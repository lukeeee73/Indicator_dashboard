// Tab state, lazy data groups, current-regime charts and currency/inflation cards. Startup lives in app.js.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// 전역 상태: 이벤트 마커 표시 여부 + 각 카드의 "redraw" 콜백.
// 헤더 체크박스가 바뀌면 등록된 모든 카드가 자기 자신을 다시 그린다.
const APP_STATE = {
  showEvents: true,
  cardRedraws: [],  // 각 카드의 redraw() 함수 모음
};

// 탭 상태 관리
let _cachedData = null;
const _renderedTabs = new Set();
const _dirtyTabs = new Set();

// 실패한 부분 렌더와 이전 로드의 카드만 비운다. 섹터 선택과 공유 노트는 유지한다.
function resetTabContent(tab) {
  _renderedTabs.delete(tab);
  if (tab === "KR" || tab === "US") clearAssessment(tab);
  if (!_dirtyTabs.has(tab)) return;
  const hostIds = tab === "STOCKS"
    ? ["index-cards", "stock-cards", "value-screen-host"]
    : Object.keys(SECTOR_META).map((sector) => `${sector}-cards-${tab}`);
  for (const id of hostIds) {
    const host = document.getElementById(id);
    if (!host) continue;
    APP_STATE.cardRedraws = APP_STATE.cardRedraws.filter((redraw) =>
      !redraw.card || !host.contains(redraw.card));
    for (const canvas of host.querySelectorAll("canvas")) {
      if (typeof Chart !== "undefined" && typeof Chart.getChart === "function") {
        Chart.getChart(canvas)?.destroy();
      }
    }
    host.replaceChildren();
  }
  // 주식 검색 핸들러는 당시 종목을 캡처하므로 새 카드에 맞게 다시 연결한다.
  if (tab === "STOCKS") {
    for (const id of ["stock-search", "stock-expand-all"]) {
      const control = document.getElementById(id);
      if (!control) continue;
      const replacement = control.cloneNode(true);
      delete replacement.dataset.wired;
      if (id === "stock-search") replacement.value = "";
      else replacement.textContent = "전체 펼치기";
      control.replaceWith(replacement);
    }
  }
  _dirtyTabs.delete(tab);
}

function resetGroupContent(group) {
  for (const [tab, tabGroup] of Object.entries(TAB_GROUP)) {
    if (tabGroup === group) resetTabContent(tab);
  }
}

// 데이터 그룹별 로드 상태 — 각 탭은 자기가 쓰는 그룹만 기다린다.
// 예전에는 지표·자산·종목·지수를 하나의 Promise.all 로 묶어 20MB 남짓을
// 전부 받은 뒤에야 아무 탭이나 그려졌고, 그 중 하나만 실패하면 모든 탭이
// 영구히 빈 화면이 됐다. 그룹을 쪼개면 종목 쪽이 늦거나 실패해도
// 지표 탭은 정상적으로 뜬다.
//   indicators : 지표 + 자산  → 미국 / 한국 탭   (약 2MB, 바로 받는다)
//   stocks     : 종목 + 지수  → 주식 탭        (약 19MB, 탭 열 때 받는다)
//
// 종목 그룹은 154개 종목의 전체 일별 히스토리라 압축 전 19MB 다.
// 국가별 화면에서는 쓰지 않으므로 페이지 로드와 함께 받을 이유가 없다. "idle" 로
// 두고 주식 탭을 처음 열 때 받으면 초기 전송량이 1/10 로 줄어든다.
const TAB_GROUP = { US: "indicators", KR: "indicators", STOCKS: "stocks" };
const DATA_GROUPS = {
  indicators: { state: "loading", error: null },
  stocks:     { state: "loading", error: null },
};
// group → 실제 로드를 실행하는 함수. app_meta 가 도착한 뒤 채워진다.
const _groupLoaders = {};

// "idle" 그룹을 처음 필요해진 순간에 로드한다.
function ensureGroupLoaded(group) {
  if (DATA_GROUPS[group].state !== "idle") return;
  const load = _groupLoaders[group];
  if (!load) return;              // 아직 메타가 안 왔다 — 메타 쪽이 이어서 처리
  setGroupState(group, "loading");
  load();
}

function switchToTab(tab) {
  // 폐기된 탭이나 잘못된 이름은 현재 선택을 그대로 둔다.
  if (!Object.prototype.hasOwnProperty.call(TAB_GROUP, tab)) return;
  const panel = document.getElementById(`panel-${tab}`);
  if (!panel) return;
  // 패널 전환은 데이터와 무관하게 항상 먼저 — 로딩 중에도 탭은 살아 있어야 한다
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });
  panel.hidden = false;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  renderTabIfReady(tab);
}

