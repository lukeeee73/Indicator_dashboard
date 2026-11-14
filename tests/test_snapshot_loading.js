const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createBrowser } = require("./browser_helpers.js");
const { SNAPSHOT_PATH } = require("../scripts/dashboard_snapshot.js");

const tick = () => new Promise(setImmediate);
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const point = (value) => ({ series: [{ date: "2026-10-01", value }] });

const meta = (lastUpdated, extra = {}) => ({
  last_updated: lastUpdated,
  indicators: [{ code: "CPI" }],
  assets: [{ code: "DEXKOUS" }, { code: "DTWEXBGS" }],
  stocks: [{ code: "AAPL" }], indices: [{ code: "^GSPC" }],
  ...extra,
});

const snapshotOf = (lastUpdated, overrides = {}) => ({
  version: 1,
  meta: meta(lastUpdated, { assessment_kr: { source: "snapshot" } }),
  indicators: { CPI: point(1) },
  assets: { DEXKOUS: point(1300), DTWEXBGS: point(120) },
  ...overrides,
});

// One page load against a fake CDN (the snapshot file) and a fake Supabase.
function harness({ snapshot = null, liveMeta = meta("2026-11-09T00:00:00Z"), payload = null, metaFails = false } = {}) {
  const calls = [];
  const events = [];
  const rendered = [];
  const statuses = new Map();
  const stamps = [];
  const held = [];
  const context = createBrowser({
    console: { ...console, warn() {} },
    document: {
      addEventListener() {},
      getElementById: () => null,
      querySelector: (selector) => selector === ".tab-btn.active" ? { dataset: { tab: "KR" } } : null,
    },
    fetch: async (url, init = {}) => {
      if (url === SNAPSHOT_PATH) {
        calls.push({ url });
        if (snapshot === null) return response(null, 404);
        if (snapshot instanceof Error) throw snapshot;
        return response(snapshot);
      }
      const args = JSON.parse(init.body);
      calls.push({ url, args });
      if (url.endsWith("/get_app_meta")) {
        if (metaFails) return response(null, 403);
        return response(liveMeta);
      }
      if (payload === "hold") await new Promise((resolve) => { held.push(resolve); });
      if (payload === "fail") return response(null, 403);
      events.push("payload");
      return response(Object.fromEntries(args.p_codes.map((code) => [code, point(2)])));
    },
  });
  context.clearGlobalError = () => {};
  context.renderError = () => {};
  context.renderLastUpdated = (value) => stamps.push(value);
  context.clearTabStatus = (tab) => statuses.delete(tab);
  context.setTabStatus = (tab, state, error) => statuses.set(tab, { state, error });
  const reset = context.resetGroupContent;
  context.resetGroupContent = (group) => { events.push(`reset:${group}`); reset(group); };
  context.renderTabContent = (tab, data) => {
    events.push(`render:${tab}`);
    rendered.push({ tab, cpi: data.indicators.CPI?.series[0].value, assessment: data.assessment_kr });
  };
  const rpc = (name) => calls.filter(({ url }) => url.endsWith(`/rpc/${name}`));
  return { context, calls, events, rendered, statuses, stamps, rpc, release: () => held.splice(0).forEach((resolve) => resolve()) };
}

const state = (context, group) => vm.runInContext(`DATA_GROUPS.${group}.state`, context);

test("a valid snapshot renders the country tab without asking the database for series", async () => {
  const h = harness({ snapshot: snapshotOf("2026-11-09T00:00:00Z") });
  await h.context.loadDashboardData();
  await settle();
  assert.equal(state(h.context, "indicators"), "ready");
  assert.equal(state(h.context, "stocks"), "idle");
  assert.deepEqual(h.rendered.map(({ tab, cpi }) => [tab, cpi]), [["KR", 1]]);
  assert.equal(h.calls[0].url, SNAPSHOT_PATH, "the snapshot is requested before any database call");
  assert.equal(h.rpc("get_payload_map").length, 0);
  assert.equal(h.rpc("get_app_meta").length, 1, "one light metadata check confirms the snapshot is current");
  assert.deepEqual(h.stamps, ["2026-11-09T00:00:00Z"]);
});

test("stocks still load from the database with the codes listed in the snapshot", async () => {
  const h = harness({ snapshot: snapshotOf("2026-11-09T00:00:00Z") });
  await h.context.loadDashboardData();
  await settle();
  h.context.renderStocksTab = () => {};
  h.context.document.querySelector = () => ({ dataset: { tab: "STOCKS" } });
  h.context.ensureGroupLoaded("stocks");
  await settle();
  assert.equal(state(h.context, "stocks"), "ready");
  const stockCall = h.rpc("get_payload_map").find(({ args }) => args.p_codes.includes("AAPL"));
  assert.match(stockCall.args.p_daily_since, /^\d{4}-\d{2}-\d{2}$/);
});

