const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { buildStatic } = require("../scripts/build_static.js");
const {
  SNAPSHOT_PATH, buildDashboardSnapshot, downsampleSeries, isoWeekKey,
} = require("../scripts/dashboard_snapshot.js");
const { createBrowser } = require("./browser_helpers.js");

const NOW = new Date("2026-11-14T05:00:00Z");

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    "index.html": '<script src="app.js"></script>',
    "app.js": "", "style.css": "", "js/.keep": "", "vendor/.keep": "",
  };
  for (const [relative, content] of Object.entries({ ...base, ...files })) {
    const dest = path.join(root, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

const daily = (from, to, value = (i) => i) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`), i = 0; d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1), i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: value(i) });
  }
  return out;
};

test("ISO week keys match Postgres IYYY-IW at year boundaries", () => {
  assert.equal(isoWeekKey("2021-01-03"), "2020-53");
  assert.equal(isoWeekKey("2021-01-04"), "2021-01");
  assert.equal(isoWeekKey("2024-12-30"), "2025-01");
  assert.equal(isoWeekKey("2026-11-14"), "2026-46");
});

test("downsampling keeps every recent day and the last point of each older week and month", () => {
  const points = daily("2020-12-20", "2026-11-14");
  const out = downsampleSeries(points, "2025-11-14", "2021-11-14");
  const recent = out.filter((p) => p.date >= "2025-11-14");
  assert.equal(recent.length, points.filter((p) => p.date >= "2025-11-14").length);
  const weekly = out.filter((p) => p.date >= "2021-11-14" && p.date < "2025-11-14");
  assert.equal(new Set(weekly.map((p) => isoWeekKey(p.date))).size, weekly.length);
  assert.ok(weekly.slice(0, -1).every((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 0),
    "a full ISO week keeps its Sunday");
  const monthly = out.filter((p) => p.date < "2021-11-14");
  assert.deepEqual(monthly.slice(0, 2).map((p) => p.date), ["2020-12-31", "2021-01-31"]);
  assert.equal(out.at(-1).date, "2026-11-14", "the latest value always survives");
  assert.deepEqual(downsampleSeries(points, null, null), points, "no boundaries keeps the full history");
});

test("snapshot payloads follow get_payload_map and sync_supabase rules", (t) => {
  const root = fixture(t, {
    "data/index.json": {
      last_updated: "2026-11-09T19:15:29Z",
      assessment_kr: { quadrant: "Q2" },
      indicators: [
        { code: "DGS10", name: "10Y", exclude_assessment: true },
        { code: "KRCPI", region: "KR" },
      ],
      assets: [{ code: "DEXKOUS", name: "KRW" }, { code: "DGS10" }, { code: "GOLD", region: null }],
      indices: [{ code: "^GSPC", filename: "GSPC" }],
      stocks: [{ code: "AAPL", name: "Apple", valuation_summary: { signal: "expensive" } }],
    },
    "data/indicators/DGS10.json": {
      name: "", unit: "percent", category: "dollar", current: { value: 4.8 }, exclude_assessment: false,
      note: "kept as a detail",
      series: [{ date: "2026-11-04", value: 4.7 }, { date: "2026-11-02", value: 4.6 },
        { date: "2026-11-03", value: null }, { date: "2026-11-05T00:00:00", value: 4.8 }],
    },
    "data/indicators/KRCPI.json": { name: "Korea CPI", unit: "%", category: "inflation", current: null, series: [] },
    "data/assets/DEXKOUS.json": { name: "", unit: "KRW", series: [{ date: "2026-11-01", value: 1300 }] },
    "data/assets/DGS10.json": { name: "asset copy", series: [{ date: "2020-01-01", value: 1 }] },
    "data/assets/GOLD.json": { unit: "USD", series: [{ date: "2026-11-01", value: 4000 }] },
  });
  const snapshot = buildDashboardSnapshot(root, { now: NOW });
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.daily_since, "2025-11-14");
  assert.equal(snapshot.weekly_since, "2021-11-14");
  assert.deepEqual(snapshot.meta.stocks, [{ code: "AAPL" }], "stock notes are not shipped on the first screen");
  assert.deepEqual(snapshot.meta.assessment_kr, { quadrant: "Q2" });

  // The indicator row wins for a code that is also an asset, as in the database.
  assert.deepEqual(snapshot.assets.DGS10, snapshot.indicators.DGS10);
  assert.deepEqual(snapshot.indicators.DGS10, {
    name: "10Y", unit: "percent", category: "dollar", region: "US", current: { value: 4.8 },
    exclude_assessment: false, note: "kept as a detail",
    series: [{ date: "2026-11-02", value: 4.6 }, { date: "2026-11-04", value: 4.7 }, { date: "2026-11-05", value: 4.8 }],
  });
  assert.deepEqual(snapshot.indicators.KRCPI, {
    name: "Korea CPI", unit: "%", category: "inflation", region: "KR", series: [],
  });
  assert.deepEqual(snapshot.assets.DEXKOUS, {
    name: "KRW", unit: "KRW", region: "US", series: [{ date: "2026-11-01", value: 1300 }],
  });
  assert.deepEqual(snapshot.assets.GOLD, { name: "GOLD", unit: "USD", series: [{ date: "2026-11-01", value: 4000 }] },
    "an explicit null region is stripped like jsonb_strip_nulls");
  assert.equal(snapshot.stocks, undefined);
});

test("the build publishes the snapshot at the path the browser requests", (t) => {
  const root = fixture(t, {
    "data/index.json": { last_updated: "2026-11-09T19:15:29Z", indicators: [], assets: [{ code: "DEXKOUS" }] },
    "data/assets/DEXKOUS.json": { name: "KRW", series: [{ date: "2026-11-01", value: 1300 }] },
  });
  const output = buildStatic(root, { now: NOW });
  const written = JSON.parse(fs.readFileSync(path.join(output, SNAPSHOT_PATH), "utf8"));
  assert.equal(written.assets.DEXKOUS.series[0].value, 1300);
  const browser = createBrowser({}, ["js/data-client.js"]);
  assert.equal(vm.runInContext("DASHBOARD_SNAPSHOT_URL", browser), SNAPSHOT_PATH);
  assert.equal(browser.isValidDashboardSnapshot(written), true);
});

test("unreadable source data skips the snapshot without failing the UI build", (t) => {
  const root = fixture(t, {
    "data/index.json": { last_updated: "2026-11-09T19:15:29Z", indicators: [{ code: "MISSING" }], assets: [] },
  });
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  const output = buildStatic(root, { now: NOW });
  assert.ok(fs.existsSync(path.join(output, "index.html")));
  assert.equal(fs.existsSync(path.join(output, SNAPSHOT_PATH)), false);
  assert.match(warnings.join("\n"), /스냅샷/);
});

test("a stale snapshot never survives a rebuild that cannot produce a new one", (t) => {
  const root = fixture(t, {
    "data/index.json": { last_updated: "2026-11-09T19:15:29Z", indicators: [], assets: [] },
  });
  const output = buildStatic(root, { now: NOW });
  assert.ok(fs.existsSync(path.join(output, SNAPSHOT_PATH)));
  fs.rmSync(path.join(root, "data/index.json"));
  buildStatic(root, { now: NOW });
  assert.equal(fs.existsSync(path.join(output, SNAPSHOT_PATH)), false);
});