// 탭 컨텐츠는 첫 방문 때 지연 렌더링한다.
// 아직 데이터가 없으면 빈 화면 대신 로딩/실패 상태를 보여준다.
function renderTabIfReady(tab) {
  if (!Object.prototype.hasOwnProperty.call(TAB_GROUP, tab)) return;
  const group = TAB_GROUP[tab];
  ensureGroupLoaded(group);      // 지연 로드 그룹이면 지금 받기 시작한다
  const { state, error } = DATA_GROUPS[group];
  if (state !== "ready") { setTabStatus(tab, state, error); return; }

  if (_renderedTabs.has(tab)) return;
  try {
    resetTabContent(tab);
    _dirtyTabs.add(tab);
    if (tab === "STOCKS") renderStocksTab(_cachedData);
    else renderTabContent(tab, _cachedData);
    _renderedTabs.add(tab);
    clearTabStatus(tab);
  } catch (err) {
    // 렌더 도중 실패한 탭을 완료로 캐시하지 않는다. 재시도 시 부분 카드를 정리한다.
    setGroupState(group, "error", err);
  }
}

// 패널 맨 위에 붙는 로딩/실패 안내 줄.
function tabStatusHost(tab, create) {
  const panel = document.getElementById(`panel-${tab}`);
  if (!panel) return null;
  let el = panel.querySelector(".tab-status");
  if (!el && create) {
    el = document.createElement("div");
    el.className = "tab-status";
    panel.prepend(el);
  }
  return el;
}

function setTabStatus(tab, state, err) {
  const el = tabStatusHost(tab, true);
  if (!el) return;
  if (state !== "error") {   // loading · idle — 아직 오류가 아니다
    el.innerHTML = emptyMessage("데이터를 불러오는 중입니다…");
    return;
  }
  const reason = (err && err.message) || "알 수 없는 오류";
  el.innerHTML = emptyMessage(`데이터를 불러오지 못했습니다 — ${reason}`)
    + `<button type="button" class="tab-retry">다시 시도</button>`;
  el.querySelector(".tab-retry").addEventListener("click", () => { retryTab(tab); });
}

// 탭의 재시도는 그 탭이 쓰는 그룹만 다시 받는다 — 지표가 이미 떠 있는데
// 주식 때문에 전체를 다시 받게 하지 않는다. 메타부터 실패한 경우엔 전체 재시도.
function retryTab(tab) {
  if (!Object.prototype.hasOwnProperty.call(TAB_GROUP, tab)) return;
  const group = TAB_GROUP[tab];
  const load = _groupLoaders[group];
  if (!load) { loadDashboardData(); return; }
  setGroupState(group, "loading");
  load();
}

function clearTabStatus(tab) {
  const el = tabStatusHost(tab, false);
  if (el) el.remove();
}

// 그룹 상태가 바뀌면 보이는 탭은 즉시 다시 판단하고,
// 숨은 탭은 상태 표시만 갱신해 둔다 (첫 방문 때 렌더링).
function setGroupState(group, state, err = null) {
  DATA_GROUPS[group] = { state, error: err };
  const active = document.querySelector(".tab-btn.active");
  const activeTab = active && active.dataset.tab;
  for (const [tab, g] of Object.entries(TAB_GROUP)) {
    if (g !== group) continue;
    if (tab === activeTab) renderTabIfReady(tab);
    else if (state === "ready" || state === "idle") clearTabStatus(tab);
    else setTabStatus(tab, state, err);
  }
}


// ---------- 진입점 ------------------------------------------
//
// 데이터 저장 구조 (2026-07 이후 — Supabase):
//   app_meta('index')   — 수집 메타데이터 (기존 index.json 과 동일 구조)
//   series/observations — 지표·자산·종목·지수별 시계열 + 부가정보
//
// get_payload_map RPC 가 기존 data/<종류>/<CODE>.json 과 같은 모양의
// payload 를 { code: payload } 맵으로 돌려주므로 이후 렌더링 로직은 동일하다.
//
// 첫 화면 (2026-11 이후): 국가 탭 데이터는 배포 때 만든 정적 스냅샷
// (data/snapshot/dashboard.json — 메타 + 지표·자산 다운샘플)에서 먼저 그린다.
// get_payload_map 은 방문마다 DB 에서 수십 년치 JSON 을 조립해 2~3초(최대 수십 초)가
// 걸렸다. 스냅샷을 그린 뒤 가벼운 get_app_meta 로 DB 가 더 새로운지 확인하고,
// 그렇다면 화면을 비우지 않은 채 DB 데이터로 바꾼다. 스냅샷이 없거나 깨졌으면
// 예전처럼 메타 → 시계열 순서로 Supabase 에서 받는다.
//
// 재시도 버튼을 연달아 누르면 로드가 겹친다. 뒤늦게 끝난 이전 로드가
// 새 로드의 _cachedData 를 덮어써 "ready 인데 내용은 빈" 상태가 되는 것을
// 세대 번호로 막는다 — 항상 마지막 로드만 화면에 반영한다.
let _loadSeq = 0;

