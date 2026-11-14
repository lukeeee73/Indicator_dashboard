// ─── 금리 변동 리포트 (미국 탭) ─────────────────────────────────────────
// scripts/rate_watch.py 가 FOMC 목표 범위 변경을 감지하면 Claude Managed Agent
// 로 시장 리포트를 받아 data/reports/rates/<date>.json 과 index.json 을 쓴다.
// 정적 파일로 배포되므로(scripts/build_static.js) Supabase 없이 바로 읽는다.
// 리포트는 모델이 쓴 텍스트라 모든 문자열을 escapeHtml 로만 넣는다.

const RR_STATE = { promise: null, index: null, reports: new Map() };

async function rrFetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function rrLoadIndex() {
  if (!RR_STATE.promise) {
    RR_STATE.promise = rrFetchJson("data/reports/rates/index.json")
      .then(idx => { RR_STATE.index = idx; return idx; })
      .catch(() => { RR_STATE.index = { reports: [] }; return RR_STATE.index; });
  }
  return RR_STATE.promise;
}

async function rrLoadReport(entry) {
  if (!RR_STATE.reports.has(entry.file)) {
    RR_STATE.reports.set(entry.file, await rrFetchJson(`data/reports/rates/${entry.file}`));
  }
  return RR_STATE.reports.get(entry.file);
}

function rrBp(bp) {
  const n = Number(bp);
  if (!Number.isFinite(n) || n === 0) return "동결";
  return `${n > 0 ? "+" : ""}${n}bp ${n > 0 ? "인상" : "인하"}`;
}

function rrNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

function rrReactionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const body = rows.map(r => {
    const change = Number(r.change);
    const cls = !Number.isFinite(change) || change === 0 ? "" : (change > 0 ? "rr-up" : "rr-down");
    return `<tr>
      <td>${escapeHtml(r.label || r.series || "")}</td>
      <td class="rr-num">${rrNum(r.before)}</td>
      <td class="rr-num">${rrNum(r.after)}</td>
      <td class="rr-num ${cls}">${Number.isFinite(change) && change > 0 ? "+" : ""}${rrNum(r.change)} ${escapeHtml(r.unit || "")}</td>
      <td class="rr-note">${escapeHtml(r.note || "")}</td>
    </tr>`;
  }).join("");
  return `<div class="rr-table-wrap"><table class="rr-table">
    <thead><tr><th>지표</th><th>결정 전</th><th>최신</th><th>변화</th><th>메모</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// 요약(결정·판단·핵심 수치)은 항상 보이고, 전문은 <details> 로 접는다.
// verdict 필드가 없는 예전 리포트는 market_reaction 칩과 헤드라인으로 대신 보여 준다.
const RR_STANCE = { hawkish: "매파", neutral: "중립", dovish: "비둘기" };

function rrChip(label, value, change, unit) {
  const n = Number(change);
  const cls = !Number.isFinite(n) || n === 0 ? "" : (n > 0 ? "rr-up" : "rr-down");
  const shown = value !== undefined && value !== null && !Number.isFinite(n)
    ? rrNum(value) : `${n > 0 ? "+" : ""}${rrNum(n)}${escapeHtml(unit || "")}`;
  return `<span class="rr-chip"><span class="rr-chip-label">${escapeHtml(label || "")}</span>
    <span class="rr-chip-val ${cls}">${shown}</span></span>`;
}

function rrKeyNumbers(report) {
  const vm = report.verdict?.key_metrics;
  const rows = Array.isArray(vm) && vm.length ? vm : report.market_reaction;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  return `<div class="rr-chips">${rows.slice(0, 5).map(r =>
    rrChip(r.label || r.series, r.value, r.change, r.unit)).join("")}</div>`;
}

function rrStanceBadge(stance, confidence) {
  if (!RR_STANCE[stance]) return "";
  const pct = Number.isFinite(Number(confidence)) ? Math.round(Number(confidence) * 100) : null;
  return `<span class="rr-stance rr-stance-${escapeHtml(stance)}">${RR_STANCE[stance]}</span>` +
    (pct === null ? "" : `<span class="rr-meter" title="확신도 ${pct}%"><i style="width:${pct}%"></i></span>
      <span class="rr-conf">확신 ${pct}%</span>`);
}

function rrVerdictBlock(report) {
  const v = report.verdict;
  if (!v) return "";
  const vs = v.vs_previous?.delta;
  return `<div class="rr-verdict">
    <div class="rr-verdict-line"><b class="rr-conclusion">${escapeHtml(v.conclusion || "")}</b>${rrStanceBadge(v.stance, v.confidence)}</div>
    ${vs ? `<div class="rr-vs"><span class="rr-vs-label">직전 대비${v.vs_previous.stance_changed ? " · 판단 변경" : ""}</span> ${escapeHtml(vs)}</div>` : ""}
  </div>`;
}

function rrRenderFull(report) {
  const sections = (report.sections || []).map(s => `
    <div class="rr-section"><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.body)}</p></div>`).join("");
  const watch = (report.watch_next || []).map(w => `<li>${escapeHtml(w)}</li>`).join("");
  const sources = (report.sources || [])
    .filter(s => /^https:\/\//.test(String(s.url || "")))
    .map(s => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`)
    .join("");
  const vote = report.decision?.vote;
  return `
    <p class="rr-summary">${escapeHtml(report.summary || "")}</p>
    ${vote ? `<p class="rr-vote">표결: ${escapeHtml(vote)}</p>` : ""}
    ${rrReactionRows(report.market_reaction)}
    <div class="rr-sections">${sections}</div>
    ${watch ? `<div class="rr-block"><h4>다음에 볼 것</h4><ul>${watch}</ul></div>` : ""}
    ${sources ? `<div class="rr-block rr-sources"><h4>출처</h4><ul>${sources}</ul></div>` : ""}
    <p class="rr-meta">Claude Managed Agent 가 작성 · 해석은 참고용입니다.</p>`;
}

