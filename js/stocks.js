// Stock/index cards, sector search, financial metrics and valuation rendering.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ---------- 주식 탭 렌더링 -------------------------------------------

function renderStocksTab(data) {
  const stocks  = data.stocks  || {};
  const indices = data.indices || {};

  // ─ 시장 지수 ─
  const indexHost = document.getElementById("index-cards");
  if (indexHost) {
    if (Object.keys(indices).length === 0) {
      indexHost.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions를 실행해 주세요.");
    } else {
      for (const [code, payload] of Object.entries(indices)) {
        if (!payload || !payload.series || payload.series.length === 0) continue;
        try {
          indexHost.appendChild(renderIndexCard(code, payload));
        } catch (err) {
          console.error(`${code} 지수 카드를 그리지 못했습니다`, err);
        }
      }
    }
  }

  // ─ 가치 발굴 (월간 스크리닝) — 먼저 로드해 두면 lazy 렌더되는 카드에 🎯 배지가 붙는다 ─
  const valueScreenReady = loadValueScreen().then((vs) => renderValuePicks(vs, stocks));

  // ─ 개별 종목 (섹터 그룹별 · 접이식 + 검색) ─
  const stockHost = document.getElementById("stock-cards");
  if (stockHost) {
    if (Object.keys(stocks).length === 0) {
      stockHost.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions를 실행해 주세요.");
    } else {
      renderStocksByGroup(stockHost, stocks);
      wireStockToolbar(stocks);
      // 스크리닝 결과가 그룹 렌더 후 도착하면 이미 열린 그룹의 배지를 갱신
      valueScreenReady.then(() => refreshValuePassBadges());
    }
  }

  // ─ AI·반도체 시장 지도 (수요 캐스케이드 · 병목 중심) ─
  renderMarketCascade(stocks);

  // 서브 네비게이션 (시장 지수 / 개별 종목 / 시장 지도 토글)
  wireSectorNav("STOCKS");
}

// ─── 개별 종목: 섹터 토글 + 검색 ─────────────────────────────────────
//
// 섹터 그룹은 기본으로 접혀 있고 헤더를 누르면 열린다. 카드(차트 포함)는
// 그룹이 처음 열릴 때만 렌더한다 (150+ 종목 전체를 한 번에 그리지 않음).
// 뉴스 루틴이 '오늘' 갱신한 종목(valuation.qualitative.as_of == 오늘)이 있는
// 섹터는 페이지를 연 그날에만 자동으로 펼쳐지고 🗞️ 배지가 붙는다.
// 검색창은 접힘 상태와 무관하게 전 종목을 훑어, 일치하는 종목이 있는
// 그룹만 열어서 그 카드만 보여준다.

const STOCK_GROUP_STATES = []; // renderStocksByGroup 이 채움 — 검색/전체펼치기가 사용

function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 뉴스 루틴이 오늘 이 종목을 갱신했는가 — 정성 분석의 as_of 가 오늘 날짜면 true.
function stockNewsUpdatedToday(payload, today) {
  const asOf = payload && payload.valuation && payload.valuation.qualitative && payload.valuation.qualitative.as_of;
  return !!asOf && asOf === today;
}

