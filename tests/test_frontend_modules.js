const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT, appScriptPaths, scriptPaths, createBrowser } = require("./browser_helpers.js");

const tick = () => new Promise(setImmediate);
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

test("HTML loads all feature scripts once, in classic dependency order, before startup", () => {
  const scripts = scriptPaths();
  const app = appScriptPaths();
  assert.equal(new Set(scripts).size, scripts.length);
  assert.equal(app.at(-1), "app.js");
  assert.deepEqual(app.filter((file) => file.startsWith("js/")).sort(),
    fs.readdirSync(path.join(ROOT, "js")).filter((file) => file.endsWith(".js")).map((file) => `js/${file}`).sort());
  for (const [dependency, consumer] of [
    ["vendor/chart.umd.js", "js/charts.js"],
    ["vendor/marked.min.js", "js/wiki-notes.js"],
    ["js/data-client.js", "js/wiki-notes.js"],
    ["js/metadata.js", "js/charts.js"],
    ["js/watchlist.js", "js/stocks.js"],
    ["js/helpers.js", "js/charts.js"],
    ["js/wiki-notes.js", "js/wiki-graph.js"],
    ["js/market-map.js", "js/player-map.js"],
    ["js/value-screen.js", "js/stocks.js"],
    ["js/stocks.js", "js/dashboard.js"],
  ]) {
    assert.ok(scripts.indexOf(dependency) >= 0 && scripts.indexOf(dependency) < scripts.indexOf(consumer), `${dependency} before ${consumer}`);
  }
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const [tag] of html.matchAll(/<script\b[^>]*\bsrc=["'](?:js\/|app\.js)[^>]*>/g)) {
    assert.doesNotMatch(tag, /\basync\b|\btype=["']module["']/);
  }
  const registered = [];
  const context = createBrowser({
    document: { addEventListener: (name) => registered.push(name) },
  });
  assert.deepEqual(registered, ["keydown", "DOMContentLoaded"]);
  for (const name of ["sbRpc", "sbDoc", "fetchPayloadMap", "renderChart", "switchToTab", "loadDashboardData",
    "renderStockCard", "renderValuePicks", "mcSwitchMap", "mcToggleFull", "pmOpen", "pmClose",
    "prRunScenario", "prSaveScenario", "prDeleteJournalItem", "wnOpenByIdx", "wnCloseNote", "wikiInitGraph", "wikiInitGraphLegacy"]) {
    assert.equal(typeof context[name], "function", `${name} remains callable as a browser global`);
    assert.equal(vm.runInContext(`window.${name} === ${name}`, context), true);
  }
});

test("the entry point waits for DOM ready, wires navigation, then opens wiki and loads data", () => {
  let ready;
  let click;
  const steps = [];
  const context = createBrowser({
    document: {
      addEventListener(name, callback) { if (name === "DOMContentLoaded") ready = callback; },
      querySelectorAll(selector) {
        assert.equal(selector, ".tab-btn");
        return [{ dataset: { tab: "STOCKS" }, addEventListener(name, callback) { assert.equal(name, "click"); click = callback; } }];
      },
    },
  });
  context.initSidebar = () => steps.push("sidebar");
  context.wireEventsToggle = () => steps.push("events");
  context.switchToTab = (tab) => steps.push(tab);
  context.loadDashboardData = () => steps.push("data");
  assert.deepEqual(steps, []);
  ready();
  assert.deepEqual(steps, ["sidebar", "events", "WIKI", "data"]);
  click();
  assert.equal(steps.at(-1), "STOCKS");
});

test("map listeners remain safe between classic script loads", () => {
  const listeners = [];
  const context = createBrowser({
    document: {
      addEventListener(name, callback) { if (name === "keydown") listeners.push(callback); },
      getElementById() { return null; },
    },
    addEventListener(name, callback) {
      if (["resize", "mousemove", "mouseup"].includes(name)) listeners.push(callback);
    },
  }, []);
  for (const file of appScriptPaths()) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
    // Downloads can yield to user input before the following script has run.
    for (const callback of listeners) assert.doesNotThrow(() => callback({ key: "Escape" }), file);
  }
  assert.equal(listeners.length, 4);
});

test("dashboard data groups load indicators first and fetch stocks only on demand", async () => {
  const requests = [];
  let active = "WIKI";
  let rendered;
  const context = createBrowser({
    document: {
      addEventListener() {},
      querySelector: () => ({ dataset: { tab: active } }),
    },
    fetch: async (url, init) => {
      const args = JSON.parse(init.body);
      requests.push({ url, args });
      if (url.endsWith("/get_app_meta")) return response({
        last_updated: "2026-10-01T00:00:00Z",
        indicators: [{ code: "T10Y2Y" }], assets: [{ code: "GOLD" }],
        stocks: [{ code: "AAPL" }], indices: [{ code: "^GSPC" }],
      });
      return response(Object.fromEntries(args.p_codes.map((code) => [code, { series: [{ date: "2026-10-01", value: 1 }] }])));
    },
  });
  context.clearGlobalError = () => {};
  context.renderLastUpdated = () => {};
  context.clearTabStatus = () => {};
  context.setTabStatus = () => {};
  context.renderStocksTab = (data) => { rendered = data; };
  await context.loadDashboardData();
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(({ args }) => args.p_codes), [["T10Y2Y"], ["GOLD"]]);
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "idle");
  assert.equal(rendered, undefined);
  active = "STOCKS";
  context.ensureGroupLoaded("stocks");
  await tick();
  assert.equal(requests.length, 5);
  const stockArgs = requests.find(({ args }) => args.p_codes?.includes("AAPL")).args;
  assert.match(stockArgs.p_daily_since, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(stockArgs.p_weekly_since, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(requests.find(({ args }) => args.p_codes?.includes("^GSPC")).args.p_daily_since, undefined);
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "ready");
  assert.ok(rendered.stocks.AAPL);
  assert.ok(rendered.indices["^GSPC"]);
  context.ensureGroupLoaded("stocks");
  await tick();
  assert.equal(requests.length, 5);
});

test("wiki data is static first, cached, indexed and able to fall back for note bodies", async () => {
  const calls = [];
  const graph = { nodes: [{ path: "wiki/news/tickers/MU - Micron.md", title: "Micron" }] };
  const context = createBrowser({ fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === "data/wiki/graph.json") return response(graph);
    if (url === "data/wiki/notes/0.json") return response(null, 404);
    return response([{ payload: { content: "fallback note" } }]);
  } });
  const first = context.wnLoadGraph();
  assert.equal(context.wnLoadGraph(), first);
  assert.deepEqual(await first, graph);
  assert.equal(context.wnNodeByPath("./WIKI/NEWS/TICKERS/MU - MICRON.MD"), 0);
  assert.equal(context.wnNodeByTicker("mu"), 0);
  assert.deepEqual(await context.wnLoadNote(0), { content: "fallback note" });
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[1].url, "data/wiki/notes/0.json");
  assert.equal(new URL(calls[2].url).searchParams.get("kind"), "eq.wiki_note");
});