async function loadDashboardData() {
  const seq = ++_loadSeq;
  // 새 메타를 기다리는 동안 이전 세대 로더를 재사용하지 않는다.
  for (const group of Object.keys(_groupLoaders)) delete _groupLoaders[group];
  _cachedData = null;

  try {
    clearGlobalError();
    resetGroupContent("indicators");
    resetGroupContent("stocks");
    setGroupState("indicators", "loading");
    setGroupState("stocks", "loading");

    const snapshot = await fetchDashboardSnapshot();
    if (seq !== _loadSeq) return;
    const idx = snapshot ? snapshot.meta : await sbRpc("get_app_meta");
    if (seq !== _loadSeq) return;
    if (!idx || typeof idx !== "object" || Array.isArray(idx)) {
      throw new Error("app_meta 형식이 올바르지 않습니다");
    }

    const target = {
      last_updated: idx.last_updated,
      assessment: idx.assessment || null,
      assessment_kr: idx.assessment_kr || null,
      indicators: {}, assets: {}, stocks: {}, indices: {},
    };
    _cachedData = target;
    renderLastUpdated(idx.last_updated);

    const codesOf = (list, label) => {
      if (list == null) return [];
      if (!Array.isArray(list) || list.some((entry) =>
        !entry || typeof entry.code !== "string" || !entry.code.trim())) {
        throw new Error(`${label} 메타데이터의 코드 목록 형식이 올바르지 않습니다`);
      }
      return list.map((entry) => entry.code);
    };
    // 잘못된 메타는 로더를 설치하기 전에 거부한다. 재시도는 교정된 메타부터 받는다.
    const codesFromMeta = (meta) => ({
      indicators: codesOf(meta.indicators, "지표"),
      assets: codesOf(meta.assets, "자산"),
      stocks: codesOf(meta.stocks, "종목"),
      indices: codesOf(meta.indices, "지수"),
    });
    const codes = codesFromMeta(idx);
    const currencyCodes = new Set(Object.values(CURRENCY_ASSET_CODES).flat());
    const groupAttempts = {};

    // parts = [[키, 코드목록, 필수여부, RPC 추가인자], …]
    // 준비·요청·후처리 오류는 해당 그룹의 재시도로 복구한다.
    // opts.source(part) 를 주면 요청 대신 그 결과(Promise.allSettled 모양)를 쓴다.
    // opts.quiet 이면 지금 화면을 지우지 않고 받아 두었다가 성공했을 때만 바꾼다.
    // 실패해도 오류 상태로 바꾸지 않고 false 를 돌려준다 (호출측이 대체 경로를 고른다).
    // opts.onCommit 은 검증을 통과한 뒤 화면을 다시 그리기 직전에 한 번 불린다.
    const loadGroup = async (group, prepareParts, opts = {}) => {
      const attempt = (groupAttempts[group] || 0) + 1;
      groupAttempts[group] = attempt;
      const isCurrent = () => seq === _loadSeq && groupAttempts[group] === attempt;
      try {
        if (!opts.quiet) resetGroupContent(group);
        const parts = prepareParts();
        const results = opts.source
          ? parts.map(opts.source)
          : await Promise.allSettled(
            parts.map(([, codes, , extraArgs]) => fetchPayloadMap(codes, extraArgs)));
        if (!isCurrent()) return false;

        const next = {};
        const missing = [];
        let fatal = null;
        results.forEach((result, i) => {
          const [key, codes, required] = parts[i];
          if (result.status === "fulfilled") {
            const payload = result.value;
            if (!payload || !payload.map || typeof payload.map !== "object"
                || Array.isArray(payload.map) || !Array.isArray(payload.missing)) {
              throw new Error(`${key} 응답 형식이 올바르지 않습니다`);
            }
            next[key] = { ...payload.map };
            missing.push(...payload.missing);
          } else {
            next[key] = {};
            if (required) fatal = result.reason || new Error(`${key} 데이터를 불러오지 못했습니다`);
            else missing.push(...codes);
          }
        });

        // 광고된 핵심 환율은 이번 시도에서 실제 시계열을 받아야 한다.
        // 비교용 자산 누락은 허용하며, 이전 시도의 데이터로 성공 처리하지 않는다.
        if (group === "indicators") {
          const requiredCurrencyAssets = parts.find(([key]) => key === "assets")[1]
            .filter((code) => currencyCodes.has(code));
          const unavailable = requiredCurrencyAssets.filter((code) =>
            !Array.isArray(next.assets[code]?.series) || !next.assets[code].series.length);
          if (unavailable.length && !fatal) {
            fatal = new Error(`필수 통화·환율 데이터를 불러오지 못했습니다: ${unavailable.join(", ")}`);
          }
        }
        if (fatal) throw fatal;
        if (opts.onCommit) opts.onCommit();
        if (opts.quiet) resetGroupContent(group);   // 새 데이터가 준비된 뒤에만 지운다
        Object.assign(target, next);
        setGroupState(group, "ready");
        if (missing.length) {
          console.warn(`${group}: ${missing.length}개 코드를 불러오지 못했습니다`, missing);
        }
        return true;
      } catch (err) {
        if (opts.quiet) {
          if (isCurrent()) console.warn(`${group}: 지금 화면을 유지합니다`, err);
          return false;
        }
        if (isCurrent()) setGroupState(group, "error", err);
        return false;
      }
    };

    const indicatorParts = (list = codes) =>
      [["indicators", list.indicators, true, SERIES_DOWNSAMPLE_ARGS()],
       ["assets", list.assets, false, SERIES_DOWNSAMPLE_ARGS()]];
    _groupLoaders.indicators = () => loadGroup("indicators", () => indicatorParts());
    _groupLoaders.stocks = () => loadGroup("stocks", () =>
      [["stocks", codes.stocks, true, SERIES_DOWNSAMPLE_ARGS()],
       ["indices", codes.indices, false]]);

    // 주식은 첫 방문까지 미룬다. 이미 주식 탭에 있다면 상태 변경이 로드를 시작한다.
    setGroupState("stocks", "idle");

    // 스냅샷에 없는 코드는 누락으로 다룬다 — 필수 환율이 빠졌으면 Supabase 로 받는다.
    const fromSnapshot = ([key, list]) => {
      const source = snapshot[key];
      const map = {};
      const absent = [];
      for (const code of list) {
        if (Object.prototype.hasOwnProperty.call(source, code)) map[code] = source[code];
        else absent.push(code);
      }
      return { status: "fulfilled", value: { map, missing: absent } };
    };
    if (snapshot && await loadGroup("indicators", () => indicatorParts(), { source: fromSnapshot, quiet: true })) {
      revalidateSnapshot(seq, idx.last_updated, async (live) => {
        // DB 가 더 새롭다 — 메타를 바꾸고 지표 그룹을 화면 유지한 채 다시 받는다.
        let nextCodes;
        try { nextCodes = codesFromMeta(live); } catch (err) {
          console.warn("DB 메타 형식이 올바르지 않아 스냅샷을 유지합니다", err);
          return;
        }
        if (seq !== _loadSeq) return;
        // 새 코드로 받되, 시계열이 모두 검증된 뒤에만 메타(평가 패널 포함)를 바꾼다.
        await loadGroup("indicators", () => indicatorParts(nextCodes), {
          quiet: true,
          onCommit: () => {
            Object.assign(codes, nextCodes);
            target.last_updated = live.last_updated;
            target.assessment = live.assessment || null;
            target.assessment_kr = live.assessment_kr || null;
            renderLastUpdated(live.last_updated);
          },
        });
      });
      return;
    }
    await _groupLoaders.indicators();
  } catch (err) {
    if (seq !== _loadSeq) return;
    // 메타 조회뿐 아니라 갱신 표시·로더 구성 중 발생한 예외도 오류로 전환한다.
    for (const group of Object.keys(_groupLoaders)) delete _groupLoaders[group];
    const stamp = document.getElementById("last-updated");
    if (stamp) stamp.textContent = "갱신 정보를 불러오지 못했습니다";
    setGroupState("indicators", "error", err);
    setGroupState("stocks", "error", err);
    renderError(err);
  }
}