// 개별 주식을 STOCK_GROUPS 순서대로 묶어서 접이식 섹터 섹션으로 배치.
function renderStocksByGroup(host, stocks) {
  host.innerHTML = "";
  STOCK_GROUP_STATES.length = 0;
  const today = localTodayStr();

  // 그룹별로 ticker 묶기. payload 의 group (index.json 의 값) 또는 STOCK_META 의 group
  // 둘 중 하나라도 있으면 사용. 아무것도 없으면 "기타" 로 분류.
  const buckets = new Map();
  for (const [ticker, payload] of Object.entries(stocks)) {
    if (!payload || !payload.series || payload.series.length === 0) continue;
    const meta  = STOCK_META[ticker];
    const group = (meta && meta.group) || payload.group || "기타";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(ticker);
  }

  // 정의된 순서로 먼저 렌더하고, 정의에 없는 그룹은 마지막에 alphabetical 로.
  const orderedGroups = STOCK_GROUPS.filter((g) => buckets.has(g.key));
  const extraGroups = [...buckets.keys()]
    .filter((k) => !STOCK_GROUPS.some((g) => g.key === k))
    .sort()
    .map((k) => ({ key: k, desc: "" }));

  for (const g of [...orderedGroups, ...extraGroups]) {
    const tickers = buckets.get(g.key) || [];
    if (tickers.length === 0) continue;

    const freshTickers = tickers.filter((t) => stockNewsUpdatedToday(stocks[t], today));

    const section = document.createElement("section");
    section.className = "stock-group";
    section.innerHTML = `
      <button type="button" class="stock-group-header" aria-expanded="false">
        <span class="sg-chevron" aria-hidden="true">▸</span>
        <h3 class="stock-group-title">${escapeHtml(g.key)}</h3>
        <span class="stock-group-count">${tickers.length}종목</span>
        ${freshTickers.length > 0 ? `<span class="stock-group-badge" title="오늘 뉴스 루틴이 갱신한 종목: ${escapeHtml(freshTickers.join(", "))}">🗞️ 오늘 뉴스 ${freshTickers.length}</span>` : ""}
        ${g.desc ? `<p class="stock-group-desc">${escapeHtml(g.desc)}</p>` : ""}
      </button>
      <div class="cards stock-group-cards" hidden></div>
    `;

    const headerBtn = section.querySelector(".stock-group-header");
    const cardsHost = section.querySelector(".stock-group-cards");

    // 카드 자리(slot)만 먼저 만들어 두고, 실제 카드는 열릴 때 slot 을 교체한다.
    const els = new Map(); // ticker → slot(div) 또는 렌더된 카드(article)
    for (const ticker of tickers) {
      const slot = document.createElement("div");
      slot.className = "stock-slot";
      slot.dataset.ticker = ticker;
      cardsHost.appendChild(slot);
      els.set(ticker, slot);
    }

    const state = {
      key: g.key,
      section, headerBtn, cardsHost, els, tickers,
      collapsed: freshTickers.length === 0, // 오늘 뉴스가 있는 섹터만 열어 둔다
      ensureCard(ticker) {
        const el = this.els.get(ticker);
        if (!el || el.tagName === "ARTICLE") return;
        try {
          const card = renderStockCard(ticker, stocks[ticker], stocks);
          el.replaceWith(card);
          this.els.set(ticker, card);
        } catch (err) {
          // 한 종목이 터져도 섹터의 나머지 카드는 계속 열린다
          console.error(`${ticker} 카드를 그리지 못했습니다`, err);
        }
      },
      setOpen(open) {
        this.collapsed = !open;
        this.cardsHost.hidden = !open;
        this.headerBtn.setAttribute("aria-expanded", String(open));
        const chev = this.headerBtn.querySelector(".sg-chevron");
        if (chev) chev.textContent = open ? "▾" : "▸";
        // 카드는 컨테이너가 보이는 상태에서 렌더해야 차트 크기가 잡힌다
        if (open) for (const t of this.tickers) this.ensureCard(t);
      },
    };
    STOCK_GROUP_STATES.push(state);

    headerBtn.addEventListener("click", () => state.setOpen(state.collapsed));
    state.setOpen(!state.collapsed);
    host.appendChild(section);
  }
}

