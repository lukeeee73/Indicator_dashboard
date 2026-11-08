// Market cascade view, edges, news and shared wiki links.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ════════════════════════════════════════════════════════════════════════
//  시장 구조도 (market diagram) — 공급의 뿌리(좌) → 최종 수요(우)
// ════════════════════════════════════════════════════════════════════════
//
// 기업이 아니라 '시장' 단위로 본 밸류체인 다이어그램. 산업별 지도를
// MARKET_MAPS 레지스트리(탭)로 전환한다 — AI·반도체 / 제약·바이오.
// 메인 체인(장비·소재 → 제조 → … → 자본 → 수요/지불자) + 하단 밴드로
// 배치되고, 모든 관계선이 항상 그려진다.
// 데이터 SSOT 는  data/markets/<id>.json  (지도당 1개)이며, 노드·관계·
// 병목·플레이어는 물론 다이어그램 배치(diagram 블록)까지 이 JSON 이 정한다.
//
// 색은 절제한다: '독점(structural)'·'병목(acute/easing/emerging)'만 색으로
// 강조하고, 그 외(수요 한계형·비병목)는 사이트 기본 톤(중립 회색)을 따른다.
//
// 시장 노드는 소속 기업(players[].ticker 중 watchlist 종목)의
// narrative_score 를 자동 집계해 "시장 분위기" 로 보여주고,
// weekly_note(주간 흐름)는 market-research 루틴이 채운다.
//
// 시장 단위 뉴스는 맵과 분리된  data/markets/news/<id>.json  에
// 시장 id 별로 누적된다. 웹은 노드 배지(건수·최신일), 노드 클릭 상세,
// 보드 하단의 통합 뉴스 피드(클릭 → 해당 시장 선택) 세 곳에 꽂아 보여준다.
//
// 세부 시장을 기업 단위로 확대한 '플레이어 지도'는 markets[].player_map 이
// 가리키는  data/markets/players/<id>.json  에 정의한다 (예: HBM). 해당
// 노드를 클릭하면 전용 화면(오버레이)이 열린다 — 아래 '플레이어 지도' 섹션.

// 시장 지도 레지스트리 — data/markets/<id>.json (+ news/<id>.json) 쌍을 추가하면 탭이 생긴다.
const MARKET_MAPS = [
  { id: "ai-semiconductor", label: "AI · 반도체" },
  { id: "power-ai",         label: "전력 · AI 인프라" },
  { id: "pharma-bio",       label: "제약 · 바이오" },
];
const MC_STATE = { mapId: MARKET_MAPS[0].id, cache: {}, map: null, news: null, pulse: null, activeNode: null, bottleneckOnly: false, loading: false, zoom: 1 };

// 강조 색 — 독점/병목만. demand_limited·비병목은 null(중립 톤).
const MC_SEVERITY_COLOR = {
  structural:     "#a855f7", // 보라 — 구조적 독점
  acute:          "#cc2424", // 사이트 레드 — 급성 병목
  easing:         "#b07d2b", // 머스타드 — 완화중 병목
  emerging:       "#b07d2b", // 머스타드 — 부상하는 병목
  demand_limited: null,      // 중립 — 수요 한계형(병목 아님)
};
const MC_SEV_SHORT = { structural: "독점", acute: "급성 병목", easing: "병목 완화", emerging: "병목 부상", demand_limited: "수요 한계" };
// 점유율 바 — 단색 회색 램프(톤 유지)
const MC_SHARE_RAMP = ["#e6e6e6", "#bcbcbc", "#929292", "#6c6c6c", "#525252"];

// 진입점 (renderStocksTab 에서 호출). 비동기 fetch 후 렌더. map 은 id 별 1회만 로드.
async function renderMarketCascade(stocks) {
  const board = document.getElementById("vc-board");
  if (!board) return;
  MC_STATE.stocks = stocks;
  const mapId = MC_STATE.mapId;
  if (!MC_STATE.cache[mapId] && !MC_STATE.loading) {
    MC_STATE.loading = true;
    board.innerHTML = emptyMessage("시장 지도를 불러오는 중…");
    try {
      const [mapData, newsData, pulseData] = await Promise.all([
        sbDoc("market", mapId),
        // 뉴스 스토어는 없어도 지도는 그린다 (recent_news 폴백)
        sbDoc("market", `news/${mapId}`).catch(() => null),
        // 자동 병목 신호 (scripts/market_pulse.py 산출) — 없어도 지도는 그린다
        sbDoc("market", `analysis/${mapId}`).catch(() => null),
      ]);
      MC_STATE.cache[mapId] = {
        map: mapData,
        news: newsData,
        pulse: pulseData,
      };
    } catch (err) {
      board.innerHTML = emptyMessage(`시장 지도를 불러오지 못했습니다 (${err.message}).`);
      MC_STATE.loading = false;
      return;
    }
    MC_STATE.loading = false;
  }
  const entry = MC_STATE.cache[mapId];
  if (!entry) return;
  MC_STATE.map = entry.map;
  MC_STATE.news = entry.news;
  MC_STATE.pulse = entry.pulse;
  renderMarketChrome();
  renderMarketBoard(stocks);
  renderMarketNewsFeed(stocks);
  mcWireCanvas();
}

// 지도 전환 (AI·반도체 ↔ 제약·바이오) — 선택·줌 상태를 초기화하고 다시 그린다
function mcSwitchMap(mapId) {
  if (mapId === MC_STATE.mapId) return;
  MC_STATE.mapId = mapId;
  MC_STATE.activeNode = null;
  MC_STATE.userZoomed = false;
  MC_STATE.fitted = false;
  const detail = document.getElementById("vc-detail");
  if (detail) detail.innerHTML = `<p class="vc-detail-hint">시장 노드를 클릭하면 상세 정보가 표시됩니다.</p>`;
  mcHideMarketNote();
  renderMarketCascade(MC_STATE.stocks || {});
}

// 상단 크롬: 강조 범례 + '병목만 강조' 토글
function renderMarketChrome() {
  const navHost = document.getElementById("vc-chain-nav");
  if (!navHost) return;
  const map = MC_STATE.map;
  const legend = Object.entries(map.severity_legend || {}).map(([k, v]) => {
    const c = MC_SEVERITY_COLOR[k] || "var(--text-dim)";
    return `<span class="mc-leg" title="${escapeHtml(v.desc || "")}" style="--mc-c:${c}">
       <i class="mc-leg-dot"></i>${escapeHtml(v.label || k)}</span>`;
  }).join("");
  const mapTabs = MARKET_MAPS.map((m) =>
    `<button type="button" class="vc-chain-btn mc-map-btn${m.id === MC_STATE.mapId ? " active" : ""}"
       data-map="${escapeHtml(m.id)}" role="tab" aria-selected="${m.id === MC_STATE.mapId}">${escapeHtml(m.label)}</button>`).join("");
  navHost.innerHTML = `
    <div class="mc-mapsel" role="tablist" aria-label="시장 지도 선택">${mapTabs}</div>
    <div class="mc-legend">${legend}</div>
    <label class="mc-toggle"><input type="checkbox" id="mc-bottleneck-only" ${MC_STATE.bottleneckOnly ? "checked" : ""}> 병목·독점만 강조</label>
    <div class="mc-zoom" role="group" aria-label="지도 줌">
      <button type="button" id="mc-zoom-out" title="축소">−</button>
      <span id="mc-zoom-val">${Math.round((MC_STATE.zoom || 1) * 100)}%</span>
      <button type="button" id="mc-zoom-in" title="확대">+</button>
      <button type="button" id="mc-zoom-fit" title="화면에 맞춤">맞춤</button>
      <button type="button" id="mc-full" title="전체 화면 (ESC 로 종료)">⛶</button>
      <span class="mc-zoom-hint">드래그 이동 · Ctrl+휠/핀치 줌</span>
    </div>`;
  navHost.querySelectorAll(".mc-map-btn").forEach((btn) =>
    btn.addEventListener("click", () => mcSwitchMap(btn.dataset.map)));
  const cb = document.getElementById("mc-bottleneck-only");
  if (cb) cb.addEventListener("change", () => {
    MC_STATE.bottleneckOnly = cb.checked;
    const b = document.getElementById("vc-board");
    if (b) b.classList.toggle("mc-board--btlonly", cb.checked);
  });
  const zoomBy = (f) => {
    const svg = document.getElementById("vc-links");
    const wrap = svg && svg.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    mcZoomTo(r.left + r.width / 2, r.top + r.height / 2, (MC_STATE.zoom || 1) * f);
  };
  const zi = document.getElementById("mc-zoom-in"), zo = document.getElementById("mc-zoom-out");
  if (zi) zi.addEventListener("click", () => zoomBy(1.15));
  if (zo) zo.addEventListener("click", () => zoomBy(1 / 1.15));
  const zf = document.getElementById("mc-zoom-fit");
  if (zf) zf.addEventListener("click", () => { MC_STATE.userZoomed = false; mcFitZoom(); });
  const fs = document.getElementById("mc-full");
  if (fs) fs.addEventListener("click", () => mcToggleFull());
}

