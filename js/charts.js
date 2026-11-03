// Chart.js adapters and configurations; calculations and dataset semantics are shared across tabs.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ---------- Chart.js 가용성 방어 ------------------------------
// vendor/chart.umd.js 를 못 받으면 Chart 전역이 없다. 그 상태로 `new Chart(...)`
// 를 직접 호출하면 예외가 카드 렌더 루프까지 거슬러 올라가 루프를 중단시키고,
// 결과적으로 미국·한국·주식 탭이 안내도 없이 완전히 빈 화면이 된다.
// 차트만 포기하고 숫자·변화폭·배지·설명은 그대로 보여준다.
let _chartLibWarned = false;

function noteChartLibMissing() {
  if (_chartLibWarned) return;
  _chartLibWarned = true;
  console.error("Chart.js 를 불러오지 못했습니다 — vendor/chart.umd.js 를 확인하세요");
  const main = document.querySelector("main");
  if (!main || document.getElementById("chart-lib-error")) return;
  const el = document.createElement("div");
  el.className = "error";
  el.id = "chart-lib-error";
  el.textContent =
    "차트 라이브러리를 불러오지 못해 그래프가 표시되지 않습니다. "
    + "숫자와 설명은 그대로 확인할 수 있습니다. "
    + "새로고침해도 같으면 광고 차단기·회사망 등 네트워크 차단을 확인해 주세요.";
  main.prepend(el);
}

// 모든 차트 생성은 이 함수를 거친다. 실패하면 null 을 돌려주고,
// 호출측은 이미 반환값 truthy 검사로 destroy 를 감싸고 있어 그대로 동작한다.
function createChart(target, config) {
  if (typeof Chart === "undefined") { noteChartLibMissing(); return null; }
  try {
    return new Chart(target, config);
  } catch (err) {
    console.error("차트를 그리지 못했습니다", err);
    return null;
  }
}

/**
 * 공용 차트 렌더러.
 *   - opts.overlay: { series, meta, name } → 오버레이 시리즈 (기본: 이중 Y축)
 *   - opts.normalize: true → 두 시리즈 모두 "표시 구간 내 0~100" 으로 정규화,
 *                     단일 Y축에서 같은 기준으로 비교 (기준화 모드)
 *   - opts.events:  [{date, label}, ...]   → 수직 점선 + 라벨 (annotation 플러그인)
 *   - opts.assetColor: asset 단독 차트일 때 선 색
 *   - opts.primaryMeta: tooltip 숫자 포맷용. zeroline 축 정책도 여기서 읽음.
 */
function renderChart(canvas, series, category, opts = {}) {
  const baseColor  = opts.assetColor || CATEGORY_COLOR[category] || "#9aa0a9";
  const labels     = series.map((p) => p.date);
  const values     = series.map((p) => p.value);
  const primaryMeta = opts.primaryMeta || { decimals: 2, unit: "" };
  const normalize = !!opts.normalize;

  // 정규화 모드: 원값은 따로 보존해서 tooltip 에 표시하고, 플롯은 0~100 값으로.
  const primaryRawValues = values.slice();
  const primaryNormInfo  = normalize ? computeNormInfo(values) : null;
  const primaryPlotValues = normalize ? values.map((v) => normalizeValue(v, primaryNormInfo)) : values;

  const datasets = [{
    label: primaryMeta.displayName || "",
    data: primaryPlotValues,
    _rawValues: primaryRawValues,
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
    const alignedRaw  = alignSeriesToLabels(opts.overlay.series, labels);
    const overlayNormInfo = normalize ? computeNormInfo(alignedRaw) : null;
    const overlayPlot = normalize
      ? alignedRaw.map((v) => normalizeValue(v, overlayNormInfo))
      : alignedRaw;
    datasets.push({
      label: opts.overlay.name || "비교",
      data: overlayPlot,
      _rawValues: alignedRaw,
      borderColor: overlayMeta.color || "#d4af37",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [3, 3],
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.2,
      yAxisID: normalize ? "y" : "y1",
      spanGaps: true,
    });
  }

  // 이벤트 annotations: x 축이 category 타입이므로 labels 내의 정확한 문자열로 snap.
  // 10년 이상 뷰: 라벨 기본 숨김 + 마커 클릭 시 토글. 이하: 항상 표시.
  const longSpan = opts.longSpan || false;
  const annotations = {};

  // zeroline 정책: 데이터가 0 을 가로지를 때만 0 기준선을 그림. 정규화 모드에선 의미 없음.
  if (!normalize && primaryMeta && primaryMeta.zeroline) {
    const finite = primaryRawValues.filter((v) => Number.isFinite(v));
    if (finite.length > 0 && Math.min(...finite) < 0 && Math.max(...finite) > 0) {
      annotations.zeroLine = {
        type: "line",
        yMin: 0,
        yMax: 0,
        borderColor: "rgba(240,240,240,0.35)",
        borderWidth: 1,
        borderDash: [2, 3],
        drawTime: "beforeDatasetsDraw",
      };
    }
  }
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

  if (normalize) {
    // 기준화 모드: 공통 0~100 범위 강제
    scales.y.min = 0;
    scales.y.max = 100;
    scales.y.title = {
      display: true,
      text: "기준화(0 = 구간 최솟값 · 100 = 구간 최댓값)",
      color: "#787878",
      font: { size: 9 },
    };
  } else if (primaryMeta && primaryMeta.zeroline) {
    // zeroline 정책: 0 을 반드시 축 범위에 포함 (YoY/스프레드 지표 객관성)
    const finite = primaryRawValues.filter((v) => Number.isFinite(v));
    if (finite.length > 0) {
      const dataMin = Math.min(...finite);
      const dataMax = Math.max(...finite);
      scales.y.suggestedMin = Math.min(0, dataMin);
      scales.y.suggestedMax = Math.max(0, dataMax);
    }
  }

  if (overlayMeta && !normalize) {
    scales.y1 = {
      position: "right",
      ticks: { color: overlayMeta.color || "#c8d8ea" },
      grid:  { display: false },
    };
  }

  // eslint-disable-next-line no-undef
  return createChart(canvas, {
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
              // 정규화 모드: tooltip 에는 원값 + (기준화 점수) 를 함께 노출.
              const raw = (ctx.dataset._rawValues && ctx.dataset._rawValues[ctx.dataIndex]);
              const showRaw = Number.isFinite(raw);
              const rawStr = showRaw ? formatWithUnit(raw, dec, unit) : "";
              const prefix = ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
              if (normalize) {
                const normScore = ctx.parsed.y.toFixed(0);
                return showRaw
                  ? `${prefix}${rawStr}  ·  기준화 ${normScore}`
                  : `${prefix}기준화 ${normScore}`;
              }
              return `${prefix}${formatWithUnit(ctx.parsed.y, dec, unit)}`;
            },
          },
        },
        annotation: { annotations, hitTolerance: longSpan ? 8 : 4 },
      },
      scales,
    },
  });
}

