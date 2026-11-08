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

function metadataLoadBrowser(metadata) {
  const stamp = { textContent: "Loading…" };
  const calls = [];
  const statuses = new Map();
  const errors = [];
  const rendered = [];
  const context = createBrowser({
    document: {
      addEventListener() {},
      getElementById: (id) => id === "last-updated" ? stamp : null,
      querySelector: (selector) => selector === ".tab-btn.active" ? { dataset: { tab: "KR" } } : null,
    },
    fetch: async (url, init) => {
      calls.push({ url, args: JSON.parse(init.body) });
      if (url.endsWith("/get_app_meta")) return response(metadata());
      return response(Object.fromEntries(JSON.parse(init.body).p_codes.map((code) =>
        [code, { series: [{ date: "2026-10-01", value: 123 }] }])));
    },
  });
  context.clearGlobalError = () => { errors.length = 0; };
  context.renderError = (err) => errors.push(err);
  context.clearTabStatus = (tab) => statuses.delete(tab);
  context.setTabStatus = (tab, state, error) => statuses.set(tab, { state, error });
  context.renderTabContent = (tab) => rendered.push(tab);
  return { context, stamp, calls, statuses, errors, rendered };
}

const validMetadata = () => ({
  last_updated: "2026-10-01T00:00:00Z",
  indicators: [{ code: "CPI" }],
  assets: [{ code: "DEXKOUS" }, { code: "DTWEXBGS" }],
  stocks: [{ code: "MU" }], indices: [{ code: "^GSPC" }],
});

function assessmentFixture(growth, inflation) {
  const summary = { quadrant: "Q2", growth_score: growth, inflation_score: inflation,
    growth_label: "high", inflation_label: "low" };
  return {
    full: summary,
    rolling_10y: { ...summary, growth_score: growth + 2, inflation_score: inflation + 2 },
    trajectory: Array.from({ length: 24 }, (_, index) => ({
      date: new Date(Date.UTC(2024, index, 1)).toISOString().slice(0, 10),
      growth_score: growth - 12 + index / 2, inflation_score: inflation - 12 + index / 2,
    })),
  };
}

function assessmentBrowser(metadata) {
  const nodes = new Map();
  const liveCharts = new Map();
  const created = [];
  let active = "KR";
  const node = () => ({
    hidden: false, textContent: "", dataset: {}, children: [],
    classList: { toggle() {} }, querySelector() { return null; },
    querySelectorAll() { return []; }, contains() { return false; },
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
  });
  for (const country of ["KR", "US"]) {
    for (const id of [`assessment-${country}`, `assessment-scatter-${country}`, `assessment-${country}-scatter-title`,
      `assessment-${country}-note`, `assessment-${country}-primary-card`, `dollar-cards-${country}`, `inflation-cards-${country}`]) nodes.set(id, node());
    for (const prefix of ["full", "10y", "primary"]) {
      for (const field of ["quadrant", "growth", "inflation"]) nodes.set(`assessment-${country}-${prefix}-${field}`, node());
    }
  }
  const context = createBrowser({ document: {
    addEventListener() {}, getElementById: (id) => nodes.get(id) || null,
    querySelector: () => ({ dataset: { tab: active } }),
  } });
  for (const name of ["clearGlobalError", "renderLastUpdated", "clearTabStatus", "setTabStatus", "wireSectorNav"]) context[name] = () => {};
  context.sbRpc = async () => metadata;
  context.fetchPayloadMap = async (codes) => ({
    map: Object.fromEntries(codes.map((code) => [code, { series: [{ date: "2026-10-01", value: 123 }] }])), missing: [],
  });
  context.renderCard = (code) => ({ code });
  context.Chart = { getChart: (canvas) => liveCharts.get(canvas) };
  context.createChart = (canvas, config) => {
    assert.ok(!liveCharts.has(canvas), "a canvas must not have two live charts");
    const chart = { ...config, destroy() { liveCharts.delete(canvas); } };
    liveCharts.set(canvas, chart);
    created.push({ canvas, chart });
    return chart;
  };
  const visit = (country) => { active = country; context.renderTabIfReady(country); };
  return { context, nodes, liveCharts, created, visit };
}

