// Supabase request queue, retries, payload batches and document reads. No requests run at load time.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

// ---------- Supabase 데이터 소스 ------------------------------
// 지표·자산·종목·지수 시계열은 Supabase(Postgres)에서 RPC 로 가져온다.
// SUPABASE_KEY 는 publishable(공개) 키로, 브라우저 노출을 전제로 한 값이다.
// 읽기 권한은 DB 의 RLS SELECT 정책으로만 열려 있다.
const SUPABASE_URL = "https://axijsbgyktrbiigybpgq.supabase.co";
const SUPABASE_KEY = "sb_publishable_7sDi1DM8Wj0BWeFHntWzzg_wNFbIsc1";

// 전역 동시 요청 제한 — 무거운 집계 쿼리를 동시에 많이 보내면
// DB statement timeout(57014)에 걸리므로 한 번에 4개까지만 보낸다.
const SB_MAX_CONCURRENT = 4;
let _sbActive = 0;
const _sbWaiters = [];

// 응답이 없는 요청은 영원히 기다리지 않는다 — 타임아웃이 없으면 모바일에서
// 커넥션 하나가 멈추는 순간 "Loading…" 상태로 화면이 그대로 굳어버린다.
// 정상 응답은 3~6초 — 15초면 충분한 여유이고, 최악의 경우(3번 모두 타임아웃)에도
// 45초 안에 실패가 화면에 드러난다.
const SB_TIMEOUT_MS = 15000;
const SB_RETRIES = 2;  // 최초 시도 외 추가 시도 횟수

async function _sbAcquire() {
  if (_sbActive < SB_MAX_CONCURRENT) { _sbActive += 1; return; }
  // 대기자를 깨울 때 슬롯을 그대로 넘겨받는다 (_sbRelease 가 감소시키지 않음).
  // 여기서 다시 +1 하면 깨어나는 사이에 끼어든 요청과 슬롯을 이중으로 세게 된다.
  await new Promise((resolve) => _sbWaiters.push(resolve));
}

function _sbRelease() {
  const next = _sbWaiters.shift();
  if (next) next();          // 슬롯을 대기자에게 그대로 인계 (_sbActive 유지)
  else _sbActive -= 1;
}

const sbSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 한 번의 시도 = 동시 요청 슬롯 확보 → 타임아웃 붙인 fetch.
async function _sbFetchOnce(url, init) {
  await _sbAcquire();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;   // 재시도 여부 판단용
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    _sbRelease();
  }
}

// 4xx 는 요청·권한 자체가 잘못된 것이라 다시 물어도 같은 답이 온다.
// (408 타임아웃·429 과다요청은 예외 — 잠시 뒤 성공할 수 있다.)
function _sbRetryable(err) {
  const s = err && err.status;
  return !(s >= 400 && s < 500 && s !== 408 && s !== 429);
}

// 일시적 실패(타임아웃·5xx·네트워크 끊김)는 지수 백오프로 재시도한다.
async function _sbWithRetry(label, run) {
  let lastErr;
  for (let attempt = 0; attempt <= SB_RETRIES; attempt += 1) {
    if (attempt > 0) await sbSleep(500 * 2 ** (attempt - 1));
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      if (!_sbRetryable(err)) break;   // 재시도해도 소용없는 오류는 바로 알린다
    }
  }
  const reason = lastErr && lastErr.name === "AbortError"
    ? `${SB_TIMEOUT_MS / 1000}초 안에 응답이 없었습니다`
    : (lastErr && lastErr.message) || "알 수 없는 오류";
  throw new Error(`${label} → ${reason}`);
}

async function sbRpc(fn, args = {}) {
  return _sbWithRetry(fn, () => _sbFetchOnce(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(args),
  }));
}

// 코드 목록을 청크로 나눠 조회 후 { code: payload } 맵 하나로 합친다.
// 청크 하나가 끝까지 실패해도 나머지는 살린다 — 종목 하나 때문에 탭 전체가
// 빈 화면이 되는 것보다 부분 표시가 낫다. 실패 코드는 missing 으로 보고한다.
// extraArgs 를 주면 RPC 인자에 그대로 얹는다 (다운샘플링 경계 등).
async function fetchPayloadMap(codes, extraArgs = null, chunkSize = 25) {
  if (!codes.length) return { map: {}, missing: [] };
  const chunks = [];
  for (let i = 0; i < codes.length; i += chunkSize) {
    chunks.push(codes.slice(i, i + chunkSize));
  }
  const results = await Promise.allSettled(
    chunks.map((c) => sbRpc("get_payload_map", { p_codes: c, ...extraArgs })),
  );
  const map = {};
  const missing = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") Object.assign(map, r.value);
    else missing.push(...chunks[i]);
  });
  // 전부 실패했다면 부분 성공이 아니라 그냥 실패다 — 호출자가 알아야 한다.
  if (missing.length === codes.length) {
    throw results.find((r) => r.status === "rejected").reason;
  }
  return { map, missing };
}

// 종목 시계열 다운샘플링 경계 — get_payload_map 의 p_daily_since / p_weekly_since.
// 최근 1년은 일별 그대로, 그 앞 4년은 주당 1개, 그보다 오래된 구간은 월당 1개만
// 받는다. 서버가 각 구간의 '마지막' 관측치를 고르므로 최신값은 항상 살아있고
// 장기 추세선도 눈으로는 차이가 없다. 154개 종목 기준 36만 → 7.7만 포인트.
// 인자를 빼면 예전처럼 전체 일별이 오므로, 지표·자산·지수는 그대로 둔다.
const STOCK_DAILY_YEARS  = 1;
const STOCK_WEEKLY_YEARS = 5;

function _isoYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// 호출 시점에 계산한다 — 탭을 안 열고 자정을 넘겨도 경계가 따라간다.
const STOCK_SERIES_ARGS = () => ({
  p_daily_since:  _isoYearsAgo(STOCK_DAILY_YEARS),
  p_weekly_since: _isoYearsAgo(STOCK_WEEKLY_YEARS),
});

// documents 테이블에서 문서 하나를 통째로 가져온다.
// (markets · wiki · principles · value_screen 등 비시계열 데이터)
async function sbDoc(kind, key) {
  const params =
    `kind=eq.${encodeURIComponent(kind)}` +
    `&key=eq.${encodeURIComponent(key)}&select=payload&limit=1`;
  const rows = await _sbWithRetry(`documents ${kind}/${key}`, () =>
    _sbFetchOnce(`${SUPABASE_URL}/rest/v1/documents?${params}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }));
  if (!rows.length) throw new Error(`documents ${kind}/${key} 를 찾을 수 없습니다`);
  return rows[0].payload;
}
