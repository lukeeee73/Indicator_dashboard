// Player-map overlay, company edges, selection and canvas gestures.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ════════════════════════════════════════════════════════════════════════
//  플레이어 지도 (player map) — 세부 시장 하나를 기업 단위로 펼친 전용 화면
// ════════════════════════════════════════════════════════════════════════
//
// 시장 지도가 '시장(수요)' 단위라면, 플레이어 지도는 그 중 한 시장을 골라
// 기업(플레이어) 단위로 다시 그린 확대경이다. 시장 JSON 의 markets[].player_map
// 이 가리키는  data/markets/players/<id>.json  이 데이터 SSOT 이며,
// 그 시장의 밸류체인을 그룹(컬럼: 장비·소재 → 제조 → 패키징 → 고객)과
// 기업 노드·거래선(links: 공급자 from → 수요자 to)으로 정의한다.
//
// 시각 문법은 시장 지도와 동일: 기본은 그룹 사이 집계 흐름선만 보여주고,
// 기업을 클릭하면 그 기업의 거래선(+라벨)만 강조하고 나머지는 흐려진다.
// 우측 패널은 처음엔 시장 요약, 기업 선택 시 그 기업의 상세·거래 관계.
// 지도 노드 클릭 → 오버레이(새 화면)로 열리고, ESC / ← 로 시장 지도에 복귀.

const PM_STATE = { open: false, data: null, market: null, cache: {}, active: null, zoom: 1, userZoomed: false };
const PM_FLAGS = { KR: "🇰🇷", US: "🇺🇸", JP: "🇯🇵", NL: "🇳🇱", TW: "🇹🇼", HK: "🇭🇰", CN: "🇨🇳", EU: "🇪🇺" };

// 진입점: 시장 id 로 플레이어 지도 데이터를 로드(1회 캐시)하고 오버레이를 연다
async function pmOpen(marketId) {
  const map = MC_STATE.map;
  const m = map && map.markets.find((x) => x.id === marketId);
  const host = document.getElementById("pm-overlay");
  if (!m || !m.player_map || !host) return;
  if (!PM_STATE.cache[m.id]) {
    try {
      PM_STATE.cache[m.id] = await sbDoc("market", m.player_map.replace(/\.json$/, ""));
    } catch (err) {
      host.hidden = false;
      host.innerHTML = `<header class="pm-head">
          <button type="button" class="pm-back" id="pm-back">← 시장 지도</button>
          <div class="pm-title"><h3>${escapeHtml(m.name_kr)} 플레이어 지도</h3>
            <p>데이터를 불러오지 못했습니다 (${escapeHtml(err.message)})</p></div></header>`;
      PM_STATE.open = true;
      document.body.classList.add("mc-noscroll");
      host.querySelector("#pm-back").addEventListener("click", pmClose);
      return;
    }
  }
  PM_STATE.data = PM_STATE.cache[m.id];
  PM_STATE.market = m;
  PM_STATE.active = null;
  PM_STATE.zoom = 1;
  PM_STATE.userZoomed = false;
  PM_STATE.open = true;
  document.body.classList.add("mc-noscroll");
  pmRender();
}

function pmClose() {
  const host = document.getElementById("pm-overlay");
  if (host) { host.hidden = true; host.innerHTML = ""; }
  PM_STATE.open = false;
  PM_STATE.active = null;
  // 시장 지도 전체화면(mc-full)에서 열렸다면 스크롤 잠금은 유지한다
  if (!document.querySelector(".sector-panel.mc-full")) document.body.classList.remove("mc-noscroll");
}

