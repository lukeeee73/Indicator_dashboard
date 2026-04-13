/* ============================================================
 * Luke Dashboard — 프론트엔드 로직
 *
 * 역할:
 *   1. data/indicators.json 을 fetch
 *   2. 각 지표를 카드 + Chart.js 라인 차트로 렌더링
 *   3. 최신값 / 최근 변화 / 카테고리별 분류 표시
 *
 * 원칙: "해석과 판단은 수동"
 *   - 현재 4분면을 자동으로 찍지 않는다
 *   - 각 지표의 수치와 추세만 중립적으로 보여준다
 * ============================================================ */

// ---------- 지표별 UI 메타데이터 ------------------------------
// fetch_fred.py 의 INDICATORS 와 별도로, 프론트 표기 전용 정보를 둔다.
// 새 지표를 추가할 때마다 여기에도 한 줄 추가하면 끝.
const INDICATOR_META = {
  T10Y2Y: {
    displayName: "10Y-2Y 금리차",
    description: "장단기 금리차. 음수면 경기침체 선행 신호.",
    unit: "%",
    decimals: 2,
  },
  T10YIE: {
    displayName: "10Y 기대 인플레 (BEI)",
    description: "시장이 예상하는 향후 10년 평균 인플레.",
    unit: "%",
    decimals: 2,
  },
  CPIAUCSL: {
    displayName: "CPI YoY",
    description: "실제 소비자물가 전년 동월 대비 상승률.",
    unit: "%",
    decimals: 2,
  },
  INDPRO: {
    displayName: "산업생산지수",
    description: "공장/광산/유틸 생산량. 성장의 현재 상태.",
    unit: "",
    decimals: 2,
  },
  DCOILWTICO: {
    displayName: "WTI 원유",
    description: "원유 가격. 인플레 선행지표.",
    unit: "$",
    decimals: 2,
  },
};

// 비교 자산(Assets) UI 메타데이터.
// fetch_fred.py 의 ASSETS 와 대응.
const ASSET_META = {
  GOLDAMGBD228NLBM: { displayName: "금 (Gold)",              unit: "$", decimals: 0, color: "#d4af37" },
  DTWEXBGS:         { displayName: "달러 지수",              unit: "",  decimals: 2, color: "#7dd3fc" },
  SP500:            { displayName: "S&P 500",                unit: "",  decimals: 2, color: "#c084fc" },
  DGS10:            { displayName: "10년 국채금리",          unit: "%", decimals: 2, color: "#fb923c" },
  VIXCLS:           { displayName: "VIX (공포지수)",         unit: "",  decimals: 2, color: "#f87171" },
  DEXKOUS:          { displayName: "원/달러 환율",           unit: "₩", decimals: 2, color: "#86efac" },
  BAMLH0A0HYM2:     { displayName: "미국 하이일드 스프레드", unit: "%", decimals: 2, color: "#fca5a5" },
};