function renderValuationGapChart(canvas, gapSeries) {
  if (!gapSeries || gapSeries.length === 0) return null;
  const labels = gapSeries.map((p) => p.date);
  const data   = gapSeries.map((p) => p.gap * 100);  // %
  // 색은 부호별로 다르게 — 위는 빨강, 아래는 그린
  const positiveColor = "rgba(204, 36, 36, 0.85)";
  const negativeColor = "rgba(90, 205, 128, 0.85)";

  return createChart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Valuation gap (%)",
        data,
        borderColor: "#cc2424",
        backgroundColor: "rgba(204, 36, 36, 0.08)",
        borderWidth: 1.5,
        fill: { target: { value: 0 }, above: "rgba(204, 36, 36, 0.10)", below: "rgba(90, 205, 128, 0.10)" },
        pointRadius: 0,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              const d = gapSeries[ctx.dataIndex];
              const sign = v >= 0 ? "+" : "";
              return [
                `Gap: ${sign}${v.toFixed(1)}%`,
                `가격 $${d.price.toFixed(2)} · 적정 $${d.fair_value.toFixed(2)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#a0a0a0", font: { size: 10 }, maxTicksLimit: 6 },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#a0a0a0",
            font: { size: 10 },
            callback: (v) => `${v >= 0 ? "+" : ""}${v}%`,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

function renderFinancialsChart(canvas, quarterly, stockMeta) {
  const labels = quarterly.map((q) => formatQuarterLabel(q.date));
  // USD 종목은 십억($B), KRW 종목은 조(₩T) 단위로 표시 — 시각적 스케일이 비슷해진다.
  const isKrw    = stockMeta && stockMeta.currency === "KRW";
  const scale    = isKrw ? 1e12 : 1e9;
  const unitTag  = isKrw ? "₩조" : "$B";
  const toScale  = (v) => (v == null ? null : v / scale);

  const datasets = [
    {
      label: "매출",
      data: quarterly.map((q) => toScale(q.revenue)),
      backgroundColor: "rgba(125, 211, 252, 0.75)",
      borderColor: "rgba(125, 211, 252, 1)",
      borderWidth: 1,
    },
    {
      label: "영업이익",
      data: quarterly.map((q) => toScale(q.operating_income)),
      backgroundColor: "rgba(192, 132, 252, 0.75)",
      borderColor: "rgba(192, 132, 252, 1)",
      borderWidth: 1,
    },
    {
      label: "순이익",
      data: quarterly.map((q) => toScale(q.net_income)),
      backgroundColor: "rgba(134, 239, 172, 0.75)",
      borderColor: "rgba(134, 239, 172, 1)",
      borderWidth: 1,
    },
  ];

  return createChart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#d0d0d0", boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: ${v.toFixed(2)}${unitTag}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#a0a0a0", font: { size: 10 } }, grid: { display: false } },
        y: {
          ticks: {
            color: "#a0a0a0",
            font: { size: 10 },
            callback: (v) => `${v}${unitTag}`,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}