// 오버레이 전체 렌더: 헤더(복귀·병목 태그) + 축 + 그룹 컬럼 보드 + 우측 패널
function pmRender() {
  const host = document.getElementById("pm-overlay");
  const d = PM_STATE.data, m = PM_STATE.market;
  if (!host || !d || !m) return;
  const sev = m.bottleneck && m.bottleneck.severity;
  const sevLeg = sev ? (MC_STATE.map.severity_legend[sev] || {}) : null;
  const sevChip = sevLeg
    ? `<span class="pm-sev" style="--mc-c:${MC_SEVERITY_COLOR[sev] || "var(--text-dim)"}">${escapeHtml(sevLeg.label || sev)}</span>`
    : "";
  const ax = d.axis || {};
  host.hidden = false;
  host.innerHTML = `
    <header class="pm-head">
      <button type="button" class="pm-back" id="pm-back" title="시장 지도로 돌아가기 (ESC)">← 시장 지도</button>
      <div class="pm-title">
        <h3>${escapeHtml(d.name_kr || m.name_kr)} <span class="pm-title-sub">플레이어 지도</span>${sevChip}</h3>
        <p>${escapeHtml(d.subtitle || "")}${d.as_of ? ` <span class="pm-asof">· 기준 ${escapeHtml(d.as_of)}</span>` : ""}</p>
      </div>
      <button type="button" class="pm-close" id="pm-close" title="닫기 (ESC)">✕</button>
    </header>
    <div class="pm-layout">
      <div class="pm-board-wrap" id="pm-board-wrap">
        <svg class="pm-links" id="pm-links" aria-hidden="true"></svg>
        <div class="pm-board" id="pm-board">
          <div class="mc-axis">
            <span>${escapeHtml(ax.left || "장비·소재 — 공정을 가능케 하는 곳")}</span>
            <span class="mc-axis-mid">${escapeHtml(ax.mid || "물건이 흐르는 방향 ▶")}</span>
            <span>${escapeHtml(ax.right || "최종 고객 — 돈을 내는 곳")}</span>
          </div>
          <div class="pm-cols">${(d.groups || []).map((g) => pmGroupEl(g, d)).join("")}</div>
        </div>
      </div>
      <aside class="pm-detail" id="pm-detail">${pmMarketSummaryHtml()}</aside>
    </div>
    <section class="pm-note wn-inline" id="pm-note" hidden aria-label="옵시디언 노트"></section>`;
  host.querySelector("#pm-back").addEventListener("click", pmClose);
  host.querySelector("#pm-close").addEventListener("click", pmClose);
  host.querySelectorAll(".pm-player[data-id]").forEach((el) =>
    el.addEventListener("click", () => pmSelect(el.dataset.id)));
  pmWireCanvas();
  requestAnimationFrame(() => { pmFitZoom(); pmDrawLinks(); });
  pmShowMarketNote();
}

// ── 플레이어 지도 아래 인라인 옵시디언 노트 ─────────────────────────────
// 초기·선택해제 상태: 이 시장의 종합 노트. 기업 선택: 그 기업의 뉴스 로그.

async function pmShowMarketNote() {
  const host = document.getElementById("pm-note");
  const m = PM_STATE.market;
  if (!host || !m) return;
  const graph = await wnLoadGraph();
  if (!host.isConnected || PM_STATE.active) return;  // 그 사이 기업을 선택했으면 양보
  const idx = graph ? wnNodeByPath(`wiki/news/markets/${MC_STATE.mapId}/${m.id}.md`) : -1;
  if (idx < 0) { host.hidden = true; host.innerHTML = ""; return; }
  wnFillInlineNote(host, idx, { kind: "시장 종합 노트 (루틴 관리)", title: `${m.name_kr} — 시장 종합` });
}

async function pmShowPlayerNote(p) {
  const host = document.getElementById("pm-note");
  if (!host || !p) return;
  const graph = await wnLoadGraph();
  if (!host.isConnected || PM_STATE.active !== p.id) return;  // 선택이 바뀌었으면 중단
  const idx = graph && p.ticker ? wnNodeByTicker(p.ticker) : -1;
  if (idx < 0) {
    host.hidden = false;
    host.innerHTML = `
      <header class="wn-inline-head">
        <span class="wn-inline-kind">기업 뉴스 로그</span>
        <h4>${escapeHtml(p.name)}</h4>
      </header>
      <div class="wn-body wn-inline-body"><p class="wn-error">이 기업의 옵시디언 뉴스 로그가 아직 없습니다${p.ticker ? "" : " (비상장)"} — watchlist 편입 후 루틴이 생성합니다.</p></div>`;
    wnScrollNoteIntoView(host);
    return;
  }
  await wnFillInlineNote(host, idx, { kind: "기업 뉴스 로그 (루틴 관리)", title: `${p.name} — Routine News Log` });
  if (PM_STATE.active === p.id) wnScrollNoteIntoView(host);
}