// 시장 노드의 watchlist 기업 narrative_score 평균을 집계
function mcAggregateScore(m, stocks) {
  const scores = [];
  (m.players || []).forEach((p) => {
    if (!p.ticker || !p.in_watchlist) return;
    const q = stocks && stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number") scores.push(q.narrative_score);
  });
  if (!scores.length) return { count: 0, score: 0, tone: "neutral" };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { count: scores.length, score: avg, tone: avg > 0.05 ? "pos" : avg < -0.05 ? "neg" : "neutral" };
}

// 집계 점수 → 시장 분위기 라벨
function mcMood(agg) {
  if (!agg || agg.count === 0) return null;
  const s = agg.score;
  if (s >= 0.2)  return { t: "강한 긍정 모멘텀", tone: "pos" };
  if (s >= 0.05) return { t: "약한 긍정", tone: "pos" };
  if (s > -0.05) return { t: "중립", tone: "neutral" };
  if (s > -0.2)  return { t: "약한 부정", tone: "neg" };
  return { t: "강한 부정 모멘텀", tone: "neg" };
}

// ── 시장 평균 대비 편차 차트 ────────────────────────────────────────────
// narrative_score 절대값은 기준선이 없어 그 자체로는 해석이 어렵다.
// 같은 시장 watchlist 기업들의 평균을 기준선(0)으로 삼고, 각 기업이
// 평균에서 얼마나 벗어났는지(Δ)를 다이버징 바로 보여준다 — 시장 안에서의
// 상대 위상을 읽는 그래프. 시장 상세 패널과 플레이어 지도가 함께 쓴다.

const mcFmtScore = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

// players[] 에서 watchlist 기업의 뉴스 시그널을 모아 시장 평균·편차·순위 계산
function mcScoreRows(players, stocks) {
  const rows = [];
  (players || []).forEach((p) => {
    if (!p.ticker || !p.in_watchlist) return;
    const q = stocks && stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number")
      rows.push({ name: p.name, ticker: p.ticker, score: q.narrative_score });
  });
  if (!rows.length) return null;
  const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length;
  rows.forEach((r) => { r.dev = r.score - avg; });
  rows.sort((a, b) => b.score - a.score);
  return { avg, rows };
}

// 편차 차트 블록 HTML. opts.highlight = 강조할 티커(플레이어 지도 기업 상세용)
function mcDevChartHtml(players, stocks, opts = {}) {
  const rel = mcScoreRows(players, stocks);
  if (!rel) return "";
  const { avg, rows } = rel;
  const title = opts.title || "시장 평균 대비 뉴스 시그널";
  if (rows.length < 2) {
    return `<div class="mc-dev mc-dev--single">
        <h5>${escapeHtml(title)}</h5>
        <p>시그널 데이터가 있는 watchlist 기업이 ${rows.length}곳뿐이라 시장 평균 비교가 아직 어렵습니다 — 2곳 이상부터 표시됩니다.</p>
      </div>`;
  }
  const maxDev = Math.max(0.1, ...rows.map((r) => Math.abs(r.dev)));
  const rowHtml = rows.map((r, i) => {
    const pct = Math.round((Math.abs(r.dev) / maxDev) * 50);
    const side = r.dev >= 0 ? "right" : "left";
    const tone = r.dev > 0.05 ? "pos" : r.dev < -0.05 ? "neg" : "neutral";
    const hl = opts.highlight && r.ticker === opts.highlight ? " mc-dev-row--hl" : "";
    return `<div class="mc-dev-row${hl}" data-tone="${tone}"
        title="${escapeHtml(r.name)} — 시그널 ${mcFmtScore(r.score)} · 시장 평균 ${mcFmtScore(avg)} 대비 ${mcFmtScore(r.dev)} · 시장 내 ${i + 1}/${rows.length}위">
        <span class="mc-dev-name">${escapeHtml(r.name)}</span>
        <span class="mc-dev-bar"><i data-side="${side}" data-tone="${tone}" style="width:${pct}%"></i></span>
        <span class="mc-dev-val">${mcFmtScore(r.dev)}</span>
      </div>`;
  }).join("");
  return `<div class="mc-dev">
      <h5>${escapeHtml(title)} <span class="mc-dev-meta">watchlist ${rows.length}곳 평균이 기준선</span></h5>
      <div class="mc-dev-rows">${rowHtml}</div>
      <p class="mc-dev-axis"><span>◀ 평균 미달</span><span class="mc-dev-avg">시장 평균 ${mcFmtScore(avg)}</span><span>평균 상회 ▶</span></p>
    </div>`;
}

// 점유율 스택 바 (단색 회색 램프). 합이 100 미만이면 '기타' 세그먼트.
function mcShareBar(players) {
  const segs = (players || []).filter((p) => typeof p.share === "number" && p.share > 0)
    .slice().sort((a, b) => b.share - a.share);
  if (!segs.length) return "";
  const sum = segs.reduce((a, p) => a + p.share, 0);
  let html = segs.map((p, i) =>
    `<span class="mc-sb-seg" style="width:${p.share}%;background:${MC_SHARE_RAMP[Math.min(i, MC_SHARE_RAMP.length - 1)]}" title="${escapeHtml(p.name)} ${p.share}%"></span>`).join("");
  if (sum < 99) html += `<span class="mc-sb-seg mc-sb-etc" style="width:${100 - sum}%" title="기타 ${Math.round(100 - sum)}%"></span>`;
  return `<span class="mc-sb">${html}</span>`;
}

// ── 자동 병목 신호 (market pulse) 헬퍼 ──────────────────────────────────
// data/markets/analysis/<id>.json — scripts/market_pulse.py 가 뉴스 스토어의
// signals 를 집계해 산출한 병목 압력·수요 모멘텀·전이 제안. 지도(severity)는
// 루틴이 검증 후 반영하므로, 웹에서는 '자동 신호'로만 표시한다.
function mcPulseFor(mid) {
  const p = MC_STATE.pulse;
  const r = p && p.markets && p.markets[mid];
  return r && r.status === "ok" ? r : null;
}

// 노드용 압력 화살표: 조여옴(▲)/풀림(▼). |압력| 이 임계 미만이면 null.
function mcPulseArrow(mid) {
  const r = mcPulseFor(mid);
  if (!r) return null;
  const th = (MC_STATE.pulse.params && MC_STATE.pulse.params.node_arrow_threshold) || 0.35;
  if (r.bottleneck_pressure >= th) return { dir: "up", label: "▲", tone: "neg", v: r.bottleneck_pressure };
  if (r.bottleneck_pressure <= -th) return { dir: "down", label: "▼", tone: "pos", v: r.bottleneck_pressure };
  return null;
}