// 스냅샷을 그린 뒤 DB 메타(가벼운 단일 행 조회)와 갱신 시각을 비교한다.
// 배포가 DB 동기화보다 앞선 경우처럼 스냅샷이 같거나 더 새로우면 아무것도 하지 않는다.
// 확인에 실패해도 이미 그린 스냅샷은 그대로 둔다.
async function revalidateSnapshot(seq, snapshotUpdated, refresh) {
  try {
    const live = await sbRpc("get_app_meta");
    if (seq !== _loadSeq) return;
    if (!live || typeof live !== "object" || Array.isArray(live)) return;
    if (!isNewerTimestamp(live.last_updated, snapshotUpdated)) return;
    await refresh(live);
  } catch (err) {
    console.warn("최신 데이터 확인에 실패해 스냅샷을 유지합니다", err);
  }
}

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
// tab: 국가 코드("KR" | "US" …) — 기존 환율 자산을 먼저, 지표를 섹터별로 이어서 표시한다.
const CURRENCY_ASSET_CODES = { KR: ["DEXKOUS"], US: ["DTWEXBGS"] };

/** 지표가 표시될 섹터. 메타의 sector 가 수집 category 보다 우선한다. */
function indicatorSector(code, payload) {
  return INDICATOR_META[code]?.sector || payload.category;
}