// 그룹 컬럼 (center 그룹은 강조)
function pmGroupEl(g, d) {
  const players = (d.players || []).filter((p) => p.group === g.id);
  return `<section class="pm-col${g.center ? " pm-col--center" : ""}" data-group="${escapeHtml(g.id)}"
      style="--cl-c:${g.color || "#7f8a99"}">
    <header class="pm-col-head">
      <h4>${escapeHtml(g.title || g.id)}</h4>
      ${g.desc ? `<span>${escapeHtml(g.desc)}</span>` : ""}
    </header>
    <div class="pm-col-nodes">${players.map((p) => pmNodeHtml(p)).join("")}</div>
  </section>`;
}

// 기업 노드 — 국기 + 이름 (+점유율) + 역할 + 티커. watchlist 종목은 뉴스 시그널 점.
function pmNodeHtml(p) {
  const flag = PM_FLAGS[p.country] || "";
  const share = typeof p.share === "number" ? `<span class="pm-share">${p.share}%</span>` : "";
  let dot = "";
  const stocks = MC_STATE.stocks || {};
  if (p.ticker && p.in_watchlist) {
    const q = stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number") {
      const tone = q.narrative_score > 0.05 ? "pos" : q.narrative_score < -0.05 ? "neg" : "neutral";
      dot = `<i class="mc-node-mood" data-tone="${tone}" title="뉴스 시그널 ${q.narrative_score >= 0 ? "+" : ""}${q.narrative_score.toFixed(2)}"></i>`;
    }
  }
  const tk = p.ticker
    ? `<span class="pm-tk">${escapeHtml(p.ticker)}</span>`
    : `<span class="pm-tk pm-tk--private">비상장</span>`;
  return `<button type="button" class="pm-player" data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.role || "")}">
      <span class="pm-player-name">${flag ? `<span class="pm-flag">${flag}</span>` : ""}<span>${escapeHtml(p.name)}</span>${dot}${share}</span>
      <span class="pm-player-role">${escapeHtml(p.role || "")}</span>
      ${tk}
    </button>`;
}

// 기업 선택: 노드 강조 + 그 기업의 거래선만 표시 + 상세 패널
function pmSelect(id) {
  const d = PM_STATE.data;
  const board = document.getElementById("pm-board");
  if (!d || !board) return;
  PM_STATE.active = id;
  const suppliers = d.links.filter((l) => l.to === id).map((l) => l.from);   // 이 기업에 공급하는 곳
  const customers = d.links.filter((l) => l.from === id).map((l) => l.to);   // 이 기업이 공급하는 곳
  const connected = new Set([...suppliers, ...customers, id]);
  board.querySelectorAll(".pm-player").forEach((el) => {
    const t = el.dataset.id;
    el.classList.toggle("pm-player--active", t === id);
    el.classList.toggle("pm-player--linked", connected.has(t) && t !== id);
    el.classList.toggle("pm-player--dim", !connected.has(t));
  });
  pmDrawActiveEdges(id);
  pmRenderDetail(id, suppliers, customers);
  const p = (d.players || []).find((x) => x.id === id);
  if (p) pmShowPlayerNote(p);
}