// ── 시장 단위 뉴스 헬퍼 ──────────────────────────────────────────────────
// 뉴스 스토어(분리 파일) 우선, 없으면 맵 안의 recent_news 폴백. 최신순 보장.
function mcNewsFor(m) {
  const store = MC_STATE.news && MC_STATE.news.markets;
  const items = (store && store[m.id]) || m.recent_news || [];
  return items.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// "2026-05-11" | "2026-05" → Date (월만 있으면 1일로). 실패 시 null.
function mcParseDate(s) {
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}$/.test(s) ? s + "-01" : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// 노드 배지용 짧은 날짜 라벨: 같은 해면 "M.D" / "M월", 다르면 "YY.M"
function mcDateShort(s) {
  const d = mcParseDate(s);
  if (!d) return "";
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return /^\d{4}-\d{2}$/.test(s) ? `${d.getMonth() + 1}월` : `${d.getMonth() + 1}.${d.getDate()}`;
  }
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`;
}

const MC_FRESH_DAYS = 14; // 이 기간 내 뉴스가 있으면 노드 배지를 '신규' 톤으로

function mcNewsFresh(items) {
  const d = items.length ? mcParseDate(items[0].date) : null;
  return !!d && (Date.now() - d.getTime()) / 86400000 <= MC_FRESH_DAYS;
}

// ── 다이어그램 배치 ──────────────────────────────────────────────────────
// JSON 의 diagram 블록이 배치의 SSOT: flow = 좌(공급의 뿌리)→우(최종 수요)
// 메인 체인 클러스터, bands = 하단 가로 밴드(피지컬 AI 체인·전력/DC 기반).
// diagram 에 없는 시장은 layer_default 가 가리키는 클러스터에 자동 배치.
function mcDiagramConfig(map) {
  let flow, bands, layerDefault;
  if (map.diagram && Array.isArray(map.diagram.flow)) {
    flow = map.diagram.flow.map((c) => ({ ...c, markets: [...(c.markets || [])] }));
    bands = (map.diagram.bands || []).map((c) => ({ ...c, markets: [...(c.markets || [])] }));
    layerDefault = map.diagram.layer_default || {};
  } else {
    // diagram 블록이 없으면 층 순서를 뒤집어(공급→수요) 클러스터로 사용
    flow = map.layers.slice().reverse().map((l) => ({
      id: l.id, title: l.label, desc: l.desc, color: null,
      markets: map.markets.filter((m) => m.layer === l.id).map((m) => m.id),
    }));
    bands = [];
    layerDefault = {};
  }
  const all = [...flow, ...bands];
  const placed = new Set(all.flatMap((c) => c.markets));
  map.markets.forEach((m) => {
    if (placed.has(m.id)) return;
    const target = all.find((c) => c.id === layerDefault[m.layer]) || flow[flow.length - 1];
    target.markets.push(m.id);
  });
  return { flow, bands };
}

// 클러스터 패널 (메인 체인은 세로 스택, 밴드는 가로 스트립)
function mcClusterEl(cl, stocks, band) {
  const map = MC_STATE.map;
  const el = document.createElement("section");
  el.className = "mcd-cluster" + (band ? " mcd-cluster--band" : "");
  el.dataset.cluster = cl.id;
  el.style.setProperty("--cl-c", cl.color || "#7f8a99");
  const nodes = cl.markets
    .map((id) => map.markets.find((m) => m.id === id))
    .filter(Boolean);
  el.innerHTML = `
    <header class="mcd-cluster-head">
      <h4>${escapeHtml(cl.title || cl.id)}</h4>
      ${cl.desc ? `<span>${escapeHtml(cl.desc)}</span>` : ""}
    </header>
    <div class="mcd-cluster-nodes">${nodes.map((m) => mcNodeHtml(m, stocks)).join("")}</div>`;
  return el;
}

// 보드 렌더: 메인 체인(좌→우) + 하단 밴드들
function renderMarketBoard(stocks) {
  const board = document.getElementById("vc-board");
  const map = MC_STATE.map;
  if (!board || !map) return;
  board.className = "vc-board mc-board" + (MC_STATE.bottleneckOnly ? " mc-board--btlonly" : "");
  board.innerHTML = "";

  const dia = mcDiagramConfig(map);
  // 시장 → 클러스터 매핑 (집계 흐름선용)
  MC_STATE.clusterOf = {};
  MC_STATE.bandClusters = new Set(dia.bands.map((c) => c.id));
  [...dia.flow, ...dia.bands].forEach((c) =>
    c.markets.forEach((mid) => { MC_STATE.clusterOf[mid] = c.id; }));

  const axis = document.createElement("div");
  axis.className = "mc-axis";
  const ax = (map.diagram && map.diagram.axis) || {};
  axis.innerHTML = `<span>${escapeHtml(ax.left || "공급의 뿌리 — 장비·소재")}</span>
                    <span class="mc-axis-mid">${escapeHtml(ax.mid || "물건·컴퓨트가 흐르는 방향 ▶")}</span>
                    <span>${escapeHtml(ax.right || "최종 수요 — 돈을 내는 곳")}</span>`;
  board.appendChild(axis);

  const strip = mcPulseStrip();
  if (strip) board.appendChild(strip);

  const main = document.createElement("div");
  main.className = "mcd-main";
  dia.flow.forEach((cl) => main.appendChild(mcClusterEl(cl, stocks, false)));
  board.appendChild(main);

  dia.bands.forEach((cl) => board.appendChild(mcClusterEl(cl, stocks, true)));

  board.querySelectorAll(".mc-node[data-id]").forEach((el) =>
    el.addEventListener("click", () => {
      selectMarketNode(el.dataset.id, stocks);
      // player_map 이 있는 세부 시장은 전용 화면(플레이어 지도)으로 확대
      const mm = map.markets.find((x) => x.id === el.dataset.id);
      if (mm && mm.player_map) pmOpen(mm.id);
      // 상세 패널이 지도 아래에 있으므로, 화면 밖이면 읽을 위치로 데려간다
      else mcScrollDetailIntoView();
    }));

  mcApplyZoom(false);
  // 레이아웃 확정 후 전체 관계선(다이어그램 엣지)을 그린다
  requestAnimationFrame(() => {
    drawAllMarketLinks();
    if (MC_STATE.activeNode && map.markets.some((m) => m.id === MC_STATE.activeNode)) {
      selectMarketNode(MC_STATE.activeNode, stocks);
    } else {
      clearMarketLinks();
    }
  });
}

// 자동 신호 스트립: 전이 제안·병목 이동 경보·주목 시장 (pulse 파일이 있을 때만)
function mcPulseStrip() {
  const p = MC_STATE.pulse;
  if (!p) return null;
  const alerts = p.alerts || [];
  const focus = p.top_focus || [];
  if (!alerts.length && !focus.length) return null;

  const chips = [];
  alerts.forEach((a) => {
    if (a.type === "severity_change_proposed") {
      const up = a.action === "escalate";
      chips.push(`<button class="mc-pulse-chip" data-goto="${escapeHtml(a.market)}" data-kind="${up ? "esc" : "de"}"
        title="뉴스 신호 기반 자동 제안 (압력 ${a.pressure >= 0 ? "+" : ""}${a.pressure}) — 루틴 검증 후 지도에 반영">
        ${up ? "⚠" : "▽"} ${escapeHtml(a.name_kr)} <em>${escapeHtml(a.from)} → ${escapeHtml(a.to)} 제안</em></button>`);
    } else if (a.type === "bottleneck_migration") {
      chips.push(`<button class="mc-pulse-chip" data-goto="${escapeHtml(a.to[0] || a.market)}" data-kind="mig"
        title="완화 중인 시장의 인접 시장이 조여옵니다">
        ⇢ 병목 이동? ${escapeHtml(a.name_kr)} → ${escapeHtml((a.to_names || []).join(" · "))}</button>`);
    }
  });
  const focusHtml = focus.length
    ? `<span class="mc-pulse-focus">주목: ${focus.slice(0, 3).map((f) =>
        `<button class="mc-pulse-mkt" data-goto="${escapeHtml(f.market)}"
           title="병목 압력·성장 전망 복합 점수 ${f.score >= 0 ? "+" : ""}${f.score}">${escapeHtml(f.name_kr)}</button>`).join(" · ")}</span>`
    : "";

  const el = document.createElement("div");
  el.className = "mc-pulse-strip";
  el.innerHTML = `<span class="mc-pulse-label" title="뉴스 스토어의 방향성 신호를 scripts/market_pulse.py 가 집계한 자동 신호 — 지도 반영은 주간 루틴이 검증 후 수행">
      📡 자동 신호 <em>${escapeHtml((p.generated || "").slice(0, 10))}</em></span>
    ${chips.join("")}${focusHtml}`;
  el.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => {
      selectMarketNode(b.dataset.goto, MC_STATE.stocks || {});
      const node = document.querySelector(`.mc-node[data-id="${CSS.escape(b.dataset.goto)}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  return el;
}

// 단일 시장 노드 — 콤팩트 (구조가 한눈에 읽히게 최소 정보만; 상세는 클릭 패널)
function mcNodeHtml(m, stocks) {
  const sev = m.bottleneck && m.bottleneck.severity;
  const hi = sev ? MC_SEVERITY_COLOR[sev] : null;   // 독점/병목만 강한 색, 그 외 클러스터 색
  const accent = hi || "var(--cl-c, var(--border-mid))";
  const tag = hi ? (MC_SEV_SHORT[sev] || "") : "";
  const agg = mcAggregateScore(m, stocks);
  const moodDot = agg.count > 0
    ? `<i class="mc-node-mood" data-tone="${agg.tone}" title="뉴스 시그널 ${agg.score >= 0 ? "+" : ""}${agg.score.toFixed(2)} (watchlist ${agg.count}곳)"></i>`
    : "";
  const news = mcNewsFor(m);
  const newsChip = news.length
    ? `<span class="mc-node-news${mcNewsFresh(news) ? " mc-node-news--fresh" : ""}"
         title="${escapeHtml(news[0].title || "")}">📰 ${news.length}</span>`
    : "";
  const wikiChip = (m.wiki || []).length
    ? `<span class="mc-node-wiki" title="옵시디언 위키 노트 ${m.wiki.length}개 연결 — 클릭하면 상세 패널에서 읽을 수 있습니다">📖 ${m.wiki.length}</span>`
    : "";
  const arrow = mcPulseArrow(m.id);
  const arrowChip = arrow
    ? `<span class="mc-node-pulse" data-dir="${arrow.dir}"
         title="자동 병목 신호 — 압력 ${arrow.v >= 0 ? "+" : ""}${arrow.v.toFixed(2)} (${arrow.dir === "up" ? "조여옴" : "풀림"})">${arrow.label}</span>`
    : "";
  const pmapChip = m.player_map
    ? `<span class="mc-node-pmap" title="클릭하면 이 시장만의 플레이어 지도(기업 단위)가 새 화면으로 열립니다">⤢ 플레이어 지도</span>`
    : "";
  return `<button class="mc-node${hi ? " mc-node--hi mc-node--" + sev : ""}" data-id="${escapeHtml(m.id)}"
            style="--mc-accent:${accent}" title="${escapeHtml(m.definition || "")}">
      ${tag ? `<span class="mc-node-tag">${escapeHtml(tag)}${arrowChip}</span>` : arrowChip ? `<span class="mc-node-tag mc-node-tag--pulse">${arrowChip}</span>` : ""}
      <span class="mc-node-name">${escapeHtml(m.name_kr)}${moodDot}</span>
      <span class="mc-node-size">${escapeHtml(m.size_label || "")}</span>
      ${newsChip}${wikiChip}${pmapChip}
    </button>`;
}

// 상세 패널(지도 아래)로 스크롤 — 이미 충분히 보이면 그대로 둔다.
// scroll-margin-top(CSS) 덕에 지도 하단이 문맥으로 함께 남는다.
function mcScrollDetailIntoView() {
  const host = document.getElementById("vc-detail");
  if (!host) return;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  if (host.getBoundingClientRect().top < vh * 0.65) return;
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 노드 선택: 강조 + 관계선 + 상세
function selectMarketNode(id, stocks) {
  MC_STATE.activeNode = id;
  const map = MC_STATE.map;
  const board = document.getElementById("vc-board");
  if (!map || !board) return;
  const needs    = map.links.filter((l) => l.from === id).map((l) => l.to);   // 의존하는 공급(우)
  const pulledBy = map.links.filter((l) => l.to === id).map((l) => l.from);   // 끌어당기는 수요(좌)
  const connected = new Set([...needs, ...pulledBy, id]);
  board.querySelectorAll(".mc-node").forEach((el) => {
    const t = el.dataset.id;
    el.classList.toggle("mc-node--active", t === id);
    el.classList.toggle("mc-node--linked", connected.has(t) && t !== id);
    el.classList.toggle("mc-node--dim", !connected.has(t));
  });
  highlightMarketLinks(id);
  renderMarketDetail(id, needs, pulledBy, stocks);
}

// ── 다이어그램 엣지 (피그마식) ──────────────────────────────────────────
// 모든 관계선을 항상 그려 한눈에 흐름이 보이게 하고, 노드 선택 시 그 노드의
// 선만 강조(+관계 라벨)하고 나머지는 흐리게 한다. 줌은 board/svg 에 같은
// scale 을 걸고, 좌표는 unscaled(레이아웃) 단위로 환산해 계산한다.

const MC_SVGNS = "http://www.w3.org/2000/svg";

// 노드의 보드 기준 좌표 (줌 보정된 레이아웃 단위)
function mcRectOf(id, wrap, wrapRect) {
  const el = wrap.querySelector(`.mc-node[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const z = MC_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

// 두 노드 사이 베지어 경로 + 라벨용 중점. 가로(컬럼 간)/세로(동일 컬럼) 자동 판별.
function mcEdgeGeo(a, b) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  let p1, p2, c1, c2;
  if (Math.abs(acx - bcx) >= Math.abs(acy - bcy)) {  // 가로: 왼쪽 노드 오른쪽 → 오른쪽 노드 왼쪽
    const aLeft = a.x < b.x;
    const lf = aLeft ? a : b, rt = aLeft ? b : a;
    p1 = { x: lf.x + lf.w, y: lf.y + lf.h / 2 };
    p2 = { x: rt.x, y: rt.y + rt.h / 2 };
    if (!aLeft) { const t = p1; p1 = p2; p2 = t; }     // 방향 보존 (a → b)
    const dx = Math.max(24, Math.abs(p2.x - p1.x) / 2) * (p2.x >= p1.x ? 1 : -1);
    c1 = { x: p1.x + dx, y: p1.y };
    c2 = { x: p2.x - dx, y: p2.y };
  } else {                                            // 세로: 위 노드 하단 → 아래 노드 상단
    const aUp = a.y < b.y;
    const up = aUp ? a : b, dn = aUp ? b : a;
    p1 = { x: up.x + up.w / 2, y: up.y + up.h };
    p2 = { x: dn.x + dn.w / 2, y: dn.y };
    if (!aUp) { const t = p1; p1 = p2; p2 = t; }
    const dy = Math.max(20, Math.abs(p2.y - p1.y) / 2) * (p2.y >= p1.y ? 1 : -1);
    c1 = { x: p1.x, y: p1.y + dy };
    c2 = { x: p2.x, y: p2.y - dy };
  }
  // 큐빅 베지어 t=0.5 지점 — 라벨 위치
  const mx = (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8;
  const my = (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8;
  return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, mx, my };
}

// 클러스터 패널의 보드 기준 좌표 (줌 보정)
function mcPanelRect(cid, wrap, wrapRect) {
  const el = wrap.querySelector(`.mcd-cluster[data-cluster="${CSS.escape(cid)}"]`);
  if (!el) return null;
  const z = MC_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

// 클러스터 흐름선 경로. 가로 흐름은 패널 상단 근처에 정렬해 선이 가지런하게.
function mcFlowPath(a, b, horiz, offA, offB) {
  if (horiz) {
    const dir = (b.x + b.w / 2) >= (a.x + a.w / 2) ? 1 : -1;
    const ay = a.y + Math.min(a.h / 2, 84) + offA;
    const by = b.y + Math.min(b.h / 2, 84) + offB;
    const p1 = { x: dir > 0 ? a.x + a.w : a.x, y: ay };
    const p2 = { x: dir > 0 ? b.x : b.x + b.w, y: by };
    const dx = Math.max(26, Math.abs(p2.x - p1.x) / 2) * dir;
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }
  // 세로(밴드 ↔ 메인): 상대 패널의 중심 x 에 맞춰 내리꽂는다
  const dir = (b.y + b.h / 2) >= (a.y + a.h / 2) ? 1 : -1;
  const bcx = b.x + b.w / 2;
  const x1 = Math.min(Math.max(bcx, a.x + 36), a.x + a.w - 36) + offA;
  const x2 = Math.min(Math.max(x1, b.x + 36), b.x + b.w - 36) + offB;
  const p1 = { x: x1, y: dir > 0 ? a.y + a.h : a.y };
  const p2 = { x: x2, y: dir > 0 ? b.y : b.y + b.h };
  const dy = Math.max(22, Math.abs(p2.y - p1.y) / 2) * dir;
  return `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + dy}, ${p2.x} ${p2.y - dy}, ${p2.x} ${p2.y}`;
}

// 노드 단위 엣지 1개 (밴드 내부 체인·선택 노드 세부선). 방향: 공급(to) → 수요(from)
function mcAddNodeEdge(svg, wrap, wrapRect, l, cls, marker, withLabel) {
  const a = mcRectOf(l.to, wrap, wrapRect), b = mcRectOf(l.from, wrap, wrapRect);
  if (!a || !b) return;
  const g = mcEdgeGeo(a, b);
  const path = document.createElementNS(MC_SVGNS, "path");
  path.setAttribute("d", g.d);
  path.setAttribute("class", cls);
  path.setAttribute("marker-end", `url(#${marker})`);
  svg.appendChild(path);
  if (withLabel && l.label) {
    const t = document.createElementNS(MC_SVGNS, "text");
    t.setAttribute("class", "mc-edge-label");
    t.setAttribute("x", g.mx.toFixed(1));
    t.setAttribute("y", (g.my - 5).toFixed(1));
    t.setAttribute("text-anchor", "middle");
    t.textContent = l.label;
    svg.appendChild(t);
  }
}

// 전체 엣지 렌더. 기본 상태는 '클러스터 사이 집계 흐름선'만 보여 깔끔하게 유지하고,
// 밴드 내부 체인(부품→로봇→국방 등)은 노드 단위로, 세부 관계선은 노드 선택 시에만.
function drawAllMarketLinks() {
  const svg  = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const map  = MC_STATE.map;
  if (!svg || !wrap || !map) return;
  const wrapRect = wrap.getBoundingClientRect();
  if (wrapRect.width === 0) return; // 패널이 숨겨져 있으면 skip

  // 처음 보일 때 화면 폭에 맞춰 자동 줌 (mcFitZoom → mcApplyZoom → 여기로 재진입)
  if (!MC_STATE.userZoomed && !MC_STATE.fitted) {
    MC_STATE.fitted = true;
    mcFitZoom();
    return;
  }

  svg.innerHTML = "";
  const board = document.getElementById("vc-board");
  svg.setAttribute("width", board ? board.scrollWidth : wrap.scrollWidth);
  svg.setAttribute("height", board ? board.scrollHeight : wrap.scrollHeight);

  const defs = document.createElementNS(MC_SVGNS, "defs");
  defs.innerHTML = `
    <marker id="mc-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#5c6470"></path>
    </marker>
    <marker id="mc-arr-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#c2c9d4"></path>
    </marker>`;
  svg.appendChild(defs);

  const cOf = MC_STATE.clusterOf || {};
  const bands = MC_STATE.bandClusters || new Set();

  // 1) 링크를 클러스터 쌍으로 집계 (방향: 공급 to → 수요 from)
  const flows = new Map();
  map.links.forEach((l) => {
    const src = cOf[l.to], dst = cOf[l.from];
    if (!src || !dst) return;
    if (src === dst) {
      // 같은 클러스터 안: 밴드의 체인(부품→로봇→국방)만 노드 단위로 표시
      if (bands.has(src)) mcAddNodeEdge(svg, wrap, wrapRect, l, "mc-edge mc-band-edge", "mc-arr", false);
      return;
    }
    const k = `${src}→${dst}`;
    const f = flows.get(k) || { src, dst, count: 0, labels: [] };
    f.count += 1;
    if (l.label && f.labels.length < 3) f.labels.push(l.label);
    flows.set(k, f);
  });

  // 2) 패널 좌표 + 방향 판별
  const items = [];
  flows.forEach((f) => {
    const a = mcPanelRect(f.src, wrap, wrapRect), b = mcPanelRect(f.dst, wrap, wrapRect);
    if (!a || !b) return;
    const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) >= Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    items.push({ ...f, a, b, horiz });
  });

  // 3) 같은 패널 면에서 나가는/들어오는 선끼리 anchor 를 벌려 겹침 방지
  const groupPush = (m, k, it) => { const arr = m.get(k) || []; arr.push(it); m.set(k, arr); };
  const outG = new Map(), inG = new Map();
  items.forEach((it) => {
    groupPush(outG, `${it.src}:${it.horiz ? "h" : "v"}`, it);
    groupPush(inG,  `${it.dst}:${it.horiz ? "h" : "v"}`, it);
  });
  outG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.b.y - q.b.y) : (p.b.x - q.b.x)));
    arr.forEach((it, i) => { it.offA = (i - (arr.length - 1) / 2) * 22; });
  });
  inG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.a.y - q.a.y) : (p.a.x - q.a.x)));
    arr.forEach((it, i) => { it.offB = (i - (arr.length - 1) / 2) * 22; });
  });

  // 4) 흐름선 그리기 — 연결 수에 따라 굵기
  items.forEach((it) => {
    const p = document.createElementNS(MC_SVGNS, "path");
    p.setAttribute("d", mcFlowPath(it.a, it.b, it.horiz, it.offA || 0, it.offB || 0));
    p.setAttribute("class", "mc-flow");
    p.setAttribute("stroke-width", (1.3 + Math.min(2.4, (it.count - 1) * 0.45)).toFixed(1));
    p.setAttribute("marker-end", "url(#mc-arr)");
    const ti = document.createElementNS(MC_SVGNS, "title");
    ti.textContent = `${it.count}개 연결 — ${it.labels.join(" · ")}`;
    p.appendChild(ti);
    svg.appendChild(p);
  });

  // 5) 활성 노드가 있으면 세부 관계선
  if (MC_STATE.activeNode) mcDrawActiveEdges(MC_STATE.activeNode);
}