// 지표별 "추천 비교 대상". 4분면 프레임워크 논리에 따라 1/2순위 구성.
// primary 는 select 의 "추천" optgroup 에 표시, secondary 는 "관련".
const COMPARE_RECOMMENDATIONS = {
  T10Y2Y: {
    primary:   ["SP500", "BAMLH0A0HYM2", "VIXCLS"],
    secondary: ["GOLDAMGBD228NLBM", "DGS10"],
    note: "장단기 금리 역전은 침체 선행 신호. 주식·신용스프레드·VIX 가 어떻게 반응했는지 비교.",
  },
  T10YIE: {
    primary:   ["GOLDAMGBD228NLBM", "DGS10"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "기대 인플레이션이 오를 때 금·명목금리는 동행, 달러는 역행하는 경향.",
  },
  CPIAUCSL: {
    primary:   ["GOLDAMGBD228NLBM", "DTWEXBGS", "DGS10"],
    secondary: ["DEXKOUS", "SP500"],
    note: "실제 인플레이션 상승기 → 금·원자재 강세, 달러·장기채 약세 경향.",
  },
  INDPRO: {
    primary:   ["SP500", "BAMLH0A0HYM2"],
    secondary: ["DGS10", "VIXCLS"],
    note: "생산 확장기엔 주식 상승·HY 스프레드 축소, 수축기엔 반대 흐름.",
  },
  DCOILWTICO: {
    primary:   ["DTWEXBGS", "GOLDAMGBD228NLBM"],
    secondary: ["SP500", "DEXKOUS"],
    note: "유가는 달러와 역상관, 인플레와 동행. 1·2차 오일쇼크·2008·COVID 전후가 관전 포인트.",
  },
};

// 주요 역사적 이벤트. 차트에 수직 점선 + 라벨로 표시.
// short: 10년 이상 뷰에서 클릭 팝업으로 쓰이는 짧은 이름
const EVENTS = [
  { date: "1914-07-28", label: "1차 세계대전 발발",          short: "WW1" },
  { date: "1929-10-29", label: "대공황 (Black Tuesday)",     short: "대공황" },
  { date: "1939-09-01", label: "2차 세계대전 발발",          short: "WW2" },
  { date: "1945-09-02", label: "2차 세계대전 종전",          short: "WW2종전" },
  { date: "1971-08-15", label: "닉슨 쇼크 (금본위 붕괴)",   short: "닉슨쇼크" },
  { date: "1973-10-06", label: "1차 오일쇼크",               short: "오일1" },
  { date: "1979-11-04", label: "2차 오일쇼크",               short: "오일2" },
  { date: "1987-10-19", label: "Black Monday",               short: "블랙먼데이" },
  { date: "1997-07-02", label: "아시아 외환위기",             short: "외환위기" },
  { date: "2000-03-10", label: "닷컴 버블 정점",             short: "닷컴버블" },
  { date: "2001-09-11", label: "9/11 테러",                  short: "9/11" },
  { date: "2008-09-15", label: "리먼 파산 (글로벌 금융위기)", short: "리먼파산" },
  { date: "2011-08-05", label: "미국 신용등급 강등",         short: "신용강등" },
  { date: "2020-03-11", label: "COVID-19 팬데믹 선언",       short: "COVID" },
  { date: "2022-02-24", label: "러시아-우크라이나 전쟁",     short: "우크라이나" },
];

// 카테고리별 차트 색 (CSS 변수와 일치시킴)
const CATEGORY_COLOR = {
  growth:    "#c8d8ea",   // 스틸 블루-화이트
  inflation: "#cc2424",   // 레드
};

// 최근 변화 계산 기준 (일)
const CHANGE_WINDOW_DAYS = 30;

// 차트 타임프레임 선택지. null 이면 전체 데이터를 보여준다.
const TIMEFRAMES = [
  { key: "3M",   label: "3개월", months: 3    },
  { key: "1Y",   label: "1년",   months: 12   },
  { key: "5Y",   label: "5년",   months: 60   },
  { key: "10Y",  label: "10년",  months: 120  },
  { key: "30Y",  label: "30년",  months: 360  },
  { key: "50Y",  label: "50년",  months: 600  },
  { key: "100Y", label: "100년", months: 1200 },
  { key: "ALL",  label: "전체",  months: null },
];

// 카드를 처음 열었을 때 보여줄 기본 타임프레임
const DEFAULT_TIMEFRAME_KEY = "1Y";


// 전역 상태: 이벤트 마커 표시 여부 + 각 카드의 "redraw" 콜백.
// 헤더 체크박스가 바뀌면 등록된 모든 카드가 자기 자신을 다시 그린다.
const APP_STATE = {
  showEvents: true,
  cardRedraws: [],  // 각 카드의 redraw() 함수 모음
};


// ---------- 진입점 ------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // cache: 'no-cache' → 브라우저 캐시보다 서버 재검증 우선
    const res = await fetch("data/indicators.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
    wireEventsToggle();
  } catch (err) {
    renderError(err);
  }
});

function wireEventsToggle() {
  const checkbox = document.getElementById("toggle-events");
  if (!checkbox) return;
  APP_STATE.showEvents = checkbox.checked;
  checkbox.addEventListener("change", () => {
    APP_STATE.showEvents = checkbox.checked;
    APP_STATE.cardRedraws.forEach((fn) => fn());
  });
}


// ---------- 렌더링 -----------------------------------------
function render(data) {
  renderLastUpdated(data.last_updated);

  const indicators = data.indicators || {};
  const assets     = data.assets     || {};
  const growthHost    = document.getElementById("growth-cards");
  const inflationHost = document.getElementById("inflation-cards");

  // 지표가 하나도 없으면 안내 메시지
  if (Object.keys(indicators).length === 0) {
    growthHost.innerHTML    = emptyMessage("아직 데이터가 없습니다. GitHub Actions 를 실행해 주세요.");
    inflationHost.innerHTML = "";
    return;
  }

  for (const [code, payload] of Object.entries(indicators)) {
    if (!payload.series || payload.series.length === 0) continue;
    const host = payload.category === "growth" ? growthHost : inflationHost;
    host.appendChild(renderCard(code, payload, assets));
  }
}

