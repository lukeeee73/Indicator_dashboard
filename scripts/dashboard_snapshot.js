const fs = require("node:fs");
const path = require("node:path");

// First-screen snapshot for the country tabs (indicators + assets), built at deploy time.
//
// The browser used to ask Supabase's get_payload_map for the full daily history of
// every indicator and asset on each visit (~4.5MB of JSON, 2–3 s of database work per
// call). This file is the same payload, downsampled exactly like the RPC does with
// p_daily_since / p_weekly_since, so the CDN can serve it in one small request.
// Supabase stays the source of truth: the page checks get_app_meta afterwards and
// reloads from the database when it holds newer data than this snapshot.

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_PATH = "data/snapshot/dashboard.json";
const DAILY_YEARS = 1;
const WEEKLY_YEARS = 5;

// Same precedence as scripts/sync_supabase.py SERIES_GROUPS: a later group replaces the
// database row of an earlier one with the same code (DGS10 is an asset and an indicator).
const SERIES_GROUPS = [
  ["assets", "asset", "assets"],
  ["indices", "index", "indices"],
  ["stocks", "stock", "stocks"],
  ["indicators", "indicator", "indicators"],
];

// Fields sync_supabase.optional_details() leaves out of series.details.
const NON_DETAIL_KEYS = new Set(["name", "unit", "series", "category", "current", "sector", "group", "region", "source"]);

// Python truthiness, so `a or b` from sync_supabase.py resolves the same way here.
function pyTruthy(value) {
  if (value == null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
const pyOr = (...values) => values.find(pyTruthy) ?? values[values.length - 1];

function isoYearsBefore(now, years) {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Postgres to_char(date, 'IYYY-IW'): ISO-8601 week-numbering year and week.
function isoWeekKey(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);           // Thursday decides the ISO year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

// Mirrors get_payload_map's bucketing: daily from dailySince, one point per ISO week
// from weeklySince, one per month before that, always keeping the bucket's last point.
function downsampleSeries(points, dailySince, weeklySince) {
  const bucketOf = (date) => {
    if (!dailySince || date >= dailySince) return `d${date}`;
    if (weeklySince && date >= weeklySince) return `w${isoWeekKey(date)}`;
    return `m${date.slice(0, 7)}`;
  };
  const out = [];
  let lastBucket = null;
  for (const point of points) {
    const bucket = bucketOf(point.date);
    if (bucket === lastBucket) out[out.length - 1] = point;
    else out.push(point);
    lastBucket = bucket;
  }
  return out;
}

// Observations as the database holds them: rows without a date or value are skipped by
// sync_supabase.observation_rows_since, one row per date, ordered by date.
function observations(series) {
  if (!Array.isArray(series)) throw new TypeError("series가 배열이 아닙니다");
  const byDate = new Map();
  for (const point of series) {
    if (!point || point.date == null || point.value == null) continue;
    const date = String(point.date).slice(0, 10);
    byDate.set(date, { date, value: point.value });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The object get_payload_map returns for one code (see its SQL definition):
// strip_nulls(base) || current || exclude_assessment || details || series.
function rpcPayload(kind, item, file, series) {
  const base = {
    name: pyOr(file.name, item.name, item.code),
    unit: kind === "stock" || kind === "index" ? null : pyOr(file.unit, item.unit),
    category: pyOr(file.category, item.category),
    region: pyOr(file.region, "region" in item ? item.region : "US"),
    sector: pyOr(file.sector, item.sector),
    group: pyOr(file.group, item.group),
  };
  const payload = Object.fromEntries(Object.entries(base).filter(([, value]) => value != null));
  if (kind !== "stock" && file.current != null) payload.current = file.current;
  if (pyTruthy(item.exclude_assessment)) payload.exclude_assessment = true;
  for (const [key, value] of Object.entries(file)) {
    if (!NON_DETAIL_KEYS.has(key)) payload[key] = value;
  }
  payload.series = series;
  return payload;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function buildDashboardSnapshot(root, { now = new Date() } = {}) {
  const dataRoot = path.join(root, "data");
  const meta = readJson(path.join(dataRoot, "index.json"));
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new TypeError("index.json 최상위 값이 객체가 아닙니다");

  // Last group wins, exactly like the database rows written by sync_supabase.py.
  const owner = new Map();
  for (const [groupKey, kind, directory] of SERIES_GROUPS) {
    const items = meta[groupKey] ?? [];
    if (!Array.isArray(items)) throw new TypeError(`index.json의 ${groupKey}가 배열이 아닙니다`);
    for (const item of items) owner.set(item.code, { kind, directory, item });
  }

  const dailySince = isoYearsBefore(now, DAILY_YEARS);
  const weeklySince = isoYearsBefore(now, WEEKLY_YEARS);
  const cache = new Map();
  const payloadOf = (code) => {
    if (!cache.has(code)) {
      const { kind, directory, item } = owner.get(code);
      const file = readJson(path.join(dataRoot, directory, `${item.filename || code}.json`));
      const series = downsampleSeries(observations(file.series ?? []), dailySince, weeklySince);
      cache.set(code, rpcPayload(kind, item, file, series));
    }
    return cache.get(code);
  };
  const mapOf = (groupKey) => Object.fromEntries((meta[groupKey] ?? []).map(({ code }) => [code, payloadOf(code)]));

  return {
    version: SNAPSHOT_VERSION,
    generated_at: now.toISOString(),
    daily_since: dailySince,
    weekly_since: weeklySince,
    // Stock entries carry valuation notes the first screen never reads; codes are enough
    // to load the stocks tab later.
    meta: { ...meta, stocks: (meta.stocks ?? []).map(({ code }) => ({ code })) },
    indicators: mapOf("indicators"),
    assets: mapOf("assets"),
  };
}

// Reads data/ before dist/ is replaced. Without data/index.json (fixtures, partial
// checkouts) or with unreadable source data there is no snapshot, and the page loads
// from Supabase as before; a data problem must not block a UI deploy.
function prepareDashboardSnapshot(root, options) {
  if (!fs.existsSync(path.join(root, "data", "index.json"))) return null;
  try {
    return buildDashboardSnapshot(root, options);
  } catch (err) {
    console.warn(`대시보드 스냅샷을 만들지 못해 Supabase 로딩으로 대체합니다: ${err.message}`);
    return null;
  }
}

function writeDashboardSnapshot(output, snapshot) {
  const destination = path.join(output, SNAPSHOT_PATH);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(snapshot));
  return destination;
}

module.exports = {
  SNAPSHOT_PATH,
  buildDashboardSnapshot,
  downsampleSeries,
  isoWeekKey,
  prepareDashboardSnapshot,
  writeDashboardSnapshot,
};