// 선택 노드의 세부 관계선 + 라벨. 흐름선은 흐리게.
function mcDrawActiveEdges(id) {
  const svg  = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const map  = MC_STATE.map;
  if (!svg || !wrap || !map) return;
  svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
  svg.querySelectorAll(".mc-flow, .mc-band-edge").forEach((p) => p.classList.add("mc-flow--dim"));
  const wrapRect = wrap.getBoundingClientRect();
  map.links.filter((l) => l.from === id || l.to === id).forEach((l) =>
    mcAddNodeEdge(svg, wrap, wrapRect, l, "mc-edge mc-active-edge", "mc-arr-hi", true));
}

function highlightMarketLinks(id) {
  const svg = document.getElementById("vc-links");
  if (svg && !svg.querySelector(".mc-flow")) drawAllMarketLinks(); // 탭 숨김 중 스킵됐으면 재시도
  mcDrawActiveEdges(id);
}

function clearMarketLinks() {
  const svg = document.getElementById("vc-links");
  if (svg) {
    svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
    svg.querySelectorAll(".mc-flow--dim").forEach((p) => p.classList.remove("mc-flow--dim"));
  }
  const board = document.getElementById("vc-board");
  if (board) board.querySelectorAll(".mc-node").forEach((el) =>
    el.classList.remove("mc-node--active", "mc-node--linked", "mc-node--dim"));
}