// 선택 해제 → 시장 요약으로 복귀
function pmClearSelect() {
  const board = document.getElementById("pm-board");
  const svg = document.getElementById("pm-links");
  PM_STATE.active = null;
  if (board) board.querySelectorAll(".pm-player").forEach((el) =>
    el.classList.remove("pm-player--active", "pm-player--linked", "pm-player--dim"));
  if (svg) {
    svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
    svg.querySelectorAll(".mc-flow--dim").forEach((p) => p.classList.remove("mc-flow--dim"));
  }
  const detail = document.getElementById("pm-detail");
  if (detail) detail.innerHTML = pmMarketSummaryHtml();
  pmShowMarketNote();
}

// 우측 패널 초기 상태 — 이 세부 시장의 요약 (정의·병목·3사 점유율·읽는 법)
function pmMarketSummaryHtml() {
  const m = PM_STATE.market, d = PM_STATE.data, map = MC_STATE.map;
  if (!m || !d) return "";
  const accent = m.bottleneck ? (MC_SEVERITY_COLOR[m.bottleneck.severity] || "var(--border-mid)") : "var(--border-mid)";
  let btlHtml = "";
  if (m.bottleneck && map) {
    const leg = map.severity_legend[m.bottleneck.severity] || {};
    btlHtml = `<div class="mc-btl-box" style="--mc-c:${accent}">
        <span class="mc-btl-tag">${escapeHtml(leg.label || m.bottleneck.severity)}</span>
        <p class="mc-btl-text">${escapeHtml(m.bottleneck.limit || "")}</p>
      </div>`;
  }
  const sizeMeta = [
    m.size_label ? `규모 <strong>${escapeHtml(m.size_label)}</strong>` : "",
    m.growth ? `성장 ${escapeHtml(m.growth)}` : "",
  ].filter(Boolean).join(" · ");
  const bar = mcShareBar((d.players || []).filter((p) => typeof p.share === "number"));
  const srcHtml = (d.sources || []).length
    ? `<details class="mc-sources"><summary>출처 ${d.sources.length}</summary><ul>${
        d.sources.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(String(u).replace(/^https?:\/\//, "").split("/")[0])}</a></li>`).join("")
      }</ul></details>`
    : "";
  return `
    <header class="mc-detail-head" style="--mc-accent:${accent}">
      <span class="mc-detail-layer">시장 요약</span>
      <h4>${escapeHtml(m.name_kr)}</h4>
      <p class="mc-detail-en">${escapeHtml(m.name_en || "")}</p>
    </header>
    <p class="mc-detail-def">${escapeHtml(m.definition || "")}</p>
    ${sizeMeta ? `<p class="mc-detail-size">${sizeMeta}</p>` : ""}
    ${btlHtml}
    ${d.intro ? `<div class="mc-weekly"><h5>지도 읽는 법</h5><p>${escapeHtml(d.intro)}</p></div>` : ""}
    ${bar ? `<div class="mc-players"><h5>제조사 점유율</h5><div class="mc-share-wrap">${bar}</div></div>` : ""}
    ${mcDevChartHtml(d.players, MC_STATE.stocks || {})}
    <p class="vc-detail-hint">기업 노드를 클릭하면 상세와 거래 관계가 표시됩니다.</p>
    ${srcHtml}`;
}

// 기업 상세 패널 — 역할·설명·거래 관계(조달/공급). 관계 클릭 → 그 기업 선택.
function pmRenderDetail(id, suppliers, customers) {
  const host = document.getElementById("pm-detail");
  const d = PM_STATE.data;
  const p = d && d.players.find((x) => x.id === id);
  if (!host || !p) return;
  const g = (d.groups || []).find((x) => x.id === p.group) || {};
  const flag = PM_FLAGS[p.country] || "";
  const nameOf = (pid) => { const x = d.players.find((y) => y.id === pid); return x ? x.name : pid; };
  const labelFor = (pid, dir) => {
    const l = dir === "sup"
      ? d.links.find((x) => x.to === id && x.from === pid)
      : d.links.find((x) => x.from === id && x.to === pid);
    return l ? l.label : "";
  };
  const relHtml = (list, dir, title) => {
    if (!list.length) return "";
    const items = list.map((pid) =>
      `<li><button class="mc-rel-link" data-goto="${escapeHtml(pid)}">${escapeHtml(nameOf(pid))}</button>
         <span class="mc-rel-label">${escapeHtml(labelFor(pid, dir))}</span></li>`).join("");
    return `<div class="mc-rel-block"><h5>${title}</h5><ul>${items}</ul></div>`;
  };
  let scoreHtml = "";
  const stocks = MC_STATE.stocks || {};
  if (p.ticker && p.in_watchlist) {
    const rel = mcScoreRows(d.players, stocks);
    const mine = rel && rel.rows.find((r) => r.ticker === p.ticker);
    if (mine) {
      // 절대값 대신 시장 평균 대비 상대 위치로 읽는다 — 톤도 편차 기준
      const rank = rel.rows.indexOf(mine) + 1;
      const tone = mine.dev > 0.05 ? "pos" : mine.dev < -0.05 ? "neg" : "neutral";
      const relTxt = rel.rows.length >= 2
        ? ` · 시장 평균 ${mcFmtScore(rel.avg)} 대비 <strong>${mcFmtScore(mine.dev)}</strong> (시장 내 ${rank}/${rel.rows.length}위)`
        : " · watchlist 추적 중";
      scoreHtml = `<p class="mc-mood" data-tone="${tone}"><span>뉴스 시그널</span> <strong>${mcFmtScore(mine.score)}</strong>${relTxt}</p>
        ${rel.rows.length >= 2 ? mcDevChartHtml(d.players, stocks, { highlight: p.ticker, title: "시장 내 상대 위치" }) : ""}`;
    }
  }
  const share = typeof p.share === "number" ? ` · 점유 ${p.share}%` : "";
  host.innerHTML = `
    <button type="button" class="pm-detail-back" id="pm-detail-back">← ${escapeHtml((PM_STATE.market && PM_STATE.market.name_kr) || "시장")} 요약으로</button>
    <header class="mc-detail-head" style="--mc-accent:${g.color || "var(--border-mid)"}">
      <span class="mc-detail-layer">${escapeHtml(g.title || "")}</span>
      <h4>${flag ? flag + " " : ""}${escapeHtml(p.name)}</h4>
      <p class="mc-detail-en">${escapeHtml(p.name_en || "")}${p.ticker ? ` · ${escapeHtml(p.ticker)}` : " · 비상장"}${share}</p>
    </header>
    ${p.role ? `<p class="mc-detail-size"><strong>${escapeHtml(p.role)}</strong></p>` : ""}
    ${p.note ? `<p class="mc-detail-def">${escapeHtml(p.note)}</p>` : ""}
    ${scoreHtml}
    <div class="mc-wiki" hidden></div>
    ${relHtml(suppliers, "sup", "◀ 이 기업에 공급 (조달처)")}
    ${relHtml(customers, "cust", "이 기업이 공급하는 곳 ▶")}`;
  host.querySelector("#pm-detail-back").addEventListener("click", pmClearSelect);
  host.querySelectorAll(".mc-rel-link[data-goto]").forEach((b) =>
    b.addEventListener("click", () => pmSelect(b.dataset.goto)));
  // 기업 노트(큐레이션 p.wiki) + 이 기업 티커의 루틴 뉴스 로그
  mcFillWikiSlot(host.querySelector(".mc-wiki"), p.wiki, [p]);
}

// ── 플레이어 지도 엣지 (시장 지도와 동일한 문법·좌표계) ────────────────────
// 좌표 계산은 mcEdgeGeo / mcFlowPath (순수 함수)를 재사용한다.
// links 방향: from(공급자) → to(수요자) — 화살표가 사는 쪽을 가리킨다.

function pmRectOf(id, wrap, wrapRect) {
  const el = wrap.querySelector(`.pm-player[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const z = PM_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

function pmGroupRect(gid, wrap, wrapRect) {
  const el = wrap.querySelector(`.pm-col[data-group="${CSS.escape(gid)}"]`);
  if (!el) return null;
  const z = PM_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

function pmAddEdge(svg, wrap, wrapRect, l, cls, marker, withLabel) {
  const a = pmRectOf(l.from, wrap, wrapRect), b = pmRectOf(l.to, wrap, wrapRect);
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

// 기본 상태: 그룹 사이 집계 흐름선(굵기 = 거래선 수). 같은 그룹 내부는 선택 시에만.
function pmDrawLinks() {
  const svg = document.getElementById("pm-links");
  const wrap = document.getElementById("pm-board-wrap");
  const d = PM_STATE.data;
  if (!svg || !wrap || !d) return;
  const wrapRect = wrap.getBoundingClientRect();
  if (wrapRect.width === 0) return;

  svg.innerHTML = "";
  const board = document.getElementById("pm-board");
  svg.setAttribute("width", board ? board.scrollWidth : wrap.scrollWidth);
  svg.setAttribute("height", board ? board.scrollHeight : wrap.scrollHeight);

  const defs = document.createElementNS(MC_SVGNS, "defs");
  defs.innerHTML = `
    <marker id="pm-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#5c6470"></path>
    </marker>
    <marker id="pm-arr-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#c2c9d4"></path>
    </marker>`;
  svg.appendChild(defs);

  const gOf = {};
  (d.players || []).forEach((p) => { gOf[p.id] = p.group; });

  // 1) 거래선을 그룹 쌍으로 집계
  const flows = new Map();
  (d.links || []).forEach((l) => {
    const src = gOf[l.from], dst = gOf[l.to];
    if (!src || !dst || src === dst) return;
    const k = `${src}→${dst}`;
    const f = flows.get(k) || { src, dst, count: 0, labels: [] };
    f.count += 1;
    if (l.label && f.labels.length < 3) f.labels.push(l.label);
    flows.set(k, f);
  });

  // 2) 컬럼 좌표 + 방향 판별
  const items = [];
  flows.forEach((f) => {
    const a = pmGroupRect(f.src, wrap, wrapRect), b = pmGroupRect(f.dst, wrap, wrapRect);
    if (!a || !b) return;
    const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) >= Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    items.push({ ...f, a, b, horiz });
  });

  // 3) 같은 면에서 나가는/들어오는 선끼리 anchor 를 벌려 겹침 방지
  const groupPush = (m2, k, it) => { const arr = m2.get(k) || []; arr.push(it); m2.set(k, arr); };
  const outG = new Map(), inG = new Map();
  items.forEach((it) => {
    groupPush(outG, `${it.src}:${it.horiz ? "h" : "v"}`, it);
    groupPush(inG, `${it.dst}:${it.horiz ? "h" : "v"}`, it);
  });
  outG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.b.y - q.b.y) : (p.b.x - q.b.x)));
    arr.forEach((it, i) => { it.offA = (i - (arr.length - 1) / 2) * 22; });
  });
  inG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.a.y - q.a.y) : (p.a.x - q.a.x)));
    arr.forEach((it, i) => { it.offB = (i - (arr.length - 1) / 2) * 22; });
  });

  // 4) 흐름선 — 연결 수에 따라 굵기
  items.forEach((it) => {
    const p = document.createElementNS(MC_SVGNS, "path");
    p.setAttribute("d", mcFlowPath(it.a, it.b, it.horiz, it.offA || 0, it.offB || 0));
    p.setAttribute("class", "mc-flow");
    p.setAttribute("stroke-width", (1.3 + Math.min(2.4, (it.count - 1) * 0.45)).toFixed(1));
    p.setAttribute("marker-end", "url(#pm-arr)");
    const ti = document.createElementNS(MC_SVGNS, "title");
    ti.textContent = `${it.count}개 거래선 — ${it.labels.join(" · ")}`;
    p.appendChild(ti);
    svg.appendChild(p);
  });

  // 5) 활성 기업이 있으면 세부 거래선
  if (PM_STATE.active) pmDrawActiveEdges(PM_STATE.active);
}

