// Shared static-first wiki data cache, note viewer and internal note links.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ════════════════════════════════════════════════════════════════
// 주식 시장·기업 지도에서 사용하는 연구 노트 색인과 본문 뷰어.
// data/wiki/graph.json (scripts/build_wiki_graph.py 가 생성)의 노드를
// 경로와 티커로 찾고, 연결된 노트 본문을 모달 또는 인라인으로 읽는다.
// ════════════════════════════════════════════════════════════════

// ── 공유 노트 뷰어 ──────────────────────────────────────────────
// 시장·기업 지도의 '위키 노트' 버튼은 같은 색인과 본문 뷰어를 공유한다.
//  - wnLoadGraph(): graph.json 1회 로드 + (경로→노드, 티커→뉴스 로그) 색인
//  - wnOpenByIdx(idx): data/wiki/notes/<idx>.json 본문을 모달로 렌더
const WN_STATE = { promise: null, graph: null, source: null, byPath: null, byTicker: null, overlay: null };

function wnLoadGraph() {
  if (!WN_STATE.promise) {
    // wiki-sync 워크플로가 커밋하는 정적 graph.json을 우선한다. 예전 Supabase
    // 문서는 갱신 주기가 달라 노드 수와 frontmatter 좌표가 뒤처질 수 있으므로
    // 정적 파일이 없는 배포에서만 폴백으로 사용한다.
    WN_STATE.promise = fetch("data/wiki/graph.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`wiki graph → HTTP ${res.status}`);
        WN_STATE.source = "static";
        return res.json();
      })
      .catch(() => {
        WN_STATE.source = "supabase";
        return sbDoc("wiki", "graph");
      })
      .then((graph) => {
        if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;
        WN_STATE.graph = graph;
        WN_STATE.byPath = new Map();
        WN_STATE.byTicker = new Map();
        graph.nodes.forEach((n, i) => {
          WN_STATE.byPath.set(String(n.path || "").toLowerCase(), i);
          // 루틴 뉴스 로그: wiki/news/tickers/<티커> - <회사명>.md → 티커 색인
          const m = /^wiki\/news\/tickers\/(\S+) - /.exec(n.path || "");
          if (m && !WN_STATE.byTicker.has(m[1].toUpperCase())) {
            WN_STATE.byTicker.set(m[1].toUpperCase(), i);
          }
        });
        return graph;
      })
      .catch(() => null);
  }
  return WN_STATE.promise;
}