// 줌 적용: board/svg 에 동일 scale, 좌표 재계산
function mcApplyZoom(redraw = true) {
  const board = document.getElementById("vc-board");
  const svg = document.getElementById("vc-links");
  const z = MC_STATE.zoom || 1;
  [board, svg].forEach((el) => {
    if (!el) return;
    el.style.transform = z === 1 ? "" : `scale(${z})`;
    el.style.transformOrigin = "0 0";
  });
  const v = document.getElementById("mc-zoom-val");
  if (v) v.textContent = `${Math.round(z * 100)}%`;
  if (redraw) {
    drawAllMarketLinks();
    if (MC_STATE.activeNode) highlightMarketLinks(MC_STATE.activeNode);
  }
}

// 화면 폭에 맞춰 자동 줌 (처음 표시·전체화면 전환 시)
function mcFitZoom() {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const board = document.getElementById("vc-board");
  if (!wrap || !board || wrap.clientWidth === 0 || board.scrollWidth === 0) return;
  const z = Math.min(1.8, Math.max(0.55, (wrap.clientWidth - 16) / board.scrollWidth));
  MC_STATE.zoom = Math.round(z * 100) / 100;
  mcApplyZoom();
}

// 지정 화면 좌표를 고정점으로 줌 (휠·핀치·버튼 공용)
function mcZoomTo(clientX, clientY, z) {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  if (!wrap) return;
  const old = MC_STATE.zoom || 1;
  z = Math.min(2.2, Math.max(0.4, z));
  if (Math.abs(z - old) < 0.001) return;
  const r = wrap.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  const ratio = z / old;
  MC_STATE.zoom = Math.round(z * 1000) / 1000;
  MC_STATE.userZoomed = true;
  mcApplyZoom();
  wrap.scrollLeft = (wrap.scrollLeft + px) * ratio - px;
  wrap.scrollTop  = (wrap.scrollTop + py) * ratio - py;
}