function rrTags(r) {
  if (Array.isArray(r.tags) && r.tags.length) return r.tags;
  const bp = Number(r.change_bp);
  return [!Number.isFinite(bp) || bp === 0 ? "동결" : (bp > 0 ? "인상" : "인하")];
}

function rrCardHead(r) {
  return `<span class="rr-date">${escapeHtml(r.date)}</span>
    <span class="rr-change">${escapeHtml(rrBp(r.change_bp))} → ${escapeHtml(r.new_range || "")}</span>
    ${r.stance ? `<span class="rr-badges">${rrStanceBadge(r.stance, r.confidence)}</span>` : ""}
    <span class="rr-headline">${escapeHtml(r.conclusion || r.headline || "")}</span>`;
}

function rrToolbar(older) {
  const tags = [...new Set(older.flatMap(rrTags))];
  return `<div class="rr-tools">
    <input type="search" class="rr-search" id="rr-search" placeholder="헤드라인·결론 검색" aria-label="리포트 검색">
    <div class="rr-filters">${tags.map(t =>
      `<button type="button" class="rr-filter" data-tag="${escapeHtml(t)}" aria-pressed="false">${escapeHtml(t)}</button>`).join("")}</div>
  </div>`;
}

function rrBindFilters(feed, older) {
  const search = feed.querySelector(".rr-search");
  if (!search) return;
  const active = new Set();
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    feed.querySelectorAll(".rr-older .rr-card").forEach(el => {
      const r = older.find(o => o.file === el.dataset.file);
      const text = `${r.date} ${r.headline || ""} ${r.conclusion || ""}`.toLowerCase();
      const ok = (!q || text.includes(q)) && [...active].every(t => rrTags(r).includes(t));
      el.hidden = !ok;
      if (ok) shown++;
    });
    feed.querySelector(".rr-none").hidden = shown > 0;
  };
  search.addEventListener("input", apply);
  feed.querySelectorAll(".rr-filter").forEach(btn => btn.addEventListener("click", () => {
    const on = !active.has(btn.dataset.tag);
    on ? active.add(btn.dataset.tag) : active.delete(btn.dataset.tag);
    btn.setAttribute("aria-pressed", String(on));
    apply();
  }));
}

// <details> 를 처음 펼칠 때만 전문 JSON 을 받아 채운다.
async function rrFill(details, entry) {
  const body = details.querySelector(".rr-full");
  if (body.dataset.loaded) return;
  body.innerHTML = `<p class="empty">불러오는 중…</p>`;
  try {
    const report = await rrLoadReport(entry);
    body.innerHTML = rrRenderFull(report);
    body.dataset.loaded = "1";
  } catch (err) {
    body.innerHTML = emptyMessage(`리포트를 불러오지 못했습니다: ${err.message}`);
  }
}

// 미국 탭이 처음 열릴 때 한 번 호출된다. 리포트가 없으면 섹션을 숨긴 채 둔다.
async function renderRateReports() {
  const host = document.getElementById("rate-reports-US");
  if (!host || host.dataset.rendered) return;
  host.dataset.rendered = "1";
  const idx = await rrLoadIndex();
  const reports = Array.isArray(idx.reports) ? idx.reports : [];
  if (reports.length === 0) return;

  const [latest, ...older] = reports;
  const feed = host.querySelector(".rr-feed");
  feed.innerHTML = `
    <details class="rr-card rr-latest" data-file="${escapeHtml(latest.file)}">
      <summary>
        <span class="rr-badge">최신</span>${rrCardHead(latest)}
        <span class="rr-key"></span>
        <span class="rr-toggle" aria-hidden="true"></span>
      </summary>
      <div class="rr-full"></div>
    </details>
    ${older.length ? `<details class="rr-archive"><summary>이전 리포트 <span class="rr-count">${older.length}</span>건</summary>
      ${older.length >= 3 ? rrToolbar(older) : ""}
      <p class="empty rr-none" hidden>조건에 맞는 리포트가 없습니다.</p>
      <div class="rr-older">${older.map(r => `
        <details class="rr-card" data-file="${escapeHtml(r.file)}">
          <summary>${rrCardHead(r)}<span class="rr-toggle" aria-hidden="true"></span></summary>
          <div class="rr-full"></div>
        </details>`).join("")}</div></details>` : ""}`;

  rrBindFilters(feed, older);
  feed.querySelectorAll("details.rr-card").forEach(d => {
    const entry = reports.find(r => r.file === d.dataset.file);
    d.addEventListener("toggle", () => { if (d.open) rrFill(d, entry); });
  });
  // 최신 리포트: 접힌 상태에서도 핵심 수치 칩은 보이도록 미리 불러온다.
  const latestEl = feed.querySelector(".rr-latest");
  try {
    const rep = await rrLoadReport(latest);
    latestEl.classList.toggle("has-verdict", Boolean(rep.verdict));  // 헤드 중복 제거
    latestEl.querySelector(".rr-key").innerHTML = rrVerdictBlock(rep) + rrKeyNumbers(rep);
  } catch (_) { /* 전문을 펼칠 때 오류 표시 */ }
  host.hidden = false;
}