// 검색창 + '전체 펼치기' 버튼 연결. 검색 중에는 그룹 접힘 상태를 무시하고
// 일치 종목이 있는 그룹만 펼쳐 보여주며, 검색어를 지우면 원래 상태로 복원.
function wireStockToolbar(stocks) {
  const input = document.getElementById("stock-search");
  const expandBtn = document.getElementById("stock-expand-all");
  const host = document.getElementById("stock-cards");
  if (!host) return;

  // 검색 대상 문자열 사전 (소문자) — 티커·한/영 이름·섹터 부제·그룹명
  const haystacks = new Map();
  for (const state of STOCK_GROUP_STATES) {
    for (const t of state.tickers) {
      const meta = STOCK_META[t] || {};
      const payload = stocks[t] || {};
      haystacks.set(t, [t, meta.displayName, meta.fullName, meta.sector, payload.name, state.key]
        .filter(Boolean).join(" ").toLowerCase());
    }
  }

  let emptyNote = null;
  const applySearch = (raw) => {
    const q = raw.trim().toLowerCase();
    let totalHits = 0;

    for (const state of STOCK_GROUP_STATES) {
      if (!q) {
        // 복원 — 모든 종목 표시 + 접힘 상태는 사용자가 두었던 그대로
        state.section.hidden = false;
        for (const t of state.tickers) { const el = state.els.get(t); if (el) el.hidden = false; }
        state.setOpen(!state.collapsed);
        continue;
      }
      const hits = state.tickers.filter((t) => haystacks.get(t).includes(q));
      totalHits += hits.length;
      if (hits.length === 0) { state.section.hidden = true; continue; }
      state.section.hidden = false;
      // 검색 결과는 항상 펼쳐 보여주되 collapsed(사용자 상태)는 건드리지 않는다
      state.cardsHost.hidden = false;
      state.headerBtn.setAttribute("aria-expanded", "true");
      const chev = state.headerBtn.querySelector(".sg-chevron");
      if (chev) chev.textContent = "▾";
      for (const t of state.tickers) {
        const isHit = hits.includes(t);
        if (isHit) state.ensureCard(t); // 카드가 보이는 상태에서 렌더
        const el = state.els.get(t);
        if (el) el.hidden = !isHit;
      }
    }

    if (emptyNote) { emptyNote.remove(); emptyNote = null; }
    if (q && totalHits === 0) {
      emptyNote = document.createElement("p");
      emptyNote.className = "stock-search-empty";
      emptyNote.textContent = `"${raw.trim()}" 에 해당하는 종목이 없습니다 — 티커·회사명·섹터로 검색해 보세요.`;
      host.prepend(emptyNote);
    }
    window.dispatchEvent(new Event("resize"));
  };

  if (input && input.dataset.wired !== "1") {
    input.dataset.wired = "1";
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => applySearch(input.value), 120);
    });
  }

  if (expandBtn && expandBtn.dataset.wired !== "1") {
    expandBtn.dataset.wired = "1";
    expandBtn.addEventListener("click", () => {
      const anyClosed = STOCK_GROUP_STATES.some((s) => s.collapsed);
      for (const s of STOCK_GROUP_STATES) s.setOpen(anyClosed);
      expandBtn.textContent = anyClosed ? "전체 접기" : "전체 펼치기";
    });
  }
}