// 선택 기업의 거래선 + 라벨. 집계 흐름선은 흐리게.
function pmDrawActiveEdges(id) {
  const svg = document.getElementById("pm-links");
  const wrap = document.getElementById("pm-board-wrap");
  const d = PM_STATE.data;
  if (!svg || !wrap || !d) return;
  svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
  svg.querySelectorAll(".mc-flow").forEach((p) => p.classList.add("mc-flow--dim"));
  const wrapRect = wrap.getBoundingClientRect();
  d.links.filter((l) => l.from === id || l.to === id).forEach((l) =>
    pmAddEdge(svg, wrap, wrapRect, l, "mc-edge mc-active-edge", "pm-arr-hi", true));
}

// ── 플레이어 지도 캔버스: 맞춤 줌 · Ctrl+휠 줌 · 드래그 패닝 ───────────────
function pmApplyZoom() {
  const board = document.getElementById("pm-board");
  const svg = document.getElementById("pm-links");
  const z = PM_STATE.zoom || 1;
  [board, svg].forEach((el) => {
    if (!el) return;
    el.style.transform = z === 1 ? "" : `scale(${z})`;
    el.style.transformOrigin = "0 0";
  });
}

function pmFitZoom() {
  const wrap = document.getElementById("pm-board-wrap");
  const board = document.getElementById("pm-board");
  if (!wrap || !board || wrap.clientWidth === 0 || board.scrollWidth === 0) return;
  PM_STATE.zoom = Math.min(1.6, Math.max(0.5, Math.round(((wrap.clientWidth - 18) / board.scrollWidth) * 100) / 100));
  pmApplyZoom();
}

