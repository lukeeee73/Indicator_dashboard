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

// 요약(결정·헤드라인·핵심 수치)은 항상 보이고, 전문은 <details> 로 접는다.
function rrKeyNumbers(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const chips = rows.slice(0, 4).map(r => {
    const change = Number(r.change);
    const cls = !Number.isFinite(change) || change === 0 ? "" : (change > 0 ? "rr-up" : "rr-down");
    return `<span class="rr-chip"><span class="rr-chip-label">${escapeHtml(r.label || r.series || "")}</span>
      <span class="rr-chip-val ${cls}">${Number.isFinite(change) && change > 0 ? "+" : ""}${rrNum(r.change)}${escapeHtml(r.unit || "")}</span></span>`;
  }).join("");
  return `<div class="rr-chips">${chips}</div>`;
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

function rrCardHead(r) {
  return `<span class="rr-date">${escapeHtml(r.date)}</span>
    <span class="rr-change">${escapeHtml(rrBp(r.change_bp))} → ${escapeHtml(r.new_range || "")}</span>
    <span class="rr-headline">${escapeHtml(r.headline || "")}</span>`;
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
    ${older.length ? `<details class="rr-archive"><summary>이전 리포트 ${older.length}건</summary>
      <div class="rr-older">${older.map(r => `
        <details class="rr-card" data-file="${escapeHtml(r.file)}">
          <summary>${rrCardHead(r)}<span class="rr-toggle" aria-hidden="true"></span></summary>
          <div class="rr-full"></div>
        </details>`).join("")}</div></details>` : ""}`;

  feed.querySelectorAll("details.rr-card").forEach(d => {
    const entry = reports.find(r => r.file === d.dataset.file);
    d.addEventListener("toggle", () => { if (d.open) rrFill(d, entry); });
  });
  // 최신 리포트: 접힌 상태에서도 핵심 수치 칩은 보이도록 미리 불러온다.
  const latestEl = feed.querySelector(".rr-latest");
  try {
    const rep = await rrLoadReport(latest);
    latestEl.querySelector(".rr-key").innerHTML = rrKeyNumbers(rep.market_reaction);
  } catch (_) { /* 전문을 펼칠 때 오류 표시 */ }
  host.hidden = false;
}