function renderStockCard(ticker, payload, allStocks = null) {
  const meta   = STOCK_META[ticker] ?? { displayName: ticker, fullName: ticker, sector: "", color: "#9aa0a9", decimals: 2, currency: "USD", business: "", moat: "" };
  const series = payload.series;
  const latest = series[series.length - 1];

  // 1년 전 대비 % 변화 — 단기보다 1년 추세가 사용자에게 유의미
  const prior = findPriorPoint(series, latest.date, 365);
  const changePct = prior ? ((latest.value - prior.value) / prior.value) * 100 : null;
  const changeClass = changePct == null ? "" : changePct >= 0 ? "up" : "down";
  const changeStr   = changePct == null
    ? "—"
    : `${changePct >= 0 ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}%`;

  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  const financials = payload.financials || { snapshot: {}, quarterly: [] };
  const snapshot   = financials.snapshot || {};
  const quarterly  = financials.quarterly || [];
  const valuation  = payload.valuation || null;

  const metricsHtml      = renderStockMetricsHtml(snapshot, meta);
  const valuationBadge   = renderValuationBadgeHtml(valuation, meta);
  const peerCompareHtml  = renderPeerCompareHtml(ticker, valuation, allStocks);
  const valuationSection = renderValuationSectionHtml(valuation, peerCompareHtml, meta);
  const hasFinancials    = metricsHtml !== "" || quarterly.length > 0 || valuationSection !== "";

  const card = document.createElement("article");
  card.className = "card stock-card";
  card.dataset.ticker = ticker;
  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${escapeHtml(meta.displayName)}</span>${valuePassBadgeHtml(ticker)}
      <span class="card-code">${escapeHtml(ticker)}</span>
    </header>
    <div>
      <span class="card-value">${formatStockPrice(latest.value, meta)}</span>
      <span class="card-change ${changeClass}" title="1년 전 대비">${changeStr} <span class="change-period">(1년)</span></span>
    </div>
    <p class="card-desc">${escapeHtml(meta.fullName)} · ${escapeHtml(meta.sector)}</p>
    ${meta.business ? `<p class="card-business">${escapeHtml(meta.business)}</p>` : ""}
    ${valuationBadge}

    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>

    ${hasFinancials ? `
      <div class="stock-details">
        <button type="button" class="details-toggle" aria-expanded="false">
          <span class="details-toggle-label">상세 분석 보기</span>
          <span class="details-toggle-icon" aria-hidden="true">▾</span>
        </button>
        <div class="details-body" hidden>
          ${valuationSection}
          ${metricsHtml}
          ${quarterly.length > 0 ? `
            <div class="section-title">분기 실적 (단위: ${meta.currency === "KRW" ? "₩조" : "$B"})</div>
            <div class="card-chart financials-chart"><canvas></canvas></div>
          ` : ""}
        </div>
      </div>
    ` : ""}
  `;

  const mainCanvas = card.querySelector(".main-chart canvas");
  const tfSelector = card.querySelector(".tf-selector");

  const initialKey = availableFrames.some((tf) => tf.key === DEFAULT_TIMEFRAME_KEY)
    ? DEFAULT_TIMEFRAME_KEY
    : availableFrames[availableFrames.length - 1].key;
  const state = { tfKey: initialKey };
  let chartInstance = null;

  function redraw() {
    const tf = TIMEFRAMES.find((t) => t.key === state.tfKey) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
    const sliced = sliceSeriesByMonths(series, tf.months);
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    chartInstance = renderChart(mainCanvas, sliced, "stock", {
      assetColor:  meta.color,
      primaryMeta: { decimals: meta.decimals, unit: stockCurrencySymbol(meta), displayName: meta.displayName },
    });
  }

  tfSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    state.tfKey = btn.dataset.tf;
    tfSelector.querySelectorAll(".tf-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tf === state.tfKey)
    );
    redraw();
  });

  redraw();

  // 상세 분석 토글 — 차트는 펼쳐질 때 lazy 렌더 (hidden 상태에선 캔버스 크기 측정 불가)
  const toggleBtn   = card.querySelector(".details-toggle");
  const detailsBody = card.querySelector(".details-body");
  if (toggleBtn && detailsBody) {
    let lazyRendered = false;
    toggleBtn.addEventListener("click", () => {
      const next = toggleBtn.getAttribute("aria-expanded") !== "true";
      toggleBtn.setAttribute("aria-expanded", String(next));
      detailsBody.hidden = !next;
      const labelEl = toggleBtn.querySelector(".details-toggle-label");
      const iconEl  = toggleBtn.querySelector(".details-toggle-icon");
      if (labelEl) labelEl.textContent = next ? "상세 분석 숨기기" : "상세 분석 보기";
      if (iconEl)  iconEl.textContent  = next ? "▴" : "▾";
      if (next && !lazyRendered) {
        const finCanvas = card.querySelector(".financials-chart canvas");
        if (finCanvas && quarterly.length > 0) renderFinancialsChart(finCanvas, quarterly, meta);
        const valCanvas = card.querySelector(".valuation-chart canvas");
        if (valCanvas && valuation && (valuation.gap_series_weekly || []).length > 1) {
          renderValuationGapChart(valCanvas, valuation.gap_series_weekly);
        }
        lazyRendered = true;
      }
    });
  }

  return card;
}

// ─── 재무/실적 표시 헬퍼 ─────────────────────────────────────────────

// 거물 투자자(버핏·달리오) 관점에서 본 4개 핵심 지표.
//  - ROE: 자본을 얼마나 효율적으로 굴리는가 (Buffett 의 사업 질 척도)
//  - 영업이익률: 본업의 수익성 = 해자(moat) 의 강도
//  - P/E: 가격이 적정한가 (밸류에이션)
//  - 시가총액: 회사의 규모/성숙도 컨텍스트
const STOCK_KEY_METRICS = [
  { key: "return_on_equity", label: "ROE",        hint: "자본 효율 · 15%+ 우량",         format: (v, meta) => formatPercent(v) },
  { key: "operating_margin", label: "영업이익률", hint: "본업 수익성 · 해자 강도",       format: (v, meta) => formatPercent(v) },
  { key: "pe_ratio",         label: "P/E",        hint: "가격/이익 · S&P500 ~22배",      format: (v, meta) => v == null ? "—" : v.toFixed(1) + "배" },
  { key: "market_cap",       label: "시가총액",   hint: "회사 규모",                     format: (v, meta) => formatLargeMoney(v, meta) },
];

function renderStockMetricsHtml(snap, stockMeta) {
  if (!snap || Object.values(snap).every((v) => v == null)) return "";
  const items = STOCK_KEY_METRICS.map(({ key, label, hint, format }) => `
    <div class="key-metric">
      <div class="km-head">
        <span class="km-label">${escapeHtml(label)}</span>
        <span class="km-value">${escapeHtml(format(snap[key], stockMeta))}</span>
      </div>
      <p class="km-hint">${escapeHtml(hint)}</p>
    </div>
  `).join("");
  return `
    <div class="section-title">핵심 지표</div>
    <div class="key-metrics">${items}</div>
    <p class="key-metrics-note">사업의 질(ROE·영업이익률) × 가격(P/E) — 거물 투자자가 가장 먼저 보는 4가지.</p>
  `;
}

// ─── Valuation (기업가치 vs 시장가격) ───────────────────────────────
//   signal       라벨            색
//   deep_value   강한 저평가     green-strong
//   undervalued  저평가          green
//   fair         적정            neutral
//   overvalued   고평가          orange
//   expensive    과대평가        red
const VALUATION_SIGNALS = {
  deep_value:  { label: "강한 저평가", tone: "value-strong" },
  undervalued: { label: "저평가",     tone: "value" },
  fair:        { label: "적정",       tone: "fair" },
  overvalued:  { label: "고평가",     tone: "over" },
  expensive:   { label: "과대평가",   tone: "over-strong" },
  "n/a":       { label: "산출 불가",  tone: "fair" },
};

function renderValuationBadgeHtml(val, stockMeta) {
  if (!val || val.valuation_gap == null || !val.signal) return "";
  const sigMeta = VALUATION_SIGNALS[val.signal] || VALUATION_SIGNALS.fair;
  const gapPct = (val.valuation_gap * 100);
  const sign = gapPct >= 0 ? "+" : "";
  const qual = val.qualitative;
  const narrative = qual && qual.narrative_score != null
    ? renderNarrativeChipHtml(qual.narrative_score, qual.as_of)
    : "";
  return `
    <div class="valuation-badge-row">
      <div class="valuation-badge" data-tone="${sigMeta.tone}" title="현재가 대비 적정가치 갭 (음수=저평가, 양수=고평가)">
        <span class="vb-label">${escapeHtml(sigMeta.label)}</span>
        <span class="vb-gap">${sign}${gapPct.toFixed(1)}%</span>
        <span class="vb-fair">vs 적정 ${formatStockPrice(val.fair_value, stockMeta)}</span>
      </div>
      ${narrative}
    </div>
  `;
}

function renderNarrativeChipHtml(score, asOf) {
  // -1.0 (악화) ~ +1.0 (개선) — Routine 산출 정성 점수
  const tone = score <= -0.2 ? "narr-neg-strong"
             : score <  0    ? "narr-neg"
             : score <  0.2  ? "narr-neutral"
             : score <  0.5  ? "narr-pos"
             :                  "narr-pos-strong";
  const sign = score >= 0 ? "+" : "";
  const dateLabel = asOf ? ` (${escapeHtml(asOf)})` : "";
  return `
    <div class="narrative-chip" data-tone="${tone}" title="Routine 정성 분석 점수${dateLabel}">
      <span class="nc-icon" aria-hidden="true">📰</span>
      <span class="nc-label">정성</span>
      <span class="nc-score">${sign}${score.toFixed(2)}</span>
    </div>
  `;
}

function renderValuationSectionHtml(val, peerCompareHtml = "", stockMeta = null) {
  if (!val) return "";
  const hasMethods = val.methods && Object.keys(val.methods).length > 0;
  if (!hasMethods) {
    return `
      <div class="section-title">기업가치 vs 시장가격</div>
      <p class="valuation-empty">${escapeHtml(val.note || "fair value 산출 불가")}</p>
    `;
  }
  const totalWeight = Object.values(val.methods).reduce((s, m) => s + (m.weight || 0), 0);
  const methodRows = Object.entries(val.methods).map(([key, m]) => {
    const w = totalWeight > 0 ? (m.weight / totalWeight * 100) : 0;
    return `
      <div class="method-row">
        <div class="method-name">${escapeHtml(m.note || key)}</div>
        <div class="method-fair">${formatStockPrice(m.fair_value, stockMeta)}</div>
        <div class="method-weight">${w.toFixed(0)}%</div>
      </div>
    `;
  }).join("");

  const hasSeries = (val.gap_series_weekly || []).length > 1;

  return `
    <div class="section-title">기업가치 vs 시장가격</div>
    <div class="valuation-summary">
      <div class="vs-row">
        <span class="vs-label">현재가</span>
        <span class="vs-value">${formatStockPrice(val.current_price, stockMeta)}</span>
      </div>
      <div class="vs-row vs-fair">
        <span class="vs-label">적정 가치 (composite)</span>
        <span class="vs-value">${formatStockPrice(val.fair_value, stockMeta)}</span>
      </div>
    </div>
    <div class="method-table">
      <div class="method-row method-head">
        <div class="method-name">산출 방법</div>
        <div class="method-fair">적정가</div>
        <div class="method-weight">가중</div>
      </div>
      ${methodRows}
    </div>
    ${hasSeries ? `
      <div class="section-title sub">최근 valuation gap 추이 (주간)</div>
      <div class="card-chart valuation-chart"><canvas></canvas></div>
      <p class="valuation-note">분기 실적 데이터가 쌓일수록 추이가 길어집니다. 0% 선이 적정 가치이며, 양수=고평가·음수=저평가입니다.</p>
    ` : `
      <p class="valuation-note">분기 실적 누적 후 valuation gap 추이 차트가 표시됩니다.</p>
    `}
    ${peerCompareHtml}
    ${renderQualitativeBlockHtml(val.qualitative)}
  `;
}

function renderPeerCompareHtml(ticker, val, allStocks) {
  if (!val || val.valuation_gap == null || !allStocks) return "";
  const peers = PEER_COMPETITORS[ticker] || [];
  const present = peers
    .map((p) => ({ ticker: p, payload: allStocks[p] }))
    .filter((x) => x.payload && x.payload.valuation && x.payload.valuation.valuation_gap != null);

  if (present.length === 0) return "";

  // 자기 자신을 맨 앞에 두고, 경쟁사 정렬은 valuation_gap 오름차순(저평가 순)
  const rows = [
    { ticker, gap: val.valuation_gap, signal: val.signal, narr: val.qualitative?.narrative_score, self: true },
    ...present
      .map((x) => ({
        ticker: x.ticker,
        gap:    x.payload.valuation.valuation_gap,
        signal: x.payload.valuation.signal,
        narr:   x.payload.valuation.qualitative?.narrative_score,
        self:   false,
      }))
      .sort((a, b) => a.gap - b.gap),
  ];

  const rowHtml = rows.map((r) => {
    const meta = VALUATION_SIGNALS[r.signal] || VALUATION_SIGNALS.fair;
    const gapPct = r.gap * 100;
    const sign = gapPct >= 0 ? "+" : "";
    const narrChip = r.narr != null
      ? `<span class="peer-narr" data-sign="${r.narr >= 0 ? "pos" : "neg"}">${r.narr >= 0 ? "+" : ""}${r.narr.toFixed(2)}</span>`
      : `<span class="peer-narr peer-narr-empty">—</span>`;
    return `
      <tr class="peer-row${r.self ? " peer-self" : ""}" data-tone="${meta.tone}">
        <td class="peer-ticker">${escapeHtml(r.ticker)}${r.self ? '<span class="peer-self-mark">현재</span>' : ""}</td>
        <td class="peer-gap">${sign}${gapPct.toFixed(1)}%</td>
        <td class="peer-signal">${escapeHtml(meta.label)}</td>
        <td class="peer-narr-cell">${narrChip}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="section-title sub">경쟁사 비교 (watchlist 내)</div>
    <table class="peer-table">
      <thead>
        <tr>
          <th>종목</th>
          <th>Gap</th>
          <th>신호</th>
          <th>정성</th>
        </tr>
      </thead>
      <tbody>${rowHtml}</tbody>
    </table>
  `;
}

function renderQualitativeBlockHtml(qual) {
  if (!qual) {
    return `
      <div class="section-title sub">정성 분석 (뉴스·경쟁사)</div>
      <p class="valuation-note">Claude Code Routine이 매일 뉴스를 수집해 채워넣습니다. <code>.claude/routines/daily-market-analysis.md</code> 참고.</p>
    `;
  }

  const score = qual.narrative_score;
  const scorePct = score != null ? (score * 100).toFixed(0) : "—";
  const summary = qual.summary_kr ? `<p class="qual-summary">${escapeHtml(qual.summary_kr)}</p>` : "";

  const events = (qual.key_events || []).slice(0, 5);
  const risks  = (qual.risks      || []).slice(0, 5);
  const eventsHtml = events.length > 0 ? `
    <div class="qual-list">
      <div class="qual-list-title qual-event">주요 이벤트</div>
      <ul>${events.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
    </div>
  ` : "";
  const risksHtml = risks.length > 0 ? `
    <div class="qual-list">
      <div class="qual-list-title qual-risk">리스크</div>
      <ul>${risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    </div>
  ` : "";

  const competitors = (qual.competitor_context || []).slice(0, 4);
  const competitorsHtml = competitors.length > 0 ? `
    <div class="qual-competitor-block">
      <div class="qual-list-title">경쟁사 동향</div>
      <ul class="qual-competitor-list">
        ${competitors.map((c) => `
          <li>
            <span class="qc-ticker">${escapeHtml(c.ticker || "")}</span>
            <span class="qc-headline">${escapeHtml(c.headline || "")}</span>
            ${c.implication_for_target ? `<div class="qc-implication">→ ${escapeHtml(c.implication_for_target)}</div>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  ` : "";

  const asOfLabel = qual.as_of ? ` · ${escapeHtml(qual.as_of)} 기준` : "";

  return `
    <div class="section-title sub">정성 분석 (뉴스·경쟁사)${asOfLabel}</div>
    <div class="qual-summary-row">
      <div class="qual-score-pill" data-sign="${score >= 0 ? "pos" : "neg"}" title="Routine 산출 정성 점수 (-1.0 ~ +1.0)">
        narrative_score <strong>${score >= 0 ? "+" : ""}${score != null ? score.toFixed(2) : "—"}</strong>
        <span class="qual-news-count">뉴스 ${qual.news_count ?? 0}건</span>
      </div>
    </div>
    ${summary}
    <div class="qual-grid">${eventsHtml}${risksHtml}</div>
    ${competitorsHtml}
  `;
}

// ─── 시장 지수 카드 ─────────────────────────────────────────────────

function renderIndexCard(code, payload) {
  const meta   = INDEX_META[code] ?? { displayName: payload.name || code, color: "#9aa0a9", decimals: 2, summary: "", description: payload.description || "" };
  const series = payload.series;
  const latest = series[series.length - 1];

  // 1주/1개월/1년 변화율 — 단기·중기·장기 흐름 한눈에
  const w1  = priorChangePct(series, 7);
  const m1  = priorChangePct(series, 30);
  const yoy = priorChangePct(series, 365);

  const fmtChange = (v) => v == null ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}%`;
  const cls       = (v) => v == null ? "" : v >= 0 ? "up" : "down";

  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  const card = document.createElement("article");
  card.className = "card index-card";
  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${escapeHtml(meta.displayName)}</span>
      <span class="card-code">${escapeHtml(code)}</span>
    </header>
    <div>
      <span class="card-value">${latest.value.toLocaleString("en-US", { maximumFractionDigits: meta.decimals })}</span>
      <span class="card-change ${cls(yoy)}" title="1년 전 대비">${fmtChange(yoy)} <span class="change-period">(1년)</span></span>
    </div>
    <p class="card-desc">${escapeHtml(meta.summary || payload.name || "")}</p>
    <p class="card-business">${escapeHtml(meta.description || payload.description || "")}</p>

    <div class="returns-row">
      <div class="return-cell"><span class="return-label">1주</span>   <span class="return-val ${cls(w1)}">${fmtChange(w1)}</span></div>
      <div class="return-cell"><span class="return-label">1개월</span> <span class="return-val ${cls(m1)}">${fmtChange(m1)}</span></div>
      <div class="return-cell"><span class="return-label">1년</span>   <span class="return-val ${cls(yoy)}">${fmtChange(yoy)}</span></div>
    </div>

    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>
  `;

  // 차트 렌더링
  const mainCanvas = card.querySelector(".main-chart canvas");
  const tfSelector = card.querySelector(".tf-selector");
  const initialKey = availableFrames.some((tf) => tf.key === DEFAULT_TIMEFRAME_KEY)
    ? DEFAULT_TIMEFRAME_KEY
    : availableFrames[availableFrames.length - 1].key;
  const state = { tfKey: initialKey };
  let chartInstance = null;

  function redraw() {
    const tf = TIMEFRAMES.find((t) => t.key === state.tfKey) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
    const sliced = sliceSeriesByMonths(series, tf.months);
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    chartInstance = renderChart(mainCanvas, sliced, "index", {
      assetColor:  meta.color,
      primaryMeta: { decimals: meta.decimals, unit: "", displayName: meta.displayName },
    });
  }
  tfSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    state.tfKey = btn.dataset.tf;
    tfSelector.querySelectorAll(".tf-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tf === state.tfKey));
    redraw();
  });
  redraw();
  return card;
}

// 시리즈에서 days 일 전 대비 % 변화. 데이터가 없으면 null.
function priorChangePct(series, days) {
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1];
  const prior  = findPriorPoint(series, latest.date, days);
  if (!prior || prior.value === 0) return null;
  return ((latest.value - prior.value) / prior.value) * 100;
}