async function wnLoadNote(idx) {
  if (WN_STATE.source === "static") {
    try {
      const res = await fetch(`data/wiki/notes/${idx}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`wiki note ${idx} → HTTP ${res.status}`);
      return await res.json();
    } catch (_) {
      // 과거 배포처럼 graph만 정적이고 본문은 Supabase에 있는 경우를 지원한다.
    }
  }
  return sbDoc("wiki_note", String(idx));
}

// vault 상대 경로(예: wiki/concepts/hbm.md) → 노드 인덱스. 없으면 -1.
function wnNodeByPath(path) {
  if (!WN_STATE.byPath) return -1;
  const i = WN_STATE.byPath.get(String(path || "").replace(/^\.\//, "").toLowerCase());
  return i === undefined ? -1 : i;
}

// watchlist 티커 → 루틴 뉴스 로그 노트(wiki/news/tickers/) 인덱스. 없으면 -1.
function wnNodeByTicker(ticker) {
  if (!WN_STATE.byTicker) return -1;
  const i = WN_STATE.byTicker.get(String(ticker || "").toUpperCase());
  return i === undefined ? -1 : i;
}

function wnEnsureOverlay() {
  if (WN_STATE.overlay) return WN_STATE.overlay;
  const ov = document.createElement("div");
  ov.className = "wn-overlay";
  ov.hidden = true;
  ov.innerHTML = `
    <div class="wn-card" role="dialog" aria-modal="true" aria-labelledby="wn-title">
      <div class="wn-head">
        <h3 class="wn-title" id="wn-title"></h3>
        <button type="button" class="wn-close" aria-label="닫기">✕</button>
      </div>
      <p class="wn-meta" id="wn-meta"></p>
      <div class="wn-body" id="wn-body"></div>
      <div class="wn-foot">
        <a class="wiki-open-github" id="wn-github" target="_blank" rel="noopener">GitHub 에서 열기 ↗</a>
      </div>
    </div>`;
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest(".wn-close")) wnCloseNote();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ov.hidden) wnCloseNote();
  });
  document.body.appendChild(ov);
  WN_STATE.overlay = ov;
  return ov;
}

function wnCloseNote() {
  if (WN_STATE.overlay) WN_STATE.overlay.hidden = true;
}

function wnRenderMarkdown(md) {
  // frontmatter 는 본문에선 감춘다 (메타는 wn-meta 줄이 담당)
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end > 0) md = md.slice(end + 4);
  }
  // HTML 주석(<!-- ... -->)은 표시하지 않는다 — 노트의 관리용 마커
  md = md.replace(/<!--[\s\S]*?-->/g, "");
  // vault 내부 상대 링크는 공백을 %20 으로 — CommonMark 는 괄호 안 공백을
  // 링크 목적지로 인식하지 않으므로 (예: [MU](../tickers/MU - Micron.md))
  md = md.replace(/\]\(([^)\n]*?\.md)\)/g, (mm, p) => `](${p.replace(/ /g, "%20")})`);
  // 노트 속 원시 HTML 은 실행하지 않고 텍스트로 취급 (안전).
  // '>' 는 이스케이프하지 않는다 — 블록 인용(> ...)의 마크다운 문법이라서.
  const safe = md.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let html;
  if (window.marked && typeof window.marked.parse === "function") {
    html = window.marked.parse(safe, { breaks: true });
  } else {
    html = `<pre class="wn-pre">${safe}</pre>`;  // CDN 로드 실패 시 폴백
  }
  // [[위키링크]] → 클릭하면 그 노트로 이동하는 링크
  return html.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target, alias) => {
    const t = target.trim();
    return `<a href="#" class="wn-wikilink" data-wiki-target="${t.replace(/"/g, "&quot;")}">${alias || t}</a>`;
  });
}

// 노트 본문 모달 열기. opts:
//   deg        — 상세 패널이 아는 연결 수 (메타 줄에 표시, 선택)
//   onNavigate — 본문 속 [[위키링크]] 로 다른 노트로 이동할 때 알림 (그래프 선택 동기화용)
async function wnOpenByIdx(idx, opts = {}) {
  const graph = WN_STATE.graph;
  if (!graph || !graph.nodes[idx]) return;
  const n = graph.nodes[idx];
  const ov = wnEnsureOverlay();
  const repoUrl = graph.repo_url || "https://github.com/lukeeee73/luke_wiki";
  const branch  = graph.branch || "main";
  ov.querySelector("#wn-title").textContent = n.title;
  ov.querySelector("#wn-meta").textContent =
    `${n.folder}${typeof opts.deg === "number" ? ` · 연결 ${opts.deg}개` : ""}${n.mtime ? ` · 수정 ${n.mtime}` : ""}`;
  ov.querySelector("#wn-github").href = `${repoUrl}/blob/${encodeURIComponent(branch)}/` +
    n.path.split("/").map(encodeURIComponent).join("/");
  const body = ov.querySelector("#wn-body");
  body.innerHTML = `<p class="wn-loading">불러오는 중…</p>`;
  ov.hidden = false;
  try {
    const note = await wnLoadNote(idx);
    body.innerHTML = wnRenderMarkdown(note.content || "");
    body.scrollTop = 0;
    // 본문 속 위키링크·상대 .md 링크 → 그 노트를 이어서 연다 (+호출부에 이동 알림)
    wnWireNoteLinks(body, n.path, (j) => {
      if (opts.onNavigate) opts.onNavigate(j);
      wnOpenByIdx(j, { onNavigate: opts.onNavigate });
    });
  } catch (err) {
    body.innerHTML = `<p class="wn-error">본문을 불러오지 못했습니다 (${escapeHtml(err.message)}).
      아직 노트 본문이 내보내지지 않았을 수 있어요 — 워크플로를 한 번 실행해 주세요.</p>`;
  }
}

