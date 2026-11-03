// Wiki tab rendering and both supported graph renderers.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

async function renderWikiTab() {
  const layout  = document.getElementById("wiki-layout");
  const toolbar = document.getElementById("wiki-toolbar");
  const empty   = document.getElementById("wiki-empty");
  try {
    const graph = await wnLoadGraph();
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) throw new Error("빈 그래프");
    toolbar.hidden = false;
    layout.hidden  = false;
    empty.hidden   = true;
    wikiInitGraph(graph);
  } catch (err) {
    toolbar.hidden = true;
    layout.hidden  = true;
    empty.hidden   = false;
    empty.innerHTML = `
      <h3>아직 위키 그래프 데이터가 없습니다</h3>
      <p>이 화면은 <code>data/wiki/graph.json</code> 을 읽어 Obsidian vault
        (<code>lukeeee73/luke_wiki</code>)의 노트 연결망을 그립니다. 데이터를 만드는 방법:</p>
      <ol>
        <li>luke_wiki 가 <strong>공개 저장소면 추가 설정 없이</strong> 다음 단계로.
          비공개면 이 저장소 <strong>Settings → Secrets and variables → Actions</strong> 에
          <code>WIKI_REPO_TOKEN</code> 시크릿을 추가한다 — luke_wiki 저장소
          <em>Contents: Read</em> 권한이 있는 fine-grained Personal Access Token.</li>
        <li>Actions 탭에서 <strong>Sync Wiki Graph</strong> 워크플로를 수동 실행(Run workflow)하면
          1분 내에 만들어진다. 이후엔 매시간 자동 동기화되고, luke_wiki 쪽에
          notify 워크플로를 추가하면 푸시 즉시 반영된다 (README 참고).</li>
        <li>로컬에서 직접 만들 수도 있다:<br>
          <code>python scripts/build_wiki_graph.py --vault ../luke_wiki --out data/wiki/graph.json</code></li>
      </ol>`;
  }
}