test("wiki graph and notes use database documents when static data is absent", async () => {
  const calls = [];
  const graph = { nodes: [{ path: "wiki/concepts/test.md", title: "test" }] };
  const context = createBrowser({ fetch: async (url) => {
    calls.push(url);
    if (url === "data/wiki/graph.json") return response(null, 404);
    const kind = new URL(url).searchParams.get("kind");
    return response([{ payload: kind === "eq.wiki" ? graph : { content: "database note" } }]);
  } });
  assert.deepEqual(await context.wnLoadGraph(), graph);
  assert.deepEqual(await context.wnLoadNote(0), { content: "database note" });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.startsWith("data/")).length, 1);
});

test("watchlist generator updates the split module and remains idempotent in an isolated fixture", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-watchlist-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "js"));
  fs.writeFileSync(path.join(root, "scripts/fetch_fred.py"), "# before\nSTOCKS: dict[str, dict] = {\n}\n# after\n");
  fs.writeFileSync(path.join(root, "scripts/competitors.py"), "# before\nCOMPETITORS: dict[str, list[str]] = {\n}\n# after\n");
  const initial = fs.readFileSync(path.join(ROOT, "js/watchlist.js"), "utf8");
  fs.writeFileSync(path.join(root, "js/watchlist.js"), initial + "\n// fixture sentinel\n");
  fs.writeFileSync(path.join(root, "app.js"), "/* entry point stays separate */\n");
  const venvPython = path.join(ROOT, ".venv", "bin", "python");
  const python = process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : "python3");
  const run = () => execFileSync(python, ["-B", "-c", `
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / "scripts"))
import gen_watchlist
gen_watchlist.ROOT = Path(sys.argv[2])
gen_watchlist.main()
`, ROOT, root], { encoding: "utf8" });
  run();
  const first = fs.readFileSync(path.join(root, "js/watchlist.js"), "utf8");
  run();
  assert.equal(fs.readFileSync(path.join(root, "js/watchlist.js"), "utf8"), first);
  assert.match(first, /\/\/ fixture sentinel/);
  const snapshot = "\nJSON.stringify({ STOCK_META, STOCK_GROUPS, PEER_COMPETITORS })";
  assert.equal(vm.runInNewContext(first + snapshot), vm.runInNewContext(initial + snapshot));
  assert.equal(fs.readFileSync(path.join(root, "app.js"), "utf8"), "/* entry point stays separate */\n");
  for (const file of ["fetch_fred.py", "competitors.py"]) {
    const text = fs.readFileSync(path.join(root, "scripts", file), "utf8");
    assert.match(text, /^# before\n/);
    assert.match(text, /\n# after\n$/);
  }
});