// ── 노트 본문 내부 링크 연결 ────────────────────────────────────────────
// [[위키링크]] 와 vault 상대 .md 링크(예: ../../tickers/MU - Micron.md)를
// 노트 이동(open 콜백)으로 바꾼다. 외부 http(s) 링크는 그대로 둔다.

function wnResolveRelPath(basePath, href) {
  const base = basePath.split("/").slice(0, -1);
  for (const part of decodeURIComponent(href).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}

function wnWireNoteLinks(body, notePath, open) {
  const graph = WN_STATE.graph;
  if (!graph) return;
  body.querySelectorAll(".wn-wikilink").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const t = el.dataset.wikiTarget.toLowerCase();
      const j = graph.nodes.findIndex((nn) =>
        nn.title.toLowerCase() === t ||
        nn.id.toLowerCase() === t ||
        nn.id.toLowerCase().endsWith("/" + t));
      if (j >= 0) open(j);
    });
  });
  body.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href") || "";
    if (/^https?:/i.test(href) || !/\.md(#|$)/i.test(href)) return;
    const j = wnNodeByPath(wnResolveRelPath(notePath, href.split("#")[0]));
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (j >= 0) open(j);
    });
    if (j < 0) el.classList.add("wn-deadlink");
  });
}

// ── 인라인 노트 — 오버레이가 아니라 화면 흐름 안에 본문을 펼친다 ────────
// 시장 지도(시장 노드 종합 노트)와 플레이어 지도(기업 뉴스 로그)가 사용.
// host 는 .wn-inline 컨테이너. 반환값: 노트를 찾았는지 여부.

async function wnFillInlineNote(host, idx, opts = {}) {
  const graph = WN_STATE.graph;
  if (!host || !graph || !graph.nodes[idx]) return false;
  const n = graph.nodes[idx];
  const repoUrl = graph.repo_url || "https://github.com/lukeeee73/luke_wiki";
  const branch  = graph.branch || "main";
  const gh = `${repoUrl}/blob/${encodeURIComponent(branch)}/` +
    n.path.split("/").map(encodeURIComponent).join("/");
  host.innerHTML = `
    <header class="wn-inline-head">
      <span class="wn-inline-kind">${escapeHtml(opts.kind || "옵시디언 노트")}</span>
      <h4>${escapeHtml(opts.title || n.title)}</h4>
      <span class="wn-inline-meta">${n.mtime ? `수정 ${escapeHtml(n.mtime)} · ` : ""}<a href="${gh}" target="_blank" rel="noopener">GitHub ↗</a></span>
    </header>
    <div class="wn-body wn-inline-body"><p class="wn-loading">불러오는 중…</p></div>`;
  host.hidden = false;
  const body = host.querySelector(".wn-inline-body");
  try {
    const note = await wnLoadNote(idx);
    if (!body.isConnected) return true;
    body.innerHTML = wnRenderMarkdown(note.content || "");
    // 인라인 본문 속 노트 링크는 오버레이 뷰어로 이어 읽는다
    wnWireNoteLinks(body, n.path, (j) => wnOpenByIdx(j));
  } catch (err) {
    if (body.isConnected)
      body.innerHTML = `<p class="wn-error">본문을 불러오지 못했습니다 (${escapeHtml(err.message)}).
        위키 동기화 워크플로 실행 후 다시 시도해 주세요.</p>`;
  }
  return true;
}