function wikiInitGraphLegacy(graph) {
  const canvas = document.getElementById("wiki-canvas");
  // 탭 재진입 시 전체 재초기화를 피한다 — 이벤트 리스너와 시뮬레이션 루프가
  // 중첩되면 서로 다른 레이아웃이 한 캔버스를 놓고 싸워 그래프가 이상하게
  // 뭉치거나 구석으로 밀린다. 같은 그래프면 화면 크기만 다시 맞춘다.
  if (canvas._wiki && canvas._wiki.graph === graph) { canvas._wiki.refresh(); return; }
  if (canvas._wiki) canvas._wiki.destroy();
  const listeners = new AbortController(); // destroy() 시 모든 리스너 일괄 해제
  const sig = listeners.signal;
  const wrap   = canvas.parentElement;
  const detail = document.getElementById("wiki-detail");
  const legend = document.getElementById("wiki-legend");
  const search = document.getElementById("wiki-search");
  const ctx    = canvas.getContext("2d");

  // ---------- 데이터 준비 ----------
  const nodes = graph.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }));
  const edges = (graph.edges || []).filter(([a, b]) =>
    a !== b && a >= 0 && b >= 0 && a < nodes.length && b < nodes.length);

  const adj = nodes.map(() => new Set());
  edges.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
  nodes.forEach((n, i) => {
    n.deg = adj[i].size;
    // 연결 수에 비례(√)하되 전체적으로 작게 — 제목 라벨이 노드에 가려지지 않도록
    n.r = Math.min(2.5 + Math.sqrt(n.deg) * 1.4, 11);
  });

  // 폴더 → 색: 노드 수 상위 폴더에 팔레트 순서대로 배정, 나머지는 회색 '기타'
  const folderCount = {};
  nodes.forEach((n) => { folderCount[n.folder] = (folderCount[n.folder] || 0) + 1; });
  const topFolders = Object.keys(folderCount)
    .sort((a, b) => folderCount[b] - folderCount[a])
    .slice(0, WIKI_FOLDER_COLORS.length);
  const folderColor = {};
  topFolders.forEach((f, i) => { folderColor[f] = WIKI_FOLDER_COLORS[i]; });
  nodes.forEach((n) => { n.color = folderColor[n.folder] || WIKI_OTHER_COLOR; });

  // 범례 (직접 라벨 — 색만으로 구분하지 않기 위한 이중 인코딩)
  const hasOther = nodes.some((n) => !(n.folder in folderColor));
  legend.innerHTML = topFolders.map((f, i) =>
    `<span class="wiki-legend-item"><span class="wiki-legend-dot"
       style="background:${WIKI_FOLDER_COLORS[i]}"></span>${escapeHtml(f)}
       <span style="opacity:.6">(${folderCount[f]})</span></span>`).join("") +
    (hasOther ? `<span class="wiki-legend-item"><span class="wiki-legend-dot"
       style="background:${WIKI_OTHER_COLOR}"></span>${WIKI_OTHER_LABEL}</span>` : "");

  // ---------- 연결요소(connected component) 분석 ----------
  // 레이아웃은 화면 좌표가 아니라 원점 중심의 월드 좌표에서 계산하고
  // fitView 가 화면에 맞춘다 — 탭이 숨겨져 컨테이너 크기가 0이어도 안전하다.
  const W = () => wrap.clientWidth, H = () => wrap.clientHeight;
  const comp = new Array(nodes.length).fill(-1);
  const comps = [];
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const members = [s]; comp[s] = comps.length;
    for (let q = 0; q < members.length; q++) {
      adj[members[q]].forEach((w) => {
        if (comp[w] < 0) { comp[w] = comps.length; members.push(w); }
      });
    }
    comps.push(members);
  }
  comps.sort((a, b) => b.length - a.length);
  comps.forEach((members, ci) => members.forEach((i) => { comp[i] = ci; nodes[i].comp = ci; }));
  // 각 요소가 정착할 중심 — packComponents() 가 확정하고, 중력이 이 점을 향한다
  const compCenter = comps.map(() => ({ x: 0, y: 0 }));
  // 작은 요소일수록 강한 중력으로 뭉쳐 있게 (거대 요소는 스프링이 구조를 만든다)
  const compGravity = comps.map((m) => (m.length <= 8 ? 0.03 : 0.0055));
  // 요소별 소프트 경계 — 노드 수의 √ 에 비례하는 반경(≈일정 밀도) 밖으로
  // 나간 노드를 되돌린다. 초대형 허브의 부챗살이나 길게 늘어진 사슬이
  // 무한정 퍼져 전체 뷰를 헐겁게 만드는 것을 막는다.
  const compMaxR = comps.map((m) => 60 + 34 * Math.sqrt(m.length));

  // 노드가 늘거나 탭을 다시 열어도 첫 화면이 매번 같도록 — 시드 고정 PRNG
  let prngState = (0x2f6e2b1 ^ Math.imul(nodes.length, 2654435761)) | 0;
  function rand() {
    prngState = (prngState + 0x6D2B79F5) | 0;
    let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- 초기 배치: 요소별 BFS 방사형 ----------
  // 요소마다 허브(연결 최다 노드)를 중심에 두고 링크 거리(깊이)에 따라
  // 동심원으로 깐다. warm-up 동안 요소끼리 간섭하지 않도록 임시 중심을
  // 멀리 떨어뜨려 두고, warm-up 후 packComponents() 가 화면에 모은다.
  const golden = Math.PI * (3 - Math.sqrt(5));
  comps.forEach((members, ci) => {
    const tx = (ci % 6) * 4000, ty = Math.floor(ci / 6) * 4000; // 임시 중심
    const root = members.reduce((b, i) => (nodes[i].deg > nodes[b].deg ? i : b), members[0]);
    const depth = new Map([[root, 0]]);
    const order = [root];
    for (let q = 0; q < order.length; q++) {
      adj[order[q]].forEach((w) => {
        if (!depth.has(w)) { depth.set(w, depth.get(order[q]) + 1); order.push(w); }
      });
    }
    const ringCount = new Map();
    order.forEach((i) => {
      const d = depth.get(i);
      const k = ringCount.get(d) || 0; ringCount.set(d, k + 1);
      const r = d === 0 ? 0 : d * 95 + rand() * 40;
      const a = k * golden + ci;
      nodes[i].x = tx + Math.cos(a) * r;
      nodes[i].y = ty + Math.sin(a) * r;
    });
    compCenter[ci].x = tx; compCenter[ci].y = ty;
  });

  // ---------- 뷰 상태 ----------
  const view = { scale: 1, ox: 0, oy: 0 };
  let hoverIdx = -1, selectedIdx = -1, query = "";
  let alpha = 1;            // 시뮬레이션 온도 — 식으면 멈춘다
  let rafId = null;
  let userAdjusted = false; // 사용자가 줌/팬/드래그 후엔 뷰를 멋대로 재조정하지 않는다

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W() * dpr;
    canvas.height = H() * dpr;
    if (userAdjusted) draw();
    else fitView();   // 사용자가 손대기 전엔 크기가 바뀔 때마다 전체가 보이게
  }

  // ---------- force 시뮬레이션 ----------
  // 초기 배치의 거친 움직임은 화면에 보여주지 않는다: 먼저 warm-up 을
  // 그리지 않고 돌려 레이아웃을 잡은 뒤, 낮은 온도 + 속도 상한 상태로
  // 천천히 정착하는 모습만 보여준다 (Obsidian 그래프 뷰와 같은 느낌).
  const LIVE_ALPHA = 0.18;  // 화면에 보이는 단계의 시작 온도
  const MAX_SPEED  = 2.2;   // px/frame — 노드가 화면에서 튀지 않는 상한
  const K   = 46;           // 반발 상수
  const CUT = 280;          // 이 거리(px) 밖 반발 무시 = 격자 셀 크기
  const REST = 72, SPRING = 0.028; // 스프링 기본 길이/강도

  // 스프링은 엣지별로 미리 계산 — 허브 쪽 엣지는 길고 약하게, 잎 엣지는
  // 짧고 강하게 (d3-force 의 링크 강도 휴리스틱). 연결 147개짜리 허브가
  // 이웃을 한 점으로 짓누르지 않고 부챗살처럼 펼치게 한다.
  const springs = edges.map(([i, j]) => {
    const lo = Math.max(1, Math.min(nodes[i].deg, nodes[j].deg));
    return { i, j, rest: REST + Math.min(lo * 4, 70), k: SPRING / Math.sqrt(lo) };
  });

  // 반발력 — 균일 격자(셀=CUT)로 이웃 셀만 검사. O(n²) 전수 비교 대신
  // 사실상 O(n)이라 노트가 수천 개로 늘어도 warm-up 이 버틴다.
  function applyRepulsion() {
    const grid = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const key = `${Math.floor(nodes[i].x / CUT)}:${Math.floor(nodes[i].y / CUT)}`;
      const bin = grid.get(key);
      if (bin) bin.push(i); else grid.set(key, [i]);
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const gx = Math.floor(a.x / CUT), gy = Math.floor(a.y / CUT);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bin = grid.get(`${gx + ox}:${gy + oy}`);
        if (!bin) continue;
        for (const j of bin) {
          if (j <= i) continue;      // 쌍마다 한 번만
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 1; }
          if (d2 > CUT * CUT) continue;
          const d = Math.sqrt(d2);
          const minGap = a.r + b.r + 14; // 이보다 가까우면 겹침 방지로 더 세게 민다
          const push = d < minGap ? (minGap - d) * 0.06 : 0;
          const f = ((K * K) / d2 + push) * alpha;
          const fx = dx / d * f, fy = dy / d * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
    }
  }

  function tick(live) {
    applyRepulsion();
    springs.forEach((s) => {
      const a = nodes[s.i], b = nodes[s.j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - s.rest) * s.k * alpha;
      const fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    nodes.forEach((n) => {
      // 자기 연결요소의 중심으로 중력 — 요소끼리 섞이거나 흩어지지 않고
      // 각자의 자리에 모여 있는다
      const c = compCenter[n.comp], g = compGravity[n.comp];
      n.vx += (c.x - n.x) * g * alpha;
      n.vy += (c.y - n.y) * g * alpha;
      // 소프트 경계: 요소 최대 반경을 넘어간 만큼 안쪽으로 되민다
      const bdx = n.x - c.x, bdy = n.y - c.y;
      const bd = Math.hypot(bdx, bdy);
      const over = bd - compMaxR[n.comp];
      if (over > 0 && bd > 0) {
        n.vx -= (bdx / bd) * over * 0.06 * alpha;
        n.vy -= (bdy / bd) * over * 0.06 * alpha;
      }
      if (n === dragNode) { n.vx = 0; n.vy = 0; return; }
      // 보이는 단계는 감쇠를 세게 + 속도 상한 → 느릿한 정착
      const damp = live ? 0.72 : 0.82;
      n.vx *= damp; n.vy *= damp;
      if (live) {
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > MAX_SPEED) { n.vx *= MAX_SPEED / sp; n.vy *= MAX_SPEED / sp; }
      }
      n.x += n.vx; n.y += n.vy;
    });
    alpha *= live ? 0.975 : 0.99;
  }

  // warm-up 으로 모양이 잡힌 요소들을 한 화면에 모은다: 가장 큰 요소를
  // 원점에 두고 나머지를 크기순으로 그 둘레의 빈 자리에 배치(원 패킹).
  // 고립 노트들은 자연스럽게 거대 요소 주위를 감싸는 링이 된다.
  function packComponents() {
    const circles = comps.map((members, ci) => {
      let mx = 0, my = 0;
      members.forEach((i) => { mx += nodes[i].x; my += nodes[i].y; });
      mx /= members.length; my /= members.length;
      let r = 0;
      members.forEach((i) => {
        r = Math.max(r, Math.hypot(nodes[i].x - mx, nodes[i].y - my) + nodes[i].r);
      });
      return { ci, mx, my, r: r + 26 }; // 26px = 요소 사이 여백
    });
    circles.sort((a, b) => b.r - a.r);
    const placed = [];
    circles.forEach((c, k) => {
      let tx = 0, ty = 0;
      if (k > 0) {
        // 황금각 나선을 따라 안쪽부터 훑어 겹치지 않는 첫 자리를 찾는다
        for (let s = 0; s < 4000; s++) {
          const ang = s * golden;
          const rad = placed[0].r + c.r + s * 1.5;
          tx = Math.cos(ang) * rad; ty = Math.sin(ang) * rad;
          if (placed.every((p) => Math.hypot(tx - p.x, ty - p.y) >= p.r + c.r)) break;
        }
      }
      placed.push({ x: tx, y: ty, r: c.r });
      const dx = tx - c.mx, dy = ty - c.my;
      comps[c.ci].forEach((i) => { nodes[i].x += dx; nodes[i].y += dy; });
      compCenter[c.ci].x = tx; compCenter[c.ci].y = ty;
    });
  }

  // 화면에 그리기 전 레이아웃을 미리 잡는다 (거친 초기 움직임 숨김)
  function warmup() {
    alpha = 1;
    for (let i = 0; i < 300 && alpha > 0.04; i++) tick(false);
    packComponents();
    nodes.forEach((n) => { n.vx = 0; n.vy = 0; });
    alpha = LIVE_ALPHA;
  }

  function loop() {
    if (alpha > 0.015) { tick(true); draw(); rafId = requestAnimationFrame(loop); }
    else { alpha = 0; if (!userAdjusted) fitView(); rafId = null; }
  }
  function wake(a) {
    alpha = Math.max(alpha, a);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  // 전체 그래프가 보이도록 스케일/오프셋 맞추기
  function fitView() {
    if (!nodes.length || !W() || !H()) return; // 탭이 숨겨져 크기 0이면 보류
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r);
    });
    const pad = 40;
    const gw = Math.max(maxX - minX, 1), gh = Math.max(maxY - minY, 1);
    // 노드가 점이 될 만큼 무한정 축소하지 않는다 — 그래프가 아주 커지면
    // 하한에서 멈추고, 밖은 팬/줌으로 본다 (최소 화면 노드 크기와 이중 안전망)
    const fit = Math.min((W() - pad * 2) / gw, (H() - pad * 2) / gh);
    view.scale = Math.min(Math.max(fit, 0.22), 1.6);
    view.ox = (W() - (minX + maxX) * view.scale) / 2;
    view.oy = (H() - (minY + maxY) * view.scale) / 2;
    draw();
  }

  // ---------- 그리기 ----------
  function matchesQuery(n) {
    return query && (n.title.toLowerCase().includes(query) ||
                     (n.tags || []).some((t) => t.toLowerCase().includes(query)));
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale,
                     dpr * view.ox, dpr * view.oy);

    const focus = selectedIdx >= 0 ? selectedIdx : hoverIdx;
    const focusSet = focus >= 0 ? adj[focus] : null;

    // 엣지
    edges.forEach(([i, j]) => {
      const onFocus = focus >= 0 && (i === focus || j === focus);
      ctx.strokeStyle = onFocus ? "rgba(230,48,48,0.75)" : "rgba(255,255,255,0.09)";
      ctx.lineWidth = (onFocus ? 1.6 : 1) / view.scale;
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[j].x, nodes[j].y);
      ctx.stroke();
    });

    // 노드 — 축소해도 화면에서 최소 3px 반지름은 유지 (점으로 사라지지 않게)
    const minR = 3 / view.scale;
    nodes.forEach((n, i) => {
      let dim = false;
      if (query) dim = !matchesQuery(n);
      else if (focus >= 0) dim = i !== focus && !focusSet.has(i);
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(n.r, minR), 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      // 배경과의 2px 분리 링
      ctx.lineWidth = 2 / view.scale;
      ctx.strokeStyle = "#121212";
      ctx.stroke();
      if (i === selectedIdx) {
        ctx.lineWidth = 2.5 / view.scale;
        ctx.strokeStyle = "#e63030";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // 라벨 — 선택/호버/이웃/검색 일치 + 허브 노드만 (전부 붙이면 겹쳐서 못 읽는다)
    ctx.font = `${11 / view.scale}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
    ctx.textAlign = "center";
    nodes.forEach((n, i) => {
      const show =
        i === hoverIdx || i === selectedIdx ||
        (focusSet && focusSet.has(i)) ||
        (query && matchesQuery(n)) ||
        // 허브 라벨은 줌 아웃 상태에선 대형 허브만, 확대할수록 더 많이
        (!query && focus < 0 && view.scale > 0.42 &&
          n.deg >= (view.scale > 0.9 ? 5 : 12));
      if (!show) return;
      const y = n.y - Math.max(n.r, 3 / view.scale) - 5 / view.scale;
      ctx.lineWidth = 3 / view.scale;
      ctx.strokeStyle = "rgba(8,8,8,0.85)";
      ctx.strokeText(n.title, n.x, y);
      ctx.fillStyle = "#f2f2f2";
      ctx.fillText(n.title, n.x, y);
    });
  }

  // ---------- 상호작용 ----------
  function toWorld(mx, my) {
    return [(mx - view.ox) / view.scale, (my - view.oy) / view.scale];
  }
  function pick(mx, my) {
    const [wx, wy] = toWorld(mx, my);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = wx - n.x, dy = wy - n.y;
      const hit = Math.max(n.r, 3 / view.scale) + 4 / view.scale;
      if (dx * dx + dy * dy <= hit * hit) return i;
    }
    return -1;
  }

  let dragNode = null, panning = false, lastX = 0, lastY = 0, moved = false;

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const i = pick(mx, my);
    moved = false;
    if (i >= 0) { dragNode = nodes[i]; }
    else { panning = true; canvas.classList.add("dragging"); }
    lastX = mx; lastY = my;
  }, { signal: sig });
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragNode) {
      const [wx, wy] = toWorld(mx, my);
      dragNode.x = wx; dragNode.y = wy;
      moved = true;
      userAdjusted = true;
      wake(0.1);
      return;
    }
    if (panning) {
      view.ox += mx - lastX; view.oy += my - lastY;
      lastX = mx; lastY = my;
      moved = true;
      userAdjusted = true;
      draw();
      return;
    }
    const i = pick(mx, my);
    if (i !== hoverIdx) {
      hoverIdx = i;
      canvas.style.cursor = i >= 0 ? "pointer" : "grab";
      draw();
    }
  }, { signal: sig });
  window.addEventListener("mouseup", (e) => {
    if (dragNode && !moved) {
      // 이동 없는 클릭 = 선택
      selectedIdx = nodes.indexOf(dragNode);
      wikiShowDetail(selectedIdx);
      draw();
    } else if (panning && !moved) {
      selectedIdx = -1;
      wikiShowDetail(-1);
      draw();
    }
    dragNode = null; panning = false;
    canvas.classList.remove("dragging");
  }, { signal: sig });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.min(Math.max(view.scale * factor, 0.15), 4);
    // 커서 위치 고정 줌
    view.ox = mx - (mx - view.ox) * (ns / view.scale);
    view.oy = my - (my - view.oy) * (ns / view.scale);
    view.scale = ns;
    userAdjusted = true;
    draw();
  }, { passive: false, signal: sig });
  canvas.addEventListener("dblclick", () => { userAdjusted = false; fitView(); }, { signal: sig });

  // ---------- 터치 (모바일: 드래그·팬·핀치 줌) ----------
  let pinch = null;
  const touchDist = (t) => Math.hypot(
    t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  canvas.addEventListener("touchstart", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (e.touches.length === 2) {
      // 두 손가락 = 핀치 줌 — 진행 중이던 드래그/팬은 취소
      dragNode = null; panning = false; canvas.classList.remove("dragging");
      pinch = { d: touchDist(e.touches), s: view.scale };
    } else if (e.touches.length === 1) {
      pinch = null;
      const mx = e.touches[0].clientX - rect.left;
      const my = e.touches[0].clientY - rect.top;
      const i = pick(mx, my);
      moved = false;
      if (i >= 0) { dragNode = nodes[i]; }
      else { panning = true; canvas.classList.add("dragging"); }
      lastX = mx; lastY = my;
    }
  }, { passive: true, signal: sig });
  canvas.addEventListener("touchmove", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const ns = Math.min(Math.max(pinch.s * touchDist(e.touches) / pinch.d, 0.15), 4);
      view.ox = mx - (mx - view.ox) * (ns / view.scale);
      view.oy = my - (my - view.oy) * (ns / view.scale);
      view.scale = ns;
      userAdjusted = true;
      draw();
      return;
    }
    if (e.touches.length !== 1) return;
    const mx = e.touches[0].clientX - rect.left;
    const my = e.touches[0].clientY - rect.top;
    if (dragNode) {
      e.preventDefault();
      const [wx, wy] = toWorld(mx, my);
      dragNode.x = wx; dragNode.y = wy;
      moved = true; userAdjusted = true;
      wake(0.1);
    } else if (panning) {
      e.preventDefault();
      view.ox += mx - lastX; view.oy += my - lastY;
      lastX = mx; lastY = my;
      moved = true; userAdjusted = true;
      draw();
    }
  }, { passive: false, signal: sig });
  canvas.addEventListener("touchend", (e) => {
    if (pinch) { pinch = null; if (e.touches.length > 0) return; }
    if (dragNode && !moved) {
      // 이동 없는 탭 = 선택
      selectedIdx = nodes.indexOf(dragNode);
      wikiShowDetail(selectedIdx);
      draw();
    } else if (panning && !moved) {
      selectedIdx = -1;
      wikiShowDetail(-1);
      draw();
    }
    dragNode = null; panning = false;
    canvas.classList.remove("dragging");
  }, { passive: true, signal: sig });

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  }, { signal: sig });

  // ---------- 상세 패널 ----------
  function wikiShowDetail(idx) {
    if (idx < 0) {
      detail.innerHTML = `<p class="vc-detail-hint">노드를 클릭하면 노트 정보가 표시됩니다.</p>`;
      return;
    }
    const n = nodes[idx];
    const neighbors = [...adj[idx]]
      .sort((a, b) => nodes[b].deg - nodes[a].deg)
      .slice(0, 30);
    const repoUrl = graph.repo_url || "https://github.com/lukeeee73/luke_wiki";
    const branch  = graph.branch || "main";
    const fileUrl = `${repoUrl}/blob/${encodeURIComponent(branch)}/` +
      n.path.split("/").map(encodeURIComponent).join("/");
    detail.innerHTML = `
      <h3>${escapeHtml(n.title)}</h3>
      <p class="wiki-detail-meta">
        📁 ${escapeHtml(n.folder)} · 연결 ${n.deg}개${n.mtime ? ` · 수정 ${escapeHtml(n.mtime)}` : ""}
      </p>
      ${(n.tags && n.tags.length)
        ? `<div class="wiki-detail-tags">${n.tags.map((t) =>
             `<span class="wiki-tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${neighbors.length ? `
        <div class="wiki-detail-links">
          <h4>연결된 노트</h4>
          ${neighbors.map((j) =>
            `<button type="button" class="wiki-link-item" data-idx="${j}">
               <span style="color:${nodes[j].color}">●</span> ${escapeHtml(nodes[j].title)}
             </button>`).join("")}
        </div>` : ""}
      ${graph.has_content
        ? `<button type="button" class="wiki-read-btn" id="wiki-read-btn">📖 이 화면에서 읽기</button>` : ""}
      <a class="wiki-open-github" href="${fileUrl}" target="_blank" rel="noopener">
        GitHub 에서 노트 열기 ↗</a>`;
    detail.querySelectorAll(".wiki-link-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedIdx = Number(btn.dataset.idx);
        wikiShowDetail(selectedIdx);
        draw();
      });
    });
    const readBtn = detail.querySelector("#wiki-read-btn");
    if (readBtn) readBtn.addEventListener("click", () => wikiOpenNote(idx));
  }

  // ---------- 노트 뷰어 — 전역 공유 뷰어(wnOpenByIdx)를 그래프 선택과 동기화해 사용 ----------
  // 클로저의 nodes 는 graph.nodes 를 1:1 매핑한 사본이라 인덱스가 호환된다.
  function wikiOpenNote(idx) {
    wnOpenByIdx(idx, {
      deg: nodes[idx].deg,
      onNavigate: (j) => { selectedIdx = j; wikiShowDetail(j); draw(); },
    });
  }

  // ---------- 시작 ----------
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  warmup();          // 연결요소별 레이아웃을 먼저 잡고
  resize();          // 캔버스 크기 반영 + 전체가 보이게 맞춘 뒤
  wake(LIVE_ALPHA);  // 낮은 온도로 천천히 정착하는 모습만 보여준다

  canvas._wiki = {
    graph,
    nodes,   // 디버깅·테스트용 노출 (레이아웃 좌표 확인)
    // 탭 재진입/데이터 동일 시: 레이아웃은 유지하고 화면만 다시 맞춘다
    refresh() { resize(); },
    destroy() {
      listeners.abort();
      ro.disconnect();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      canvas._wiki = null;
    },
  };
}