test("assessment metadata reaches its country chart and survives revisit and retry without duplicate charts", async () => {
  const us = assessmentFixture(41, 72);
  us.primary = { ...assessmentFixture(54, 65).full, trajectory: assessmentFixture(54, 65).trajectory };
  const kr = assessmentFixture(61, 36);
  kr.primary = us.primary; // Korea must keep its own full scores even if a primary field is supplied.
  const { context, nodes, liveCharts, created, visit } = assessmentBrowser({ ...validMetadata(), assessment: us, assessment_kr: kr });
  const check = (country, assessment, current) => {
    const chart = liveCharts.get(nodes.get(`assessment-scatter-${country}`));
    assert.ok(chart, `${country} received its assessment from app metadata`);
    assert.equal(chart.type, "scatter");
    const dot = chart.data.datasets.find((dataset) => dataset.label === "현재");
    assert.equal(dot.data.length, 1);
    assert.equal(dot.data[0].x, current.inflation_score);
    assert.equal(dot.data[0].y, current.growth_score);
    const trajectory = chart.data.datasets.find((dataset) => dataset.label === "최근 24개월");
    assert.equal(trajectory.data.length, 24);
    assert.deepEqual(Array.from(trajectory.data, (point) => [point.date, point.x, point.y]),
      assessment.trajectory.map((point) => [point.date, point.inflation_score, point.growth_score]));
    assert.equal(trajectory.data.at(-1).isLast, true);
    assert.equal(nodes.get(`assessment-${country}`).hidden, false);
    assert.equal(chart.options.scales.x.min, 0);
    assert.equal(chart.options.scales.y.max, 100);
  };
  await context.loadDashboardData();
  check("KR", kr, kr.full);
  visit("US");
  check("US", us.primary, us.primary);
  for (let repeat = 0; repeat < 3; repeat++) { visit("KR"); visit("US"); }
  assert.equal(created.length, 2, "visiting a rendered country reuses its chart");
  context.retryTab("US");
  await tick();
  visit("KR");
  check("US", us.primary, us.primary);
  check("KR", kr, kr.full);
  assert.equal(liveCharts.size, 2, "retry replaces existing charts rather than leaking them");
  assert.equal(created.length, 4);
});

test("US scatter falls back to full assessment when primary trajectory is absent", () => {
  const us = assessmentFixture(42, 73);
  us.primary = { ...assessmentFixture(55, 66).full, trajectory: [] };
  const { context, nodes, liveCharts } = assessmentBrowser(validMetadata());
  context.renderAssessment(us, "US");
  const chart = liveCharts.get(nodes.get("assessment-scatter-US"));
  const dot = chart.data.datasets.find((dataset) => dataset.label === "현재").data[0];
  assert.equal(dot.x, us.full.inflation_score);
  assert.equal(dot.y, us.full.growth_score);
  assert.equal(chart.data.datasets[0].data.length, 24);
  assert.equal(chart.data.datasets[0].data[0].x, us.trajectory[0].inflation_score);
});

test("missing country assessments hide their panels while currency data still renders", async () => {
  for (const absent of [undefined, null, {}, { full: assessmentFixture(60, 30).full }]) {
    const { context, nodes, liveCharts, visit } = assessmentBrowser({ ...validMetadata(), assessment: absent, assessment_kr: absent });
    await assert.doesNotReject(context.loadDashboardData());
    visit("US");
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
    for (const country of ["KR", "US"]) {
      assert.equal(nodes.get(`assessment-${country}`).hidden, true);
      assert.equal(nodes.get(`dollar-cards-${country}`).children.length, 1);
    }
    assert.equal(liveCharts.size, 0);
  }
  const metadata = { ...validMetadata(), assessment: assessmentFixture(42, 73), assessment_kr: assessmentFixture(61, 36) };
  const { context, nodes, liveCharts, visit } = assessmentBrowser(metadata);
  await context.loadDashboardData();
  visit("US");
  assert.equal(liveCharts.size, 2);
  delete metadata.assessment;
  delete metadata.assessment_kr;
  await context.loadDashboardData();
  visit("KR");
  assert.equal(liveCharts.size, 0, "a reload without assessment data removes stale scatter charts");
  for (const country of ["KR", "US"]) assert.equal(nodes.get(`assessment-${country}`).hidden, true);
});

