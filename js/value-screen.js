// Monthly screening document cache, picks and pass badges.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ─── 가치 발굴 (월간 버핏식 스크리닝) ─────────────────────────────────
//
// scripts/value_screen.py 가 매월 1일 data/value_screen.json 을 생성한다 —
// 사업의 질 3가지(ROE·영업이익률·연속 흑자) × 가격 1가지(저평가 갭)를
// 모두 통과한 기업 목록. 여기서는 그 파일을 읽어 '가치 발굴' 서브탭을
// 채우고, 통과 종목의 일반 카드 헤더에 🎯 배지를 붙인다.

const VALUE_SCREEN = { promise: null, data: null, passSet: new Set() };

function loadValueScreen() {
  if (!VALUE_SCREEN.promise) {
    VALUE_SCREEN.promise = sbDoc("value_screen", "latest")
      .catch(() => null)
      .then((data) => {
        VALUE_SCREEN.data = data;
        VALUE_SCREEN.passSet = new Set((data && data.passed) || []);
        return data;
      });
  }
  return VALUE_SCREEN.promise;
}

function valuePassBadgeHtml(ticker) {
  return VALUE_SCREEN.passSet.has(ticker)
    ? `<span class="vs-pass-chip" title="이번 달 가치투자 스크리닝(질 3 + 가격 1) 기준을 모두 통과 — 주식 탭 '가치 발굴' 참고">🎯 가치 기준 통과</span>`
    : "";
}

// 스크리닝 결과가 카드 렌더보다 늦게 도착했을 때, 이미 렌더된 카드에 배지를 뒤늦게 삽입.
function refreshValuePassBadges() {
  if (VALUE_SCREEN.passSet.size === 0) return;
  document.querySelectorAll(".stock-card[data-ticker]").forEach((card) => {
    if (!VALUE_SCREEN.passSet.has(card.dataset.ticker)) return;
    if (card.querySelector(".vs-pass-chip")) return;
    const title = card.querySelector(".card-title");
    if (title) title.insertAdjacentHTML("afterend", valuePassBadgeHtml(card.dataset.ticker));
  });
}

// 기준별 측정값 표시 형식
function vsCheckValueStr(key, value) {
  if (value == null) return "데이터 없음";
  if (key === "profit") return `${value}/4분기 흑자`;
  const pct = (value * 100).toFixed(1) + "%";
  return key === "discount" ? (value >= 0 ? "+" : "") + pct : pct;
}

function vsChecksHtml(result, criteria) {
  return criteria.map((c) => {
    const chk = (result.checks || {})[c.key] || { ok: false, value: null };
    return `<span class="vs-chip" data-ok="${chk.ok ? "1" : "0"}" title="${escapeHtml(c.desc)}">
      ${chk.ok ? "✓" : "✗"} ${escapeHtml(c.label)} <b>${escapeHtml(vsCheckValueStr(c.key, chk.value))}</b>
    </span>`;
  }).join("");
}

function renderValuePicks(vs, stocks) {
  const host = document.getElementById("value-screen-host");
  if (!host) return;

  if (!vs || !vs.criteria) {
    host.innerHTML = emptyMessage("아직 스크리닝 데이터가 없습니다. GitHub Actions 의 'Monthly Value Screen' 워크플로를 실행해 주세요.");
    return;
  }

  const total = Object.keys(vs.results || {}).length;
  const passed = (vs.passed || []).filter((t) => stocks[t]);
  const nearMiss = (vs.near_miss || []).filter((t) => vs.results && vs.results[t]);

  host.innerHTML = `
    <div class="vs-meta">
      <span>기준일 <b>${escapeHtml(vs.as_of || "—")}</b></span>
      <span>대상 <b>${total}</b>종목</span>
      <span>통과 <b class="vs-meta-pass">${passed.length}</b></span>
      <span>기준 3개 통과 <b>${nearMiss.length}</b></span>
    </div>

    <div class="section-title">4가지 기준 — 전부 통과해야 한다</div>
    <div class="vs-criteria">
      ${vs.criteria.map((c, i) => `
        <div class="vs-criterion" data-kind="${c.key === "discount" ? "price" : "quality"}">
          <span class="vs-criterion-kind">${c.key === "discount" ? "가격" : "사업의 질 " + (i + 1)}</span>
          <span class="vs-criterion-label">${escapeHtml(c.label)}</span>
          <p class="vs-criterion-desc">${escapeHtml(c.desc)}</p>
        </div>
      `).join("")}
    </div>

    <div class="section-title">이번 달 통과 기업</div>
    <div class="vs-picks" id="vs-picks"></div>

    ${nearMiss.length > 0 ? `
      <div class="section-title">아깝게 탈락 — 기준 3개는 통과 (지켜볼 후보)</div>
      <p class="category-desc">사업의 질 또는 가격 기준 중 한 가지가 아직 충족되지 않았다. 각 기업의 미충족 기준을 확인하며 지켜본다.</p>
      <div class="vs-near" id="vs-near"></div>
    ` : ""}
  `;

  const picksHost = host.querySelector("#vs-picks");
  if (passed.length === 0) {
    picksHost.innerHTML = `<p class="vs-empty">이번 달, 4가지 기준을 모두 통과한 기업이 없습니다.<br>
      좋은 기업이 싸지기를 기다리는 중 — <strong>움직이지 않는 것도 전략이다.</strong></p>`;
  } else {
    for (const ticker of passed) {
      const result = vs.results[ticker] || { checks: {} };
      const wrap = document.createElement("div");
      wrap.className = "vs-pick";
      wrap.innerHTML = `<div class="vs-checks">${vsChecksHtml(result, vs.criteria)}</div>`;
      try {
        wrap.appendChild(renderStockCard(ticker, stocks[ticker], stocks));
      } catch (err) {
        console.error(`${ticker} 가치발굴 카드를 그리지 못했습니다`, err);
      }
      picksHost.appendChild(wrap);
    }
  }

  const nearHost = host.querySelector("#vs-near");
  if (nearHost) {
    nearHost.innerHTML = nearMiss.map((t) => {
      const r = vs.results[t];
      const meta = STOCK_META[t] || {};
      const failed = vs.criteria.filter((c) => !((r.checks || {})[c.key] || {}).ok);
      return `
        <div class="vs-near-row">
          <span class="vs-near-name">${escapeHtml(meta.displayName || r.name || t)} <span class="card-code">${escapeHtml(t)}</span></span>
          <span class="vs-near-group">${escapeHtml(r.group || "")}</span>
          <span class="vs-near-fail">${failed.map((c) => {
            const chk = (r.checks || {})[c.key] || {};
            return `✗ ${escapeHtml(c.label)} (현재 ${escapeHtml(vsCheckValueStr(c.key, chk.value))})`;
          }).join(" · ")}</span>
        </div>`;
    }).join("");
  }
}