/** 섹터 카드 호스트를 찾고, 없으면 국가 패널에 서브탭 버튼과 패널을 새로 만든다. */
function ensureSectorHost(tab, sector) {
  const id = `${sector}-cards-${tab}`;
  const existing = document.getElementById(id);
  if (existing) return existing;
  const panel = document.getElementById(`panel-${tab}`);
  const nav = panel?.querySelector(".sector-nav");
  const meta = SECTOR_META[sector];
  if (!panel || !nav || !meta) return null;

  const activeSector = nav.querySelector(".sector-btn.active")?.dataset.sector;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sector-btn";
  btn.dataset.sector = sector;
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", "false");
  btn.textContent = meta.label;
  nav.appendChild(btn);

  const section = document.createElement("section");
  section.className = `category sector-panel category--${sector}`;
  section.dataset.sector = sector;
  section.hidden = activeSector !== sector;
  section.innerHTML = `<h2>${escapeHtml(meta.label)}</h2>`
    + (meta.desc ? `<p class="category-desc">${escapeHtml(meta.desc)}</p>` : "")
    + `<div class="cards" id="${id}"></div>`;
  const panels = panel.querySelectorAll(".sector-panel");
  if (panels.length) panels[panels.length - 1].after(section);
  else panel.appendChild(section);
  return section.querySelector(".cards");
}

function renderTabContent(tab, data) {
  renderAssessment(tab === "US" ? data.assessment : data.assessment_kr, tab);
  const indicators = data.indicators || {};
  const assets = data.assets || {};
  const bySector = {};
  for (const [code, payload] of Object.entries(indicators)) {
    if ((payload.region ?? "US") !== tab || !payload?.series?.length) continue;
    const sector = indicatorSector(code, payload);
    if (!Object.prototype.hasOwnProperty.call(SECTOR_META, sector)) continue;
    (bySector[sector] ||= []).push([code, payload]);
  }
  const hosts = {};
  for (const sector of Object.keys(SECTOR_META)) {
    hosts[sector] = document.getElementById(`${sector}-cards-${tab}`)
      || (bySector[sector] ? ensureSectorHost(tab, sector) : null);
  }
  const rendered = new Set();
  const counts = Object.fromEntries(Object.keys(SECTOR_META).map((sector) => [sector, 0]));
  const appendCard = (code, payload, category) => {
    const host = hosts[category];
    if (!host || !payload?.series?.length || rendered.has(code)) return;
    // 카드 하나가 실패해도 다른 시계열과 섹터 전환은 계속 동작한다.
    try {
      host.appendChild(renderCard(code, { ...payload, category }, assets));
      rendered.add(code);
      counts[category]++;
    } catch (err) {
      console.error(`${code} 카드를 그리지 못했습니다`, err);
    }
  };

  for (const code of CURRENCY_ASSET_CODES[tab] || []) {
    appendCard(code, assets[code], "dollar");
    if (!rendered.has(code) && hosts.dollar) {
      const message = document.createElement("p");
      message.className = "empty";
      message.textContent = `${ASSET_META[code].displayName} 데이터가 없습니다.`;
      hosts.dollar.appendChild(message);
    }
  }

  for (const [sector, entries] of Object.entries(bySector)) {
    for (const [code, payload] of entries) appendCard(code, payload, sector);
  }

  for (const [category, host] of Object.entries(hosts)) {
    if (host && !counts[category] && !host.children.length) {
      host.innerHTML = emptyMessage("아직 데이터가 없습니다.");
    }
  }
  wireSectorNav(tab);
}

/** 국가별 통화·물가 및 주식 서브탭의 sector-panel 표시를 전환한다. */
function wireSectorNav(tab) {
  const panel = document.getElementById(`panel-${tab}`);
  if (!panel) return;
  const nav = panel.querySelector(".sector-nav");
  if (!nav || nav.dataset.wired === "1") return;
  nav.dataset.wired = "1";

  const apply = (sector) => {
    nav.querySelectorAll(".sector-btn").forEach((b) => {
      const active = b.dataset.sector === sector;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    panel.querySelectorAll(".sector-panel").forEach((s) => {
      s.hidden = s.dataset.sector !== sector;
    });
    // 숨겨졌던 섹터의 차트가 resize 타이밍을 놓치지 않도록 window resize 디스패치
    window.dispatchEvent(new Event("resize"));
  };

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("button.sector-btn");
    if (!btn) return;
    apply(btn.dataset.sector);
  });
}

// 차트 인스턴스만 해제한다. 요약 패널·캔버스 등 정적 마크업은 남긴다.
function destroyAssessmentChart(tab) {
  const canvas = document.getElementById(`assessment-scatter-${tab}`);
  if (!canvas) return;
  const chart = canvas._chart || (typeof Chart !== "undefined" && typeof Chart.getChart === "function"
    ? Chart.getChart(canvas) : null);
  canvas._chart = null;
  if (chart) chart.destroy();
}

function clearAssessment(tab) {
  const section = document.getElementById(`assessment-${tab}`);
  if (section) section.hidden = true;
  destroyAssessmentChart(tab);
}