test("navigation exposes exactly KR, US and STOCKS with only currency and inflation country sectors", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const tabs = [...html.matchAll(/<button\b[^>]*class="tab-btn[^"]*"[^>]*data-tab="([^"]+)"/g)];
  assert.deepEqual(tabs.map((match) => match[1]), ["KR", "US", "STOCKS"]);
  assert.match(tabs[0][0], /class="tab-btn active"/);
  assert.deepEqual([...html.matchAll(/id="panel-([^"]+)"/g)].map((match) => match[1]), ["KR", "US", "STOCKS"]);
  for (const country of ["KR", "US"]) {
    const panel = html.split(`id="panel-${country}"`)[1].split(`<!-- /panel-${country} -->`)[0];
    const buttons = [...panel.matchAll(/<button\b[^>]*data-sector="([^"]+)"[^>]*>/g)];
    assert.deepEqual(buttons.map((match) => match[1]), ["dollar", "inflation"]);
    assert.match(buttons[0][0], /aria-selected="true"/);
  }
  assert.doesNotMatch(html, /id="(?:growth-cards|wiki-canvas|principles-setup)[^"]*"|data-sector="growth"/);
  for (const country of ["KR", "US"]) {
    assert.equal([...html.matchAll(new RegExp(`id="assessment-${country}"`, "g"))].length, 1);
    assert.equal([...html.matchAll(new RegExp(`id="assessment-scatter-${country}"`, "g"))].length, 1);
  }
});

test("HTML loads retained feature scripts once, in classic dependency order, before startup", () => {
  const scripts = scriptPaths();
  const app = appScriptPaths();
  assert.equal(new Set(scripts).size, scripts.length);
  assert.equal(app.at(-1), "app.js");
  assert.deepEqual(app.filter((file) => file.startsWith("js/")).sort(),
    fs.readdirSync(path.join(ROOT, "js")).filter((file) => file.endsWith(".js")).map((file) => `js/${file}`).sort());
  for (const removed of ["js/wiki-graph.js", "js/principles.js"]) assert.ok(!app.includes(removed), removed);
  for (const [dependency, consumer] of [
    ["vendor/chart.umd.js", "js/charts.js"],
    ["vendor/marked.min.js", "js/wiki-notes.js"],
    ["js/data-client.js", "js/wiki-notes.js"],
    ["js/metadata.js", "js/charts.js"],
    ["js/watchlist.js", "js/stocks.js"],
    ["js/helpers.js", "js/charts.js"],
    ["js/wiki-notes.js", "js/market-map.js"],
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
    "wnOpenByIdx", "wnCloseNote", "wnFillInlineNote", "wnWireNoteLinks", "renderAssessment", "renderScatter"]) {
    assert.equal(typeof context[name], "function", `${name} remains callable as a browser global`);
    assert.equal(vm.runInContext(`window.${name} === ${name}`, context), true);
  }
  for (const name of ["prRunScenario", "prSaveScenario", "prDeleteJournalItem", "wikiInitGraph", "wikiInitGraphLegacy"]) {
    assert.equal(typeof context[name], "undefined", `${name} is no longer loaded`);
  }
});

test("the entry point waits for DOM ready, wires navigation, then opens KR and loads data", () => {
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
  assert.deepEqual(steps, ["sidebar", "events", "KR", "data"]);
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
  let active = "KR";
  let rendered;
  const context = createBrowser({
    document: {
      addEventListener() {},
      getElementById() { return null; },
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
  context.renderTabContent = () => {};
  await context.loadDashboardData();
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url }) => /\/rpc\/(?:get_app_meta|get_payload_map)$/.test(url)),
    "initial country load must not request wiki, principles, stock documents or note exports");
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

test("stock failure and retry leave country data ready and do not refetch its group", async () => {
  let active = "KR";
  let failStocks = true;
  const calls = [];
  const renders = [];
  const context = createBrowser({
    document: { addEventListener() {}, getElementById() { return null; }, querySelector: () => ({ dataset: { tab: active } }) },
    fetch: async (url, init) => {
      const args = JSON.parse(init.body);
      calls.push({ url, args });
      if (url.endsWith("/get_app_meta")) return response({
        indicators: [{ code: "CPI" }], assets: [{ code: "DEXKOUS" }],
        stocks: [{ code: "AAPL" }], indices: [{ code: "^GSPC" }],
      });
      if (args.p_codes.includes("AAPL") && failStocks) return response(null, 403);
      return response(Object.fromEntries(args.p_codes.map((code) => [code, { series: [{ date: "2026-10-01", value: 1 }] }])));
    },
  });
  for (const name of ["clearGlobalError", "renderLastUpdated", "clearTabStatus", "setTabStatus"]) context[name] = () => {};
  context.renderTabContent = (tab) => renders.push(tab);
  context.renderStocksTab = () => renders.push("STOCKS");
  await context.loadDashboardData();
  active = "STOCKS";
  context.ensureGroupLoaded("stocks");
  await tick();
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "error");
  assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
  assert.deepEqual(renders, ["KR"]);
  failStocks = false;
  context.retryTab("STOCKS");
  await tick();
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "ready");
  assert.deepEqual(renders, ["KR", "STOCKS"]);
  assert.equal(calls.filter(({ url }) => url.endsWith("/get_app_meta")).length, 1);
  assert.equal(calls.filter(({ args }) => args.p_codes?.includes("CPI")).length, 1);
  assert.equal(calls.filter(({ args }) => args.p_codes?.includes("DEXKOUS")).length, 1);
});