// 캔버스 인터랙션 (1회 와이어링): Ctrl/⌘+휠 줌 · 터치 핀치 줌 · 마우스 드래그 패닝
function mcWireCanvas() {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  if (!wrap || wrap.dataset.mcWired) return;
  wrap.dataset.mcWired = "1";

  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // 일반 휠 = 스크롤
    e.preventDefault();
    mcZoomTo(e.clientX, e.clientY, (MC_STATE.zoom || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) pinch = { d: dist(e.touches), z: MC_STATE.zoom || 1 };
  }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    mcZoomTo(cx, cy, pinch.z * dist(e.touches) / pinch.d);
  }, { passive: false });
  wrap.addEventListener("touchend", () => { pinch = null; }, { passive: true });

  let drag = null;
  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".mc-node, button, a, input, label")) return;
    drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add("mc-grabbing");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    wrap.scrollLeft = drag.sl - (e.clientX - drag.x);
    wrap.scrollTop  = drag.st - (e.clientY - drag.y);
  });
  window.addEventListener("mouseup", () => { drag = null; wrap.classList.remove("mc-grabbing"); });
}

// 전체 화면 모드: 시장 지도 섹션을 화면에 고정하고 다시 맞춤 줌
function mcToggleFull(force) {
  const board = document.getElementById("vc-board");
  const section = board && board.closest(".sector-panel");
  if (!section) return;
  const on = force !== undefined ? force : !section.classList.contains("mc-full");
  if (force === false && !section.classList.contains("mc-full")) return;
  section.classList.toggle("mc-full", on);
  document.body.classList.toggle("mc-noscroll", on);
  const btn = document.getElementById("mc-full");
  if (btn) btn.textContent = on ? "✕" : "⛶";
  MC_STATE.fitted = false;
  MC_STATE.userZoomed = false;
  requestAnimationFrame(() => drawAllMarketLinks());
}
// 보드 하단 통합 뉴스 피드 — 전 시장의 뉴스를 최신순 한 줄씩.
// 시장 칩을 클릭하면 지도에서 그 시장 노드가 선택·스크롤된다 (뉴스 ↔ 지도 연결).
function renderMarketNewsFeed(stocks) {
  const host = document.getElementById("mc-feed");
  const map = MC_STATE.map;
  if (!host || !map) return;
  const all = [];
  map.markets.forEach((m) => mcNewsFor(m).forEach((n) => all.push({ m, n })));
  all.sort((a, b) => String(b.n.date || "").localeCompare(String(a.n.date || "")));
  if (!all.length) { host.innerHTML = ""; return; }

  const row = ({ m, n }) => {
    const tone = n.impact === "+" ? "pos" : n.impact === "-" ? "neg" : "neutral";
    const sev = m.bottleneck && m.bottleneck.severity;
    const accent = (sev && MC_SEVERITY_COLOR[sev]) || "var(--border-mid)";
    const title = n.url
      ? `<a class="mc-feed-title" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title || "")}</a>`
      : `<span class="mc-feed-title">${escapeHtml(n.title || "")}</span>`;
    return `<li class="mc-feed-item" data-tone="${tone}">
        <span class="mc-feed-date">${escapeHtml(mcDateShort(n.date))}</span>
        <button class="mc-feed-mkt" data-market="${escapeHtml(m.id)}" style="--mc-accent:${accent}"
          title="지도에서 이 시장 보기">${escapeHtml(m.name_kr)}</button>
        <span class="mc-feed-body">${title}
          ${n.summary ? `<span class="mc-feed-sum">${escapeHtml(n.summary)}</span>` : ""}
        </span>
      </li>`;
  };

  const FEED_MAX = 12;
  host.innerHTML = `
    <header class="mc-feed-head">
      <h3>시장 뉴스 피드</h3>
      <span class="mc-feed-hint">전 시장 최신순 — 시장 이름을 누르면 지도에서 그 시장이 선택됩니다</span>
    </header>
    <ul class="mc-feed-list">${all.slice(0, FEED_MAX).map(row).join("")}</ul>
    ${all.length > FEED_MAX
      ? `<details class="mc-feed-more"><summary>지난 뉴스 ${all.length - FEED_MAX}건 더 보기</summary>
           <ul class="mc-feed-list">${all.slice(FEED_MAX).map(row).join("")}</ul></details>`
      : ""}`;

  host.querySelectorAll(".mc-feed-mkt[data-market]").forEach((b) =>
    b.addEventListener("click", () => {
      selectMarketNode(b.dataset.market, stocks);
      const node = document.querySelector(`.mc-node[data-id="${CSS.escape(b.dataset.market)}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
}

// 상세 패널: 분위기 · 주간 흐름 · 병목 · 시장 뉴스 · 점유율/플레이어 · 관계 · 출처
function renderMarketDetail(id, needs, pulledBy, stocks) {
  const host = document.getElementById("vc-detail");
  const map = MC_STATE.map;
  if (!host || !map) return;
  const m = map.markets.find((x) => x.id === id);
  if (!m) return;

  const nameOf = (mid) => { const x = map.markets.find((y) => y.id === mid); return x ? x.name_kr : mid; };
  const labelFor = (mid, dir) => {
    const link = dir === "need"
      ? map.links.find((l) => l.from === id && l.to === mid)
      : map.links.find((l) => l.from === mid && l.to === id);
    return link ? link.label : "";
  };
  const relHtml = (list, dir, title) => {
    if (!list.length) return "";
    const items = list.map((mid) =>
      `<li><button class="mc-rel-link" data-goto="${escapeHtml(mid)}">${escapeHtml(nameOf(mid))}</button>
         <span class="mc-rel-label">${escapeHtml(labelFor(mid, dir))}</span></li>`).join("");
    return `<div class="mc-rel-block"><h5>${title}</h5><ul>${items}</ul></div>`;
  };

  let btlHtml = "";
  if (m.bottleneck) {
    const sev = m.bottleneck.severity, leg = map.severity_legend[sev] || {};
    const c = MC_SEVERITY_COLOR[sev] || "var(--text-dim)";
    btlHtml = `<div class="mc-btl-box" style="--mc-c:${c}">
        <span class="mc-btl-tag">${escapeHtml(leg.label || sev)}</span>
        <p class="mc-btl-text">${escapeHtml(m.bottleneck.limit)}</p>
      </div>`;
  }

  const agg = mcAggregateScore(m, stocks);
  const mood = mcMood(agg);
  const moodHtml = mood
    ? `<p class="mc-mood" data-tone="${mood.tone}"><span>시장 분위기</span> <strong>${escapeHtml(mood.t)}</strong> · 뉴스 시그널 ${agg.score >= 0 ? "+" : ""}${agg.score.toFixed(2)} (watchlist ${agg.count}곳)</p>`
    : `<p class="mc-mood mc-mood--none"><span>시장 분위기</span> watchlist 뉴스 데이터 연결 전</p>`;
  const devHtml = mcDevChartHtml(m.players, stocks);

  // 자동 병목 신호 (market pulse) — 압력·수요 모멘텀 게이지 + 전이 제안 + 근거
  let pulseHtml = "";
  const pr = mcPulseFor(id);
  if (pr) {
    const gauge = (v, label) => {
      const pct = Math.round(Math.abs(v) * 50);
      const side = v >= 0 ? "right" : "left";
      const tone = v >= 0.2 ? "neg" : v <= -0.2 ? "pos" : "neutral";
      return `<div class="mc-pulse-gauge" title="${escapeHtml(label)} ${v >= 0 ? "+" : ""}${v.toFixed(2)}">
          <span class="mc-pulse-gname">${escapeHtml(label)}</span>
          <span class="mc-pulse-bar"><i data-side="${side}" data-tone="${tone}" style="width:${pct}%"></i></span>
          <span class="mc-pulse-gval">${v >= 0 ? "+" : ""}${v.toFixed(2)}</span>
        </div>`;
    };
    const prop = pr.proposal
      ? `<p class="mc-pulse-prop" data-kind="${pr.proposal.action === "escalate" ? "esc" : "de"}">
           ${pr.proposal.action === "escalate" ? "⚠ 승급 제안" : "▽ 완화 제안"}:
           <strong>${escapeHtml(pr.proposal.from)} → ${escapeHtml(pr.proposal.to)}</strong>
           (신뢰도 ${escapeHtml(pr.proposal.confidence)}) — 루틴 검증 후 지도 반영</p>`
      : "";
    const noteHtml = pr.note ? `<p class="mc-pulse-note">${escapeHtml(pr.note)}</p>` : "";
    const bene = (pr.beneficiaries || []).length
      ? `<p class="mc-pulse-bene">가격결정력 신호 — ${pr.beneficiaries.map((b) =>
          `${escapeHtml(b.name)}${typeof b.share === "number" ? ` ${b.share}%` : ""}`).join(" · ")}</p>`
      : "";
    const evid = (pr.evidence || []).slice(0, 3).map((e) =>
      `<li><span class="mc-pulse-etype" data-t="${escapeHtml(e.type)}">${
          e.type === "supply_tightening" ? "긴축" : e.type === "supply_easing" ? "완화" :
          e.type === "demand_up" ? "수요↑" : "수요↓"}</span> ${escapeHtml(e.title)} <em>${escapeHtml(e.date || "")}</em></li>`).join("");
    pulseHtml = `<div class="mc-pulse-box">
        <h5>자동 병목 신호 <span class="mc-pulse-meta">뉴스 ${pr.signal_count}건 · 출처 ${pr.source_count}곳 (감쇠 가중)</span></h5>
        ${gauge(pr.bottleneck_pressure, "병목 압력")}
        ${gauge(pr.demand_momentum, "수요 모멘텀")}
        ${prop}${noteHtml}${bene}
        ${evid ? `<ul class="mc-pulse-evid">${evid}</ul>` : ""}
      </div>`;
  }

  const weeklyHtml = m.weekly_note
    ? `<div class="mc-weekly"><h5>이번 주 시장 흐름</h5><p>${escapeHtml(m.weekly_note)}</p></div>`
    : "";

  const newsItems = mcNewsFor(m);
  const newsLi = (n) => {
    const tone = n.impact === "+" ? "pos" : n.impact === "-" ? "neg" : "neutral";
    const meta = [n.source, n.date].filter(Boolean).join(" · ");
    const title = n.url
      ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title || "")}</a>`
      : escapeHtml(n.title || "");
    return `<li class="mc-news-item" data-tone="${tone}">
        <span class="mc-news-title">${title}</span>
        ${n.summary ? `<span class="mc-news-sum">${escapeHtml(n.summary)}</span>` : ""}
        ${meta ? `<span class="mc-news-src">${escapeHtml(meta)}</span>` : ""}
      </li>`;
  };
  const NEWS_VISIBLE = 6;
  const newsHtml = newsItems.length
    ? `<div class="mc-news"><h5>이 시장의 뉴스 <span class="mc-news-count">${newsItems.length}건</span></h5>
        <ul>${newsItems.slice(0, NEWS_VISIBLE).map(newsLi).join("")}</ul>
        ${newsItems.length > NEWS_VISIBLE
          ? `<details class="mc-news-more"><summary>지난 뉴스 ${newsItems.length - NEWS_VISIBLE}건 더 보기</summary>
               <ul>${newsItems.slice(NEWS_VISIBLE).map(newsLi).join("")}</ul></details>`
          : ""}
      </div>`
    : `<div class="mc-news mc-news--empty"><h5>이 시장의 뉴스</h5><p>아직 수집된 시장 뉴스가 없습니다 — 주간 리서치 루틴이 채웁니다.</p></div>`;

  // 점유율 바 + 플레이어 목록(점유율·뉴스 점수)
  const barHtml = mcShareBar(m.players);
  const playersHtml = (m.players || []).map((p) => {
    let chip = "", cls = "mc-player";
    if (p.ticker && p.in_watchlist) {
      cls += " mc-player--data";
      const q = stocks && stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
      if (q && typeof q.narrative_score === "number") {
        const tone = q.narrative_score > 0.05 ? "pos" : q.narrative_score < -0.05 ? "neg" : "neutral";
        chip = `<span class="mc-player-score" data-tone="${tone}">${q.narrative_score >= 0 ? "+" : ""}${q.narrative_score.toFixed(2)}</span>`;
      } else {
        chip = `<span class="mc-player-score" data-tone="neutral">—</span>`;
      }
    } else {
      chip = `<span class="mc-player-ext">${p.ticker ? "데이터 예정" : "비상장"}</span>`;
    }
    const tk = p.ticker ? `<span class="mc-player-tk">${escapeHtml(p.ticker)}</span>` : "";
    const share = typeof p.share === "number" ? `<span class="mc-player-share">${p.share}%</span>` : "";
    return `<li class="${cls}">
        <span class="mc-player-name">${escapeHtml(p.name)} ${tk}</span>
        <span class="mc-player-role">${escapeHtml(p.role || "")}</span>
        ${share}${chip}
      </li>`;
  }).join("");

  const sizeMeta = [
    m.size_label ? `규모 <strong>${escapeHtml(m.size_label)}</strong>` : "",
    m.growth ? `성장 ${escapeHtml(m.growth)}` : "",
    m.size_confidence ? `<span class="mc-conf mc-conf--${escapeHtml(m.size_confidence)}">신뢰도 ${escapeHtml(m.size_confidence)}</span>` : "",
  ].filter(Boolean).join(" · ");

  const srcHtml = (m.sources || []).length
    ? `<details class="mc-sources"><summary>출처 ${m.sources.length}</summary><ul>${
        m.sources.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(String(u).replace(/^https?:\/\//, "").split("/")[0])}</a></li>`).join("")
      }</ul></details>`
    : "";

  const layerLabel = (map.layers.find((l) => l.id === m.layer) || {}).label || "";
  const accent = m.bottleneck ? (MC_SEVERITY_COLOR[m.bottleneck.severity] || "var(--border-mid)") : "var(--border-mid)";

  const pmBtn = m.player_map
    ? `<button type="button" class="pm-open-btn" data-pm="${escapeHtml(m.id)}"
         title="이 시장만을 기업(플레이어) 단위로 펼친 전용 화면">⤢ 플레이어 지도 열기 — 기업 단위로 확대</button>`
    : "";

  host.innerHTML = `
    <header class="mc-detail-head" style="--mc-accent:${accent}">
      <span class="mc-detail-layer">${escapeHtml(layerLabel)}</span>
      <h4>${escapeHtml(m.name_kr)}</h4>
      <p class="mc-detail-en">${escapeHtml(m.name_en || "")}</p>
    </header>
    <p class="mc-detail-def">${escapeHtml(m.definition || "")}</p>
    ${pmBtn}
    ${sizeMeta ? `<p class="mc-detail-size">${sizeMeta}</p>` : ""}
    ${m.demand_driver ? `<p class="mc-detail-driver"><span>수요 동인</span>${escapeHtml(m.demand_driver)}</p>` : ""}
    ${btlHtml}
    ${pulseHtml}
    ${moodHtml}
    ${devHtml}
    ${weeklyHtml}
    ${newsHtml}
    <div class="mc-wiki" hidden></div>
    <div class="mc-players">
      <h5>시장 점유율 · 핵심 플레이어</h5>
      ${barHtml ? `<div class="mc-share-wrap">${barHtml}</div>` : ""}
      <ul>${playersHtml}</ul>
    </div>
    ${relHtml(needs, "need", "◀ 의존하는 공급 (상류)")}
    ${relHtml(pulledBy, "pull", "끌어당기는 수요 (하류) ▶")}
    ${srcHtml}`;

  host.querySelectorAll(".mc-rel-link[data-goto]").forEach((b) =>
    b.addEventListener("click", () => selectMarketNode(b.dataset.goto, stocks)));
  const pb = host.querySelector(".pm-open-btn[data-pm]");
  if (pb) pb.addEventListener("click", () => pmOpen(pb.dataset.pm));
  mcFillWikiSlot(host.querySelector(".mc-wiki"), m.wiki, m.players);
  mcRenderMarketNote(m);
}

// ── 시장 노드 종합 노트 (지도 아래 인라인) ─────────────────────────────
// 루틴이 관리하는 luke_wiki 의 시장 노드별 종합 페이지
// (wiki/news/markets/{map_id}/{market_id}.md — 시장 정의·병목·기업 동향·뉴스 로그)
// 를 노드 선택 시 지도 아래에 바로 펼쳐 보여준다. 파일이 없는 지도(전력·바이오)는 숨김.

let MC_NOTE_REQ = 0;

async function mcRenderMarketNote(m) {
  const host = document.getElementById("mc-note");
  if (!host) return;
  const req = ++MC_NOTE_REQ;
  const graph = await wnLoadGraph();
  if (req !== MC_NOTE_REQ || !host.isConnected) return;  // 그 사이 다른 노드 선택
  const idx = graph ? wnNodeByPath(`wiki/news/markets/${MC_STATE.mapId}/${m.id}.md`) : -1;
  if (idx < 0) { mcHideMarketNote(); return; }
  await wnFillInlineNote(host, idx, { kind: "시장 종합 노트 (루틴 관리)", title: `${m.name_kr} — 시장 종합` });
  wnScrollNoteIntoView(host);
}

// 노트가 화면 밖(아래)이면 읽을 위치로 데려간다 — 이미 보이면 건드리지 않는다
function wnScrollNoteIntoView(host) {
  if (!host || host.hidden || !host.isConnected) return;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const top = host.getBoundingClientRect().top;
  if (top >= 0 && top < vh * 0.7) return;
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

function mcHideMarketNote() {
  const host = document.getElementById("mc-note");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

// ── 옵시디언 위키 노트 연결 ─────────────────────────────────────────────
// 시장 지도의 짧은 요약을 luke_wiki 의 긴 글로 확장하는 다리.
// 두 경로로 노트를 모은다:
//   1) 큐레이션 — 시장 JSON 의 markets[].wiki: [{path, label}] (vault 상대 경로)
//   2) 자동     — players[].ticker 와 루틴 뉴스 로그(wiki/news/tickers/) 매칭
// graph.json 이 아직 동기화 전이면 노트 섹션을 숨기고 시장 지도는 유지한다.

const MC_WIKI_KIND = {
  "wiki/principles": "원칙", "wiki/concepts": "개념", "wiki/topics": "주제",
  "wiki/entities": "기업·조직", "wiki/syntheses": "내 판단", "wiki/comparisons": "비교",
  "wiki/news": "뉴스 로그", "sources": "원문",
};

async function mcFillWikiSlot(slot, curated, players) {
  if (!slot) return;
  const graph = await wnLoadGraph();
  // fetch 대기 중 다른 노드를 선택했으면 slot 은 이미 DOM 에서 떨어져 있다
  if (!graph || !slot.isConnected) return;

  const refs = [], seen = new Set();
  (curated || []).forEach((w) => {
    const i = wnNodeByPath(w.path);
    if (i < 0 || seen.has(i)) return;
    seen.add(i);
    const n = graph.nodes[i];
    refs.push({ idx: i, label: w.label || n.title, kind: MC_WIKI_KIND[n.folder] || n.folder, mtime: n.mtime });
  });
  (players || []).forEach((p) => {
    if (!p.ticker) return;
    const i = wnNodeByTicker(p.ticker);
    if (i < 0 || seen.has(i)) return;
    seen.add(i);
    refs.push({ idx: i, label: `${p.name} 뉴스 로그`, kind: "뉴스 로그", auto: true, mtime: graph.nodes[i].mtime });
  });
  if (!refs.length) return;

  slot.innerHTML = `
    <h5>옵시디언 위키 노트 <span class="mc-news-count">${refs.length}</span></h5>
    <p class="mc-wiki-hint">루틴·공부로 쌓인 긴 글 — 클릭하면 이 화면에서 읽습니다.</p>
    <ul>${refs.map((r, k) => `
      <li><button type="button" class="mc-wiki-btn" data-ref="${k}">
        <span class="mc-wiki-kind${r.auto ? " mc-wiki-kind--auto" : ""}">${escapeHtml(r.kind)}</span>
        <span class="mc-wiki-title">${escapeHtml(r.label)}</span>
        ${r.mtime ? `<span class="mc-wiki-mtime">${escapeHtml(r.mtime)}</span>` : ""}
      </button></li>`).join("")}
    </ul>`;
  slot.hidden = false;
  slot.querySelectorAll(".mc-wiki-btn").forEach((b) =>
    b.addEventListener("click", () => wnOpenByIdx(refs[Number(b.dataset.ref)].idx)));
}