// 현재 국면 자동 판정 패널.
// assessment = { primary?, full, rolling_10y, config, trajectory }
//   primary — 백테스트 검증 모델(scripts/compare_models.py 승자)의 종합 판정.
//             US 에만 존재. full/rolling_10y 는 참조용 백분위 뷰.
// tab: "US" | "KR"
function renderAssessment(assessment, tab) {
  const section = document.getElementById(`assessment-${tab}`);
  if (!section || !assessment || !assessment.full || !assessment.rolling_10y) {
    clearAssessment(tab);
    return;
  }
  section.hidden = false;

  const QUADRANT_LABEL = {
    "Q1": "Q1 · 성장↑ 인플레↑",
    "Q2": "Q2 · 성장↑ 인플레↓",
    "Q3": "Q3 · 성장↓ 인플레↑",
    "Q4": "Q4 · 성장↓ 인플레↓",
    "Q1/Q2-edge": "Edge · 성장↑ 인플레 중립",
    "Q3/Q4-edge": "Edge · 성장↓ 인플레 중립",
    "Q1/Q3-edge": "Edge · 인플레↑ 성장 중립",
    "Q2/Q4-edge": "Edge · 인플레↓ 성장 중립",
    "Neutral":    "Neutral · 중립 구간",
  };

  const fillPanel = (keyPrefix, summary) => {
    const qEl = document.getElementById(`assessment-${tab}-${keyPrefix}-quadrant`);
    const gEl = document.getElementById(`assessment-${tab}-${keyPrefix}-growth`);
    const iEl = document.getElementById(`assessment-${tab}-${keyPrefix}-inflation`);
    if (qEl) {
      qEl.textContent = QUADRANT_LABEL[summary.quadrant] || summary.quadrant;
      qEl.dataset.quadrant = summary.quadrant.split("/")[0].replace("-edge", "");
    }
    if (gEl) {
      gEl.textContent = `${summary.growth_score.toFixed(0)} · ${summary.growth_label}`;
      gEl.dataset.label = summary.growth_label;
    }
    if (iEl) {
      iEl.textContent = `${summary.inflation_score.toFixed(0)} · ${summary.inflation_label}`;
      iEl.dataset.label = summary.inflation_label;
    }
  };
  fillPanel("full", assessment.full);
  fillPanel("10y",  assessment.rolling_10y);

  // 종합 판정 (primary) — 존재하는 탭(US)에서만 카드 표시
  const primary = tab === "US" ? (assessment.primary || null) : null;
  const primaryCard = document.getElementById(`assessment-${tab}-primary-card`);
  if (primaryCard) {
    primaryCard.hidden = !primary;
    if (primary) {
      fillPanel("primary", primary);
      const sub = document.getElementById(`assessment-${tab}-primary-sub`);
      if (sub && primary.backtest && primary.backtest.recession) {
        const r = primary.backtest.recession;
        const lead = r.median_lead_months;
        sub.textContent =
          `백테스트: 침체 ${r.hit} 적중 · 중위 선행 ${lead >= 0 ? "+" : ""}${lead}개월`;
        sub.title = `검증 구간 ${primary.backtest.window} · ` +
          `FPR ${(r.false_positive_rate * 100).toFixed(1)}% · ` +
          `모델 ${primary.model} (${primary.method})`;
      }
    }
  }
  const grid = section.querySelector(".assessment-grid");
  if (grid) grid.classList.toggle("has-primary", !!(primary && primaryCard));

  // 판정 요약 문구: primary 가 있으면 그것이 헤드라인, full/10y 는 보조 비교
  const note = document.getElementById(`assessment-${tab}-note`);
  if (note) {
    const f = assessment.full;
    const s = assessment.rolling_10y;
    const qf = f.quadrant;
    const qs = s.quadrant;
    let text;
    if (qf === qs) {
      text = `장기·단기 기준 모두 ${QUADRANT_LABEL[qf] || qf}. 분면 판정이 일관됨.`;
    } else {
      text = `장기 기준은 ${QUADRANT_LABEL[qf] || qf}, 단기 기준은 ${QUADRANT_LABEL[qs] || qs}. 두 창의 판정이 엇갈리면 레짐 전환 가능성에 주목.`;
    }
    if (primary) {
      const qp = primary.quadrant;
      text = `종합 판정(검증 모델)은 ${QUADRANT_LABEL[qp] || qp}. ` + text;
    }
    note.textContent = text;
  }

  // 2D 산점도
  renderScatter(assessment, tab);
}

