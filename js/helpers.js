// Shared date, series, markup and numeric formatting helpers. No DOM or network work at load time.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

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

  const available = TIMEFRAMES.filter((tf) => {
    if (tf.months == null) return true;
    if (tf.months > spanMonths) return false;
    // 짧은 타임프레임에 최소 3개 이상의 포인트가 들어가야 차트로 의미 있음.
    // 전체 평균 간격으로 어림하지 않고 실제로 그릴 구간의 포인트를 직접 센다.
    // 종목 시계열은 최근만 일별이고 과거는 주·월별이라, 전체 평균으로 재면
    // 최근 구간이 촘촘한데도 1W 같은 짧은 프레임이 부당하게 빠진다.
    return sliceSeriesByMonths(series, tf.months).length >= 3;
  });
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

// ---------- Chart.js ----------------------------------------
/**
 * 시계열의 마지막 날짜 기준으로 최근 `months` 개월치만 남긴다.
 * months 가 null 이면 원본을 그대로 반환 (ALL).
 */
function sliceSeriesByMonths(series, months) {
  if (months == null || series.length === 0) return series;
  const last = new Date(series[series.length - 1].date);
  const cutoff = new Date(last);
  // 분수 month(1W = 0.23) 도 정확하게 처리하기 위해 일 단위로 변환해서 차감.
  cutoff.setDate(cutoff.getDate() - Math.round(months * 30.44));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const start = series.findIndex((p) => p.date >= cutoffStr);
  return start === -1 ? series.slice(-1) : series.slice(start);
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
 * 주어진 값 배열의 min/max 를 계산. 정규화의 스케일 기준으로 쓴다.
 * 유효한 숫자가 0 개 / 1 개 (min === max) 면 normalize 를 포기하고 null 반환.
 */
function computeNormInfo(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return null;
  return { min, max };
}

/** 값을 0~100 으로 min-max 정규화. info 가 null 이거나 값이 없으면 null. */
function normalizeValue(v, info) {
  if (!info || !Number.isFinite(v)) return null;
  return ((v - info.min) / (info.max - info.min)) * 100.0;
}

/** 단위 포맷터 (tooltip 공통) */
function formatWithUnit(v, decimals, unit) {
  const n = v.toFixed(decimals);
  if (unit === "$") return `$${n}`;
  if (unit === "%") return `${n}%`;
  if (unit === "₩") return `₩${n}`;
  return n;
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
/**
 * 카드 값 아래에 "장기 기준 / 10년 기준" 두 개의 high/neutral/low 배지를 렌더.
 * current 가 없으면(오래된 JSON) 빈 문자열 반환.
 */
function renderBadges(current) {
  if (!current) return "";
  const cell = (label, p, lbl) => {
    if (p == null || !lbl) return "";
    const pct = Math.round(p);
    return `
      <span class="badge" data-label="${lbl}" title="${label} 기준 백분위 ${pct}">
        <span class="badge-window">${label}</span>
        <span class="badge-value">${pct}</span>
        <span class="badge-label">${lbl}</span>
      </span>`;
  };
  const fullCell = cell("장기", current.percentile_full, current.label_full);
  const rollCell = cell("10y",  current.percentile_10y, current.label_10y);
  if (!fullCell && !rollCell) return "";
  return `<div class="card-badges">${fullCell}${rollCell}</div>`;
}

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


// ─── Stock price formatting helpers (USD / KRW) ────────────────────────
// 한국 상장 종목은 가격이 KRW 라 별도 통화 기호와 소수점 처리 필요.
function stockCurrencySymbol(meta) {
  return (meta && meta.currency === "KRW") ? "₩" : "$";
}

function formatStockPrice(value, meta) {
  if (value == null || Number.isNaN(value)) return "—";
  const sym      = stockCurrencySymbol(meta);
  const decimals = (meta && typeof meta.decimals === "number") ? meta.decimals : 2;
  const formatted = value >= 1000
    ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : value.toFixed(decimals);
  return `${sym}${formatted}`;
}

function formatLargeMoney(n, meta) {
  if (n == null) return "—";
  const sym = (meta && meta.currency === "KRW") ? "₩" : "$";
  if (n >= 1e12) return `${sym}${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${sym}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${sym}${(n / 1e6).toFixed(2)}M`;
  return `${sym}${n.toFixed(0)}`;
}

function formatRatio(n) {
  return (n == null) ? "—" : n.toFixed(2);
}

function formatPercent(frac) {
  // yfinance 는 비율을 0.245 형태로 줌 → 24.5% 로 표시
  if (frac == null) return "—";
  return `${(frac * 100).toFixed(2)}%`;
}

function formatQuarterLabel(dateStr) {
  // "2024-09-30" → "24Q3"
  const d = new Date(dateStr);
  const year = String(d.getFullYear()).slice(-2);
  const month = d.getMonth() + 1;
  const q = Math.ceil(month / 3);
  return `${year}Q${q}`;
}