test("successfully fetched malformed metadata exits loading and retries with corrected metadata", async () => {
  // These are injected reproductions of setup failures, not evidence about a
  // particular live response or the cause of a reported browser problem.
  for (const [field, value] of [["assets", {}], ["indicators", [null]]]) {
    let metadata = { ...validMetadata(), [field]: value };
    const { context, calls, statuses, errors, rendered, stamp } = metadataLoadBrowser(() => metadata);
    await assert.doesNotReject(context.loadDashboardData(), field);
    assert.equal(calls.length, 1, "the metadata request succeeded before setup failed");
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "error", field);
    assert.notEqual(vm.runInContext("DATA_GROUPS.stocks.state", context), "loading");
    for (const tab of ["KR", "US"]) assert.equal(statuses.get(tab)?.state, "error", tab);
    assert.notEqual(stamp.textContent, "Loading…");
    assert.deepEqual(rendered, []);

    metadata = validMetadata();
    context.retryTab("KR");
    await tick();
    assert.equal(calls.filter(({ url }) => url.endsWith("/get_app_meta")).length, 2,
      "setup failure must retry metadata rather than reuse a partially installed loader");
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
    assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "idle");
    assert.deepEqual(rendered, ["KR"]);
    assert.equal(errors.length, 0);
    assert.ok(!statuses.has("KR") && !statuses.has("US"));
    assert.match(stamp.textContent, /2026/);
  }
});

test("post-fetch setup exceptions reach the retry path without an unhandled rejection", async () => {
  const { context, calls, statuses, errors, rendered } = metadataLoadBrowser(validMetadata);
  const renderStamp = context.renderLastUpdated;
  const injected = new Error("injected timestamp display setup failure");
  context.renderLastUpdated = () => { throw injected; };
  await assert.doesNotReject(context.loadDashboardData());
  assert.equal(calls.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0], injected);
  assert.equal(statuses.get("KR")?.state, "error");
  assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "error");
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "error");
  assert.deepEqual(rendered, []);
  context.renderLastUpdated = renderStamp;
  context.retryTab("KR");
  await tick();
  assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "idle");
  assert.deepEqual(rendered, ["KR"]);
  assert.equal(errors.length, 0);
});