function renderScatter(assessment, tab) {
  if (!assessment || !assessment.full) {
    clearAssessment(tab);
    return;
  }
  const canvas = document.getElementById(`assessment-scatter-${tab}`);
  if (!canvas) return;

  // primary(종합 판정) 가 있으면 그 궤적·현재값을 그린다. 없으면 장기 기준.
  const primary  = tab === "US" ? (assessment.primary || null) : null;
  const usePrimary = !!(primary && primary.trajectory && primary.trajectory.length);
  const traj = usePrimary ? primary.trajectory : (assessment.trajectory || []);
  const cur  = usePrimary ? primary : assessment.full;

  const title = document.getElementById(`assessment-${tab}-scatter-title`);
  if (title) {
    title.textContent = usePrimary
      ? "궤적 (최근 24개월, 종합 판정)"
      : "궤적 (최근 24개월, 장기 기준)";
  }

  // 궤적: 과거 → 현재 순으로 dot + 선. 마지막 점은 크게 강조.
  const trajectoryPoints = traj.map((p, idx) => ({
    x: p.inflation_score,
    y: p.growth_score,
    date: p.date,
    isLast: idx === traj.length - 1,
  }));
  const currentPoint = {
    x: cur.inflation_score,
    y: cur.growth_score,
    date: usePrimary ? "지금 (종합 판정)" : "지금 (장기 기준)",
    isCurrent: true,
  };

  const trajDataset = {
    label: "최근 24개월",
    data: trajectoryPoints,
    showLine: true,
    borderColor: "rgba(200,200,200,0.35)",
    borderWidth: 1,
    pointBackgroundColor: trajectoryPoints.map((p) =>
      p.isLast ? "#cc2424" : "rgba(200,200,200,0.5)",
    ),
    pointBorderColor: trajectoryPoints.map((p) =>
      p.isLast ? "#cc2424" : "rgba(200,200,200,0.5)",
    ),
    pointRadius: trajectoryPoints.map((p) => (p.isLast ? 5 : 2.5)),
    pointHoverRadius: 6,
  };
  const curDataset = {
    label: "현재",
    data: [currentPoint],
    showLine: false,
    pointBackgroundColor: "#cc2424",
    pointBorderColor: "#ffffff",
    pointBorderWidth: 2,
    pointRadius: 7,
    pointHoverRadius: 8,
  };

  // 기존 차트 파괴 후 재생성
  destroyAssessmentChart(tab);

  // 40/60 경계선
  const bandAnnotations = {
    vLow:  { type: "line", xMin: 40, xMax: 40, borderColor: "rgba(150,150,150,0.3)", borderWidth: 1, borderDash: [3,3] },
    vHigh: { type: "line", xMin: 60, xMax: 60, borderColor: "rgba(150,150,150,0.3)", borderWidth: 1, borderDash: [3,3] },
    hLow:  { type: "line", yMin: 40, yMax: 40, borderColor: "rgba(150,150,150,0.3)", borderWidth: 1, borderDash: [3,3] },
    hHigh: { type: "line", yMin: 60, yMax: 60, borderColor: "rgba(150,150,150,0.3)", borderWidth: 1, borderDash: [3,3] },
    // 모서리 분면 라벨
    q1: { type: "label", xValue: 80, yValue: 80, content: ["Q1"], color: "rgba(200,200,200,0.45)", font: { size: 12, weight: "700" } },
    q2: { type: "label", xValue: 20, yValue: 80, content: ["Q2"], color: "rgba(200,200,200,0.45)", font: { size: 12, weight: "700" } },
    q3: { type: "label", xValue: 80, yValue: 20, content: ["Q3"], color: "rgba(200,200,200,0.45)", font: { size: 12, weight: "700" } },
    q4: { type: "label", xValue: 20, yValue: 20, content: ["Q4"], color: "rgba(200,200,200,0.45)", font: { size: 12, weight: "700" } },
  };

  // eslint-disable-next-line no-undef
  canvas._chart = createChart(canvas, {
    type: "scatter",
    data: { datasets: [trajDataset, curDataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return `${p.date}  ·  I ${p.x.toFixed(0)}  ·  G ${p.y.toFixed(0)}`;
            },
          },
        },
        annotation: { annotations: bandAnnotations },
      },
      scales: {
        x: {
          min: 0, max: 100,
          title: { display: true, text: "인플레이션 점수", color: "#787878", font: { size: 10 } },
          ticks: { color: "#787878", stepSize: 20 },
          grid:  { color: "#222222" },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: "성장 점수", color: "#787878", font: { size: 10 } },
          ticks: { color: "#787878", stepSize: 20 },
          grid:  { color: "#222222" },
        },
      },
    },
  });
}

function renderLastUpdated(iso) {
  const el = document.getElementById("last-updated");
  if (!el) return;
  if (!iso) {
    el.textContent = "아직 갱신되지 않았습니다";
    return;
  }
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    el.textContent = "갱신 시간을 확인할 수 없습니다";
    return;
  }
  const kst = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(d);
  el.textContent = `마지막 갱신: ${kst} (KST)`;
}

// 마지막 관측일이 이보다 오래되면 갱신 중단 가능성을 경고한다. 분기 계열은 발표가 6~9개월
// 늦고 날짜가 분기 첫날로 찍히므로 1년보다 넉넉하게 잡는다.
const STALE_AFTER_DAYS = 540;

