"""Optional Playwright regression against dist/, using only repository fixtures.

Run after `node scripts/build_static.js` with a Python that has Playwright.
Every remote request is intercepted; no live database access is possible.
Screenshots and the result JSON are written under --artifacts (default /tmp).
"""

import argparse
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def read_fixture(relative):
    return json.loads((ROOT / "data" / relative).read_text())


def run_viewport(browser, base_url, name, artifacts):
    mobile = name == "mobile"
    context = browser.new_context(
        viewport={"width": 390 if mobile else 1440, "height": 844 if mobile else 1000},
        is_mobile=mobile, has_touch=mobile,
    )
    page = context.new_page()
    page.set_default_timeout(15000)
    errors, console_errors, unexpected, calls = [], [], [], []
    stale_script_hits = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    meta = read_fixture("index.json")
    payloads = {}
    for group in ("indicators", "assets", "stocks", "indices"):
        for item in meta.get(group, []):
            safe_code = item.get("filename") or item["code"].lstrip("^")
            file = ROOT / "data" / group / f"{safe_code}.json"
            if file.exists():
                payloads.setdefault(item["code"], json.loads(file.read_text()))
    failure = {"stocks": False}
    resize_checks = []
    assessment_checks = []
    assessment_resize_checks = []
    assessment_chart_ids = {}
    stock_codes = {item["code"] for item in meta.get("stocks", [])}

    def route_request(route):
        request = route.request
        url = urlparse(request.url)
        if request.url.startswith(base_url):
            # Simulate an existing visitor's obsolete, unversioned startup cache.
            # New HTML must request a new URL instead of opening the removed Wiki panel.
            if url.path == "/app.js" and not url.query:
                stale_script_hits.append(request.url)
                route.fulfill(content_type="application/javascript", body="""
                  document.addEventListener('DOMContentLoaded', () => {
                    document.getElementById('panel-WIKI').hidden = false;
                  });
                """)
            elif url.path == "/favicon.ico":
                route.fulfill(status=204)
            else:
                route.continue_()
            return
        calls.append({"url": request.url, "method": request.method, "body": request.post_data})
        if url.hostname != "axijsbgyktrbiigybpgq.supabase.co":
            unexpected.append(request.url)
            route.abort()
            return
        result = None
        status = 200
        if url.path.endswith("/rpc/get_app_meta"):
            result = meta
        elif url.path.endswith("/rpc/get_payload_map"):
            args = request.post_data_json
            if failure["stocks"] and stock_codes.intersection(args["p_codes"]):
                status = 403
                result = {"message": "intentional stock fixture failure"}
            else:
                result = {code: payloads[code] for code in args["p_codes"] if code in payloads}
        elif url.path == "/rest/v1/documents" and request.method == "GET":
            query = parse_qs(url.query)
            kind = query["kind"][0].removeprefix("eq.")
            key = query["key"][0].removeprefix("eq.")
            if kind == "market":
                relative = f"markets/{key}.json"
            elif kind == "value_screen":
                relative = "value_screen.json"
            else:
                unexpected.append(f"unexpected document: {kind}/{key}")
                route.abort()
                return
            file = ROOT / "data" / relative
            result = [{"payload": read_fixture(relative)}] if file.exists() else []
        else:
            unexpected.append(request.url)
            route.abort()
            return
        route.fulfill(status=status, json=result)

    context.route("**/*", route_request)

    def switch_tab(tab):
        narrow_viewport = page.viewport_size["width"] <= 900
        if narrow_viewport:
            page.locator("#sidebar-open").click()
        page.locator(f'.tab-btn[data-tab="{tab}"]').click()
        expect(page.locator(f"#panel-{tab}")).to_be_visible()
        if narrow_viewport:
            expect(page.locator("body")).not_to_have_class("sb-mobile-open")

    def visible_chart(selector):
        page.wait_for_function("""selector => {
          const canvas = document.querySelector(selector);
          const chart = canvas && Chart.getChart(canvas);
          return chart && chart.width > 0 && chart.height > 0 && chart.data.datasets[0].data.length > 0;
        }""", arg=selector)

    def check_assessment(country):
        assessment = meta["assessment_kr" if country == "KR" else "assessment"]
        primary = assessment.get("primary") if country == "US" else None
        use_primary = bool(primary and primary.get("trajectory"))
        current = primary if use_primary else assessment["full"]
        trajectory = primary["trajectory"] if use_primary else assessment.get("trajectory", [])
        selector = f"#assessment-scatter-{country}"
        expect(page.locator(f"#assessment-{country}")).to_be_visible()
        expect(page.locator(selector)).to_have_count(1)
        visible_chart(selector)
        page.wait_for_function("""selector => {
          const canvas = document.querySelector(selector);
          const chart = Chart.getChart(canvas);
          const rect = canvas.getBoundingClientRect();
          const parent = canvas.parentElement.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            && Math.abs(chart.width - rect.width) <= 2
            && Math.abs(rect.width - parent.width) <= 2
            && rect.left >= parent.left - 1 && rect.right <= parent.right + 1;
        }""", arg=selector, timeout=5000)
        actual = page.locator(selector).evaluate("""canvas => {
          const chart = Chart.getChart(canvas);
          return {
            chartId: chart.id, type: chart.config.type,
            current: chart.data.datasets.find(d => d.label === '현재').data,
            trajectory: chart.data.datasets.find(d => d.label === '최근 24개월').data,
            instances: Object.values(Chart.instances).filter(c => c.canvas === canvas).length,
            width: canvas.getBoundingClientRect().width,
            chartWidth: chart.width,
            containerWidth: canvas.parentElement.getBoundingClientRect().width
          };
        }""")
        assert actual["type"] == "scatter", actual
        assert actual["instances"] == 1, actual
        assert len(actual["current"]) == 1, actual
        assert actual["current"][0]["x"] == current["inflation_score"], actual
        assert actual["current"][0]["y"] == current["growth_score"], actual
        assert actual["current"][0]["isCurrent"] is True
        assert len(actual["trajectory"]) == len(trajectory) == 24
        assert [[p["date"], p["x"], p["y"]] for p in actual["trajectory"]] == [
            [p["date"], p["inflation_score"], p["growth_score"]] for p in trajectory]
        expected_quadrant = assessment["full"]["quadrant"].split("/")[0].replace("-edge", "")
        expect(page.locator(f"#assessment-{country}-full-quadrant")).to_have_attribute("data-quadrant", expected_quadrant)
        if country in assessment_chart_ids:
            assert actual["chartId"] == assessment_chart_ids[country], "revisit or stock retry recreated a country scatter chart"
        assessment_chart_ids[country] = actual["chartId"]
        check = {"country": country, "source": "primary" if use_primary else "full",
                 "viewport": page.viewport_size["width"], **actual}
        assessment_checks.append(check)
        return check

    def check_resized_country_charts(width, height):
        page.set_viewport_size({"width": width, "height": height})
        for country in ("KR", "US"):
            switch_tab(country)
            assessment_resize_checks.append(check_assessment(country))
            for sector in ("dollar", "inflation"):
                page.locator(f'#panel-{country} .sector-btn[data-sector="{sector}"]').click()
                selector = f"#{sector}-cards-{country} .main-chart canvas"
                visible_chart(selector)
                # Chart.js resizes asynchronously. Every visible chart must fit
                # its container and agree with its CSS width after the resize.
                page.wait_for_function("""selector => [...document.querySelectorAll(selector)].every(canvas => {
                  const chart = Chart.getChart(canvas);
                  const bounds = canvas.getBoundingClientRect();
                  const host = canvas.parentElement.getBoundingClientRect();
                  const card = canvas.closest('.card').getBoundingClientRect();
                  return chart && bounds.width > 0 && bounds.height > 0
                    && Math.abs(chart.width - bounds.width) <= 2
                    && Math.abs(bounds.width - host.width) <= 2
                    && bounds.width <= host.width + 1
                    && bounds.left >= card.left - 1 && bounds.right <= card.right + 1;
                })""", arg=selector, timeout=5000)
                metrics = page.locator(selector).evaluate_all("""canvases => ({
                  viewport: innerWidth, body: document.body.scrollWidth,
                  document: document.documentElement.scrollWidth,
                  charts: canvases.map(canvas => ({
                    width: canvas.getBoundingClientRect().width,
                    chartWidth: Chart.getChart(canvas).width,
                    containerWidth: canvas.parentElement.getBoundingClientRect().width
                  }))
                })""")
                assert max(metrics["body"], metrics["document"]) <= width + 1, metrics
                resize_checks.append({"country": country, "sector": sector, **metrics})
            page.screenshot(path=str(artifacts / f"{name}-resize-{width}-{country}.png"), full_page=True)
        return resize_checks[-4:]

    try:
        page.goto(base_url, wait_until="networkidle")
        assert not stale_script_hits, "new HTML reused the obsolete startup script URL"
        expect(page.locator(".tab-btn")).to_have_count(3)
        assert page.locator(".tab-btn").evaluate_all("buttons => buttons.map(b => b.dataset.tab)") == ["KR", "US", "STOCKS"]
        expect(page.locator(".tab-btn.active")).to_have_attribute("data-tab", "KR")
        expect(page.locator("#panel-KR")).to_be_visible()
        assert page.locator("#dollar-cards-KR .card-code").first.inner_text() == "DEXKOUS"
        expect(page.locator("#dollar-cards-KR .card-value").first).to_contain_text("₩")
        visible_chart("#dollar-cards-KR canvas")
        assert all("/rpc/" in call["url"] for call in calls)
        assert not any(stock_codes.intersection((json.loads(call["body"] or "{}" )).get("p_codes", [])) for call in calls)
        assert not page.locator('script[src*="wiki-graph"], script[src*="principles"], #panel-WIKI, #panel-PRINCIPLES, [data-sector="growth"]').count()
        assert not any("/data/wiki/" in request["name"] for request in page.evaluate("performance.getEntriesByType('resource').map(r => ({name:r.name}))"))
        page.screenshot(path=str(artifacts / f"{name}-kr.png"), full_page=True)

        for country, code in (("KR", "DEXKOUS"), ("US", "DTWEXBGS")):
            if country == "US":
                switch_tab("US")
            check_assessment(country)
            assert page.locator(f"#dollar-cards-{country} .card-code").first.inner_text() == code
            assert page.locator(f"#panel-{country} .sector-btn").evaluate_all("buttons => buttons.map(b => b.dataset.sector)") == ["dollar", "inflation"]
            page.locator(f'#panel-{country} .sector-btn[data-sector="inflation"]').click()
            visible_chart(f"#inflation-cards-{country} canvas")
            page.locator(f'#panel-{country} .sector-btn[data-sector="dollar"]').click()
            visible_chart(f"#dollar-cards-{country} canvas")
        if not mobile:
            # Reuse the already rendered charts across both breakpoints. A
            # fresh mobile page alone misses stale desktop canvas sizing.
            desktop_before = check_resized_country_charts(1440, 1000)
            narrowed = check_resized_country_charts(390, 844)
            desktop_after = check_resized_country_charts(1440, 1000)
            for before, small, after in zip(desktop_before, narrowed, desktop_after):
                assert len(before["charts"]) == len(small["charts"]) == len(after["charts"])
                assert small["charts"][0]["width"] < before["charts"][0]["width"], (before, small)
                for initial, restored in zip(before["charts"], after["charts"]):
                    assert abs(initial["width"] - restored["width"]) <= 2, (initial, restored)
            for before, small, after in zip(assessment_resize_checks[:2], assessment_resize_checks[2:4], assessment_resize_checks[4:6]):
                assert small["width"] < before["width"], (before, small)
                assert abs(before["width"] - after["width"]) <= 2, (before, after)
        if mobile:
            page.locator("#sidebar-open").click()
        page.locator("#toggle-events").uncheck()
        assert page.evaluate("APP_STATE.showEvents") is False
        page.locator("#toggle-events").check()
        assert page.evaluate("APP_STATE.showEvents") is True
        if mobile:
            page.locator("#sidebar-close").click()
        assert page.locator("body").evaluate("b => b.scrollWidth <= window.innerWidth + 1"), "country page overflows viewport"

        # Exercise the real failure UI before retrying the stock group.
        before_meta = sum(call["url"].endswith("/get_app_meta") for call in calls)
        failure["stocks"] = True
        switch_tab("STOCKS")
        expect(page.locator("#panel-STOCKS .tab-retry")).to_be_visible()
        assert page.evaluate("DATA_GROUPS.indicators.state") == "ready"
        failure["stocks"] = False
        page.locator("#panel-STOCKS .tab-retry").click()
        page.wait_for_function("DATA_GROUPS.stocks.state === 'ready'")
        expect(page.locator("#panel-STOCKS .tab-retry")).to_have_count(0)
        visible_chart("#index-cards canvas")
        assert sum(call["url"].endswith("/get_app_meta") for call in calls) == before_meta
        assert page.evaluate("""ids => Object.entries(ids).every(([country, id]) => {
          const canvas = document.getElementById(`assessment-scatter-${country}`);
          return Chart.getChart(canvas)?.id === id
            && Object.values(Chart.instances).filter(chart => chart.canvas === canvas).length === 1;
        })""", assessment_chart_ids), "stock retry changed or duplicated country assessment charts"
        page.locator('#panel-STOCKS .sector-btn[data-sector="individual"]').click()
        expect(page.locator(".stock-group").first).to_be_visible()
        page.locator("#stock-search").fill("MU")
        expect(page.locator('#stock-cards .stock-card[data-ticker="MU"]')).to_be_visible()
        visible_chart('#stock-cards .stock-card[data-ticker="MU"] canvas')
        page.locator("#stock-search").fill("")
        page.locator('#panel-STOCKS .sector-btn[data-sector="valuepicks"]').click()
        expect(page.locator("#value-screen-host .vs-pick").first).to_be_visible()
        page.locator('#panel-STOCKS .sector-btn[data-sector="valuechain"]').click()
        expect(page.locator('#vc-board [data-id="hbm"]')).to_be_visible()
        for map_id in ("power-ai", "pharma-bio", "ai-semiconductor"):
            page.locator(f'.mc-map-btn[data-map="{map_id}"]').click()
            page.wait_for_function("id => MC_STATE.mapId === id && !MC_STATE.loading && MC_STATE.map.id === id", arg=map_id)
            expect(page.locator("#vc-board .mc-node").first).to_be_visible()

        page.locator('#vc-board [data-id="hbm"]').click()
        expect(page.locator("#pm-overlay")).to_be_visible()
        page.locator("#pm-close").click()
        page.locator("#vc-detail .mc-wiki-btn").first.click()
        expect(page.locator(".wn-overlay")).to_be_visible()
        expect(page.locator("#wn-body")).not_to_contain_text("불러오는 중")
        expect(page.locator("#wn-body .wn-error")).to_have_count(0)
        old_title = page.locator("#wn-title").inner_text()
        links = page.locator('#wn-body .wn-wikilink, #wn-body a[href$=".md"]:not(.wn-deadlink)')
        navigated = False
        if links.count():
            links.first.click()
            page.wait_for_function("old => document.querySelector('#wn-title').textContent !== old", arg=old_title)
            navigated = True
        page.screenshot(path=str(artifacts / f"{name}-stock-note.png"), full_page=True)
        page.keyboard.press("Escape")
        expect(page.locator(".wn-overlay")).to_be_hidden()
        assert not errors, errors
        assert not unexpected, unexpected
        # Chromium reports the intentionally injected HTTP failures in console.
        unexpected_console = [error for error in console_errors if "403" not in error]
        assert not unexpected_console, unexpected_console
        return {"viewport": name, "page_errors": errors, "console_errors": console_errors,
                "unexpected_requests": unexpected, "intercepted_requests": len(calls),
                "note_navigation": navigated, "resize_checks": resize_checks,
                "assessment_checks": assessment_checks, "assessment_resize_checks": assessment_resize_checks,
                "status": "passed"}
    except Exception as error:
        result = {"viewport": name, "status": "failed", "failure": str(error),
                  "page_errors": errors, "console_errors": console_errors,
                  "unexpected_requests": unexpected, "intercepted_requests": len(calls)}
        (artifacts / f"{name}-failure.json").write_text(json.dumps(result, indent=2))
        page.screenshot(path=str(artifacts / f"{name}-failure.png"), full_page=True)
        print(json.dumps(result), flush=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=Path("/tmp/currency-browser-smoke"))
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT / "dist")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                for name in ("desktop", "mobile"):
                    result = run_viewport(browser, f"http://127.0.0.1:{server.server_port}/", name, args.artifacts)
                    results.append(result)
                    print(json.dumps(result), flush=True)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (args.artifacts / "results.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