test("lazy stock request setup errors recover without reloading ready country data", async () => {
  const { context, calls, statuses, errors, rendered } = metadataLoadBrowser(validMetadata);
  await context.loadDashboardData();
  const originalDateBoundary = context._isoYearsAgo;
  context._isoYearsAgo = () => { throw new Error("injected stock request date boundary failure"); };
  context.document.querySelector = (selector) => selector === ".tab-btn.active" ? { dataset: { tab: "STOCKS" } } : null;
  context.renderStocksTab = () => rendered.push("STOCKS");
  context.ensureGroupLoaded("stocks");
  await tick();
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "error");
  assert.match(statuses.get("STOCKS").error.message, /injected stock request date boundary failure/);
  assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
  assert.deepEqual(rendered, ["KR"]);
  assert.equal(calls.length, 3, "argument setup failed before sending any stock requests");
  context._isoYearsAgo = originalDateBoundary;
  context.retryTab("STOCKS");
  await tick();
  assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "ready");
  assert.deepEqual(rendered, ["KR", "STOCKS"]);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(({ url }) => url.endsWith("/get_app_meta")).length, 1);
  assert.equal(errors.length, 0);
});

test("invalid or absent last_updated values do not prevent country data loading", async () => {
  for (const value of ["not-a-date", "2026-99-99T99:99:99Z", {}, null, ""]) {
    const { context, stamp, errors, rendered } = metadataLoadBrowser(() => ({ ...validMetadata(), last_updated: value }));
    await assert.doesNotReject(context.loadDashboardData());
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready", JSON.stringify(value));
    assert.equal(vm.runInContext("DATA_GROUPS.stocks.state", context), "idle");
    assert.equal(errors.length, 0);
    assert.deepEqual(rendered, ["KR"]);
    assert.ok(stamp.textContent.trim().length > 0);
    assert.doesNotMatch(stamp.textContent, /Loading|Invalid Date|NaN/);
    context.renderLastUpdated(validMetadata().last_updated);
    assert.match(stamp.textContent, /2026/);
    assert.match(stamp.textContent, /KST/);
  }
  const missingStamp = createBrowser();
  assert.doesNotThrow(() => missingStamp.renderLastUpdated("not-a-date"));
});

test("removed tab names and unknown handlers cannot disturb the selected country", () => {
  const context = createBrowser();
  for (const tab of ["WIKI", "PRINCIPLES", "missing", "toString", "__proto__"]) {
    for (const handler of ["switchToTab", "renderTabIfReady", "retryTab"]) {
      assert.doesNotThrow(() => context[handler](tab), `${handler}(${tab})`);
    }
  }
});