function renderAsOf(date) {
  const ageDays = (Date.now() - Date.parse(date)) / 86_400_000;
  const stale = Number.isFinite(ageDays) && ageDays > STALE_AFTER_DAYS;
  const title = stale ? "원천 데이터 갱신이 늦거나 중단된 계열입니다" : "마지막 관측일";
  return `<span class="card-asof${stale ? " stale" : ""}" title="${title}">`
    + `${stale ? "⚠ " : ""}${escapeHtml(date)} 기준</span>`;
}

function renderCard(code, payload, assets) {
  const meta = INDICATOR_META[code] ?? ASSET_META[code] ?? {
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
  if (meta.region) card.dataset.region = meta.region;

  const changeStr   = formatChange(change, meta) + (change != null && meta.unit === "₩" ? "원" : "");
  const valueStr = meta.unit === "₩"
    ? formatWithUnit(latest.value, meta.decimals, meta.unit)
    : formatValue(latest.value, meta);
  const changeClass = change == null ? "" : change >= 0 ? "up" : "down";

  // 실제로 선택 가능한 타임프레임만 버튼으로 노출한다.
  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  // 비교 자산 select: 주요 비교 / 관련 / 기타로 그룹화. 자기 자신은 제외한다.
  const compareSelectHtml = buildCompareSelectHtml(recs, assets, code);

  const badgesHtml = renderBadges(payload.current);

  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${meta.displayName}</span>
      <span class="card-code">${code}</span>
    </header>
    <div>
      <span class="card-value">${valueStr}</span>${meta.valueLabel ? `<span class="card-unit">${escapeHtml(meta.valueLabel)}</span>` : ""}
      <span class="card-change ${changeClass}" title="약 ${CHANGE_WINDOW_DAYS}일 전 대비">${changeStr}</span>
      ${renderAsOf(latest.date)}
    </div>
    ${badgesHtml}
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
        <button type="button" class="mode-btn active" data-mode="overlay"    title="각자의 원단위 축(이중 y축)">겹쳐보기</button>
        <button type="button" class="mode-btn"        data-mode="normalized" title="각 시리즈를 표시 구간 내 0~100 으로 정규화 — 같은 기준으로 형태 비교">기준화</button>
        <button type="button" class="mode-btn"        data-mode="stacked"    title="두 개의 독립 차트로 나란히">나란히</button>
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
    // 다운샘플 데이터의 밀도를 고르게 맞춘다 — 장기 구간에서 최근 1년이 늘어나지 않도록.
    const mainSliced = evenDensityForChart(sliceSeriesByMonths(series, tf.months));

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
      // 겹쳐보기: 같은 차트에 이중 Y축 (각 시리즈는 자기 원단위 축에 표시)
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
    } else if (cmpPayload && state.compareMode === "normalized") {
      // 기준화(정규화): 두 시리즈 모두 "표시 구간 내 0~100" 으로 스케일.
      // 결과적으로 단일 y축에서 "형태와 상대 위치" 를 같은 기준으로 비교할 수 있다.
      chartState.main = renderChart(mainCanvas, mainSliced, category, {
        overlay: {
          series: cmpPayload.series,
          meta:   cmpMeta,
          name:   cmpMeta?.displayName ?? state.compareCode,
        },
        normalize: true,
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
        const cmpSliced = evenDensityForChart(sliceByDateRange(cmpPayload.series, rangeStart, rangeEnd));
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
  redraw.card = card;
  APP_STATE.cardRedraws.push(redraw);

  return card;
}

/** 비교 자산 select 의 <option> HTML 을 조립한다. 주요 비교/관련/기타 순으로 그룹화. */
function buildCompareSelectHtml(recs, assets, primaryCode = null) {
  const availableCodes = new Set(
    Object.entries(assets)
      .filter(([code, p]) => code !== primaryCode && p.series && p.series.length > 0)
      .map(([code]) => code),
  );
  if (availableCodes.size === 0) {
    return `<option value="">비교 자산 데이터 없음</option>`;
  }

  const primary   = [...new Set(recs.primary || [])].filter((c) => availableCodes.has(c));
  const secondary = [...new Set(recs.secondary || [])].filter((c) => availableCodes.has(c) && !primary.includes(c));
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
    group("주요 비교", primary),
    group("관련", secondary),
    group("기타 자산", others),
  ].join("");
}

function renderError(err) {
  // 탭 탐색과 재시도 버튼이 유지되도록 실패 안내는 상단 배너에 표시한다.
  clearGlobalError();   // 재시도할 때마다 배너가 쌓이지 않게 한다
  const main = document.querySelector("main");
  if (!main) return;
  const banner = document.createElement("div");
  banner.className = "error";
  banner.id = "global-error";
  banner.append(`데이터를 불러오지 못했습니다: ${err.message} `);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "tab-retry";
  retry.textContent = "다시 시도";
  retry.addEventListener("click", () => { loadDashboardData(); });
  banner.append(retry);
  main.prepend(banner);
}

function clearGlobalError() {
  const prev = document.getElementById("global-error");
  if (prev) prev.remove();
}
