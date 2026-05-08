/* ============================================================
 * Luke Dashboard — 프론트엔드 로직
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
//
// 필드 설명:
//   displayName / description / unit / decimals — 표시 포맷
//   region        — "KR" 이면 한국 패널로 라우팅
//   zeroline      — true 면 y축에 0 을 반드시 포함하고 0 기준선을 그림.
//                   부호(양/음) 가 의미를 가지는 시리즈(YoY, 스프레드 등) 전용.
//   axisScale     — "linear"(기본) | "log"  장기 가격·지수는 로그가 더 객관적.
const INDICATOR_META = {
  // ── 성장 지표 ─────────────────────────────────────────────────────────
  T10Y2Y: {
    displayName: "10Y-2Y 금리차",
    description: "장기 금리와 단기 금리의 차이. 마이너스(역전)가 되면 역사적으로 1~2년 내 침체가 따라왔다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  INDPRO: {
    displayName: "산업생산 YoY",
    description: "공장·광산·유틸리티 생산량의 전년 대비 변화. 실물 경기가 지금 어느 속도로 돌아가는지 보여준다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  PAYEMS: {
    displayName: "비농업 고용 YoY",
    description: "비농업 일자리의 전년 대비 증감. 경기가 좋으면 고용이 늘고 나쁘면 줄어드는 동행 지표.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  USSLIND: {
    displayName: "주 단위 선행지수",
    description: "Philly Fed가 집계하는 향후 6개월 성장률 전망. 50개 주(州) 데이터를 가중 합산해 지역 편중 없이 미국 전체를 본다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  ICSA: {
    displayName: "신규 실업급여 청구 YoY",
    description: "매주 목요일 발표. 새로 실업급여를 신청한 사람 수의 전년 대비 변화. 경기 충격 첫 주에 즉시 튀어 오르며 PAYEMS보다 5~6주 빠르다. 높을수록 나쁨(역방향 적용).",
    unit: "%",
    decimals: 1,
    zeroline: true,
  },
  UMCSENT: {
    displayName: "미시간대 소비자심리",
    description: "미시간대가 매달 측정하는 소비자 낙관도. GDP의 70%인 소비를 이끄는 가계 심리를 가장 빠르게 반영하는 선행 지표.",
    unit: "index",
    decimals: 1,
  },

  // ── 인플레이션 지표 ───────────────────────────────────────────────────
  T10YIE: {
    displayName: "10Y 기대 인플레 (BEI)",
    description: "채권 시장이 베팅하는 향후 10년 평균 물가 상승률. 실시간으로 움직이는 가장 빠른 인플레 선행 신호.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  CPIAUCSL: {
    displayName: "CPI YoY",
    description: "가계가 실제로 사는 물건·서비스 바구니의 전년 대비 가격 변화. 우리가 일상에서 느끼는 물가 그 자체.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  CPILFESL: {
    displayName: "Core CPI YoY",
    description: "CPI에서 변동성이 큰 식품·에너지를 뺀 값. 인플레가 얼마나 '끈적하게' 고착되고 있는지 보여준다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  PCEPI: {
    displayName: "PCE YoY",
    description: "Fed가 금리 결정 기준으로 삼는 물가 지표. CPI보다 범위가 넓고 소비 패턴 변화를 더 빠르게 반영한다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  DCOILWTICO: {
    displayName: "WTI 원유 YoY",
    description: "국제 원유 가격의 전년 대비 변화. 에너지 비용을 통해 물가 압력이 얼마나 빠르게 퍼지는지 알 수 있다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  T5YIFR: {
    displayName: "5Y5Y 기대 인플레",
    description: "5년 후부터 시작하는 5년간의 기대 인플레이션. 10Y BEI와 함께 보면 인플레가 일시적인지, 구조적으로 고착되는지 구분할 수 있다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  PCUOMFGOMFG: {
    displayName: "제조업 PPI YoY",
    description: "제조업체가 받는 제품 가격의 전년 대비 변화. 원가 상승 압력이 소비자 가격에 전가되기 2~3개월 전에 먼저 움직인다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  WPSID61: {
    displayName: "원자재 PPI YoY",
    description: "금속·농산물 등 광범위한 원자재 가격의 전년 대비 변화. WTI가 에너지만 보는 것을 보완해 인플레 원천을 넓게 커버한다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },

  // ── 달러 가치 분석 지표 (미국) ────────────────────────────────────────
  DGS10: {
    displayName: "미국 10Y 국채 수익률",
    description: "미국 10년물 국채 수익률. 달러 자산의 기회비용이자 글로벌 자금 흐름의 기준점. 오르면 달러 강세와 이머징 자금 유출 압력이 커진다.",
    unit: "%",
    decimals: 2,
  },
  M2SL: {
    displayName: "미국 M2 통화량 YoY",
    description: "현금·예금·MMF를 합친 광의 통화량의 전년 대비 증가율. 돈이 너무 많이 풀리면 인플레와 달러 약세로 이어지는 선행 지표.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  GFDEGDQ188S: {
    displayName: "미국 연방 부채 (% of GDP)",
    description: "미국 연방 정부 빚의 GDP 대비 비율. 재정 건전성을 장기적으로 보여주는 지표로 분기 단위로 발표된다.",
    unit: "% GDP",
    decimals: 1,
  },

  // ── 달러 가치 분석 지표 (한국) ────────────────────────────────────────
  IRLTLT01KRM156N: {
    displayName: "🇰🇷 한국 10Y 국채 수익률",
    description: "한국 10년물 국채 수익률. 미국 DGS10과의 금리 차이(스프레드)가 원/달러 환율 방향을 결정하는 핵심 변수.",
    unit: "%",
    decimals: 2,
    region: "KR",
  },
  MYAGM2KRM189S: {
    displayName: "🇰🇷 한국 M2 통화량 YoY",
    description: "한국 광의 통화(M2)의 전년 대비 증가율. 미국 M2와 비교해 어느 쪽이 더 빠르게 돈을 풀고 있는지 파악할 수 있다.",
    unit: "%",
    decimals: 2,
    region: "KR",
    zeroline: true,
  },
  DEBTTLKRQ052N: {
    displayName: "🇰🇷 한국 정부 부채 (% of GDP)",
    description: "한국 정부 부채의 GDP 대비 비율 (IMF/World Bank). 미국과 함께 보면 두 나라의 재정 여력을 비교할 수 있다. 분기 발표.",
    unit: "% GDP",
    decimals: 1,
    region: "KR",
  },

  // ── 한국 지표 ─────────────────────────────────────────────────────────
  KORCPIALLMINMEI: {
    displayName: "🇰🇷 한국 CPI YoY",
    description: "한국 소비자물가의 전년 대비 상승률. 국내 물가 흐름을 직접 보여주는 지표로 미국 4분면 점수에는 포함되지 않는다.",
    unit: "%",
    decimals: 2,
    region: "KR",
    zeroline: true,
  },
  KORPROINDMISMEI: {
    displayName: "🇰🇷 한국 산업생산 YoY",
    description: "한국 제조업 산업생산의 전년 대비 변화율. 수출 중심 한국 경제의 실물 흐름을 보여준다. 미국 4분면 점수에는 포함되지 않는다.",
    unit: "%",
    decimals: 2,
    region: "KR",
    zeroline: true,
  },
  LRUNTTTTKOR156S: {
    displayName: "🇰🇷 한국 실업률",
    description: "한국 15세 이상 실업률. 높을수록 성장 약화를 의미해 역방향으로 계산된다. 미국 4분면 점수에는 포함되지 않는다.",
    unit: "%",
    decimals: 1,
    region: "KR",
  },
  KOSPI_YOY: {
    displayName: "🇰🇷 코스피 YoY",
    description: "코스피 지수의 전년 동월 대비 수익률. 한국 증시가 경기를 어떻게 반영하는지 한눈에 보여준다. 미국 4분면 점수에는 포함되지 않는다.",
    unit: "%",
    decimals: 2,
    region: "KR",
    zeroline: true,
  },
};

// 개별 종목 UI 메타데이터. fetch_fred.py 의 STOCKS 와 대응.
const STOCK_META = {
  AAPL: { displayName: "Apple",  fullName: "Apple Inc.",              sector: "Technology",               color: "#9aa0a9", decimals: 2 },
  NVDA: { displayName: "NVIDIA", fullName: "NVIDIA Corporation",      sector: "Technology",               color: "#76b900", decimals: 2 },
  TSLA: { displayName: "Tesla",  fullName: "Tesla Inc.",              sector: "Consumer Discretionary",   color: "#cc0000", decimals: 2 },
  META: { displayName: "Meta",   fullName: "Meta Platforms Inc.",     sector: "Communication Services",   color: "#0082fb", decimals: 2 },
};

// 비교 자산(Assets) UI 메타데이터.
// fetch_fred.py 의 ASSETS 와 대응.
const ASSET_META = {
  GOLDAMGBD228NLBM: { displayName: "금 (Gold)",              unit: "$", decimals: 0, color: "#d4af37" },
  DTWEXBGS:         { displayName: "달러 지수",              unit: "",  decimals: 2, color: "#7dd3fc" },
  SP500:            { displayName: "S&P 500",                unit: "",  decimals: 2, color: "#c084fc" },
  DGS10:            { displayName: "10년 국채금리",          unit: "%", decimals: 2, color: "#fb923c" },
  VIXCLS:           { displayName: "VIX (공포지수)",         unit: "",  decimals: 2, color: "#f87171" },
  DEXKOUS:          { displayName: "원/달러 환율",           unit: "₩", decimals: 2, color: "#86efac" },
  BAMLH0A0HYM2:     { displayName: "미국 하이일드 스프레드", unit: "%", decimals: 2, color: "#fca5a5" },
  IRLTLT01KRM156N:  { displayName: "한국 국채 10년",         unit: "%", decimals: 2, color: "#4c9ef7" },
  KOSPI:            { displayName: "코스피 (원시)",          unit: "",  decimals: 0, color: "#a78bfa" },
};

// 지표별 "추천 비교 대상". 4분면 프레임워크 논리에 따라 1/2순위 구성.
// primary 는 select 의 "추천" optgroup 에 표시, secondary 는 "관련".
const COMPARE_RECOMMENDATIONS = {
  T10Y2Y: {
    primary:   ["SP500", "BAMLH0A0HYM2", "VIXCLS"],
    secondary: ["GOLDAMGBD228NLBM", "DGS10"],
    note: "장단기 금리 역전은 침체 선행 신호. 주식·신용스프레드·VIX 가 어떻게 반응했는지 비교.",
  },
  T10YIE: {
    primary:   ["GOLDAMGBD228NLBM", "DGS10"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "기대 인플레이션이 오를 때 금·명목금리는 동행, 달러는 역행하는 경향.",
  },
  CPIAUCSL: {
    primary:   ["GOLDAMGBD228NLBM", "DTWEXBGS", "DGS10"],
    secondary: ["DEXKOUS", "SP500"],
    note: "실제 인플레이션 상승기 → 금·원자재 강세, 달러·장기채 약세 경향.",
  },
  INDPRO: {
    primary:   ["SP500", "BAMLH0A0HYM2"],
    secondary: ["DGS10", "VIXCLS"],
    note: "생산 확장기엔 주식 상승·HY 스프레드 축소, 수축기엔 반대 흐름.",
  },
  PAYEMS: {
    primary:   ["SP500", "BAMLH0A0HYM2"],
    secondary: ["DGS10", "VIXCLS"],
    note: "고용 YoY 둔화는 경기 후행이지만 침체의 확정적 신호. 주식·크레딧 스프레드와 비교.",
  },
  USSLIND: {
    primary:   ["SP500", "BAMLH0A0HYM2"],
    secondary: ["VIXCLS", "DGS10"],
    note: "Philly Fed 선행지수가 꺾일 때 주식/크레딧이 선반영했는지 체크.",
  },
  CPILFESL: {
    primary:   ["GOLDAMGBD228NLBM", "DGS10"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "Core CPI 가속기엔 명목금리·금 동행, 달러 약세 경향.",
  },
  PCEPI: {
    primary:   ["DGS10", "GOLDAMGBD228NLBM"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "Fed 기준 지표. 목표(2%) 대비 이탈 국면에서 채권/달러 반응 확인.",
  },
  DCOILWTICO: {
    primary:   ["DTWEXBGS", "GOLDAMGBD228NLBM"],
    secondary: ["SP500", "DEXKOUS"],
    note: "유가 YoY 는 달러와 역상관, 인플레와 동행. 1·2차 오일쇼크·2008·COVID 전후가 관전 포인트.",
  },

  // ── 달러 가치 분석 지표 비교 추천 ────────────────────────────────────
  DGS10: {
    primary:   ["DEXKOUS", "IRLTLT01KRM156N", "DTWEXBGS"],
    secondary: ["GOLDAMGBD228NLBM", "SP500"],
    note: "미국 10Y 금리가 오를수록 달러 강세 압력. 한국 국채와의 스프레드, 원/달러 환율과 동시 비교.",
  },
  M2SL: {
    primary:   ["DEXKOUS", "DTWEXBGS", "GOLDAMGBD228NLBM"],
    secondary: ["SP500", "VIXCLS"],
    note: "M2 급증 구간(2020 등)에서 달러 지수 약세·금 강세 경향. 환율과의 시차 동행 확인.",
  },
  GFDEGDQ188S: {
    primary:   ["DGS10", "BAMLH0A0HYM2", "DEXKOUS"],
    secondary: ["GOLDAMGBD228NLBM", "DTWEXBGS"],
    note: "부채/GDP 급등 구간에서 장기금리·크레딧 스프레드 반응을 체크. 금·달러 약세와의 연관성.",
  },
  IRLTLT01KRM156N: {
    primary:   ["DEXKOUS", "DGS10", "KOSPI"],
    secondary: ["GOLDAMGBD228NLBM", "BAMLH0A0HYM2"],
    note: "한미 금리차 확대 시 원화 약세 경향. 원/달러 환율, 미국 10Y 국채와 동시에 비교.",
  },
  MYAGM2KRM189S: {
    primary:   ["DEXKOUS", "IRLTLT01KRM156N", "KOSPI"],
    secondary: ["GOLDAMGBD228NLBM", "SP500"],
    note: "한국 M2 팽창 속도를 미국 M2와 비교해 상대 통화 공급 과잉을 파악. 원/달러와 동행 확인.",
  },
  DEBTTLKRQ052N: {
    primary:   ["IRLTLT01KRM156N", "DEXKOUS", "KOSPI"],
    secondary: ["BAMLH0A0HYM2", "GOLDAMGBD228NLBM"],
    note: "한국 재정 건전성 추이. 부채 확대 시 장기금리·원화 방향성과의 관계를 확인.",
  },

  // ── 한국 지표 비교 추천 ────────────────────────────────────────────────
  KORCPIALLMINMEI: {
    primary:   ["DEXKOUS", "DCOILWTICO"],
    secondary: ["IRLTLT01KRM156N", "GOLDAMGBD228NLBM"],
    note: "수입 의존도가 높은 한국은 원/달러 약세·유가 상승이 CPI 선행 지표. 환율과의 동행성 확인.",
  },
  KORPROINDMISMEI: {
    primary:   ["KOSPI", "DEXKOUS"],
    secondary: ["SP500", "BAMLH0A0HYM2"],
    note: "수출 의존 경제구조상 글로벌 수요와 동행. 코스피·원화와의 상관, S&P 500 과의 동조화 확인.",
  },
  LRUNTTTTKOR156S: {
    primary:   ["KOSPI", "KORPROINDMISMEI"],
    secondary: ["DEXKOUS", "VIXCLS"],
    note: "실업률 상승은 내수 위축 신호. 코스피 하락과 동행 경향. 백분위는 역방향(높을수록 성장 약화).",
  },
  KOSPI_YOY: {
    primary:   ["SP500", "DEXKOUS"],
    secondary: ["GOLDAMGBD228NLBM", "BAMLH0A0HYM2"],
    note: "코스피 YoY 상승기엔 원화 강세·글로벌 위험 선호. S&P 500 과의 동조화/디커플링 비교.",
  },
};

// 주요 역사적 이벤트. 차트에 수직 점선 + 라벨로 표시.
// short: 10년 이상 뷰에서 클릭 팝업으로 쓰이는 짧은 이름
const EVENTS = [
  { date: "1914-07-28", label: "1차 세계대전 발발",          short: "WW1" },
  { date: "1929-10-29", label: "대공황 (Black Tuesday)",     short: "대공황" },
  { date: "1939-09-01", label: "2차 세계대전 발발",          short: "WW2" },
  { date: "1945-09-02", label: "2차 세계대전 종전",          short: "WW2종전" },
  { date: "1971-08-15", label: "닉슨 쇼크 (금본위 붕괴)",   short: "닉슨쇼크" },
  { date: "1973-10-06", label: "1차 오일쇼크",               short: "오일1" },
  { date: "1979-11-04", label: "2차 오일쇼크",               short: "오일2" },
  { date: "1987-10-19", label: "Black Monday",               short: "블랙먼데이" },
  { date: "1997-07-02", label: "아시아 외환위기",             short: "외환위기" },
  { date: "2000-03-10", label: "닷컴 버블 정점",             short: "닷컴버블" },
  { date: "2001-09-11", label: "9/11 테러",                  short: "9/11" },
  { date: "2008-09-15", label: "리먼 파산 (글로벌 금융위기)", short: "리먼파산" },
  { date: "2011-08-05", label: "미국 신용등급 강등",         short: "신용강등" },
  { date: "2020-03-11", label: "COVID-19 팬데믹 선언",       short: "COVID" },
  { date: "2022-02-24", label: "러시아-우크라이나 전쟁",     short: "우크라이나" },
];

// 카테고리별 차트 색 (CSS 변수와 일치시킴)
const CATEGORY_COLOR = {
  growth:    "#c8d8ea",   // 스틸 블루-화이트
  inflation: "#cc2424",   // 레드
  dollar:    "#f5c842",   // 골드-옐로우 (달러 상징색)
};

// 최근 변화 계산 기준 (일)
const CHANGE_WINDOW_DAYS = 30;

// 차트 타임프레임 선택지. null 이면 전체 데이터를 보여준다.
const TIMEFRAMES = [
  { key: "3M",   label: "3개월", months: 3    },
  { key: "1Y",   label: "1년",   months: 12   },
  { key: "5Y",   label: "5년",   months: 60   },
  { key: "10Y",  label: "10년",  months: 120  },
  { key: "30Y",  label: "30년",  months: 360  },
  { key: "50Y",  label: "50년",  months: 600  },
  { key: "100Y", label: "100년", months: 1200 },
  { key: "ALL",  label: "전체",  months: null },
];

// 카드를 처음 열었을 때 보여줄 기본 타임프레임
const DEFAULT_TIMEFRAME_KEY = "1Y";


// 전역 상태: 이벤트 마커 표시 여부 + 각 카드의 "redraw" 콜백.
// 헤더 체크박스가 바뀌면 등록된 모든 카드가 자기 자신을 다시 그린다.
const APP_STATE = {
  showEvents: true,
  cardRedraws: [],  // 각 카드의 redraw() 함수 모음
};

// 탭 상태 관리
let _cachedData = null;
const _renderedTabs = new Set();

function switchToTab(tab) {
  // 첫 방문 시 해당 탭 컨텐츠를 지연 렌더링
  if (!_renderedTabs.has(tab) && _cachedData) {
    if (tab === "STOCKS") {
      renderStocksTab(_cachedData);
    } else {
      renderTabContent(tab, _cachedData);
    }
    _renderedTabs.add(tab);
  }
  // 패널 전환
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });
  document.getElementById(`panel-${tab}`).hidden = false;
  // 버튼 active 상태
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}


// ---------- 진입점 ------------------------------------------
//
// 데이터 저장 구조 (2026-04 이후):
//   data/index.json               — 메타데이터 + assessment
//   data/indicators/<CODE>.json   — 지표별 전체 payload
//   data/assets/<CODE>.json       — 자산별 전체 payload
//
// 각 파일이 독립 파일이라 수동 편집·가공이 쉬워진다.
// 페이지 로드 시 index + 모든 파일을 병렬로 가져와 단일 dict 로 합친다.
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const idxRes = await fetch("data/index.json", { cache: "no-cache" });
    if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
    const idx = await idxRes.json();

    const indicatorEntries = idx.indicators || [];
    const assetEntries     = idx.assets     || [];
    const stockEntries     = idx.stocks     || [];

    const fetchJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.json();
    });

    const [indicatorPayloads, assetPayloads, stockPayloads] = await Promise.all([
      Promise.all(indicatorEntries.map((e) => fetchJson(`data/indicators/${e.code}.json`))),
      Promise.all(assetEntries.map((e)     => fetchJson(`data/assets/${e.code}.json`))),
      Promise.all(stockEntries.map((e)     => fetchJson(`data/stocks/${e.code}.json`))),
    ]);

    const indicators = {};
    indicatorEntries.forEach((e, i) => { indicators[e.code] = indicatorPayloads[i]; });
    const assets = {};
    assetEntries.forEach((e, i) => { assets[e.code] = assetPayloads[i]; });
    const stocks = {};
    stockEntries.forEach((e, i) => { stocks[e.code] = stockPayloads[i]; });

    const data = {
      last_updated:  idx.last_updated,
      indicators,
      assets,
      stocks,
      assessment:    idx.assessment    || null,
      assessment_kr: idx.assessment_kr || null,
    };

    _cachedData = data;
    renderLastUpdated(data.last_updated);
    // US 탭 먼저 렌더링
    renderTabContent("US", data);
    _renderedTabs.add("US");
    // 탭 버튼 이벤트 연결
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
    });
    wireEventsToggle();
  } catch (err) {
    renderError(err);
  }
});

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
// tab: "US" | "KR" — 해당 탭의 지표와 assessment를 렌더링한다.
function renderTabContent(tab, data) {
  const indicators = data.indicators || {};
  const assets     = data.assets     || {};

  // 탭에 맞는 assessment 선택
  const assessment = tab === "US"
    ? (data.assessment    || null)
    : (data.assessment_kr || null);
  renderAssessment(assessment, tab);

  const growthHost    = document.getElementById(`growth-cards-${tab}`);
  const inflationHost = document.getElementById(`inflation-cards-${tab}`);
  const dollarHost    = document.getElementById(`dollar-cards-${tab}`);

  // 지표가 하나도 없으면 안내 메시지
  if (Object.keys(indicators).length === 0) {
    if (growthHost) growthHost.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions 를 실행해 주세요.");
    wireSectorNav(tab);
    return;
  }

  for (const [code, payload] of Object.entries(indicators)) {
    if (!payload.series || payload.series.length === 0) continue;
    const region = payload.region ?? "US";
    // US 탭: KR 이 아닌 지표, KR 탭: KR 지표만
    const belongsHere = tab === "US" ? region !== "KR" : region === tab;
    if (!belongsHere) continue;
    let host;
    if (payload.category === "growth") host = growthHost;
    else if (payload.category === "dollar") host = dollarHost;
    else host = inflationHost;
    if (host) host.appendChild(renderCard(code, payload, assets));
  }

  wireSectorNav(tab);
}

/** 섹터 서브탭(성장/인플레/달러) 버튼 클릭 → 해당 sector-panel 만 보이도록 토글. */
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

