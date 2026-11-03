// Principles scenario calculation, historical episodes and the local scenario journal.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// =====================================================================
// 원칙 (Principles) 탭 — 레이 달리오식 시나리오 타임머신
//
// 과거의 한 시점(예: 1999-06)으로 돌아가 "그 때 알 수 있었던 정보만" 으로
// 국면을 확인하고, 자산배분을 정한 뒤, 나중 시점에 팔았다면 수익률이
// 어땠을지 계산한다. data/principles/timeline.json (scripts/build_principles.py
// 가 생성) 을 lazy-fetch 해서 전부 클라이언트에서 계산한다 — 백엔드 없음.
// =====================================================================

const PR_JOURNAL_KEY = "principles_journal_v1";

const PR_ASSET_META = {
  bond_us10y:     { short: "미국 10년 국채" },
  cash:           { short: "현금" },
  stock_us_sp500: { short: "미국 주식 (S&P500)" },
  stock_kr_kospi: { short: "한국 주식 (코스피)" },
  gold_xau:       { short: "금 (XAU/USD)" },
};
// 정식 순서 — 실제 사용 가능한 자산은 timeline.json 에 든 것만 (prAssets()).
// gold_xau 는 GOLD 시세가 수집된 뒤부터 나타난다.
const PR_ASSET_ORDER = ["bond_us10y", "cash", "stock_us_sp500", "stock_kr_kospi", "gold_xau"];

// 국면별 "참고용 추천 배분" — README 4분면 표(원자재·신흥국 주식·인플레연동채 /
// 선진국 주식·회사채 / 금·인플레연동채·원자재 / 장기국채·현금)를 이 레포에 있는
// 자산으로 근사한 예시일 뿐이다. 금 데이터가 없는 기간에는 prFitAllocToRange 가
// 금 비중을 나머지 자산으로 재분배한다 — 투자 조언이 아니라 비교용 참고선이다.
const PR_QUADRANT_ALLOC = {
  Q1: { bond_us10y: 10, cash: 10, stock_us_sp500: 20, stock_kr_kospi: 40, gold_xau: 20 },
  Q2: { bond_us10y: 20, cash: 10, stock_us_sp500: 55, stock_kr_kospi: 15, gold_xau: 0 },
  Q3: { bond_us10y: 10, cash: 30, stock_us_sp500: 10, stock_kr_kospi: 15, gold_xau: 35 },
  Q4: { bond_us10y: 55, cash: 25, stock_us_sp500: 10, stock_kr_kospi: 5,  gold_xau: 5 },
};

// 진입/청산 시점과 과거 국면 카드에 보여줄 시장 지표 정의.
// timeline.json 의 months[i] 에 같은 key 로 값이 실려 온다 (없으면 null).
const PR_MKT_DEFS = [
  { key: "fed_funds", label: "기준금리",  kind: "pct" },
  { key: "us10y",     label: "미 10년물", kind: "pct" },
  { key: "gold",      label: "금",       kind: "usd" },
  { key: "cpi_yoy",   label: "CPI YoY",  kind: "pct" },
];

const PR_DRAFT_PRINCIPLE = {
  Q1: "성장과 인플레가 함께 뜨거워지는 국면에서는 명목 장기채 비중을 줄이고 실물·신흥시장 비중을 늘리는 것을 원칙으로 검토한다.",
  Q2: "성장은 개선되는데 인플레가 잠잠한 국면(골디락스)에서는 위험자산(주식) 비중을 늘리는 것을 원칙으로 검토한다.",
  Q3: "성장이 꺾이는데 물가가 오르는 국면(스태그플레이션)에서는 현금·방어자산 비중을 늘리고 위험자산 비중을 줄이는 것을 원칙으로 검토한다 — 주식·채권이 동시에 흔들리기 쉬운 구간이다.",
  Q4: "성장과 물가가 함께 식는 국면에서는 장기 국채·현금 비중을 늘리는 것을 원칙으로 검토한다 — 금리 하락(채권 가격 상승) 수혜 국면이다.",
};
const PR_DRAFT_DEFAULT = "국면이 뚜렷하지 않은 경계·중립 구간에서는 특정 자산에 몰빵하기보다 배분을 분산하는 것을 원칙으로 검토한다.";

const PR_STATE = {
  data: null,
  monthsByYm: new Map(),
  monthsSorted: [],
  assetByYm: {},
  assetOrder: PR_ASSET_ORDER.slice(0, 4), // prInit 에서 실제 데이터 기준으로 갱신
  allocation: {},
  minYm: null,
  maxYm: null,
  lastScenario: null,
  pathChart: null,
  episodesByQuadrant: null, // {Q1: [{startYm, endYm, months, ongoing}], ...}
  selectedQuadrant: null,
};

// timeline.json 에 실제로 존재하는 자산만, 정식 순서대로.
function prAssets() { return PR_STATE.assetOrder; }

// 프리셋을 사용 가능한 자산 기준으로 동적 생성 — 금 자산이 생기면 자동 반영.
function prPresetAlloc(key) {
  const order = prAssets();
  const alloc = {};
  for (const k of order) alloc[k] = 0;
  const single = {
    all_bond: "bond_us10y", all_cash: "cash", all_us: "stock_us_sp500",
    all_kr: "stock_kr_kospi", all_gold: "gold_xau",
  }[key];
  if (single && order.includes(single)) {
    alloc[single] = 100;
    return alloc;
  }
  // balanced (기본): 균등분산 + 반올림 잔여분은 첫 자산에
  const w = Math.floor(100 / order.length);
  for (const k of order) alloc[k] = w;
  alloc[order[0]] += 100 - w * order.length;
  return alloc;
}