test("failed, missing or empty core FX assets require retry before rendering either country", async () => {
  for (const failure of ["request", "missing-KR", "missing-US", "empty-KR"]) {
    let mode = failure;
    let active = "KR";
    let metaCalls = 0;
    const point = { series: [{ date: "2026-10-01", value: 123 }] };
    const hosts = Object.fromEntries(["KR", "US"].flatMap((country) => ["dollar", "inflation"].map((category) =>
      [`${category}-cards-${country}`, { children: [], appendChild(card) { this.children.push(card); } }])));
    const context = createBrowser({
      console: { ...console, warn() {} },
      document: {
        addEventListener() {}, getElementById: (id) => hosts[id] || null,
        querySelector: () => ({ dataset: { tab: active } }),
      },
      fetch: async (url, init) => {
        if (url.endsWith("/get_app_meta")) {
          metaCalls++;
          return response({ indicators: [], assets: ["DEXKOUS", "DTWEXBGS", "GOLD"].map((code) => ({ code })) });
        }
        assert.ok(JSON.parse(init.body).p_codes.includes("DEXKOUS"));
        if (mode === "request") return response(null, 403);
        const map = { DEXKOUS: point, DTWEXBGS: point };
        if (mode === "missing-KR") delete map.DEXKOUS;
        if (mode === "missing-US") delete map.DTWEXBGS;
        if (mode === "empty-KR") map.DEXKOUS = { series: [] };
        return response(map);
      },
    });
    for (const name of ["clearGlobalError", "renderLastUpdated", "clearTabStatus", "setTabStatus", "wireSectorNav"]) context[name] = () => {};
    context.renderCard = (code) => ({ code });
    await context.loadDashboardData();
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "error", failure);
    assert.match(vm.runInContext("DATA_GROUPS.indicators.error.message", context), /DEXKOUS|DTWEXBGS/);
    assert.equal(vm.runInContext("_renderedTabs.size", context), 0);
    assert.equal(hosts["dollar-cards-KR"].children.length, 0);
    // A different missing FX on retry must not be masked by the prior attempt's cached payload.
    mode = failure === "missing-US" ? "missing-KR" : "missing-US";
    context.retryTab("KR");
    await tick();
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "error");
    assert.equal(vm.runInContext("_renderedTabs.size", context), 0);
    mode = "success";
    context.retryTab("KR");
    await tick();
    assert.equal(vm.runInContext("DATA_GROUPS.indicators.state", context), "ready");
    active = "US";
    context.renderTabIfReady("US");
    for (let visit = 0; visit < 3; visit++) {
      context.renderTabIfReady("KR");
      context.renderTabIfReady("US");
    }
    assert.deepEqual(hosts["dollar-cards-KR"].children.map((card) => card.code), ["DEXKOUS"]);
    assert.deepEqual(hosts["dollar-cards-US"].children.map((card) => card.code), ["DTWEXBGS"]);
    assert.equal(metaCalls, 1, "country retry must not reload metadata or stocks");
  }
});

test("currency assets render first, growth is ignored, and country boundaries remain intact", () => {
  for (const [country, primary] of [["KR", "DEXKOUS"], ["US", "DTWEXBGS"]]) {
    const hosts = Object.fromEntries(["dollar", "inflation"].map((category) => [category, {
      children: [], appendChild(card) { this.children.push(card); },
    }]));
    const context = createBrowser({ document: {
      addEventListener() {},
      getElementById: (id) => hosts[Object.keys(hosts).find((category) => id === `${category}-cards-${country}`)] || null,
    } });
    const point = { series: [{ date: "2026-10-01", value: 123 }] };
    context.wireSectorNav = () => {};
    context.renderCard = (code, payload) => ({ code, category: payload.category });
    context.renderTabContent(country, {
      assets: { DEXKOUS: point, DTWEXBGS: point },
      indicators: Object.fromEntries(["KR", "US"].flatMap((region) =>
        ["growth", "dollar", "inflation"].map((category) => [`${region}-${category}`, { ...point, region, category }]))),
    });
    assert.deepEqual(hosts.dollar.children.map((card) => card.code), [primary, `${country}-dollar`]);
    assert.deepEqual(hosts.inflation.children.map((card) => card.code), [`${country}-inflation`]);
    assert.equal(hosts.dollar.children[0].category, "dollar");
  }
});

test("shared stock notes keep wiki-link and relative markdown navigation", async () => {
  const nodes = [
    { path: "wiki/news/markets/ai/source.md", title: "Market", id: "market" },
    { path: "wiki/news/tickers/MU - Micron.md", title: "Micron", id: "ticker/micron" },
  ];
  const context = createBrowser({ fetch: async () => response({ nodes }) });
  await context.wnLoadGraph();
  const link = (attributes) => ({
    ...attributes, classList: { add() {} },
    getAttribute: () => attributes.href,
    addEventListener(name, callback) { assert.equal(name, "click"); this.click = callback; },
  });
  const wiki = link({ dataset: { wikiTarget: "Micron" } });
  const relative = link({ href: "../../tickers/MU%20-%20Micron.md#news" });
  const external = link({ href: "https://example.com/news.md" });
  const opened = [];
  context.wnWireNoteLinks({ querySelectorAll: (selector) => selector === ".wn-wikilink" ? [wiki] : [relative, external] },
    nodes[0].path, (idx) => opened.push(idx));
  for (const element of [wiki, relative]) element.click({ preventDefault() {} });
  assert.deepEqual(opened, [1, 1]);
  assert.equal(external.click, undefined);
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