let pmDrag = null; // 드래그 패닝 상태 (window 리스너는 1회만 등록)
window.addEventListener("mousemove", (e) => {
  if (!pmDrag) return;
  pmDrag.wrap.scrollLeft = pmDrag.sl - (e.clientX - pmDrag.x);
  pmDrag.wrap.scrollTop = pmDrag.st - (e.clientY - pmDrag.y);
});
window.addEventListener("mouseup", () => {
  if (pmDrag) pmDrag.wrap.classList.remove("mc-grabbing");
  pmDrag = null;
});

function pmWireCanvas() {
  const wrap = document.getElementById("pm-board-wrap");
  if (!wrap || wrap.dataset.pmWired) return;
  wrap.dataset.pmWired = "1";
  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // 일반 휠 = 스크롤
    e.preventDefault();
    const old = PM_STATE.zoom || 1;
    const z = Math.min(2.2, Math.max(0.4, old * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    if (Math.abs(z - old) < 0.001) return;
    const r = wrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    PM_STATE.zoom = Math.round(z * 1000) / 1000;
    PM_STATE.userZoomed = true;
    pmApplyZoom();
    const ratio = PM_STATE.zoom / old;
    wrap.scrollLeft = (wrap.scrollLeft + px) * ratio - px;
    wrap.scrollTop = (wrap.scrollTop + py) * ratio - py;
    pmDrawLinks();
  }, { passive: false });
  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".pm-player, button, a")) return;
    pmDrag = { wrap, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add("mc-grabbing");
    e.preventDefault();
  });
}

// Shared map listeners require both MC_STATE and PM_STATE to be initialized.
// Register here so input between classic script downloads cannot see missing state.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (PM_STATE.open) { pmClose(); return; } // 플레이어 지도가 열려 있으면 그것부터 닫는다
  mcToggleFull(false);
});

// 서브탭이 보일 때 / 리사이즈 시 전체 엣지 다시 그리기
// (wireSectorNav 가 서브탭 전환마다 window resize 를 디스패치한다)
window.addEventListener("resize", () => {
  if (PM_STATE.open) {
    if (!PM_STATE.userZoomed) pmFitZoom();
    pmDrawLinks();
  }
  if (!MC_STATE.map) return;
  drawAllMarketLinks();
  if (MC_STATE.activeNode) highlightMarketLinks(MC_STATE.activeNode);
});