function renderLastUpdated(iso) {
  const el = document.getElementById("last-updated");
  if (!iso) {
    el.textContent = "아직 갱신되지 않았습니다";
    return;
  }
  const d = new Date(iso);
  const kst = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(d);
  el.textContent = `마지막 갱신: ${kst} (KST)`;
}

function renderCard(code, payload, assets) {
  const meta = INDICATOR_META[code] ?? {
    displayName: code, description: "", unit: "", decimals: 2,
  };
  const series   = payload.series;
  const category = payload.category;
  const latest   = series[series.length - 1];
  const prior    = findPriorPoint(series, latest.date, CHANGE_WINDOW_DAYS);
  const change   = prior ? latest.value - prior.value : null;
  const recs     = COMPARE_RECOMMENDATIONS[code] ?? { primary: [], secondary: [], note: "" };

  const card = document.createElement("article");
  card.className = "card";

  const changeStr   = formatChange(change, meta);
  const changeClass = change == null ? "" : change >= 0 ? "up" : "down";

  // 실제로 선택 가능한 타임프레임만 버튼으로 노출한다.
  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  // 비교 자산 select: 추천 / 관련 / 기타로 그룹화. assets 에 존재하는 코드만 옵션으로 노출.
  const compareSelectHtml = buildCompareSelectHtml(recs, assets);

  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${meta.displayName}</span>
      <span class="card-code">${code}</span>
    </header>
    <div>
      <span class="card-value">${formatValue(latest.value, meta)}</span>
      <span class="card-change ${changeClass}" title="약 ${CHANGE_WINDOW_DAYS}일 전 대비">${changeStr}</span>
    </div>
    <p class="card-desc">${meta.description}</p>
    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>
    <p class="event-hint" hidden>이벤트 마커(▏)를 클릭하면 라벨이 표시됩니다</p>

    <div class="compare-bar">
      <label class="compare-label">
        <span>비교:</span>
        <select class="compare-select">${compareSelectHtml}</select>
      </label>
      <div class="mode-toggle" role="group" aria-label="비교 표시 방식" hidden>
        <button type="button" class="mode-btn active" data-mode="overlay">겹쳐보기</button>
        <button type="button" class="mode-btn"        data-mode="stacked">나란히</button>
      </div>
    </div>
    <p class="compare-note" hidden>${escapeHtml(recs.note || "")}</p>
    <div class="card-chart compare-chart" hidden><canvas></canvas></div>
  `;

  const mainCanvas    = card.querySelector(".main-chart canvas");
  const compareCanvas = card.querySelector(".compare-chart canvas");
  const compareBox    = card.querySelector(".compare-chart");
  const compareNote   = card.querySelector(".compare-note");
  const compareSelect = card.querySelector(".compare-select");
  const modeToggle    = card.querySelector(".mode-toggle");
  const tfSelector    = card.querySelector(".tf-selector");
  const eventHint     = card.querySelector(".event-hint");

  const initialKey = availableFrames.some((tf) => tf.key === DEFAULT_TIMEFRAME_KEY)
    ? DEFAULT_TIMEFRAME_KEY
    : availableFrames[availableFrames.length - 1].key;

  const state = {
    tfKey:       initialKey,
    compareCode: null,
    compareMode: "overlay",
  };
  const chartState = { main: null, compare: null };

  function redraw() {
    const tf = TIMEFRAMES.find((t) => t.key === state.tfKey) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
    const mainSliced = sliceSeriesByMonths(series, tf.months);

    // 표시 범위 내 이벤트만 추출해서 annotation 으로 전달
    const rangeStart = mainSliced[0]?.date;
    const rangeEnd   = mainSliced[mainSliced.length - 1]?.date;
    const events = APP_STATE.showEvents
      ? EVENTS.filter((e) => rangeStart && rangeEnd && e.date >= rangeStart && e.date <= rangeEnd)
      : [];

    // 10년 이상 뷰 여부 → 클릭 방식 힌트 표시
    const isLongSpan = spansOverTenYears(mainSliced.map((p) => p.date));
    if (eventHint) {
      eventHint.hidden = !(APP_STATE.showEvents && isLongSpan && events.length > 0);
    }

    // 기존 차트 파괴
    if (chartState.main)    { chartState.main.destroy();    chartState.main = null; }
    if (chartState.compare) { chartState.compare.destroy(); chartState.compare = null; }

    // 비교 자산 준비
    const cmpPayload = state.compareCode ? assets[state.compareCode] : null;
    const cmpMeta    = state.compareCode ? (ASSET_META[state.compareCode] ?? null) : null;

    if (cmpPayload && state.compareMode === "overlay") {
      // 겹쳐보기: 같은 차트에 이중 Y축
      chartState.main = renderChart(mainCanvas, mainSliced, category, {
        overlay: {
          series: cmpPayload.series,
          meta:   cmpMeta,
          name:   cmpMeta?.displayName ?? state.compareCode,
        },
        events,
        longSpan: isLongSpan,
        primaryMeta: meta,
      });
      compareBox.hidden = true;
    } else {
      chartState.main = renderChart(mainCanvas, mainSliced, category, {
        events,
        longSpan: isLongSpan,
        primaryMeta: meta,
      });

      if (cmpPayload && state.compareMode === "stacked") {
        // 나란히 보기: 메인과 같은 기간으로 잘라 별도 차트
        const cmpSliced = sliceByDateRange(cmpPayload.series, rangeStart, rangeEnd);
        compareBox.hidden = false;
        chartState.compare = renderChart(compareCanvas, cmpSliced, null, {
          events,
          longSpan: isLongSpan,
          assetColor: cmpMeta?.color,
          primaryMeta: cmpMeta,
        });
      } else {
        compareBox.hidden = true;
      }
    }
  }

  // ---------- 이벤트 핸들러 ----------
  tfSelector.addEventListener("click", (e) => {
    const btn = e.target.closest("button.tf-btn");
    if (!btn) return;
    tfSelector.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tfKey = btn.dataset.tf;
    redraw();
  });

  compareSelect.addEventListener("change", () => {
    state.compareCode = compareSelect.value || null;
    modeToggle.hidden = !state.compareCode;
    compareNote.hidden = !(state.compareCode && recs.note);
    redraw();
  });

  modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button.mode-btn");
    if (!btn) return;
    modeToggle.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.compareMode = btn.dataset.mode;
    redraw();
  });

  // 최초 렌더링 + 전역 이벤트 토글에 반응할 수 있도록 등록
  redraw();
  APP_STATE.cardRedraws.push(redraw);

  return card;
}

/** 비교 자산 select 의 <option> HTML 을 조립한다. 추천/관련/기타 순으로 그룹화. */
function buildCompareSelectHtml(recs, assets) {
  const availableCodes = new Set(
    Object.entries(assets)
      .filter(([, p]) => p.series && p.series.length > 0)
      .map(([code]) => code),
  );
  if (availableCodes.size === 0) {
    return `<option value="">비교 자산 데이터 없음</option>`;
  }

  const primary   = (recs.primary   || []).filter((c) => availableCodes.has(c));
  const secondary = (recs.secondary || []).filter((c) => availableCodes.has(c));
  const listed    = new Set([...primary, ...secondary]);
  const others    = [...availableCodes].filter((c) => !listed.has(c));

  const optionFor = (code) => {
    const m = ASSET_META[code] ?? { displayName: code };
    return `<option value="${code}">${escapeHtml(m.displayName)}</option>`;
  };
  const group = (label, codes) =>
    codes.length === 0 ? "" : `<optgroup label="${escapeHtml(label)}">${codes.map(optionFor).join("")}</optgroup>`;

  return [
    `<option value="">— 비교하지 않음 —</option>`,
    group("추천 (4분면 프레임워크 기반)", primary),
    group("관련", secondary),
    group("기타 자산", others),
  ].join("");
}

/** 기간 시작/끝 날짜(YYYY-MM-DD) 사이의 데이터만 남긴다. */
function sliceByDateRange(series, startDate, endDate) {
  if (!series || series.length === 0 || !startDate || !endDate) return series || [];
  return series.filter((p) => p.date >= startDate && p.date <= endDate);
}

/**
 * 주어진 시계열이 실제로 커버할 수 있는 타임프레임만 반환한다.
 * 예: 2년치 데이터만 있으면 3M, 1Y, ALL 만 보여준다.
 * (단, ALL 과 데이터 범위를 포함하는 가장 큰 타임프레임은 항상 포함한다.)
 */
function filterAvailableTimeframes(series) {
  if (!series || series.length === 0) return [TIMEFRAMES[TIMEFRAMES.length - 1]];
  const spanMonths = monthsBetween(series[0].date, series[series.length - 1].date);
  const available = TIMEFRAMES.filter((tf) => tf.months == null || tf.months <= spanMonths);
  // 가장 큰 타임프레임이 데이터 범위를 아예 초과하는 경우에도, "전체" 는 항상 제공.
  if (!available.some((tf) => tf.months == null)) {
    available.push(TIMEFRAMES[TIMEFRAMES.length - 1]);
  }
  return available;
}

function monthsBetween(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

function renderError(err) {
  document.querySelector("main").innerHTML =
    `<div class="error">데이터를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>`;
}


// ---------- Chart.js ----------------------------------------
/**
 * 시계열의 마지막 날짜 기준으로 최근 `months` 개월치만 남긴다.
 * months 가 null 이면 원본을 그대로 반환 (ALL).
 */
function sliceSeriesByMonths(series, months) {
  if (months == null || series.length === 0) return series;
  const last = new Date(series[series.length - 1].date);
  const cutoff = new Date(last);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const start = series.findIndex((p) => p.date >= cutoffStr);
  return start === -1 ? series.slice(-1) : series.slice(start);
}

/**
 * 공용 차트 렌더러.
 *   - opts.overlay: { series, meta, name } → 이중 Y축으로 오버레이
 *   - opts.events:  [{date, label}, ...]   → 수직 점선 + 라벨 (annotation 플러그인)
 *   - opts.assetColor: asset 단독 차트일 때 선 색
 *   - opts.primaryMeta: tooltip 숫자 포맷용
 */
function renderChart(canvas, series, category, opts = {}) {
  const baseColor  = opts.assetColor || CATEGORY_COLOR[category] || "#9aa0a9";
  const labels     = series.map((p) => p.date);
  const values     = series.map((p) => p.value);
  const primaryMeta = opts.primaryMeta || { decimals: 2, unit: "" };

  const datasets = [{
    label: primaryMeta.displayName || "",
    data: values,
    borderColor: baseColor,
    backgroundColor: baseColor + "22",
    borderWidth: 1.5,
    fill: !opts.overlay,  // 오버레이 시엔 채우면 가독성 떨어져서 끔
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2,
    yAxisID: "y",
  }];

  // 오버레이 데이터셋: 메인 라벨(날짜) 에 정렬해서 그린다.
  let overlayMeta = null;
  if (opts.overlay && opts.overlay.series && opts.overlay.series.length > 0) {
    overlayMeta = opts.overlay.meta || { decimals: 2, unit: "", color: "#d4af37" };
    const aligned = alignSeriesToLabels(opts.overlay.series, labels);
    datasets.push({
      label: opts.overlay.name || "비교",
      data: aligned,
      borderColor: overlayMeta.color || "#d4af37",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [3, 3],
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.2,
      yAxisID: "y1",
      spanGaps: true,
    });
  }

  // 이벤트 annotations: x 축이 category 타입이므로 labels 내의 정확한 문자열로 snap.
  // 10년 이상 뷰: 라벨 기본 숨김 + 마커 클릭 시 토글. 이하: 항상 표시.
  const longSpan = opts.longSpan || false;
  const annotations = {};
  (opts.events || []).forEach((evt, i) => {
    const snapped = snapEventToLabel(evt.date, labels);
    if (!snapped) return;
    const annotKey = `evt_${i}`;
    const annotation = {
      type: "line",
      xMin: snapped,
      xMax: snapped,
      borderColor: longSpan ? "rgba(200, 50, 50, 0.55)" : "rgba(210, 210, 210, 0.4)",
      borderWidth: longSpan ? 1.5 : 1,
      borderDash: [4, 4],
      label: {
        display: !longSpan,
        content: evt.label,
        position: "start",
        backgroundColor: "rgba(10, 10, 10, 0.9)",
        color: "#f2f2f2",
        font: { size: 9, weight: "500" },
        padding: { top: 2, bottom: 2, left: 4, right: 4 },
        yAdjust: -4,
      },
    };
    if (longSpan) {
      annotation.click = function(ctx) {
        const a = ctx.chart.options.plugins.annotation.annotations[annotKey];
        if (a && a.label) {
          a.label.display = !a.label.display;
          ctx.chart.update("none");
        }
      };
    }
    annotations[annotKey] = annotation;
  });

  const scales = {
    x: {
      ticks: {
        color: "#787878",
        maxTicksLimit: 5,
        autoSkip: true,
        callback(v) {
          const raw = this.getLabelForValue(v);
          return labels.length > 0 && spansOverAYear(labels) ? raw.slice(0, 4) : raw.slice(0, 7);
        },
      },
      grid: { color: "#222222", tickLength: 0 },
    },
    y: {
      position: "left",
      ticks: { color: "#787878" },
      grid:  { color: "#222222" },
    },
  };
  if (overlayMeta) {
    scales.y1 = {
      position: "right",
      ticks: { color: overlayMeta.color || "#c8d8ea" },
      grid:  { display: false },
    };
  }

  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          display: !!overlayMeta,
          labels: { color: "#a0a0a0", boxWidth: 10, boxHeight: 10, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const m = ctx.datasetIndex === 1 && overlayMeta ? overlayMeta : primaryMeta;
              const dec = m.decimals ?? 2;
              const unit = m.unit || "";
              const v = ctx.parsed.y.toFixed(dec);
              const prefix = ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
              if (unit === "$") return `${prefix}$${v}`;
              if (unit === "%") return `${prefix}${v}%`;
              if (unit === "₩") return `${prefix}₩${v}`;
              return `${prefix}${v}`;
            },
          },
        },
        annotation: { annotations, hitTolerance: longSpan ? 8 : 4 },
      },
      scales,
    },
  });
}

function spansOverAYear(labels) {
  if (labels.length < 2) return false;
  const first = new Date(labels[0]);
  const last  = new Date(labels[labels.length - 1]);
  return (last - first) > 365 * 24 * 3600 * 1000;
}

function spansOverTenYears(labels) {
  if (labels.length < 2) return false;
  const first = new Date(labels[0]);
  const last  = new Date(labels[labels.length - 1]);
  return (last - first) > 10 * 365 * 24 * 3600 * 1000;
}

/**
 * 오버레이용 시리즈를 메인 차트의 labels(날짜 배열)에 정렬.
 * labels[i] 날짜에 대해: target 시리즈에서 "그 날짜 이하" 의 가장 최근 값을 채운다.
 * labels[i] 가 target 시리즈 시작 전이면 null (Chart.js 에서 gap).
 */
function alignSeriesToLabels(targetSeries, labels) {
  if (!targetSeries || targetSeries.length === 0) return labels.map(() => null);
  const out = new Array(labels.length).fill(null);
  let j = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    while (j + 1 < targetSeries.length && targetSeries[j + 1].date <= label) j++;
    if (targetSeries[j] && targetSeries[j].date <= label) {
      out[i] = targetSeries[j].value;
    }
  }
  return out;
}

/** 이벤트 날짜를 현재 차트 라벨(정확한 문자열) 중 가장 가까운 것으로 스냅. 범위 밖이면 null. */
function snapEventToLabel(eventDate, labels) {
  if (!labels || labels.length === 0) return null;
  if (eventDate < labels[0] || eventDate > labels[labels.length - 1]) return null;
  // 첫 번째 "labels[i] >= eventDate" 를 찾고, labels[i-1] 과 비교해 더 가까운 쪽 선택.
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= eventDate) {
      if (i === 0) return labels[0];
      const prev = labels[i - 1];
      const curr = labels[i];
      const dPrev = new Date(eventDate) - new Date(prev);
      const dCurr = new Date(curr) - new Date(eventDate);
      return dCurr < dPrev ? curr : prev;
    }
  }
  return labels[labels.length - 1];
}


// ---------- 헬퍼 --------------------------------------------
function formatValue(v, meta) {
  const n = v.toFixed(meta.decimals);
  if (meta.unit === "$") return `$${n}`;
  if (meta.unit === "%") return `${n}%`;
  return n;
}

function formatChange(change, meta) {
  if (change == null) return "—";
  const arrow = change >= 0 ? "▲" : "▼";
  const v = Math.abs(change).toFixed(meta.decimals);
  const suffix = meta.unit === "%" ? "%p" : (meta.unit === "$" ? "$" : "");
  return `${arrow} ${v}${suffix}`;
}

/**
 * series 의 마지막 시점에서 days 일 이전에 가장 가까운 데이터 포인트 반환.
 * FRED 는 휴일/주말을 건너뛰므로 정확히 그 날짜가 없을 수 있어서,
 * "그 이전 가장 최근 포인트" 로 근사한다.
 */
function findPriorPoint(series, latestDate, days) {
  const t = new Date(latestDate);
  t.setDate(t.getDate() - days);
  const targetStr = t.toISOString().slice(0, 10);
  for (let i = series.length - 2; i >= 0; i--) {
    if (series[i].date <= targetStr) return series[i];
  }
  return null;
}

function emptyMessage(text) {
  return `<p class="empty">${escapeHtml(text)}</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
