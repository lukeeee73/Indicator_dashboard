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
    <div class="card-chart"><canvas></canvas></div>
  `;

  renderChart(card.querySelector("canvas"), series, payload.category);
  return card;
}

function renderError(err) {
  document.querySelector("main").innerHTML =
    `<div class="error">데이터를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>`;
}


// ---------- Chart.js ----------------------------------------
function renderChart(canvas, series, category) {
  const color = CATEGORY_COLOR[category] || "#9aa0a9";
  const labels = series.map((p) => p.date);
  const values = series.map((p) => p.value);

  // eslint-disable-next-line no-undef
  new Chart(canvas, {
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
      animation: { duration: 600 },
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
              // YYYY-MM 까지만 표시해서 축이 깔끔
              return this.getLabelForValue(v).slice(0, 7);
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