test("newer database data replaces the snapshot only after it has arrived", async () => {
  const live = meta("2026-11-12T00:00:00Z", {
    indicators: [{ code: "CPI" }, { code: "PCE" }],
    assessment_kr: { source: "database" },
  });
  const h = harness({ snapshot: snapshotOf("2026-11-09T00:00:00Z"), liveMeta: live, payload: "hold" });
  await h.context.loadDashboardData();
  await settle();
  assert.deepEqual(h.rendered.map(({ cpi }) => cpi), [1]);
  const resetsBefore = h.events.filter((e) => e === "reset:indicators").length;

  // While the database answers, the snapshot cards stay on screen.
  assert.equal(h.rpc("get_payload_map").length, 2);
  assert.equal(h.events.filter((e) => e === "reset:indicators").length, resetsBefore);
  assert.equal(state(h.context, "indicators"), "ready");
  assert.ok(!h.statuses.has("KR"), "no loading message replaces visible cards");

  h.release();
  await settle();
  const requested = h.rpc("get_payload_map").flatMap(({ args }) => args.p_codes);
  assert.deepEqual(requested.sort(), ["CPI", "DEXKOUS", "DTWEXBGS", "PCE"]);
  for (const { args } of h.rpc("get_payload_map")) {
    assert.match(args.p_daily_since, /^\d{4}-\d{2}-\d{2}$/, "country series are downsampled");
    assert.match(args.p_weekly_since, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.deepEqual(h.rendered.map(({ cpi }) => cpi), [1, 2], "one re-render with database values");
  assert.deepEqual(h.rendered.at(-1).assessment, { source: "database" });
  assert.deepEqual(h.stamps, ["2026-11-09T00:00:00Z", "2026-11-12T00:00:00Z"]);
  assert.ok(vm.runInContext("_cachedData.indicators.PCE", h.context));
});

test("a database that is the same age or older than the deploy keeps the snapshot", async () => {
  for (const liveUpdated of ["2026-11-09T00:00:00Z", "2026-11-01T00:00:00Z", "not-a-date", null]) {
    const h = harness({ snapshot: snapshotOf("2026-11-09T00:00:00Z"), liveMeta: meta(liveUpdated) });
    await h.context.loadDashboardData();
    await settle();
    assert.equal(h.rpc("get_payload_map").length, 0, String(liveUpdated));
    assert.deepEqual(h.rendered.map(({ cpi }) => cpi), [1]);
  }
});

test("failed freshness checks or refreshes leave the snapshot visible and ready", async () => {
  const unreachable = harness({ snapshot: snapshotOf("2026-11-09T00:00:00Z"), metaFails: true });
  await unreachable.context.loadDashboardData();
  await settle();
  assert.equal(state(unreachable.context, "indicators"), "ready");
  assert.deepEqual(unreachable.rendered.map(({ cpi }) => cpi), [1]);

  const failing = harness({
    snapshot: snapshotOf("2026-11-09T00:00:00Z"), liveMeta: meta("2026-11-12T00:00:00Z"), payload: "fail",
  });
  await failing.context.loadDashboardData();
  await settle();
  assert.ok(failing.rpc("get_payload_map").length > 0);
  assert.equal(state(failing.context, "indicators"), "ready");
  assert.deepEqual(failing.rendered.map(({ cpi }) => cpi), [1]);
  assert.equal(failing.events.filter((e) => e === "reset:indicators").length,
    failing.events.slice(0, failing.events.indexOf("render:KR")).filter((e) => e === "reset:indicators").length,
    "a failed refresh never clears the rendered cards");
  assert.deepEqual(failing.stamps, ["2026-11-09T00:00:00Z"]);
  assert.ok(!failing.statuses.has("KR"));
});

test("missing, broken or incompatible snapshots fall back to downsampled database loading", async () => {
  const cases = {
    "not deployed": null,
    "network error": new TypeError("Failed to fetch"),
    "future format": snapshotOf("2026-11-09T00:00:00Z", { version: 2 }),
    "array meta": snapshotOf("2026-11-09T00:00:00Z", { meta: [] }),
    "no assets": snapshotOf("2026-11-09T00:00:00Z", { assets: null }),
    "missing core FX": snapshotOf("2026-11-09T00:00:00Z", { assets: { DTWEXBGS: point(120) } }),
  };
  for (const [label, snapshot] of Object.entries(cases)) {
    const h = harness({ snapshot });
    await h.context.loadDashboardData();
    await settle();
    assert.equal(state(h.context, "indicators"), "ready", label);
    assert.deepEqual(h.rendered.map(({ cpi }) => cpi), [2], label);
    const payloadCalls = h.rpc("get_payload_map");
    assert.equal(payloadCalls.length, 2, label);
    for (const { args } of payloadCalls) assert.match(args.p_daily_since, /^\d{4}-\d{2}-\d{2}$/, label);
  }
});

test("long chart ranges of downsampled series get one point per week or month", () => {
  const context = createBrowser({}, ["js/helpers.js"]);
  const days = (from, to) => {
    const out = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      out.push({ date: d.toISOString().slice(0, 10), value: d.getUTCDate() });
    }
    return out;
  };
  const year = days("2025-11-15", "2026-11-14");
  assert.equal(context.evenDensityForChart(year), year, "a one-year view keeps every day");

  // Mixed density as served: monthly history, weekly middle years, daily last year.
  const mixed = [
    ...days("2015-01-01", "2021-11-13").filter((p, i, all) => all[i + 1]?.date.slice(0, 7) !== p.date.slice(0, 7)),
    ...days("2021-11-14", "2025-11-13").filter((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 0),
    ...year,
  ];
  const all = context.evenDensityForChart(mixed);
  assert.equal(new Set(all.map((p) => p.date.slice(0, 7))).size, all.length, "one point per month");
  assert.ok(all.filter((p) => p.date >= "2025-11-15").length <= 13, "the last year no longer dominates the axis");
  assert.deepEqual(all.at(-1), mixed.at(-1), "the latest value survives");

  const fiveYears = context.evenDensityForChart(mixed.filter((p) => p.date >= "2021-11-14"));
  const weeks = fiveYears.map((p) => context.isoWeekKey(p.date));
  assert.equal(new Set(weeks).size, weeks.length, "one point per ISO week");
  assert.deepEqual(fiveYears.at(-1), mixed.at(-1));
});
