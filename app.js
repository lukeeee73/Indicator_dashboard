/* ============================================================
 * Dalio Dashboard — 프론트엔드 로직
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

// 카테고리별 차트 색 (CSS 변수와 일치시킴)
const CATEGORY_COLOR = {
  growth:    "#5ab0f0",
  inflation: "#f08c5a",
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


// ---------- 진입점 ------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // cache: 'no-cache' → 브라우저 캐시보다 서버 재검증 우선
    const res = await fetch("data/indicators.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    renderError(err);
  }
});


// ---------- 렌더링 -----------------------------------------
function render(data) {
  renderLastUpdated(data.last_updated);

  const indicators = data.indicators || {};
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
    host.appendChild(renderCard(code, payload));
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

function renderCard(code, payload) {
  const meta = INDICATOR_META[code] ?? {
    displayName: code, description: "", unit: "", decimals: 2,
  };
  const series = payload.series;
  const latest = series[series.length - 1];
  const prior  = findPriorPoint(series, latest.date, CHANGE_WINDOW_DAYS);
  const change = prior ? latest.value - prior.value : null;

  const card = document.createElement("article");
  card.className = "card";

  const changeStr   = formatChange(change, meta);
  const changeClass = change == null ? "" : change >= 0 ? "up" : "down";

  // 실제로 선택 가능한 타임프레임만 버튼으로 노출한다.
  // (ex. 데이터가 3년뿐인 지표에 100년 버튼을 달면 혼란스러우므로 숨긴다.)
  const availableFrames = filterAvailableTimeframes(series);
  const buttonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

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
    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${buttonsHtml}</div>
    <div class="card-chart"><canvas></canvas></div>
  `;

  const canvas   = card.querySelector("canvas");
  const selector = card.querySelector(".tf-selector");
  const initialKey = availableFrames.some((tf) => tf.key === DEFAULT_TIMEFRAME_KEY)
    ? DEFAULT_TIMEFRAME_KEY
    : availableFrames[availableFrames.length - 1].key;

  // 최초 렌더링 + 버튼 클릭 시 다시 그리기
  const chartState = { chart: null };
  drawChartForTimeframe(canvas, series, payload.category, initialKey, chartState);

  selector.addEventListener("click", (e) => {
    const btn = e.target.closest("button.tf-btn");
    if (!btn) return;
    selector.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    drawChartForTimeframe(canvas, series, payload.category, btn.dataset.tf, chartState);
  });

  return card;
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
 * 선택된 타임프레임에 맞춰 시계열을 잘라 차트를 (다시) 그린다.
 * chartState.chart 에 기존 인스턴스를 저장해 두어, 재호출 시 파괴 후 재생성한다.
 */
function drawChartForTimeframe(canvas, fullSeries, category, tfKey, chartState) {
  const tf = TIMEFRAMES.find((t) => t.key === tfKey) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
  const sliced = sliceSeriesByMonths(fullSeries, tf.months);

  if (chartState.chart) {
    chartState.chart.destroy();
    chartState.chart = null;
  }
  chartState.chart = renderChart(canvas, sliced, category);
}

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
  // 이진 탐색 대신 선형 — FRED 시리즈는 일간 기준 최대 수만 포인트라 충분히 빠르다.
  const start = series.findIndex((p) => p.date >= cutoffStr);
  return start === -1 ? series.slice(-1) : series.slice(start);
}

function renderChart(canvas, series, category) {
  const color = CATEGORY_COLOR[category] || "#9aa0a9";
  const labels = series.map((p) => p.date);
  const values = series.map((p) => p.value);

  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: color + "22",  // 13% alpha 로 영역 채움
        borderWidth: 1.5,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => ctx.parsed.y.toFixed(2),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9aa0a9",
            maxTicksLimit: 5,
            autoSkip: true,
            callback(v) {
              // 전체 데이터 범위에 따라 축 표기 단위를 바꾼다.
              // - 1년 이하: YYYY-MM
              // - 그 이상:   YYYY
              const raw = this.getLabelForValue(v);
              return labels.length > 0 && spansOverAYear(labels)
                ? raw.slice(0, 4)
                : raw.slice(0, 7);
            },
          },
          grid: { color: "#2a2f3a", tickLength: 0 },
        },
        y: {
          ticks: { color: "#9aa0a9" },
          grid:  { color: "#2a2f3a" },
        },
      },
    },
  });
}

function spansOverAYear(labels) {
  if (labels.length < 2) return false;
  const first = new Date(labels[0]);
  const last  = new Date(labels[labels.length - 1]);
  return (last - first) > 365 * 24 * 3600 * 1000;
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