// 현재 국면 자동 판정 패널.
// assessment = { full, rolling_10y, config, trajectory }
// tab: "US" | "KR"
function renderAssessment(assessment, tab) {
  const section = document.getElementById(`assessment-${tab}`);
  if (!section) return;
  if (!assessment || !assessment.full || !assessment.rolling_10y) {
    section.hidden = true;
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

  // 분면이 두 창에서 다르면 그 자체가 레짐 전환 힌트 → 문구 생성
  const note = document.getElementById(`assessment-${tab}-note`);
  if (note) {
    const f = assessment.full;
    const s = assessment.rolling_10y;
    const qf = f.quadrant;
    const qs = s.quadrant;
    if (qf === qs) {
      note.textContent = `장기·단기 기준 모두 ${QUADRANT_LABEL[qf] || qf}. 분면 판정이 일관됨.`;
    } else {
      note.textContent = `장기 기준은 ${QUADRANT_LABEL[qf] || qf}, 단기 기준은 ${QUADRANT_LABEL[qs] || qs}. 두 창의 판정이 엇갈리면 레짐 전환 가능성에 주목.`;
    }
  }

  // 2D 산점도
  renderScatter(assessment, tab);
}

function renderScatter(assessment, tab) {
  const canvas = document.getElementById(`assessment-scatter-${tab}`);
  if (!canvas) return;
  const traj = assessment.trajectory || [];
  const cur  = assessment.full;

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
    date: "지금 (장기 기준)",
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
  if (canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }

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
  canvas._chart = new Chart(canvas, {
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

function renderCard(code, payload, assets) {
  const meta = INDICATOR_META[code] ?? {
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

  const changeStr   = formatChange(change, meta);
  const changeClass = change == null ? "" : change >= 0 ? "up" : "down";

  // 실제로 선택 가능한 타임프레임만 버튼으로 노출한다.
  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  // 비교 자산 select: 추천 / 관련 / 기타로 그룹화. assets 에 존재하는 코드만 옵션으로 노출.
  const compareSelectHtml = buildCompareSelectHtml(recs, assets);

  const badgesHtml = renderBadges(payload.current);

  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${meta.displayName}</span>
      <span class="card-code">${code}</span>
    </header>
    <div>
      <span class="card-value">${formatValue(latest.value, meta)}</span>
      <span class="card-change ${changeClass}" title="약 ${CHANGE_WINDOW_DAYS}일 전 대비">${changeStr}</span>
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
    const mainSliced = sliceSeriesByMonths(series, tf.months);

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
        const cmpSliced = sliceByDateRange(cmpPayload.series, rangeStart, rangeEnd);
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
  APP_STATE.cardRedraws.push(redraw);

  return card;
}

/** 비교 자산 select 의 <option> HTML 을 조립한다. 추천/관련/기타 순으로 그룹화. */
function buildCompareSelectHtml(recs, assets) {
  const availableCodes = new Set(
    Object.entries(assets)
      .filter(([, p]) => p.series && p.series.length > 0)
      .map(([code]) => code),
  );
  if (availableCodes.size === 0) {
    return `<option value="">비교 자산 데이터 없음</option>`;
  }

  const primary   = (recs.primary   || []).filter((c) => availableCodes.has(c));
  const secondary = (recs.secondary || []).filter((c) => availableCodes.has(c));
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
    group("추천 (4분면 프레임워크 기반)", primary),
    group("관련", secondary),
    group("기타 자산", others),
  ].join("");
}

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
  const available = TIMEFRAMES.filter((tf) => tf.months == null || tf.months <= spanMonths);
  // 가장 큰 타임프레임이 데이터 범위를 아예 초과하는 경우에도, "전체" 는 항상 제공.
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

function renderError(err) {
  document.querySelector("main").innerHTML =
    `<div class="error">데이터를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>`;
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
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const start = series.findIndex((p) => p.date >= cutoffStr);
  return start === -1 ? series.slice(-1) : series.slice(start);
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
  return new Chart(canvas, {
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


// ---------- 주식 탭 렌더링 -------------------------------------------

function renderStocksTab(data) {
  const stocks = data.stocks || {};
  const host   = document.getElementById("stock-cards");
  if (!host) return;

  if (Object.keys(stocks).length === 0) {
    host.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions를 실행해 주세요.");
    return;
  }

  for (const [ticker, payload] of Object.entries(stocks)) {
    if (!payload || !payload.series || payload.series.length === 0) continue;
    host.appendChild(renderStockCard(ticker, payload));
  }
}

function renderStockCard(ticker, payload) {
  const meta   = STOCK_META[ticker] ?? { displayName: ticker, fullName: ticker, sector: "", color: "#9aa0a9", decimals: 2 };
  const series = payload.series;
  const latest = series[series.length - 1];

  // 90일 전 대비 % 변화
  const prior = findPriorPoint(series, latest.date, 90);
  const changePct = prior ? ((latest.value - prior.value) / prior.value) * 100 : null;
  const changeClass = changePct == null ? "" : changePct >= 0 ? "up" : "down";
  const changeStr   = changePct == null
    ? "—"
    : `${changePct >= 0 ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}%`;

  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  const financials = payload.financials || { snapshot: {}, quarterly: [] };
  const snapshot   = financials.snapshot || {};
  const quarterly  = financials.quarterly || [];

  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${escapeHtml(meta.displayName)}</span>
      <span class="card-code">${escapeHtml(ticker)}</span>
    </header>
    <div>
      <span class="card-value">$${latest.value.toFixed(meta.decimals)}</span>
      <span class="card-change ${changeClass}" title="90일 전 대비">${changeStr}</span>
    </div>
    <p class="card-desc">${escapeHtml(meta.fullName)} · ${escapeHtml(meta.sector)}</p>
    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>

    ${renderStockMetricsHtml(snapshot)}
    ${quarterly.length > 0 ? `
      <div class="financials-header">
        <span>분기 실적 추세</span>
        <span class="financials-sub">매출 · 영업이익 · 순이익 (최근 ${quarterly.length}분기)</span>
      </div>
      <div class="card-chart financials-chart"><canvas></canvas></div>
    ` : ""}
  `;

  const mainCanvas = card.querySelector(".main-chart canvas");
  const tfSelector = card.querySelector(".tf-selector");

  const initialKey = availableFrames.some((tf) => tf.key === DEFAULT_TIMEFRAME_KEY)
    ? DEFAULT_TIMEFRAME_KEY
    : availableFrames[availableFrames.length - 1].key;
  const state = { tfKey: initialKey };
  let chartInstance = null;

  function redraw() {
    const tf = TIMEFRAMES.find((t) => t.key === state.tfKey) ?? TIMEFRAMES[TIMEFRAMES.length - 1];
    const sliced = sliceSeriesByMonths(series, tf.months);
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    chartInstance = renderChart(mainCanvas, sliced, "stock", {
      assetColor:  meta.color,
      primaryMeta: { decimals: meta.decimals, unit: "$", displayName: meta.displayName },
    });
  }

  tfSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    state.tfKey = btn.dataset.tf;
    tfSelector.querySelectorAll(".tf-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tf === state.tfKey)
    );
    redraw();
  });

  redraw();

  // 분기 실적 차트 — 카드가 DOM 에 붙기 전에 render 해도 Chart.js 는 동작함
  if (quarterly.length > 0) {
    const finCanvas = card.querySelector(".financials-chart canvas");
    if (finCanvas) renderFinancialsChart(finCanvas, quarterly);
  }

  return card;
}

// ─── 재무/실적 표시 헬퍼 ─────────────────────────────────────────────

function renderStockMetricsHtml(snap) {
  if (!snap || Object.values(snap).every((v) => v == null)) return "";
  const items = [
    { label: "시가총액",    value: formatLargeMoney(snap.market_cap) },
    { label: "P/E (TTM)",   value: formatRatio(snap.pe_ratio) },
    { label: "선행 P/E",    value: formatRatio(snap.forward_pe) },
    { label: "EPS (TTM)",   value: snap.eps_ttm == null ? "—" : `$${snap.eps_ttm.toFixed(2)}` },
    { label: "영업이익률",  value: formatPercent(snap.operating_margin) },
    { label: "순이익률",    value: formatPercent(snap.profit_margin) },
    { label: "ROE",         value: formatPercent(snap.return_on_equity) },
    { label: "배당수익률",  value: formatPercent(snap.dividend_yield) },
  ];
  return `
    <div class="stock-metrics">
      ${items.map((it) => `
        <div class="stock-metric">
          <span class="sm-label">${escapeHtml(it.label)}</span>
          <span class="sm-value">${escapeHtml(it.value)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderFinancialsChart(canvas, quarterly) {
  const labels = quarterly.map((q) => formatQuarterLabel(q.date));
  const toBillions = (v) => (v == null ? null : v / 1e9);

  const datasets = [
    {
      label: "매출",
      data: quarterly.map((q) => toBillions(q.revenue)),
      backgroundColor: "rgba(125, 211, 252, 0.75)",
      borderColor: "rgba(125, 211, 252, 1)",
      borderWidth: 1,
    },
    {
      label: "영업이익",
      data: quarterly.map((q) => toBillions(q.operating_income)),
      backgroundColor: "rgba(192, 132, 252, 0.75)",
      borderColor: "rgba(192, 132, 252, 1)",
      borderWidth: 1,
    },
    {
      label: "순이익",
      data: quarterly.map((q) => toBillions(q.net_income)),
      backgroundColor: "rgba(134, 239, 172, 0.75)",
      borderColor: "rgba(134, 239, 172, 1)",
      borderWidth: 1,
    },
  ];

  return new Chart(canvas.getContext("2d"), {
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
              return `${ctx.dataset.label}: $${v.toFixed(2)}B`;
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
            callback: (v) => `$${v}B`,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

function formatLargeMoney(n) {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
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