// ---------- 날짜(YYYY-MM) 유틸 ----------
function prYm(dateStr) { return dateStr.slice(0, 7); }
function prYmToN(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}
function prNToYm(n) {
  const y = Math.floor(n / 12);
  const m = (n % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function prAddMonths(ym, delta) { return prNToYm(prYmToN(ym) + delta); }
function prMonthsBetween(a, b) { return prYmToN(b) - prYmToN(a); }

function prFmtPct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(digits)}%`;
}
function prSignAttr(x) {
  if (x == null || Number.isNaN(x)) return "";
  return x > 0.0001 ? "pos" : (x < -0.0001 ? "neg" : "");
}

// ---------- 시장 지표(기준금리/10년물/금/CPI) 표시 유틸 ----------
function prFmtMktValue(def, value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (def.kind === "usd") return `$${Math.round(value).toLocaleString("en-US")}`;
  return `${value.toFixed(2)}%`;
}

// 두 시점 사이 지표 변화: 금리·CPI 는 %p 차이, 금은 % 변화율.
function prFmtMktDelta(def, v0, v1) {
  if (v0 == null || v1 == null) return null;
  if (def.kind === "usd") {
    const pct = v1 / v0 - 1;
    return { text: prFmtPct(pct), sign: prSignAttr(pct) };
  }
  const diff = v1 - v0;
  const sign = prSignAttr(diff);
  const arrow = diff > 0.001 ? "▲" : (diff < -0.001 ? "▼" : "");
  return { text: `${arrow}${Math.abs(diff).toFixed(2)}%p`, sign };
}

// 한 시점의 시장 지표 칩 목록 (진입 스냅샷·과거 국면 카드 공용).
function prMarketChips(row) {
  if (!row) return "";
  const chips = PR_MKT_DEFS.map((def) => {
    const val = prFmtMktValue(def, row[def.key]);
    const yoy = def.key === "gold" && row.gold_yoy != null
      ? ` <small>(YoY ${row.gold_yoy > 0 ? "+" : ""}${row.gold_yoy.toFixed(1)}%)</small>` : "";
    return `<span class="pr-mkt-chip">${escapeHtml(def.label)} <b>${escapeHtml(val)}</b>${yoy}</span>`;
  });
  return `<div class="pr-mkt-chips">${chips.join("")}</div>`;
}

// 아직 수집 전(available=false)인 지표 안내 문구.
function prMissingIndicatorNote() {
  const mi = PR_STATE.data.market_indicators || {};
  const missing = PR_MKT_DEFS
    .filter((d) => mi[d.key] && mi[d.key].available === false)
    .map((d) => d.label);
  if (missing.length === 0) return "";
  return `<p class="pr-mkt-missing">${escapeHtml(missing.join(", "))} 데이터는 다음 주간 데이터 갱신 때 채워집니다.</p>`;
}

// ---------- 진입점 ----------
async function renderPrinciplesTab() {
  const setup = document.getElementById("principles-setup");
  if (!setup) return;
  try {
    const data = await sbDoc("principles", "timeline");
    prInit(data);
  } catch (err) {
    setup.hidden = false;
    setup.innerHTML = emptyMessage(
      `시나리오 데이터를 불러오지 못했습니다 (${err.message}).`,
    );
  }
}

function prInit(data) {
  PR_STATE.data = data;
  for (const row of data.months) {
    PR_STATE.monthsByYm.set(prYm(row.date), row);
  }
  PR_STATE.monthsSorted = data.months.map((r) => prYm(r.date));
  PR_STATE.minYm = PR_STATE.monthsSorted[0];
  PR_STATE.maxYm = PR_STATE.monthsSorted[PR_STATE.monthsSorted.length - 1];

  for (const [key, asset] of Object.entries(data.assets)) {
    if (asset.synthetic_flat) continue;
    const map = new Map();
    for (const p of asset.index) map.set(prYm(p.date), p.value);
    PR_STATE.assetByYm[key] = map;
  }

  PR_STATE.assetOrder = PR_ASSET_ORDER.filter((k) => k === "cash" || data.assets[k]);
  PR_STATE.allocation = prPresetAlloc("balanced");
  PR_STATE.episodesByQuadrant = prBuildEpisodes(data.months);

  const setup = document.getElementById("principles-setup");
  setup.hidden = false;

  const entryInput = document.getElementById("pr-entry-date");
  const exitInput  = document.getElementById("pr-exit-date");
  entryInput.min = PR_STATE.minYm; entryInput.max = PR_STATE.maxYm;
  exitInput.min  = PR_STATE.minYm; exitInput.max  = PR_STATE.maxYm;

  const wantDefault = "1999-06";
  const defaultEntry = (prYmToN(wantDefault) >= prYmToN(PR_STATE.minYm) &&
                        prYmToN(wantDefault) <= prYmToN(PR_STATE.maxYm))
    ? wantDefault : PR_STATE.minYm;
  entryInput.value = defaultEntry;
  exitInput.value  = PR_STATE.maxYm;

  prRenderAllocGrid();
  prRenderPresetRow();
  prRenderEntrySnapshot();

  entryInput.addEventListener("change", prRenderEntrySnapshot);
  document.getElementById("pr-run-btn").addEventListener("click", prRunScenario);
  document.getElementById("pr-save-btn").addEventListener("click", prSaveScenario);
  document.getElementById("pr-journal-export").addEventListener("click", prExportJournal);
  document.getElementById("pr-journal-clear").addEventListener("click", prClearJournal);

  prInitSimilar();
  prRenderJournal();
}

// ---------- 자산배분 UI ----------
function prRenderAllocGrid() {
  const host = document.getElementById("pr-alloc-grid");
  host.innerHTML = prAssets().map((key) => {
    const meta = PR_ASSET_META[key];
    const asset = PR_STATE.data.assets[key];
    const w = PR_STATE.allocation[key] ?? 0;
    const note = asset.synthetic_flat
      ? asset.note
      : `데이터 범위: ${asset.start.slice(0, 7)} ~ ${asset.end.slice(0, 7)}`;
    return `
      <div class="pr-alloc-item" data-asset="${key}">
        <div class="pr-alloc-name"><span>${escapeHtml(meta.short)}</span><b data-role="val">${w}%</b></div>
        <input type="range" class="pr-alloc-range" data-asset="${key}" min="0" max="100" step="1" value="${w}">
        <div class="pr-alloc-note">${escapeHtml(note)}</div>
      </div>`;
  }).join("");

  host.querySelectorAll(".pr-alloc-range").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.asset;
      PR_STATE.allocation[key] = Number(input.value);
      host.querySelector(`.pr-alloc-item[data-asset="${key}"] b[data-role="val"]`).textContent = `${input.value}%`;
      prUpdateAllocTotal();
    });
  });
  prUpdateAllocTotal();
}

function prUpdateAllocTotal() {
  const total = prAssets().reduce((s, k) => s + (PR_STATE.allocation[k] || 0), 0);
  const el = document.getElementById("pr-alloc-total-val");
  el.textContent = total;
  el.parentElement.classList.toggle("pr-alloc-bad", total !== 100);
  return total;
}

function prRenderPresetRow() {
  const host = document.getElementById("pr-preset-row");
  const hasGold = prAssets().includes("gold_xau");
  const presets = [
    { key: "all_bond", label: "100% 국채" },
    { key: "all_cash", label: "100% 현금" },
    { key: "all_us",   label: "100% 미국주식" },
    { key: "all_kr",   label: "100% 코스피" },
    ...(hasGold ? [{ key: "all_gold", label: "100% 금" }] : []),
    { key: "balanced", label: "균등분산" },
    { key: "quadrant", label: "이 국면 추천 배분" },
  ];
  host.innerHTML = presets.map((p) =>
    `<button type="button" class="pr-preset-btn" data-preset="${p.key}">${escapeHtml(p.label)}</button>`,
  ).join("");
  host.querySelectorAll(".pr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => prApplyPreset(btn.dataset.preset));
  });
}

// 추천 배분 중 이 기간에 데이터가 없는 자산(예: 2006년 이전 S&P500)은 0으로
// 낮추고, 남은 자산끼리 비중을 다시 100%로 재분배한다.
function prFitAllocToRange(alloc, entryYm, exitYm) {
  const available = {};
  let availSum = 0;
  for (const k of prAssets()) {
    const w = alloc[k] || 0;
    if (w > 0 && prAssetRangeOk(k, entryYm, exitYm)) { available[k] = w; availSum += w; }
  }
  if (availSum === 0) return prPresetAlloc("all_cash");
  const out = {};
  for (const k of prAssets()) out[k] = 0;
  for (const [k, w] of Object.entries(available)) out[k] = Math.round((w / availSum) * 100);
  const diff = 100 - prAssets().reduce((s, k) => s + out[k], 0);
  if (diff !== 0) {
    const biggest = Object.keys(available).reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[biggest] += diff;
  }
  return out;
}

function prApplyPreset(key) {
  let alloc;
  if (key === "quadrant") {
    const entryYm = document.getElementById("pr-entry-date").value;
    const exitYm  = document.getElementById("pr-exit-date").value;
    const row = PR_STATE.monthsByYm.get(entryYm);
    const q = row ? row.quadrant : null;
    const base = PR_QUADRANT_ALLOC[q] || prPresetAlloc("balanced");
    alloc = prFitAllocToRange(base, entryYm, exitYm);
  } else {
    alloc = prPresetAlloc(key);
  }
  PR_STATE.allocation = { ...alloc };
  prRenderAllocGrid();
}

// ---------- 진입 시점 국면 스냅샷 ----------
function prRenderEntrySnapshot() {
  const host = document.getElementById("pr-entry-snapshot");
  const ym = document.getElementById("pr-entry-date").value;
  const row = PR_STATE.monthsByYm.get(ym);
  if (!row) {
    host.innerHTML = `<p class="pr-snapshot-empty">이 시점의 국면 데이터가 없습니다.</p>`;
    return;
  }
  const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : "";
  const playbook = PR_STATE.data.quadrant_playbook[q] || null;
  host.innerHTML = `
    <div class="assessment-card assessment-card-primary">
      <div class="aw-header">
        <span class="aw-title">${escapeHtml(ym)} 시점의 국면</span>
        <span class="aw-sub">그 때 알 수 있었던 데이터만 사용 (발표 지연 반영, 모델 H)</span>
      </div>
      <div class="aw-quadrant" data-quadrant="${escapeHtml(q)}">${escapeHtml(row.quadrant || "—")}${playbook ? ` · ${escapeHtml(playbook.label)}` : ""}</div>
      <div class="aw-scores">
        <span class="aw-score">성장 <b data-label="${row.growth_label || ""}">${row.growth_score ?? "—"}</b></span>
        <span class="aw-score">인플레 <b data-label="${row.inflation_label || ""}">${row.inflation_score ?? "—"}</b></span>
      </div>
      <div class="pr-snapshot-market">
        <span class="pr-mkt-title">그 때의 시장 지표</span>
        ${prMarketChips(row)}
      </div>
    </div>
    ${prMissingIndicatorNote()}
    ${playbook ? `<p class="pr-snapshot-hint">${escapeHtml(playbook.hint)} — ${escapeHtml(playbook.principle)}</p>` : ""}
    ${q ? `<button type="button" class="pr-similar-jump" data-quadrant="${q}">🔍 과거의 ${q} 국면들과 비교하기 ↓</button>` : ""}
  `;
  const jumpBtn = host.querySelector(".pr-similar-jump");
  if (jumpBtn) {
    jumpBtn.addEventListener("click", () => {
      prSelectQuadrant(jumpBtn.dataset.quadrant);
      document.getElementById("pr-similar").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

// ---------- 시뮬레이션 엔진 ----------
function prAssetValueAt(key, ym) {
  if (key === "cash") return 100;
  const map = PR_STATE.assetByYm[key];
  return map ? (map.get(ym) ?? null) : null;
}

function prAssetRangeOk(key, entryYm, exitYm) {
  if (key === "cash") return true;
  const asset = PR_STATE.data.assets[key];
  if (!asset) return false;
  return entryYm >= asset.start.slice(0, 7) && exitYm <= asset.end.slice(0, 7);
}

// 진입~청산 사이 인플레이션 누적 배수. entry 로부터 정확히 12개월씩 떨어진
// 월(연간 YoY)만 체인으로 곱해 오차를 피하고, 마지막 잔여 개월(<12)만
// 최근 YoY 로 선형(기하) 근사한다.
function prInflationMultiple(entryYm, exitYm) {
  const totalMonths = prMonthsBetween(entryYm, exitYm);
  const fullYears = Math.floor(totalMonths / 12);
  const remainder = totalMonths - fullYears * 12;
  let mult = 1;
  for (let k = 1; k <= fullYears; k++) {
    const row = PR_STATE.monthsByYm.get(prAddMonths(entryYm, k * 12));
    if (row && row.cpi_yoy != null) mult *= (1 + row.cpi_yoy / 100);
  }
  if (remainder > 0) {
    const row = PR_STATE.monthsByYm.get(exitYm);
    if (row && row.cpi_yoy != null) mult *= Math.pow(1 + row.cpi_yoy / 100, remainder / 12);
  }
  return mult;
}

// buy & hold 가정: 자산별 (청산가/진입가) 를 비중으로 가중합.
function prPortfolioMultiple(alloc, entryYm, exitYm) {
  let mult = 0;
  let totalWeight = 0;
  for (const key of prAssets()) {
    const w = alloc[key] || 0;
    if (w <= 0) continue;
    totalWeight += w;
    const v0 = prAssetValueAt(key, entryYm);
    const v1 = prAssetValueAt(key, exitYm);
    if (v0 == null || v1 == null) return null;
    mult += (w / 100) * (v1 / v0);
  }
  if (totalWeight === 0) return null;
  return mult;
}

function prInRecession(ym) {
  for (const ep of PR_STATE.data.recession_episodes) {
    const start = prAddMonths(ep.peak, 1);
    if (ym >= start && ym <= ep.trough) return true;
  }
  return false;
}
function prInInflationEpisode(ym) {
  for (const ep of PR_STATE.data.inflation_episodes) {
    if (ym >= ep.start && ym <= ep.end) return true;
  }
  return false;
}

function prShowError(msg) {
  const el = document.getElementById("pr-error");
  el.hidden = false;
  el.textContent = msg;
  document.getElementById("pr-result").hidden = true;
}

function prRunScenario() {
  const errEl = document.getElementById("pr-error");
  errEl.hidden = true;

  const entryYm = document.getElementById("pr-entry-date").value;
  const exitYm  = document.getElementById("pr-exit-date").value;
  const total = prUpdateAllocTotal();

  if (!entryYm || !exitYm) return prShowError("진입/청산 시점을 선택하세요.");
  if (prYmToN(exitYm) <= prYmToN(entryYm)) return prShowError("청산 시점은 진입 시점보다 뒤여야 합니다.");
  if (total !== 100) return prShowError(`자산배분 합계가 ${total}% 입니다 — 100%로 맞춰주세요.`);

  const missing = prAssets().filter(
    (k) => (PR_STATE.allocation[k] || 0) > 0 && !prAssetRangeOk(k, entryYm, exitYm),
  );
  if (missing.length > 0) {
    const names = missing.map((k) => PR_ASSET_META[k].short).join(", ");
    return prShowError(`${names} 은(는) 이 기간의 데이터가 없습니다. 기간을 조정하거나 비중을 0으로 낮춰주세요.`);
  }

  const alloc = { ...PR_STATE.allocation };
  const portfolioMult = prPortfolioMultiple(alloc, entryYm, exitYm);
  if (portfolioMult == null) return prShowError("수익률을 계산할 수 없습니다 (데이터 누락).");

  const monthsHeld = prMonthsBetween(entryYm, exitYm);
  const years = monthsHeld / 12;
  const cagr = Math.pow(portfolioMult, 1 / years) - 1;
  const inflMult = prInflationMultiple(entryYm, exitYm);
  const realMult = portfolioMult / inflMult;

  const benchmarks = prAssets().map((key) => {
    const ok = prAssetRangeOk(key, entryYm, exitYm);
    const mult = ok ? prPortfolioMultiple({ [key]: 100 }, entryYm, exitYm) : null;
    return { key, label: PR_ASSET_META[key].short, ret: mult != null ? mult - 1 : null };
  });

  const entryRow = PR_STATE.monthsByYm.get(entryYm);
  const exitRow  = PR_STATE.monthsByYm.get(exitYm);
  const q = entryRow && ["Q1", "Q2", "Q3", "Q4"].includes(entryRow.quadrant) ? entryRow.quadrant : null;
  // 추천 배분에 든 자산 중 이 기간 데이터가 없는 것(예: 초기 금·S&P500)은
  // 나머지 자산으로 재분배해 비교가 항상 가능하게 한다.
  const recommendedAlloc = q ? prFitAllocToRange(PR_QUADRANT_ALLOC[q], entryYm, exitYm) : null;
  let recommendedRet = null;
  if (recommendedAlloc) {
    const okAll = prAssets().every(
      (k) => (recommendedAlloc[k] || 0) === 0 || prAssetRangeOk(k, entryYm, exitYm),
    );
    if (okAll) {
      const m = prPortfolioMultiple(recommendedAlloc, entryYm, exitYm);
      if (m != null) recommendedRet = m - 1;
    }
  }

  const pathYms = PR_STATE.monthsSorted.filter((ym) => ym >= entryYm && ym <= exitYm);
  const pathRows = pathYms.map((ym) => PR_STATE.monthsByYm.get(ym));
  let transitions = 0, recessionMonths = 0, inflationMonths = 0;
  for (let i = 0; i < pathRows.length; i++) {
    if (i > 0 && pathRows[i].quadrant !== pathRows[i - 1].quadrant) transitions++;
    if (prInRecession(pathYms[i])) recessionMonths++;
    if (prInInflationEpisode(pathYms[i])) inflationMonths++;
  }

  const scenario = {
    entryYm, exitYm, monthsHeld, allocation: alloc,
    totalReturn: portfolioMult - 1, cagr, realReturn: realMult - 1,
    benchmarks, recommendedRet, entryQuadrant: q,
    transitions, recessionMonths, inflationMonths,
    pathYms, pathRows,
    entryRow, exitRow,
  };
  PR_STATE.lastScenario = scenario;
  prRenderResult(scenario);
}

// ---------- 결과 렌더링 ----------
function prRenderResult(sc) {
  document.getElementById("pr-result").hidden = false;

  document.getElementById("pr-metric-months").textContent = `${sc.monthsHeld}개월`;

  const totalEl = document.getElementById("pr-metric-total");
  totalEl.textContent = prFmtPct(sc.totalReturn);
  totalEl.dataset.sign = prSignAttr(sc.totalReturn);

  const cagrEl = document.getElementById("pr-metric-cagr");
  cagrEl.textContent = prFmtPct(sc.cagr);
  cagrEl.dataset.sign = prSignAttr(sc.cagr);

  const realEl = document.getElementById("pr-metric-real");
  realEl.textContent = prFmtPct(sc.realReturn);
  realEl.dataset.sign = prSignAttr(sc.realReturn);

  const benchHost = document.getElementById("pr-benchmarks");
  benchHost.innerHTML = sc.benchmarks.map((b) => {
    const color = b.ret == null ? "var(--text-dim)" : (b.ret >= 0 ? "var(--up)" : "var(--down)");
    const val = b.ret == null ? "데이터없음" : prFmtPct(b.ret);
    return `<span>${escapeHtml(b.label)} 100%: <b style="color:${color}">${val}</b></span>`;
  }).join("");

  prRenderIndicatorCompare(sc);
  prRenderPathStrip(sc);
  prRenderPathChart(sc);
  document.getElementById("pr-insight").innerHTML = prBuildInsight(sc);
}

// 진입 vs 청산 시점의 시장 지표(기준금리·10년물·금·CPI) 비교표.
function prRenderIndicatorCompare(sc) {
  const host = document.getElementById("pr-indicator-compare");
  if (!host) return;
  const rows = PR_MKT_DEFS.map((def) => {
    const v0 = sc.entryRow ? sc.entryRow[def.key] : null;
    const v1 = sc.exitRow ? sc.exitRow[def.key] : null;
    const delta = prFmtMktDelta(def, v0, v1);
    const deltaHtml = delta
      ? `<span class="pr-ic-delta" data-sign="${delta.sign}">${escapeHtml(delta.text)}</span>`
      : "—";
    return `
      <tr>
        <th>${escapeHtml(def.label)}</th>
        <td>${escapeHtml(prFmtMktValue(def, v0))}</td>
        <td>${escapeHtml(prFmtMktValue(def, v1))}</td>
        <td>${deltaHtml}</td>
      </tr>`;
  }).join("");
  host.innerHTML = `
    <h3>진입 vs 청산 시점의 시장 지표</h3>
    <table class="pr-ic-table">
      <thead>
        <tr>
          <th></th>
          <th>진입 (${escapeHtml(sc.entryYm)})</th>
          <th>청산 (${escapeHtml(sc.exitYm)})</th>
          <th>변화</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${prMissingIndicatorNote()}
  `;
}

function prRenderPathStrip(sc) {
  const host = document.getElementById("pr-path-strip");
  host.innerHTML = sc.pathRows.map((row, i) => {
    const ym = sc.pathYms[i];
    const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : "";
    const rec  = prInRecession(ym) ? "1" : "0";
    const infl = prInInflationEpisode(ym) ? "1" : "0";
    return `<div class="pr-path-cell" data-quadrant="${q}" data-recession="${rec}" ` +
           `data-inflation-episode="${infl}" title="${escapeHtml(ym)} · ${escapeHtml(row.quadrant || "—")}"></div>`;
  }).join("");
}

function prRenderPathChart(sc) {
  const canvas = document.getElementById("pr-path-canvas");
  if (!canvas) return;
  if (PR_STATE.pathChart) { PR_STATE.pathChart.destroy(); PR_STATE.pathChart = null; }
  // eslint-disable-next-line no-undef
  PR_STATE.pathChart = createChart(canvas, {
    type: "line",
    data: {
      labels: sc.pathYms,
      datasets: [
        {
          label: "성장 점수", data: sc.pathRows.map((r) => r.growth_score),
          borderColor: "#c8d8ea", backgroundColor: "transparent",
          borderWidth: 1.5, pointRadius: 0, tension: 0.15,
        },
        {
          label: "인플레 점수", data: sc.pathRows.map((r) => r.inflation_score),
          borderColor: "#cc2424", backgroundColor: "transparent",
          borderWidth: 1.5, pointRadius: 0, tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#787878", font: { size: 10 } } },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: { ticks: { color: "#787878", maxTicksLimit: 8, font: { size: 9 } }, grid: { color: "#1c1c1c" } },
        y: { min: 0, max: 100, ticks: { color: "#787878", font: { size: 9 } }, grid: { color: "#222222" } },
      },
    },
  });
}

function prBuildInsight(sc) {
  const q = sc.entryQuadrant;
  const playbook = q ? PR_STATE.data.quadrant_playbook[q] : null;
  const draft = q ? (PR_DRAFT_PRINCIPLE[q] || PR_DRAFT_DEFAULT) : PR_DRAFT_DEFAULT;
  const allocSummary = PR_ASSET_ORDER
    .filter((k) => (sc.allocation[k] || 0) > 0)
    .map((k) => `${PR_ASSET_META[k].short} ${sc.allocation[k]}%`)
    .join(" · ");

  const lines = [];
  lines.push(
    `진입 시점(${escapeHtml(sc.entryYm)})의 국면은 <strong>${escapeHtml(q || "경계/중립")}</strong>` +
    `${playbook ? ` (${escapeHtml(playbook.label)})` : ""}이었다.`,
  );
  if (playbook) {
    lines.push(`역사적으로 이 국면에서 유리했던 자산: ${escapeHtml(playbook.hint)}. ${escapeHtml(playbook.principle)}`);
  }
  lines.push(
    `보유 ${sc.monthsHeld}개월 동안 국면이 ${sc.transitions}번 바뀌었고, ` +
    `${sc.recessionMonths}개월은 NBER 공식 침체, ${sc.inflationMonths}개월은 고인플레 episode 구간과 겹쳤다.`,
  );
  const mktMoves = PR_MKT_DEFS
    .map((def) => {
      const v0 = sc.entryRow ? sc.entryRow[def.key] : null;
      const v1 = sc.exitRow ? sc.exitRow[def.key] : null;
      if (v0 == null || v1 == null) return null;
      return `${def.label} ${prFmtMktValue(def, v0)} → ${prFmtMktValue(def, v1)}`;
    })
    .filter(Boolean);
  if (mktMoves.length > 0) {
    lines.push(`같은 기간 시장 지표는 ${escapeHtml(mktMoves.join(", "))} 로 움직였다.`);
  }
  lines.push(
    `내 배분(${escapeHtml(allocSummary)})의 실현수익률은 <strong>${prFmtPct(sc.totalReturn)}</strong> ` +
    `(연환산 ${prFmtPct(sc.cagr)}, 물가반영 실질 ${prFmtPct(sc.realReturn)}).`,
  );
  if (sc.recommendedRet != null) {
    lines.push(
      `같은 기간 이 국면의 '참고용 추천 배분'을 따랐다면 <strong>${prFmtPct(sc.recommendedRet)}</strong> 였다 ` +
      `(원자재·금 데이터가 없어 코스피·현금으로 근사한 예시 배분 — 투자 조언 아님).`,
    );
  }
  lines.push(`원칙 초안: ${escapeHtml(draft)}`);
  return lines.join("\n\n");
}

// =====================================================================
// 비슷한 과거 국면 찾기 — 4분면 필터
//
// "내가 지금 Q1 에 있다면, 과거의 Q1 들은 어떻게 흘러갔나?" 를 보여준다.
// 월별 타임라인에서 같은 분면이 연속된 구간(episode)을 묶고, 각 구간의
// 시장 지표(기준금리·10년물·금·CPI) 변화와 자산 성과를 카드로 나열한다.
// =====================================================================

const PR_EPISODE_PAGE = 10; // 처음에 보여줄 에피소드 수

// 같은 분면이 연속된 구간들. 경계(edge) 판정 월은 구간을 끊는다.
function prBuildEpisodes(months) {
  const out = { Q1: [], Q2: [], Q3: [], Q4: [] };
  let cur = null;
  for (const row of months) {
    const ym = prYm(row.date);
    const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : null;
    if (cur && q === cur.quadrant) {
      cur.endYm = ym;
      cur.months++;
    } else {
      if (cur) out[cur.quadrant].push(cur);
      cur = q ? { quadrant: q, startYm: ym, endYm: ym, months: 1 } : null;
    }
  }
  if (cur) out[cur.quadrant].push(cur);
  const lastYm = months.length > 0 ? prYm(months[months.length - 1].date) : null;
  for (const q of Object.keys(out)) {
    for (const ep of out[q]) ep.ongoing = ep.endYm === lastYm;
    out[q].reverse(); // 최신순
  }
  return out;
}

function prRangeReturn(assetKey, startYm, endYm) {
  const map = PR_STATE.assetByYm[assetKey];
  if (!map) return null;
  const v0 = map.get(startYm);
  const v1 = map.get(endYm);
  if (v0 == null || v1 == null) return null;
  return v1 / v0 - 1;
}

// 가장 최근의 뚜렷한(Q1~Q4) 분면. isNow 는 그것이 최신 월인 경우에만 true —
// 최신 월이 경계/중립 판정이면 "지금 여기" 로 표시하지 않는다.
function prCurrentQuadrant() {
  for (let i = PR_STATE.monthsSorted.length - 1; i >= 0; i--) {
    const ym = PR_STATE.monthsSorted[i];
    const row = PR_STATE.monthsByYm.get(ym);
    if (row && ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant)) {
      return { quadrant: row.quadrant, ym, isNow: ym === PR_STATE.maxYm };
    }
  }
  return null;
}

function prInitSimilar() {
  const section = document.getElementById("pr-similar");
  if (!section) return;
  section.hidden = false;

  const current = prCurrentQuadrant();
  const host = document.getElementById("pr-quad-filter");
  host.innerHTML = ["Q1", "Q2", "Q3", "Q4"].map((q) => {
    const pb = PR_STATE.data.quadrant_playbook[q];
    const nowBadge = current && current.quadrant === q
      ? `<em class="pr-quad-now">${current.isNow ? "지금 여기" : `최근 (${escapeHtml(current.ym)})`}</em>` : "";
    return `
      <button type="button" class="pr-quad-btn" data-quadrant="${q}">
        <b>${q}</b>
        <span>${escapeHtml(pb ? pb.label : "")}</span>
        ${nowBadge}
      </button>`;
  }).join("");
  host.querySelectorAll(".pr-quad-btn").forEach((btn) => {
    btn.addEventListener("click", () => prSelectQuadrant(btn.dataset.quadrant));
  });

  prSelectQuadrant(current ? current.quadrant : "Q2");
}

function prSelectQuadrant(q) {
  PR_STATE.selectedQuadrant = q;
  PR_STATE.similarShowAll = false;
  document.querySelectorAll("#pr-quad-filter .pr-quad-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.quadrant === q);
  });
  prRenderEpisodes(q);
}

// 에피소드 구간에 NBER 침체가 한 달이라도 겹치는가
function prEpisodeHasRecession(ep) {
  for (let ym = ep.startYm; ym <= ep.endYm; ym = prAddMonths(ym, 1)) {
    if (prInRecession(ym)) return true;
  }
  return false;
}

function prEpisodeIndicatorRows(startRow, endRow, singleMonth) {
  return PR_MKT_DEFS.map((def) => {
    const v0 = startRow ? startRow[def.key] : null;
    const v1 = endRow ? endRow[def.key] : null;
    if (v0 == null && v1 == null) return "";
    // 1개월짜리 국면은 시작=끝이므로 화살표 없이 그 달의 값만 보여준다.
    if (singleMonth) {
      return `
        <div class="pr-ep-ind-row">
          <span class="pr-ep-ind-label">${escapeHtml(def.label)}</span>
          <span class="pr-ep-ind-vals">${escapeHtml(prFmtMktValue(def, v1 ?? v0))}</span>
        </div>`;
    }
    const delta = prFmtMktDelta(def, v0, v1);
    const deltaHtml = delta
      ? ` <span class="pr-ic-delta" data-sign="${delta.sign}">${escapeHtml(delta.text)}</span>` : "";
    return `
      <div class="pr-ep-ind-row">
        <span class="pr-ep-ind-label">${escapeHtml(def.label)}</span>
        <span class="pr-ep-ind-vals">${escapeHtml(prFmtMktValue(def, v0))} → ${escapeHtml(prFmtMktValue(def, v1))}${deltaHtml}</span>
      </div>`;
  }).join("");
}

const PR_EP_ASSETS = [
  ["stock_us_sp500", "S&P500"],
  ["stock_kr_kospi", "코스피"],
  ["gold_xau", "금"],
  ["bond_us10y", "채권(근사)"],
];

// 국면 중 자산 수익률의 기준점은 국면 시작 전월 말 — 국면에 들어선 첫 달의
// 움직임까지 포함한다 (전월 데이터가 없으면 시작월 기준으로 폴백).
function prEpisodeReturn(assetKey, ep) {
  const prevYm = prAddMonths(ep.startYm, -1);
  const r = prRangeReturn(assetKey, prevYm, ep.endYm);
  return r != null ? r : prRangeReturn(assetKey, ep.startYm, ep.endYm);
}

function prEpisodeAssetPerf(ep) {
  const parts = [];
  for (const [key, label] of PR_EP_ASSETS) {
    const r = prEpisodeReturn(key, ep);
    if (r == null) continue;
    parts.push(`${escapeHtml(label)} <b data-sign="${prSignAttr(r)}">${prFmtPct(r)}</b>`);
  }
  return parts.length > 0 ? parts.join(" · ") : `<span class="pr-ep-nodata">이 구간의 자산 가격 데이터 없음</span>`;
}

// 국면 종료 후 12개월 동안의 자산 성과 — "그 다음에 무슨 일이 있었나".
function prEpisodeAfterPerf(ep) {
  if (ep.ongoing) return "";
  const afterYm = prAddMonths(ep.endYm, 12);
  if (afterYm > PR_STATE.maxYm) return "";
  const parts = [];
  for (const [key, label] of PR_EP_ASSETS) {
    const r = prRangeReturn(key, ep.endYm, afterYm);
    if (r == null) continue;
    parts.push(`${escapeHtml(label)} <b data-sign="${prSignAttr(r)}">${prFmtPct(r)}</b>`);
  }
  if (parts.length === 0) return "";
  return `<div class="pr-ep-after">국면 종료 후 12개월: ${parts.join(" · ")}</div>`;
}

function prRenderEpisodes(q) {
  const episodes = (PR_STATE.episodesByQuadrant && PR_STATE.episodesByQuadrant[q]) || [];
  const summaryHost = document.getElementById("pr-quad-summary");
  const listHost = document.getElementById("pr-episode-list");
  const pb = PR_STATE.data.quadrant_playbook[q];
  const current = prCurrentQuadrant();

  if (episodes.length === 0) {
    summaryHost.innerHTML = "";
    listHost.innerHTML = `<p class="pr-journal-empty">${q} 국면으로 판정된 과거 구간이 없습니다.</p>`;
    return;
  }

  const avgMonths = episodes.reduce((s, ep) => s + ep.months, 0) / episodes.length;
  const spReturns = episodes
    .map((ep) => prEpisodeReturn("stock_us_sp500", ep))
    .filter((r) => r != null);
  const avgSp = spReturns.length > 0
    ? spReturns.reduce((s, r) => s + r, 0) / spReturns.length : null;

  summaryHost.innerHTML = `
    <div class="pr-quad-summary-card" data-quadrant="${q}">
      <p>
        <strong>${q} · ${escapeHtml(pb ? pb.label : "")}</strong> 국면은 1980년 이후
        <b>${episodes.length}번</b> 있었고, 평균 <b>${avgMonths.toFixed(1)}개월</b> 지속됐다.
        ${avgSp != null ? `국면 중 S&P500 평균 수익률은 <b data-sign="${prSignAttr(avgSp)}">${prFmtPct(avgSp)}</b> (데이터가 있는 ${spReturns.length}개 구간 기준).` : ""}
        ${current && current.quadrant === q
          ? (current.isNow
              ? `<em class="pr-quad-now-inline">지금(${escapeHtml(current.ym)})이 바로 이 국면이다.</em>`
              : `<em class="pr-quad-now-inline">가장 최근엔 ${escapeHtml(current.ym)}에 이 국면이었다 (그 이후는 경계/중립 판정).</em>`)
          : ""}
      </p>
      ${pb ? `<p class="pr-snapshot-hint">${escapeHtml(pb.hint)} — ${escapeHtml(pb.principle)}</p>` : ""}
    </div>`;

  const showAll = PR_STATE.similarShowAll;
  const visible = showAll ? episodes : episodes.slice(0, PR_EPISODE_PAGE);
  const cards = visible.map((ep) => {
    const startRow = PR_STATE.monthsByYm.get(ep.startYm);
    const endRow = PR_STATE.monthsByYm.get(ep.endYm);
    const badges = [
      ep.ongoing ? `<em class="pr-ep-badge pr-ep-ongoing">진행 중</em>` : "",
      prEpisodeHasRecession(ep) ? `<em class="pr-ep-badge pr-ep-recession">NBER 침체 겹침</em>` : "",
    ].join("");
    return `
      <div class="pr-episode-card" data-quadrant="${q}">
        <div class="pr-ep-head">
          <b>${escapeHtml(ep.startYm)} ~ ${escapeHtml(ep.endYm)}</b>
          <span>${ep.months}개월</span>
          ${badges}
        </div>
        <div class="pr-ep-ind">${prEpisodeIndicatorRows(startRow, endRow, ep.months === 1)}</div>
        <div class="pr-ep-assets">국면 중 성과: ${prEpisodeAssetPerf(ep)}</div>
        ${prEpisodeAfterPerf(ep)}
      </div>`;
  }).join("");

  const moreBtn = !showAll && episodes.length > PR_EPISODE_PAGE
    ? `<button type="button" class="pr-ep-more" id="pr-ep-more">전체 ${episodes.length}개 구간 모두 보기</button>` : "";
  listHost.innerHTML = cards + moreBtn + prMissingIndicatorNote();

  const moreEl = document.getElementById("pr-ep-more");
  if (moreEl) {
    moreEl.addEventListener("click", () => {
      PR_STATE.similarShowAll = true;
      prRenderEpisodes(q);
    });
  }
}

// ---------- 원칙 저널 (localStorage) ----------
function prLoadJournal() {
  try {
    return JSON.parse(localStorage.getItem(PR_JOURNAL_KEY) || "[]");
  } catch {
    return [];
  }
}
function prSaveJournalList(list) {
  localStorage.setItem(PR_JOURNAL_KEY, JSON.stringify(list));
}

function prSaveScenario() {
  const sc = PR_STATE.lastScenario;
  if (!sc) return;
  const list = prLoadJournal();
  list.unshift({
    savedAt: new Date().toISOString(),
    entryYm: sc.entryYm, exitYm: sc.exitYm, monthsHeld: sc.monthsHeld,
    allocation: sc.allocation, totalReturn: sc.totalReturn, cagr: sc.cagr,
    realReturn: sc.realReturn, entryQuadrant: sc.entryQuadrant,
    insight: prBuildInsight(sc).replace(/<[^>]+>/g, ""),
  });
  prSaveJournalList(list);
  prRenderJournal();
}

function prRenderJournal() {
  const host = document.getElementById("pr-journal-list");
  const list = prLoadJournal();
  if (list.length === 0) {
    host.innerHTML = `<p class="pr-journal-empty">아직 저장된 시나리오가 없습니다. 위에서 계산 후 "원칙 저널에 저장"을 눌러보세요.</p>`;
    return;
  }
  host.innerHTML = list.map((item, i) => {
    const allocSummary = PR_ASSET_ORDER
      .filter((k) => (item.allocation[k] || 0) > 0)
      .map((k) => `${PR_ASSET_META[k].short} ${item.allocation[k]}%`)
      .join(" · ");
    return `
      <div class="pr-journal-item">
        <div class="pr-journal-item-head">
          <b>${escapeHtml(item.entryYm)} → ${escapeHtml(item.exitYm)}</b>
          <span>(${item.monthsHeld}개월, 진입국면 ${escapeHtml(item.entryQuadrant || "—")})</span>
          <span class="pr-journal-item-return" data-sign="${prSignAttr(item.totalReturn)}">${prFmtPct(item.totalReturn)}</span>
        </div>
        <div class="pr-journal-item-alloc">${escapeHtml(allocSummary)}</div>
        <div class="pr-journal-item-note">${escapeHtml(item.insight)}</div>
        <button type="button" class="pr-journal-item-del" data-idx="${i}">삭제</button>
      </div>`;
  }).join("");
  host.querySelectorAll(".pr-journal-item-del").forEach((btn) => {
    btn.addEventListener("click", () => prDeleteJournalItem(Number(btn.dataset.idx)));
  });
}

function prDeleteJournalItem(idx) {
  const list = prLoadJournal();
  list.splice(idx, 1);
  prSaveJournalList(list);
  prRenderJournal();
}

function prExportJournal() {
  const list = prLoadJournal();
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `principles-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function prClearJournal() {
  if (!confirm("저장된 모든 시나리오를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
  prSaveJournalList([]);
  prRenderJournal();
}