// frontmatter 기반 3차원 지식 좌표계. force-directed 레이아웃처럼 링크 수가
// 위치를 결정하지 않는다. 링크는 관계선과 노드 크기에만 남기고, 위치는
// 검증 강도(X) · 판단 비중(Y) · 나의 개입도(Z)가 결정한다.
// 화면 배치: Z(나의 개입도)가 세로축 — 내 판단·원칙이 위로 떠오른다.
// X(검증 강도)는 가로, Y(판단 비중)는 깊이(앞으로 나올수록 핵심).
function wikiInitGraph(graph) {
  const canvas = document.getElementById("wiki-canvas");
  if (canvas._wiki && canvas._wiki.graph === graph) { canvas._wiki.refresh(); return; }
  if (canvas._wiki) canvas._wiki.destroy();

  const listeners = new AbortController();
  const sig = listeners.signal;
  const wrap = canvas.parentElement;
  const detail = document.getElementById("wiki-detail");
  const legend = document.getElementById("wiki-legend");
  const search = document.getElementById("wiki-search");
  const resetBtn = document.getElementById("wiki-reset");
  const presetButtons = [...document.querySelectorAll("#wiki-presets .wiki-preset")];
  const ctx = canvas.getContext("2d");

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const asArray = (value) => Array.isArray(value) ? value : (value ? String(value).split(",").map((v) => v.trim()) : []);
  const labelMap = {
    finance: "금융", ai: "AI", design: "디자인", multi: "복수 도메인",
    meta: "메타", other: "기타",
  };
  function domainKey(frontmatter) {
    const domains = asArray(frontmatter && frontmatter.domain).filter(Boolean);
    if (domains.length > 1) return "multi";
    const key = (domains[0] || "other").toLowerCase();
    return WIKI_DOMAIN_COLORS[key] ? key : "other";
  }
  function hashSeed(value) {
    let h = 2166136261;
    for (const ch of String(value)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function seeded(seed) {
    let s = seed || 1;
    return () => {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const nodes = graph.nodes.map((raw, index) => {
    const frontmatter = raw.frontmatter || {};
    const dimensions = raw.dimensions || {
      evidence: 0.35,
      importance: 0.34,
      agency: String(raw.path || "").startsWith("wiki/news/") ? 0.03 : 0.2,
      agency_basis: "이전 그래프 형식의 기본값",
      agency_inferred: true,
    };
    const rnd = seeded(hashSeed(raw.id || raw.path || index));
    // 같은 enum 값의 노트가 완전히 겹치지 않도록 작은 결정론적 오프셋만 준다.
    // 축 점수의 순서는 유지하면서 밀집된 routine-news 군집도 읽을 수 있게 한다.
    const jitter = 0.17;
    const coordinate = (score) => clamp(score * 2 - 1 + (rnd() - 0.5) * jitter, -1, 1);
    return {
      ...raw,
      index,
      frontmatter,
      dimensions,
      domain: domainKey(frontmatter),
      color: WIKI_DOMAIN_COLORS[domainKey(frontmatter)],
      // projectPoint 의 up 축은 wy — 나의 개입도(Z)를 세로로 세운다.
      wx: coordinate(Number(dimensions.evidence) || 0),
      wy: coordinate(Number(dimensions.agency) || 0),
      wz: coordinate(Number(dimensions.importance) || 0),
      deg: 0,
      sx: 0, sy: 0, sr: 0, depth: 0,
    };
  });
  const edges = (graph.edges || []).filter(([a, b]) =>
    a !== b && a >= 0 && b >= 0 && a < nodes.length && b < nodes.length);
  const adj = nodes.map(() => new Set());
  edges.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
  nodes.forEach((n, i) => { n.deg = adj[i].size; });

  const domainCounts = {};
  nodes.forEach((n) => { domainCounts[n.domain] = (domainCounts[n.domain] || 0) + 1; });
  legend.innerHTML = Object.keys(domainCounts)
    .sort((a, b) => domainCounts[b] - domainCounts[a])
    .map((key) => `<span class="wiki-legend-item"><span class="wiki-legend-dot"
      style="background:${WIKI_DOMAIN_COLORS[key]}"></span>${labelMap[key]}
      <span style="opacity:.6">(${domainCounts[key]})</span></span>`).join("") +
    `<span class="wiki-legend-item"><span class="wiki-legend-size"></span>크기 = 연결 수</span>` +
    `<span class="wiki-legend-item">선 = 위키링크</span>`;

  const presetCounts = {
    all: nodes.length,
    mine: nodes.filter((n) => n.dimensions.agency >= 0.6).length,
    core: nodes.filter((n) => n.dimensions.importance >= 0.8).length,
    evidence: nodes.filter((n) => n.dimensions.evidence >= 0.72).length,
  };
  presetButtons.forEach((button) => {
    const base = button.textContent.replace(/\s+\d+$/, "");
    button.textContent = `${base} ${presetCounts[button.dataset.preset] || 0}`;
  });

  const camera = { yaw: -0.68, pitch: 0.42, zoom: 1, panX: 0, panY: 0 };
  const initialCamera = { ...camera };
  let selectedIdx = -1;
  let hoverIdx = -1;
  let query = "";
  let activePreset = "all";
  let cssW = 0, cssH = 0;

  function matchesPreset(n) {
    if (activePreset === "mine") return n.dimensions.agency >= 0.6;
    if (activePreset === "core") return n.dimensions.importance >= 0.8;
    if (activePreset === "evidence") return n.dimensions.evidence >= 0.72;
    return true;
  }
  function matchesQuery(n) {
    if (!query) return true;
    const haystack = [n.title, n.path, n.frontmatter.type, n.frontmatter.weight,
      n.frontmatter.confidence, ...asArray(n.frontmatter.domain), ...(n.tags || [])]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  }
  function isActive(n) { return matchesPreset(n) && matchesQuery(n); }

  function projectPoint(x, y, z) {
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const rx = x * cy + z * sy;
    const rz = -x * sy + z * cy;
    const ry = y * cp - rz * sp;
    const depth = y * sp + rz * cp;
    const distance = 3.7;
    const perspective = distance / Math.max(1.5, distance - depth);
    const scale = Math.min(cssW, cssH) * 0.33 * camera.zoom;
    return {
      x: cssW / 2 + camera.panX + rx * scale * perspective,
      y: cssH / 2 + camera.panY - ry * scale * perspective,
      depth,
      perspective,
    };
  }

  function drawLine(a, b, color, width = 1) {
    const pa = projectPoint(...a), pb = projectPoint(...b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }

  const cubeEdges = [];
  [-1, 1].forEach((a) => [-1, 1].forEach((b) => {
    cubeEdges.push([[-1, a, b], [1, a, b]]);
    cubeEdges.push([[a, -1, b], [a, 1, b]]);
    cubeEdges.push([[a, b, -1], [a, b, 1]]);
  }));

  function drawFrame() {
    // 바깥 큐브와 50% 보조선. 축 자체는 색으로 한 번 더 구분한다.
    cubeEdges.forEach(([a, b]) => drawLine(a, b, "rgba(255,255,255,0.12)", 1));
    [-1, 0, 1].forEach((t) => {
      drawLine([-1, t, -1], [1, t, -1], "rgba(255,255,255,0.045)");
      drawLine([t, -1, -1], [t, 1, -1], "rgba(255,255,255,0.045)");
      drawLine([-1, -1, t], [1, -1, t], "rgba(255,255,255,0.045)");
    });
    // 세로(월드 y)는 Z 나의 개입도, 깊이(월드 z)는 Y 판단 비중이다.
    drawLine([-1, -1, -1], [1, -1, -1], "rgba(214,161,75,0.8)", 1.6);
    drawLine([-1, -1, -1], [-1, 1, -1], "rgba(141,141,232,0.9)", 1.6);
    drawLine([-1, -1, -1], [-1, -1, 1], "rgba(98,185,141,0.8)", 1.6);

    const labels = [
      { p: [1, -1, -1], text: "X  검증 강도", color: "#d6a14b" },
      { p: [-1, 1, -1], text: "Z  나의 개입도", color: "#8d8de8" },
      { p: [-1, -1, 1], text: "Y  판단 비중", color: "#62b98d" },
    ];
    ctx.font = '600 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textBaseline = "middle";
    labels.forEach(({ p, text, color }) => {
      const q = projectPoint(...p);
      ctx.fillStyle = color;
      ctx.fillText(text, q.x + 7, q.y - 5);
    });
  }

  function draw() {
    if (!cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.lineCap = "round";
    drawFrame();

    nodes.forEach((n) => {
      const p = projectPoint(n.wx, n.wy, n.wz);
      n.sx = p.x; n.sy = p.y; n.depth = p.depth;
      n.sr = (2.2 + Math.min(5.8, Math.sqrt(n.deg) * 0.58)) * p.perspective;
    });
    const focus = selectedIdx >= 0 ? selectedIdx : hoverIdx;
    const focusSet = focus >= 0 ? adj[focus] : null;

    // 관계선은 좌표를 정하지 않고, 선택한 노트의 맥락을 읽는 역할만 한다.
    edges.slice().sort(([a1, b1], [a2, b2]) =>
      (nodes[a1].depth + nodes[b1].depth) - (nodes[a2].depth + nodes[b2].depth))
      .forEach(([a, b]) => {
        const na = nodes[a], nb = nodes[b];
        const active = isActive(na) && isActive(nb);
        const focused = focus >= 0 && (a === focus || b === focus);
        ctx.beginPath(); ctx.moveTo(na.sx, na.sy); ctx.lineTo(nb.sx, nb.sy);
        ctx.strokeStyle = focused ? "rgba(230,48,48,0.68)" :
          (active ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.012)");
        ctx.lineWidth = focused ? 1.35 : 0.7;
        ctx.stroke();
      });

    const ordered = nodes.slice().sort((a, b) => a.depth - b.depth);
    ordered.forEach((n) => {
      const active = isActive(n);
      const related = focus < 0 || n.index === focus || focusSet.has(n.index);
      let alpha = active ? 0.93 : 0.045;
      if (active && !related) alpha = 0.17;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(n.sx, n.sy, Math.max(1.5, n.sr), 0, Math.PI * 2);
      ctx.fillStyle = n.color; ctx.fill();
      ctx.lineWidth = n.index === selectedIdx ? 2.1 : 0.8;
      ctx.strokeStyle = n.index === selectedIdx ? "#f2f2f2" : "rgba(8,8,8,0.95)";
      ctx.stroke();
      if (n.dimensions.agency >= 0.6 && active) {
        ctx.beginPath(); ctx.arc(n.sx, n.sy, Math.max(3, n.sr) + 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = n.index === selectedIdx ? "#e63030" : "rgba(141,141,232,0.55)";
        ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    ctx.font = '500 11px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const occupiedLabels = [];
    const labelCandidates = ordered.filter((n) => {
      const prominent = n.dimensions.importance >= 0.8 || n.dimensions.agency >= 0.85;
      return isActive(n) && (n.index === selectedIdx || n.index === hoverIdx || (focus < 0 && prominent));
    }).sort((a, b) => {
      const af = a.index === selectedIdx || a.index === hoverIdx ? 1 : 0;
      const bf = b.index === selectedIdx || b.index === hoverIdx ? 1 : 0;
      return bf - af || (b.dimensions.importance + b.dimensions.agency) -
        (a.dimensions.importance + a.dimensions.agency);
    });
    labelCandidates.forEach((n) => {
      const y = n.sy - n.sr - 5;
      const width = ctx.measureText(n.title).width + 8;
      const box = { left: n.sx - width / 2, right: n.sx + width / 2, top: y - 15, bottom: y + 2 };
      const forced = n.index === selectedIdx || n.index === hoverIdx;
      const overlaps = occupiedLabels.some((other) =>
        box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
      if (overlaps && !forced) return;
      occupiedLabels.push(box);
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(8,8,8,0.9)";
      ctx.strokeText(n.title, n.sx, y);
      ctx.fillStyle = "#f2f2f2"; ctx.fillText(n.title, n.sx, y);
    });
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cssW = wrap.clientWidth;
    cssH = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    draw();
  }

  function pick(x, y) {
    let hit = -1, bestDepth = -Infinity;
    nodes.forEach((n) => {
      if (!isActive(n)) return;
      // 작은 원도 실제 포인터/터치로 선택하기 쉽게 시각 반경보다 넓은 히트 영역을 둔다.
      const radius = Math.max(12, n.sr + 6);
      if ((n.sx - x) ** 2 + (n.sy - y) ** 2 <= radius ** 2 && n.depth > bestDepth) {
        hit = n.index; bestDepth = n.depth;
      }
    });
    return hit;
  }

  function resetCamera() {
    Object.assign(camera, initialCamera);
    draw();
  }

  function scoreRow(key, label, value) {
    const pct = Math.round(clamp(Number(value) || 0, 0, 1) * 100);
    return `<div class="wiki-coordinate wiki-coordinate--${key}">
      <div class="wiki-coordinate-head"><span>${label}</span><strong>${pct}</strong></div>
      <div class="wiki-coordinate-track"><i style="width:${pct}%"></i></div>
    </div>`;
  }

  function wikiShowDetail(idx) {
    if (idx < 0) {
      detail.innerHTML = `<p class="vc-detail-hint">노드 ${nodes.length}개 · 링크 ${edges.length}개<br>
        노드를 선택하면 frontmatter, 좌표 점수, 사실·주장·판단 callout 분포가 표시됩니다.</p>`;
      return;
    }
    const n = nodes[idx];
    const fm = n.frontmatter || {};
    const d = n.dimensions || {};
    const epistemic = n.epistemic || {};
    const neighbors = [...adj[idx]].sort((a, b) => nodes[b].deg - nodes[a].deg).slice(0, 24);
    const repoUrl = graph.repo_url || "https://github.com/lukeeee73/luke_wiki";
    const branch = graph.branch || "main";
    const fileUrl = `${repoUrl}/blob/${encodeURIComponent(branch)}/` +
      n.path.split("/").map(encodeURIComponent).join("/");
    const epistemicLabels = { fact: "사실", claim: "주장", judgment: "내 판단", principle: "원칙", opinion: "의견" };
    const epistemicHtml = Object.keys(epistemicLabels)
      .filter((key) => Number(epistemic[key]) > 0)
      .map((key) => `<span class="wiki-tag">${epistemicLabels[key]} <strong>${epistemic[key]}</strong></span>`).join("");
    const domains = asArray(fm.domain).join(" · ") || "—";
    const sources = asArray(fm.sources);

    detail.innerHTML = `
      <h3>${escapeHtml(n.title)}</h3>
      <p class="wiki-detail-meta">${escapeHtml(n.path)}<br>연결 ${n.deg}개${n.mtime ? ` · 수정 ${escapeHtml(n.mtime)}` : ""}</p>
      <dl class="wiki-frontmatter">
        <div><dt>domain</dt><dd>${escapeHtml(domains)}</dd></div>
        <div><dt>type</dt><dd>${escapeHtml(fm.type || "—")}</dd></div>
        <div><dt>weight</dt><dd>${escapeHtml(fm.weight || "—")}</dd></div>
        <div><dt>confidence</dt><dd>${escapeHtml(fm.confidence || "—")}</dd></div>
        <div><dt>sources</dt><dd>${sources.length}개</dd></div>
        <div><dt>updated</dt><dd>${escapeHtml(fm.updated || n.mtime || "—")}</dd></div>
      </dl>
      <div class="wiki-coordinates">
        ${scoreRow("x", "X · 검증 강도", d.evidence)}
        ${scoreRow("y", "Y · 판단 비중", d.importance)}
        ${scoreRow("z", "Z · 나의 개입도", d.agency)}
      </div>
      <p class="wiki-agency-note">${d.agency_inferred ? "추정값 · " : "명시값 · "}${escapeHtml(d.agency_basis || "근거 없음")}
        ${d.agency_inferred ? "<br>정확한 구분은 frontmatter의 authorship: human | mixed | ai | routine 으로 덮어쓸 수 있습니다." : ""}</p>
      ${epistemicHtml ? `<div class="wiki-epistemic" aria-label="문장별 인식론 표식">${epistemicHtml}</div>` : ""}
      ${(n.tags && n.tags.length) ? `<div class="wiki-detail-tags">${n.tags.map((t) =>
        `<span class="wiki-tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${neighbors.length ? `<div class="wiki-detail-links"><h4>연결된 노트</h4>${neighbors.map((j) =>
        `<button type="button" class="wiki-link-item" data-idx="${j}">
          <span style="color:${nodes[j].color}">●</span> ${escapeHtml(nodes[j].title)}</button>`).join("")}</div>` : ""}
      ${graph.has_content ? `<button type="button" class="wiki-read-btn" id="wiki-read-btn">📖 이 화면에서 읽기</button>` : ""}
      <a class="wiki-open-github" href="${fileUrl}" target="_blank" rel="noopener">GitHub 에서 노트 열기 ↗</a>`;

    detail.querySelectorAll(".wiki-link-item").forEach((button) => {
      button.addEventListener("click", () => {
        selectedIdx = Number(button.dataset.idx);
        wikiShowDetail(selectedIdx);
        draw();
      });
    });
    const readBtn = detail.querySelector("#wiki-read-btn");
    if (readBtn) readBtn.addEventListener("click", () => {
      wnOpenByIdx(idx, {
        deg: n.deg,
        onNavigate: (j) => { selectedIdx = j; wikiShowDetail(j); draw(); },
      });
    });
  }

  // 포인터 1개는 회전, 2개는 확대/축소. 이동 없이 놓으면 노드 선택이다.
  const pointers = new Map();
  let pointerStart = null;
  let pinchStart = null;
  let gestureMoved = false;
  let suppressNextClick = false;
  const pointInCanvas = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pointInCanvas(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      pointerStart = { ...p, yaw: camera.yaw, pitch: camera.pitch, hit: pick(p.x, p.y) };
      gestureMoved = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom };
      gestureMoved = true;
    }
    canvas.classList.add("dragging");
  }, { signal: sig });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointInCanvas(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pointers.size >= 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      camera.zoom = clamp(pinchStart.zoom * distance / Math.max(1, pinchStart.distance), 0.55, 3.2);
      draw();
      return;
    }
    if (pointers.size === 1 && pointerStart && pointers.has(e.pointerId)) {
      const dx = p.x - pointerStart.x, dy = p.y - pointerStart.y;
      if (Math.hypot(dx, dy) > 3) gestureMoved = true;
      if (gestureMoved) {
        camera.yaw = pointerStart.yaw + dx * 0.008;
        camera.pitch = clamp(pointerStart.pitch + dy * 0.008, -1.15, 1.15);
        draw();
      }
      return;
    }
    const hit = pick(p.x, p.y);
    if (hit !== hoverIdx) {
      hoverIdx = hit;
      canvas.style.cursor = hit >= 0 ? "pointer" : "grab";
      draw();
    }
  }, { signal: sig });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      suppressNextClick = gestureMoved;
      pointerStart = null; pinchStart = null; gestureMoved = false;
      canvas.classList.remove("dragging");
    }
  }
  canvas.addEventListener("pointerup", endPointer, { signal: sig });
  canvas.addEventListener("pointercancel", endPointer, { signal: sig });
  canvas.addEventListener("click", (e) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const p = pointInCanvas(e);
    selectedIdx = pick(p.x, p.y);
    wikiShowDetail(selectedIdx);
    draw();
  }, { signal: sig });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    camera.zoom = clamp(camera.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.55, 3.2);
    draw();
  }, { passive: false, signal: sig });
  canvas.addEventListener("dblclick", resetCamera, { signal: sig });
  resetBtn.addEventListener("click", resetCamera, { signal: sig });

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  }, { signal: sig });
  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activePreset = button.dataset.preset || "all";
      presetButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      if (selectedIdx >= 0 && !isActive(nodes[selectedIdx])) {
        selectedIdx = -1;
        wikiShowDetail(-1);
      }
      draw();
    }, { signal: sig });
  });

  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();
  wikiShowDetail(-1);
  canvas._wiki = {
    graph,
    nodes,
    camera,
    refresh() { resize(); },
    destroy() {
      listeners.abort();
      ro.disconnect();
      canvas._wiki = null;
    },
  };
}
