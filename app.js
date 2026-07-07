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

// 개별 종목 UI 메타데이터.
//   - displayName / fullName: 카드 상단 표시명
//   - sector:   카드 부제 (한국어, 사업 모델 한 줄)
//   - group:    상위 섹터 묶음 헤더 (fetch_fred.py STOCKS 의 group 과 동일)
//   - color:    차트 라인 색
//   - decimals: 가격 소수점 자릿수 (KRW 등 정수 단위는 0)
//   - currency: "USD" (기본) | "KRW" — 가격 prefix·valuation 표시에 사용
//   - business: 초보자도 이해할 수 있는 사업 모델 한 줄 설명
const STOCK_META = {
  // ── 빅테크 / 소프트웨어 ─────────────────────────────────────
  AAPL: { displayName: "Apple", fullName: "Apple Inc.", group: "빅테크 / 소프트웨어", sector: "기술 (하드웨어 + 서비스)", color: "#9aa0a9", decimals: 2, currency: "USD", business: "아이폰·맥 등 하드웨어와 앱스토어·iCloud 같은 서비스. 매출 절반이 아이폰. 전 세계 가장 비싼 회사 (시총 1위권)." },
  MSFT: { displayName: "Microsoft", fullName: "Microsoft Corporation", group: "빅테크 / 소프트웨어", sector: "기술 (소프트웨어 + 클라우드)", color: "#00a4ef", decimals: 2, currency: "USD", business: "Windows·Office 라이선스 + 클라우드 Azure. 기업 SW 시장 절대강자. OpenAI 투자로 AI 시장 선두권." },
  GOOGL: { displayName: "Alphabet (Google)", fullName: "Alphabet Inc.", group: "빅테크 / 소프트웨어", sector: "통신 서비스 (광고 + 클라우드)", color: "#4285f4", decimals: 2, currency: "USD", business: "구글 검색·유튜브 광고가 매출의 약 75%. 클라우드(GCP)·자율주행(Waymo)·생성형 AI(Gemini) 보유." },
  AMZN: { displayName: "Amazon", fullName: "Amazon.com Inc.", group: "빅테크 / 소프트웨어", sector: "전자상거래 + 클라우드", color: "#ff9900", decimals: 2, currency: "USD", business: "세계 최대 전자상거래. 클라우드(AWS)는 매출 비중 작지만 영업이익의 절반 이상을 책임진다." },
  META: { displayName: "Meta", fullName: "Meta Platforms Inc.", group: "빅테크 / 소프트웨어", sector: "통신 서비스 (광고)", color: "#0082fb", decimals: 2, currency: "USD", business: "페이스북·인스타·왓츠앱 광고가 매출의 약 98%. VR(Quest)·AI 인프라에 대규모 투자 중." },
  ORCL: { displayName: "Oracle", fullName: "Oracle Corporation", group: "빅테크 / 소프트웨어", sector: "기술 (데이터베이스 + 클라우드)", color: "#f80000", decimals: 2, currency: "USD", business: "기업용 데이터베이스 절대강자. 최근 AI용 GPU 클라우드(OCI)에 공격 투자." },
  CRM: { displayName: "Salesforce", fullName: "Salesforce, Inc.", group: "빅테크 / 소프트웨어", sector: "B2B SaaS CRM 1위", color: "#00a1e0", decimals: 2, currency: "USD", business: "기업용 SaaS·CRM(고객관리) 1위. Slack·Tableau 등 인수로 확장. 'No Software' 슬로건의 클라우드 SW 대표주." },
  ADBE: { displayName: "Adobe", fullName: "Adobe Inc.", group: "빅테크 / 소프트웨어", sector: "크리에이티브 소프트웨어", color: "#ff0000", decimals: 2, currency: "USD", business: "포토샵·일러스트레이터·PDF(Acrobat) 절대 강자. 디자이너·마케터 표준 도구. 구독 전환 성공 사례." },
  IBM: { displayName: "IBM", fullName: "International Business Machines", group: "빅테크 / 소프트웨어", sector: "전통 엔터프라이즈 IT", color: "#0530ad", decimals: 2, currency: "USD", business: "100년+ 역사의 엔터프라이즈 IT. 메인프레임·컨설팅(IBM Consulting)·하이브리드 클라우드(Red Hat 인수)." },
  PLTR: { displayName: "Palantir", fullName: "Palantir Technologies Inc.", group: "빅테크 / 소프트웨어", sector: "정부·기업 데이터 분석 SW", color: "#cbd5e1", decimals: 2, currency: "USD", business: "정부·기업 데이터 분석 SW. 미국 국방·정보기관 핵심 공급사. AI 플랫폼 AIP 로 민간 확장 중." },
  // ── 반도체 — AI 칩 · 설계 ─────────────────────────────────────
  NVDA: { displayName: "NVIDIA", fullName: "NVIDIA Corporation", group: "반도체 — AI 칩 · 설계", sector: "AI 학습용 GPU 사실상 독점", color: "#76b900", decimals: 2, currency: "USD", business: "AI 학습용 GPU 시장 점유율 90%+. 매출 80% 이상이 데이터센터. ChatGPT 이후 AI 인프라 투자 최대 수혜주." },
  AMD: { displayName: "AMD", fullName: "Advanced Micro Devices", group: "반도체 — AI 칩 · 설계", sector: "CPU + GPU 종합 반도체", color: "#ed1c24", decimals: 2, currency: "USD", business: "CPU·GPU 동시 공급. NVIDIA 의 거의 유일한 AI 칩 경쟁자. 서버 CPU(EPYC)로 Intel 점유율 잠식 중." },
  INTC: { displayName: "Intel", fullName: "Intel Corporation", group: "반도체 — AI 칩 · 설계", sector: "x86 CPU 전통 강자 + 파운드리 도전", color: "#0071c5", decimals: 2, currency: "USD", business: "x86 CPU 전통 절대강자였으나 AMD·ARM 에 밀려 점유율 하락. 파운드리(18A)·첨단 패키징으로 재기 시도. 미국 정부 CHIPS 보조금 최대 수혜자." },
  QCOM: { displayName: "Qualcomm", fullName: "QUALCOMM Incorporated", group: "반도체 — AI 칩 · 설계", sector: "스마트폰 모뎀·SoC 프리미엄 1위", color: "#3253dc", decimals: 2, currency: "USD", business: "스마트폰 통신 모뎀·AP(Snapdragon) 프리미엄 1위. 안드로이드 진영 핵심. AI PC(Snapdragon X)·자동차(Ride)로 확장." },
  AVGO: { displayName: "Broadcom", fullName: "Broadcom Inc.", group: "반도체 — AI 칩 · 설계", sector: "커스텀 AI ASIC 1위 (~60%)", color: "#e60024", decimals: 2, currency: "USD", business: "하이퍼스케일러 커스텀 AI ASIC 코디자인 1위 (Google·Meta·OpenAI) + 머천트 스위치 칩(Tomahawk) + VMware 인프라 SW. ASIC 시대의 최대 수혜." },
  MRVL: { displayName: "Marvell", fullName: "Marvell Technology, Inc.", group: "반도체 — AI 칩 · 설계", sector: "커스텀 AI ASIC 2위 (~25%)", color: "#de3163", decimals: 2, currency: "USD", business: "하이퍼스케일러 커스텀 AI ASIC 코디자인 2위 (Amazon Trainium·Microsoft). 광 DSP·DPU·인터커넥트 실리콘 — Broadcom 과 함께 ASIC 양강." },
  "2454.TW": { displayName: "MediaTek", fullName: "MediaTek Inc.", group: "반도체 — AI 칩 · 설계", sector: "모바일 AP 물량 1위 (~40%)", color: "#f7a600", decimals: 0, currency: "TWD", business: "스마트폰 AP-SoC 물량 세계 1위 (~40%, Dimensity). 온디바이스 AI 폰의 중저가 확산 축 + Google TPU v8 설계 참여설 등 ASIC 확장." },
  MBLY: { displayName: "Mobileye", fullName: "Mobileye Global Inc.", group: "반도체 — AI 칩 · 설계", sector: "카메라 ADAS 칩 ~65%", color: "#0b67b2", decimals: 2, currency: "USD", business: "카메라 기반 ADAS 칩·SW 점유율 ~65% (Intel 자회사). EyeQ 칩 누적 출하 2억개 — 자율주행 L2+→L4 전환기 차량용 AI 칩의 기준 종목." },
  SNPS: { displayName: "Synopsys", fullName: "Synopsys, Inc.", group: "반도체 — AI 칩 · 설계", sector: "EDA (설계 자동화 SW) 1위", color: "#5a2d81", decimals: 2, currency: "USD", business: "칩 설계 자동화(EDA) 1위 + 설계 IP 2위. Cadence 와 듀오폴리(합산 ~60%) — AI 칩 설계 복잡도 급증의 구조적 관문. 대중 수출통제 지렛대." },
  CDNS: { displayName: "Cadence", fullName: "Cadence Design Systems", group: "반도체 — AI 칩 · 설계", sector: "EDA 2위 (Synopsys 와 양강)", color: "#d42e34", decimals: 2, currency: "USD", business: "EDA 양강. AI 기반 설계 자동화(Cerebrus)·검증·시뮬레이션 강자 — 커스텀 ASIC 붐과 칩 설계 스타트업 증가의 직접 수혜." },
  ARM: { displayName: "Arm", fullName: "Arm Holdings plc", group: "반도체 — AI 칩 · 설계", sector: "CPU IP · ISA 사실상 표준", color: "#0091bd", decimals: 2, currency: "USD", business: "모바일 CPU IP ~99% + 서버·엣지로 확장 중인 ISA 표준. 칩이 팔릴 때마다 로열티를 수취하는 'toll booth' 모델. 소프트뱅크 지배." },
  // ── 반도체 — 메모리 (HBM·DRAM) ─────────────────────────────────────
  "005930.KS": { displayName: "삼성전자", fullName: "Samsung Electronics", group: "반도체 — 메모리 (HBM·DRAM)", sector: "메모리 1위 + 파운드리 + AP", color: "#1428a0", decimals: 0, currency: "KRW", business: "DRAM·NAND 세계 1위 종합 반도체. HBM4 Rubin 인증으로 SK 추격 + 파운드리 2nm GAA + 엑시노스 AP — 시장지도의 메모리·파운드리·AP 세 노드에 동시 등장하는 유일 기업." },
  "000660.KS": { displayName: "SK하이닉스", fullName: "SK Hynix", group: "반도체 — 메모리 (HBM·DRAM)", sector: "HBM 세계 1위 (~62%)", color: "#ec1c24", decimals: 0, currency: "KRW", business: "HBM 점유율 ~62% 세계 1위 — HBM4 를 NVIDIA 에 최초 인증·양산. MR-MUF 적층 공정 수율 우위. AI 메모리 슈퍼사이클의 최대 수혜주. DRAM 2위 + Solidigm NAND." },
  MU: { displayName: "Micron", fullName: "Micron Technology, Inc.", group: "반도체 — 메모리 (HBM·DRAM)", sector: "메모리 3강 · HBM ~21%", color: "#00a85b", decimals: 2, currency: "USD", business: "메모리(DRAM·NAND) 글로벌 3강. HBM 점유율 ~21%, ’26 물량 완판 — 미국 유일 메모리 제조사로 지정학 수혜." },
  // ── 반도체 — 파운드리 · 패키징 · 기판 ─────────────────────────────────────
  TSM: { displayName: "TSMC", fullName: "Taiwan Semiconductor Mfg.", group: "반도체 — 파운드리 · 패키징 · 기판", sector: "세계 1위 파운드리 + CoWoS 지배", color: "#d11919", decimals: 2, currency: "USD", business: "세계 1위 반도체 파운드리 (선단 ≤5nm 90%+). 애플·NVIDIA·AMD 핵심 칩을 거의 다 제조 + CoWoS 첨단 패키징 지배 — AI 칩 밸류체인의 단일 관문." },
  AMKR: { displayName: "Amkor", fullName: "Amkor Technology, Inc.", group: "반도체 — 파운드리 · 패키징 · 기판", sector: "OSAT 2위 · 美 첨단 패키징 증설", color: "#e87722", decimals: 2, currency: "USD", business: "패키징·테스트 외주(OSAT) 세계 2위. TSMC CoWoS 오버플로 2차 공급 + 애리조나 첨단 패키징 공장 — 미국 내 패키징 리쇼어링의 핵심." },
  "4062.T": { displayName: "Ibiden", fullName: "Ibiden Co., Ltd.", group: "반도체 — 파운드리 · 패키징 · 기판", sector: "최고급 ABF 기판 (NVIDIA 향)", color: "#1b5faa", decimals: 0, currency: "JPY", business: "AI 서버용 최고급 ABF 기판 양강 (NVIDIA 주공급). ’26 고급 ABF 공급부족 전환의 최대 수혜 — 기판이 패키징 다음의 2차 병목." },
  // ── 반도체 — 장비 · 소재 ─────────────────────────────────────
  ASML: { displayName: "ASML", fullName: "ASML Holding N.V.", group: "반도체 — 장비 · 소재", sector: "노광장비 (EUV) 글로벌 독점", color: "#0091da", decimals: 2, currency: "USD", business: "반도체 미세공정의 핵심 노광장비 (EUV/High-NA) 글로벌 100% 독점 (네덜란드). 전 밸류체인에서 구조적으로 가장 단단한 병목. 1대 약 4억 달러." },
  AMAT: { displayName: "Applied Materials", fullName: "Applied Materials, Inc.", group: "반도체 — 장비 · 소재", sector: "반도체 장비 종합 1위", color: "#0095da", decimals: 2, currency: "USD", business: "반도체 장비 종합 1위 (식각·증착 등). 메모리·로직 모든 공정에 폭넓게 공급. 반도체 capex 사이클의 거울." },
  LRCX: { displayName: "Lam Research", fullName: "Lam Research Corp.", group: "반도체 — 장비 · 소재", sector: "반도체 장비 (식각·증착)", color: "#10b981", decimals: 2, currency: "USD", business: "반도체 식각·증착 장비 강자. 메모리(DRAM·NAND)·HBM TSV 공정에 특히 강세. 한국 삼성·SK 가 큰 고객." },
  TOELY: { displayName: "Tokyo Electron", fullName: "Tokyo Electron Limited", group: "반도체 — 장비 · 소재", sector: "일본 1위 장비 (코터 독점)", color: "#9e1b32", decimals: 2, currency: "USD", business: "일본 1위 반도체 장비. EUV 포토레지스트 코터/디벨로퍼 사실상 독점 + 식각·증착. 글로벌 WFE 4강 (ADR)." },
  KLAC: { displayName: "KLA", fullName: "KLA Corporation", group: "반도체 — 장비 · 소재", sector: "계측·검사 ~74% 준독점", color: "#0067b1", decimals: 2, currency: "USD", business: "계측·검사 장비 ~74% 준독점. AI 칩 복잡도·수율 비용 상승의 구조적 수혜 — GAA·HBM 수율 전쟁의 무기상." },
  "042700.KS": { displayName: "한미반도체", fullName: "Hanmi Semiconductor", group: "반도체 — 장비 · 소재", sector: "HBM TC 본더 세계 1위", color: "#0aa5c2", decimals: 0, currency: "KRW", business: "HBM 적층용 TC 본더 세계 1위 — SK하이닉스·마이크론 공급. 적층 수율(=HBM 병목)의 심장인 본딩 장비를 쥔 국내 최대 수혜 장비주." },
  "6857.T": { displayName: "Advantest", fullName: "Advantest Corporation", group: "반도체 — 장비 · 소재", sector: "반도체 테스터 세계 1위", color: "#e8380d", decimals: 0, currency: "JPY", business: "반도체 테스터 세계 1위 (Teradyne 과 양강). HBM 스택 전수 테스트 + AI SoC 테스트 시간 증가가 구조적 순풍." },
  "6146.T": { displayName: "DISCO", fullName: "DISCO Corporation", group: "반도체 — 장비 · 소재", sector: "그라인더·다이서 독점적 1위", color: "#2f7d32", decimals: 0, currency: "JPY", business: "웨이퍼를 얇게 갈고(그라인더) 자르는(다이서) 장비 70~80% 독점적 1위. HBM 12·16단 적층의 초박형 다이 가공 필수 — 첨단 패키징의 숨은 관문." },
  "BESI.AS": { displayName: "BESI", fullName: "BE Semiconductor Industries", group: "반도체 — 장비 · 소재", sector: "하이브리드 본딩 장비 선두", color: "#7a3ea8", decimals: 2, currency: "EUR", business: "어드밴스드 패키징용 하이브리드 본딩 장비 선두 (Applied Materials 제휴). HBM4E·SoIC 세대의 칩렛 적층 전환 수혜 — 유럽 소형 강자." },
  "4063.T": { displayName: "Shin-Etsu", fullName: "Shin-Etsu Chemical", group: "반도체 — 장비 · 소재", sector: "실리콘 웨이퍼 1위 + 레지스트", color: "#b5121b", decimals: 0, currency: "JPY", business: "실리콘 웨이퍼 세계 1위 (SUMCO 와 듀오폴리) + 포토레지스트 강자. 소재 노드의 지정학 리스크(일본 >90% 집중)를 대표하는 종목." },
  // ── AI 인프라 — 네트워킹 · 광 · 네오클라우드 ─────────────────────────────────────
  ANET: { displayName: "Arista", fullName: "Arista Networks, Inc.", group: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", sector: "AI 이더넷 스위치 1위", color: "#2a5caa", decimals: 2, currency: "USD", business: "데이터센터 이더넷 스위치 1위권 (~19%). AI 백엔드 네트워크의 이더넷 전환(InfiniBand 대체) 최대 수혜 — 하이퍼스케일러가 주고객." },
  COHR: { displayName: "Coherent", fullName: "Coherent Corp.", group: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", sector: "광 트랜시버·CPO 수직통합", color: "#00a870", decimals: 2, currency: "USD", business: "800G/1.6T 광 트랜시버 수직통합 강자 + NVIDIA CPO 파트너. GPU 클러스터 확장의 병목이 구리→광으로 이동하는 국면의 수혜." },
  MPWR: { displayName: "Monolithic Power", fullName: "Monolithic Power Systems", group: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", sector: "GPU 전력전달 'last inch'", color: "#0a66a0", decimals: 2, currency: "USD", business: "고밀도 전원관리 반도체(PMIC) 강자. GPU 랙 전력밀도 급증(랙 100kW→MW급)의 'last inch' 전력전달 — NVIDIA 전력 체인 핵심." },
  CRWV: { displayName: "CoreWeave", fullName: "CoreWeave, Inc.", group: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", sector: "네오클라우드 1위", color: "#6b46c1", decimals: 2, currency: "USD", business: "최대 독립 GPU 클라우드 — 계약 잔고 $99B+. NVIDIA 앵커 투자 + MS·OpenAI 대형 계약. GPU 담보 부채의 순환금융 구조가 핵심 리스크." },
  NBIS: { displayName: "Nebius", fullName: "Nebius Group N.V.", group: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", sector: "네오클라우드 2위권", color: "#00a8a8", decimals: 2, currency: "USD", business: "구 Yandex 분할 네오클라우드. Meta $27B·MS 계약으로 잔고 ~$50B, 계약전력 3GW+ — 'GPU 확보전 → 전력 전쟁' 국면의 선두권." },
  // ── 로보틱스 / 피지컬 AI ─────────────────────────────────────
  TER: { displayName: "TER", fullName: "Teradyne, Inc.", group: "로보틱스 / 피지컬 AI", sector: "반도체 테스트 + 협동로봇", color: "#e31837", decimals: 2, currency: "USD", business: "반도체 자동시험장비(ATE) 양강 + 협동로봇(Universal Robots)·자율이동로봇(MiR). AI 칩 테스트 수요와 피지컬 AI 양쪽에 걸친 이중 노출." },
  HSAI: { displayName: "HSAI", fullName: "Hesai Group", group: "로보틱스 / 피지컬 AI", sector: "라이다 출하 세계 1위", color: "#0084ff", decimals: 2, currency: "USD", business: "차량 ADAS·로보틱스용 라이다 출하 세계 1위(연 160만개+, 첫 흑자전환). 로봇향 출하 +400%대 폭증 — 휴머노이드·로보택시의 '눈'." },
  MP: { displayName: "MP", fullName: "MP Materials Corp.", group: "로보틱스 / 피지컬 AI", sector: "비중국 희토류·자석 수직계열화", color: "#b87333", decimals: 2, currency: "USD", business: "미국 유일 희토류 채굴(Mountain Pass)→정제→네오디뮴 자석 수직계열화. 美 국방부 지분 투자. 로봇 모터·액추에이터 핵심 소재 NdPr 자석의 비중국 대안." },
  "6954.T": { displayName: "FANUC", fullName: "FANUC Corporation", group: "로보틱스 / 피지컬 AI", sector: "산업용 로봇 글로벌 1위권", color: "#e0b400", decimals: 0, currency: "JPY", business: "산업용 로봇·CNC 글로벌 1위권 (4강 합산 55%+). 공장 자동화의 기준 종목 — 중국 로컬 추월 압박 속 AI 코봇·피지컬 AI 통합이 반전 카드." },
  "6324.T": { displayName: "Harmonic Drive", fullName: "Harmonic Drive Systems", group: "로보틱스 / 피지컬 AI", sector: "하모닉 감속기 세계 1위", color: "#4a7ab5", decimals: 0, currency: "JPY", business: "스트레인 웨이브(하모닉) 감속기 세계 1위. 휴머노이드 1대당 감속기·액추에이터 30~40개 — 로봇 구동부품 구조적 병목의 핵심 수혜." },
  // ── 자동차 / 모빌리티 ─────────────────────────────────────
  TSLA: { displayName: "Tesla", fullName: "Tesla Inc.", group: "자동차 / 모빌리티", sector: "전기차 + 에너지 + 자율주행", color: "#cc0000", decimals: 2, currency: "USD", business: "전기차 매출 위주. 에너지 저장(Megapack)·자율주행(FSD)·로봇(Optimus) 개발 중. CEO 일론 머스크 영향력 큼." },
  TM: { displayName: "Toyota", fullName: "Toyota Motor Corporation", group: "자동차 / 모빌리티", sector: "글로벌 1위 완성차", color: "#eb0a1e", decimals: 2, currency: "USD", business: "글로벌 판매량 1위 완성차 (일본). 하이브리드(프리우스) 강자. EV 전환은 상대적으로 보수적." },
  F: { displayName: "Ford", fullName: "Ford Motor Company", group: "자동차 / 모빌리티", sector: "미국 빅3 (Ford F-150)", color: "#003478", decimals: 2, currency: "USD", business: "미국 빅3 완성차. 픽업트럭 F-150 절대 강자. EV(F-150 Lightning, Mustang Mach-E) 와 내연기관 병행." },
  GM: { displayName: "GM", fullName: "General Motors Company", group: "자동차 / 모빌리티", sector: "미국 빅3 (Chevrolet, Cadillac)", color: "#005daa", decimals: 2, currency: "USD", business: "미국 빅3 완성차 (Chevrolet·Cadillac·GMC). EV 플랫폼 Ultium 전개. 자율주행 자회사 Cruise." },
  STLA: { displayName: "Stellantis", fullName: "Stellantis N.V.", group: "자동차 / 모빌리티", sector: "Chrysler·Peugeot·Fiat 통합", color: "#1a3a6e", decimals: 2, currency: "USD", business: "Chrysler·Peugeot·Fiat·Jeep 등 14 브랜드를 가진 글로벌 4위 자동차 그룹 (2021 합병)." },
  HMC: { displayName: "Honda", fullName: "Honda Motor Co., Ltd.", group: "자동차 / 모빌리티", sector: "Honda — 일본 2위 완성차", color: "#cc0000", decimals: 2, currency: "USD", business: "일본 2위 완성차. 자동차 + 오토바이 (오토바이는 글로벌 1위). 하이브리드·F1 엔진 기술 강자." },
  RIVN: { displayName: "Rivian", fullName: "Rivian Automotive, Inc.", group: "자동차 / 모빌리티", sector: "미국 EV 픽업트럭 스타트업", color: "#ffc814", decimals: 2, currency: "USD", business: "미국 EV 픽업트럭·SUV 스타트업 (2021 상장). 아마존이 배송 밴 10만대 주문, 폭스바겐과 합작사 설립." },
  NIO: { displayName: "NIO", fullName: "NIO Inc.", group: "자동차 / 모빌리티", sector: "중국 프리미엄 EV 대표", color: "#00a8e1", decimals: 2, currency: "USD", business: "중국 프리미엄 EV 대표주 (NIO ES8 등). 배터리 교환(스왑) 스테이션 차별화. 정부 보조 / 가격경쟁 변수." },
  "005380.KS": { displayName: "현대차", fullName: "Hyundai Motor Company", group: "자동차 / 모빌리티", sector: "한국 1위 완성차", color: "#002c5f", decimals: 0, currency: "KRW", business: "한국 1위 완성차. EV(아이오닉)·수소차(넥쏘) 동시 추진. 정의선 회장 지휘 하 미국·인도 시장 성장." },
  "000270.KS": { displayName: "기아", fullName: "Kia Corporation", group: "자동차 / 모빌리티", sector: "한국 2위 완성차 (현대차그룹)", color: "#bb162b", decimals: 0, currency: "KRW", business: "한국 2위 완성차 (현대차그룹). EV6·EV9 등 EV 라인업 호평. 디자인 경쟁력 + 미국 시장 점유율 확대." },
  // ── 바이오 / 제약 / 헬스케어 ─────────────────────────────────────
  LLY: { displayName: "Eli Lilly", fullName: "Eli Lilly and Company", group: "바이오 / 제약 / 헬스케어", sector: "비만 / 당뇨 치료제 글로벌 1위", color: "#d52b1e", decimals: 2, currency: "USD", business: "비만치료제(GLP-1) 시장 1위. Zepbound·Mounjaro 매출 폭발로 시총 1조 달러 돌파. 알츠하이머·항암제도 보유." },
  NVO: { displayName: "Novo Nordisk", fullName: "Novo Nordisk A/S", group: "바이오 / 제약 / 헬스케어", sector: "비만 / 당뇨 치료제 양대산맥", color: "#0066cc", decimals: 2, currency: "USD", business: "덴마크 제약사. Ozempic·Wegovy 등 비만/당뇨 치료제로 Eli Lilly 와 양대산맥. 유럽 시총 1위." },
  JNJ: { displayName: "J&J", fullName: "Johnson & Johnson", group: "바이오 / 제약 / 헬스케어", sector: "종합 헬스케어 (제약 + 의료기기)", color: "#d51b25", decimals: 2, currency: "USD", business: "세계 최대 종합 헬스케어. 제약 + 의료기기. 60년 연속 배당 증가의 대표 배당귀족(Dividend King)." },
  PFE: { displayName: "Pfizer", fullName: "Pfizer Inc.", group: "바이오 / 제약 / 헬스케어", sector: "글로벌 제약 + COVID 백신", color: "#0093d0", decimals: 2, currency: "USD", business: "글로벌 메이저 제약사. COVID-19 백신(Comirnaty)·치료제(Paxlovid)로 팬데믹 수혜 후 정상화 중. 항암제·심혈관." },
  MRK: { displayName: "Merck", fullName: "Merck & Co., Inc.", group: "바이오 / 제약 / 헬스케어", sector: "항암제 키트루다 글로벌 1위", color: "#00857c", decimals: 2, currency: "USD", business: "면역항암제 키트루다(Keytruda) 글로벌 매출 1위 의약품 (연 매출 ~$25B). 2028 특허 만료가 핵심 변수." },
  ABBV: { displayName: "AbbVie", fullName: "AbbVie Inc.", group: "바이오 / 제약 / 헬스케어", sector: "면역질환 (휴미라 후속)", color: "#071d49", decimals: 2, currency: "USD", business: "면역질환 치료제 강자. 휴미라(Humira) 특허 만료 후 Skyrizi·Rinvoq 등 후속 신약으로 성공적 전환." },
  AZN: { displayName: "AstraZeneca", fullName: "AstraZeneca PLC", group: "바이오 / 제약 / 헬스케어", sector: "영국 제약 메이저 (항암·호흡기)", color: "#830051", decimals: 2, currency: "USD", business: "영국 메이저 제약사. 항암제·호흡기·심혈관 강세. COVID 백신 개발. 미국 시장 진출 확대." },
  UNH: { displayName: "UnitedHealth", fullName: "UnitedHealth Group", group: "바이오 / 제약 / 헬스케어", sector: "미국 1위 의료보험 + 헬스케어", color: "#4c8cf8", decimals: 2, currency: "USD", business: "미국 최대 의료보험사. 보험(UnitedHealthcare) + 의료서비스(Optum) 결합. 미국 의료비 인플레이션의 핵심 종목." },
  TMO: { displayName: "Thermo Fisher", fullName: "Thermo Fisher Scientific", group: "바이오 / 제약 / 헬스케어", sector: "진단·실험 장비 1위", color: "#0086c9", decimals: 2, currency: "USD", business: "세계 1위 과학 연구 / 진단 장비·시약 공급사. 제약사·연구소·진단검사센터가 모두 고객. M&A 로 성장." },
  ABT: { displayName: "Abbott", fullName: "Abbott Laboratories", group: "바이오 / 제약 / 헬스케어", sector: "의료기기 + 진단 + 영양식품", color: "#0090d0", decimals: 2, currency: "USD", business: "의료기기(연속혈당측정기 Freestyle Libre)·진단·영양식품·일반약. JNJ 와 함께 종합 헬스케어 대표." },
  // ── 에너지 / 원자재 ─────────────────────────────────────
  XOM: { displayName: "ExxonMobil", fullName: "Exxon Mobil Corporation", group: "에너지 / 원자재", sector: "세계 최대 민간 석유·가스 메이저", color: "#cf0a2c", decimals: 2, currency: "USD", business: "세계 최대 민간 석유·가스 회사. 상류(탐사·생산)부터 하류(정제·화학)까지 수직통합. 유가·인플레이션 직접 수혜." },
  CVX: { displayName: "Chevron", fullName: "Chevron Corporation", group: "에너지 / 원자재", sector: "미국 2위 석유 메이저", color: "#1e4d93", decimals: 2, currency: "USD", business: "미국 2위 석유 메이저. 상·하류 수직통합. 배당귀족(36년 연속 증가). 워런 버핏 대규모 보유." },
  COP: { displayName: "ConocoPhillips", fullName: "ConocoPhillips", group: "에너지 / 원자재", sector: "북미 상류 (탐사·생산) 전문", color: "#e51937", decimals: 2, currency: "USD", business: "미국 최대 상류(E&P) 전문 회사. 정제 사업 없이 탐사·생산만. 셰일 + 알래스카 + 카타르 LNG." },
  SHEL: { displayName: "Shell", fullName: "Shell plc", group: "에너지 / 원자재", sector: "Shell — 유럽 메이저", color: "#fbce07", decimals: 2, currency: "USD", business: "영국·네덜란드 본사 유럽 최대 석유 메이저. 천연가스(LNG) 글로벌 1위 거래 회사. 신재생 점진적 전환." },
  OXY: { displayName: "Occidental", fullName: "Occidental Petroleum", group: "에너지 / 원자재", sector: "셰일 + 버핏 핵심 보유", color: "#cc092f", decimals: 2, currency: "USD", business: "미국 셰일 오일 강자 (퍼미안 분지). 워런 버핏이 28% 보유. CCUS(탄소 포집) 기술 투자." },
  SLB: { displayName: "Schlumberger", fullName: "Schlumberger Limited", group: "에너지 / 원자재", sector: "유전 서비스 글로벌 1위", color: "#0080c8", decimals: 2, currency: "USD", business: "유전 서비스(시추·물리탐사·완결) 글로벌 1위. 석유·가스 회사가 사업 영위하려면 거치는 'toll booth'." },
  FCX: { displayName: "Freeport-McMoRan", fullName: "Freeport-McMoRan Inc.", group: "에너지 / 원자재", sector: "세계 최대 구리 광산회사", color: "#fa9000", decimals: 2, currency: "USD", business: "세계 최대 구리 광산회사. 전기차·신재생에너지 확대로 구리 수요가 핵심 모멘텀. 금도 일부 생산." },
  NEM: { displayName: "Newmont", fullName: "Newmont Corporation", group: "에너지 / 원자재", sector: "세계 최대 금광 회사", color: "#c8a032", decimals: 2, currency: "USD", business: "세계 최대 금광 회사. 인플레이션·달러 약세·중앙은행 금 매입 수요의 직접 수혜. 금 가격에 연동." },
  LIN: { displayName: "Linde", fullName: "Linde plc", group: "에너지 / 원자재", sector: "산업용 가스 글로벌 1위", color: "#0072c6", decimals: 2, currency: "USD", business: "산업용 가스(질소·산소·수소) 글로벌 1위. 반도체·헬스케어·화학 등 제조업의 필수 인프라." },
  APD: { displayName: "Air Products", fullName: "Air Products & Chemicals", group: "에너지 / 원자재", sector: "산업용 가스 + 청정수소 투자", color: "#1c98d3", decimals: 2, currency: "USD", business: "산업용 가스 글로벌 2위. 수소 경제(청정수소) 적극 투자. 사우디 NEOM 그린수소 프로젝트 참여." },
  // ── 금융 ─────────────────────────────────────
  JPM: { displayName: "JPMorgan", fullName: "JPMorgan Chase & Co.", group: "금융", sector: "미국 1위 은행 (소매+IB+자산운용)", color: "#5b8def", decimals: 2, currency: "USD", business: "미국 1위 은행. 소비자 금융 + 투자은행(JP Morgan) + 자산운용 결합. 금리·경기 사이클의 대표 종목." },
  BAC: { displayName: "Bank of America", fullName: "Bank of America Corp.", group: "금융", sector: "미국 2위 은행 (소매 중심)", color: "#e31837", decimals: 2, currency: "USD", business: "미국 2위 은행. 소매 금융 중심. 워런 버핏 핵심 보유 종목. 금리 상승 수혜 (NIM 확대)." },
  WFC: { displayName: "Wells Fargo", fullName: "Wells Fargo & Company", group: "금융", sector: "미국 4대 은행 (소매·모기지)", color: "#d71e2b", decimals: 2, currency: "USD", business: "미국 4대 은행. 소매·모기지 중심. 2016 가짜계좌 스캔들 후 자산 상한 규제 받음 → 최근 해제 기대." },
  C: { displayName: "Citigroup", fullName: "Citigroup Inc.", group: "금융", sector: "글로벌 진출 미국 은행", color: "#005baa", decimals: 2, currency: "USD", business: "미국 4대 은행 중 가장 글로벌화된 은행 (100+ 국가). 트랜잭션 뱅킹·기관 사업 강세." },
  GS: { displayName: "Goldman Sachs", fullName: "The Goldman Sachs Group", group: "금융", sector: "투자은행 1위 (M&A·트레이딩)", color: "#7a89a4", decimals: 2, currency: "USD", business: "글로벌 투자은행 1위. M&A 자문·트레이딩·자산운용. IPO·M&A 사이클에 가장 민감한 종목." },
  MS: { displayName: "Morgan Stanley", fullName: "Morgan Stanley", group: "금융", sector: "투자은행 2위 + 자산관리", color: "#0066b3", decimals: 2, currency: "USD", business: "투자은행 2위. ETrade 인수로 wealth management 비중 확대 → 수익 안정성 개선." },
  V: { displayName: "Visa", fullName: "Visa Inc.", group: "금융", sector: "글로벌 결제 네트워크 1위", color: "#7c8cf5", decimals: 2, currency: "USD", business: "글로벌 결제 네트워크 1위. 카드 결제마다 수수료를 가져가는 'toll booth' 비즈니스. 영업이익률 60%대." },
  MA: { displayName: "Mastercard", fullName: "Mastercard Incorporated", group: "금융", sector: "글로벌 결제 네트워크 2위", color: "#eb001b", decimals: 2, currency: "USD", business: "글로벌 결제 네트워크 2위. Visa 와 사실상 양강. 신용·체크·디지털 결제. 크로스보더 결제 성장." },
  AXP: { displayName: "Amex", fullName: "American Express Company", group: "금융", sector: "고급 신용카드 (Closed-loop)", color: "#016fd0", decimals: 2, currency: "USD", business: "고급 신용카드 (Centurion·Platinum). 카드망·발행·가맹 통합(Closed-loop). 워런 버핏 핵심 보유." },
  "BRK-B": { displayName: "Berkshire (B)", fullName: "Berkshire Hathaway Inc. (Class B)", group: "금융", sector: "워런 버핏 지주회사", color: "#a3a3a3", decimals: 2, currency: "USD", business: "워런 버핏의 지주회사. 보험(Geico) + 철도(BNSF) + 에너지 + 주식 포트폴리오(애플 비중 큼). 배당 없음." },
  // ── 소비재 ─────────────────────────────────────
  WMT: { displayName: "Walmart", fullName: "Walmart Inc.", group: "소비재", sector: "세계 최대 소매 유통", color: "#0071ce", decimals: 2, currency: "USD", business: "세계 최대 소매 유통. 미국 가구 90%가 매장 10마일 내 거주. e-commerce 로 Amazon 추격, 광고 사업으로 마진 확대." },
  COST: { displayName: "Costco", fullName: "Costco Wholesale", group: "소비재", sector: "회원제 창고형 매장", color: "#e31837", decimals: 2, currency: "USD", business: "회원제 창고형 매장. 멤버십 수수료가 영업이익의 70%+, 갱신율 90%대로 매우 충성도 높음. 인플레이션 방어 종목." },
  KO: { displayName: "Coca-Cola", fullName: "The Coca-Cola Company", group: "소비재", sector: "글로벌 음료 절대강자", color: "#f40009", decimals: 2, currency: "USD", business: "200여 개국 판매 글로벌 음료 강자. 60년 연속 배당 증가 배당귀족. 워런 버핏 핵심 보유 종목." },
  PEP: { displayName: "PepsiCo", fullName: "PepsiCo, Inc.", group: "소비재", sector: "음료 + 스낵 (Frito-Lay)", color: "#004b93", decimals: 2, currency: "USD", business: "음료(펩시) + 스낵(Frito-Lay, Lay's, Doritos). 스낵 사업이 음료보다 큼. 배당귀족." },
  PG: { displayName: "P&G", fullName: "Procter & Gamble Co.", group: "소비재", sector: "생활용품 글로벌 1위", color: "#003da5", decimals: 2, currency: "USD", business: "생활용품 글로벌 1위 (질레트·팬틴·페브리즈·다우니 등 65개+ 브랜드). 65년 연속 배당 증가 배당귀족." },
  MO: { displayName: "Altria", fullName: "Altria Group, Inc.", group: "소비재", sector: "미국 담배 1위 (Marlboro)", color: "#005826", decimals: 2, currency: "USD", business: "미국 담배 1위 (Marlboro 브랜드). 50+년 연속 배당 증가. 배당수익률 7%대로 인컴주 대표. ESG 관점 호불호." },
  MCD: { displayName: "McDonald's", fullName: "McDonald's Corporation", group: "소비재", sector: "글로벌 패스트푸드 1위", color: "#ffc72c", decimals: 2, currency: "USD", business: "글로벌 패스트푸드 1위. 사실상 부동산 임대업(가맹점에 부지 임대). 배당귀족 47년 연속 증가." },
  HD: { displayName: "Home Depot", fullName: "The Home Depot, Inc.", group: "소비재", sector: "미국 1위 홈임프루브먼트", color: "#f96302", decimals: 2, currency: "USD", business: "미국 1위 홈임프루브먼트 매장 (Lowe's 와 양대). DIY + 프로용. 주택 시장·금리에 민감." },
  NKE: { displayName: "Nike", fullName: "NIKE, Inc.", group: "소비재", sector: "스포츠웨어 글로벌 1위", color: "#fa5400", decimals: 2, currency: "USD", business: "스포츠웨어 글로벌 1위. 운동화·의류·용품. D2C 강화 + 중국 시장 회복이 핵심 변수." },
  SBUX: { displayName: "Starbucks", fullName: "Starbucks Corporation", group: "소비재", sector: "글로벌 커피 체인 1위", color: "#006241", decimals: 2, currency: "USD", business: "글로벌 커피 체인 1위. 중국 시장 회복·국내 가격 경쟁이 주가 변수. 모바일 주문·로열티 프로그램 강세." },
  // ── 산업재 / 방산 ─────────────────────────────────────
  CAT: { displayName: "Caterpillar", fullName: "Caterpillar Inc.", group: "산업재 / 방산", sector: "세계 1위 건설·광산 장비", color: "#ffcd11", decimals: 2, currency: "USD", business: "세계 1위 건설·광산 장비 제조. 글로벌 인프라 투자·자원개발 사이클의 대표주. 농업·엔진 사업도 운영." },
  DE: { displayName: "John Deere", fullName: "Deere & Company", group: "산업재 / 방산", sector: "John Deere — 농기계 1위", color: "#367c2b", decimals: 2, currency: "USD", business: "John Deere — 농기계 글로벌 1위. 정밀 농업(See & Spray, 자율 트랙터) 기술 선도. 농산물 가격에 동행." },
  BA: { displayName: "Boeing", fullName: "The Boeing Company", group: "산업재 / 방산", sector: "Airbus 와 함께 민항기 양대 강자", color: "#5b8df8", decimals: 2, currency: "USD", business: "Airbus 와 함께 민항기 양대 강자. 737·787·777 시리즈. 방산(F/A-18, 우주) 도 운영. 최근 품질·안전 이슈." },
  LMT: { displayName: "Lockheed Martin", fullName: "Lockheed Martin Corp.", group: "산업재 / 방산", sector: "미국 1위 방산 (F-35)", color: "#86a3d4", decimals: 2, currency: "USD", business: "미국 1위 방산기업. F-35 스텔스 전투기·미사일·우주 시스템. 미 국방예산 + NATO·일본·한국 수출 직접 수혜." },
  RTX: { displayName: "RTX", fullName: "RTX Corporation", group: "산업재 / 방산", sector: "Raytheon — 미사일·항공엔진", color: "#c8102e", decimals: 2, currency: "USD", business: "구 Raytheon Technologies. 미사일(Patriot, Tomahawk)·항공엔진(Pratt & Whitney)·국방 시스템. 우크라이나·중동 분쟁 수혜." },
  NOC: { displayName: "Northrop Grumman", fullName: "Northrop Grumman Corp.", group: "산업재 / 방산", sector: "전략핵·우주 시스템 방산", color: "#0066a1", decimals: 2, currency: "USD", business: "미국 4대 방산. 전략 핵폭격기(B-21 Raider)·핵미사일(Sentinel)·우주(NASA 협력) 강자. 미·중 우주 경쟁 수혜." },
  HON: { displayName: "Honeywell", fullName: "Honeywell International", group: "산업재 / 방산", sector: "산업복합 (항공·자동화)", color: "#e1241c", decimals: 2, currency: "USD", business: "산업복합 (항공우주·빌딩기술·에너지·자동화·헬스케어). GE·3M 과 함께 미국 산업복합 대표." },
  GE: { displayName: "GE Aerospace", fullName: "GE Aerospace", group: "산업재 / 방산", sector: "항공기 엔진 (LEAP) 1위", color: "#005eb8", decimals: 2, currency: "USD", business: "민항기 엔진(LEAP) Safran 합작 통해 글로벌 1위. 2024 GE 분할로 항공우주만 남음. 항공 운항 시간(FH) 연동." },
  UPS: { displayName: "UPS", fullName: "United Parcel Service", group: "산업재 / 방산", sector: "글로벌 물류 1위", color: "#351c15", decimals: 2, currency: "USD", business: "글로벌 물류·택배 1위 (갈색 트럭). 220개 국가 배송. e-commerce 성장과 동행, B2B 산업 사이클에 민감." },
  FDX: { displayName: "FedEx", fullName: "FedEx Corporation", group: "산업재 / 방산", sector: "글로벌 익일배송 1위", color: "#4d148c", decimals: 2, currency: "USD", business: "글로벌 익일·국제 배송 1위 (Express). UPS 와 양대. 보잉 757/767 항공기 다수 보유." },
  AVAV: { displayName: "AVAV", fullName: "AeroVironment, Inc.", group: "산업재 / 방산", sector: "소모성 드론·배회폭탄 1위", color: "#1f6fb2", decimals: 2, currency: "USD", business: "Switchblade 배회폭탄·소형 UAS 1위 + BlueHalo 인수로 대드론·레이저·우주 확장. 美 'Drone Dominance' 조달 확대의 직접 수혜 퓨어플레이." },
  KTOS: { displayName: "KTOS", fullName: "Kratos Defense & Security", group: "산업재 / 방산", sector: "저가 무인전투기 (CCA)", color: "#5a7d9a", decimals: 2, currency: "USD", business: "저가 무인전투기 XQ-58 Valkyrie·표적드론·제트엔진. 해병대 CCA 기체 선정 — '소모 가능한 무인 윙맨' 대량생산 테마의 핵심 상장주." },
  "012450.KS": { displayName: "012450.KS", fullName: "Hanwha Aerospace", group: "산업재 / 방산", sector: "K-방산 대장주 (K9·유무인복합)", color: "#f37321", decimals: 0, currency: "KRW", business: "K9 자주포·천무 수출 + 항공엔진. 유럽 재무장 최대 수혜 K-방산 대장주. UGV·유무인복합으로 피지컬 AI 확장." },
  "079550.KS": { displayName: "079550.KS", fullName: "LIG Nex1", group: "산업재 / 방산", sector: "유도무기·대드론 (천궁)", color: "#c4122f", decimals: 0, currency: "KRW", business: "천궁-II 등 유도무기 수출 주력. 중형무인기 공통플랫폼·대드론 체계로 무인전 확장. 중동 수출 모멘텀." },
  // ── 부동산 (REITs) ─────────────────────────────────────
  AMT: { displayName: "American Tower", fullName: "American Tower Corporation", group: "부동산 (REITs)", sector: "세계 최대 통신탑 REIT", color: "#4ea1ff", decimals: 2, currency: "USD", business: "세계 최대 통신탑(셀타워) REIT. 통신사들에 5G 안테나 임대. 디지털 인프라의 'toll bridge' 모델." },
  CCI: { displayName: "Crown Castle", fullName: "Crown Castle Inc.", group: "부동산 (REITs)", sector: "통신탑 REIT 2위", color: "#005faf", decimals: 2, currency: "USD", business: "미국 통신탑 REIT 2위. 광케이블(Fiber) 사업 보유. AMT 와 양대. 5G 인프라 임대수익." },
  PLD: { displayName: "Prologis", fullName: "Prologis, Inc.", group: "부동산 (REITs)", sector: "세계 최대 물류창고 REIT", color: "#34d399", decimals: 2, currency: "USD", business: "세계 최대 물류창고 REIT. 아마존 등 e-commerce 성장에 따른 물류센터 임대수익 폭발. AI 데이터센터로 확장." },
  EQIX: { displayName: "Equinix", fullName: "Equinix, Inc.", group: "부동산 (REITs)", sector: "글로벌 데이터센터 REIT 1위", color: "#f97316", decimals: 2, currency: "USD", business: "글로벌 데이터센터 REIT 1위. 70+ 도시에 데이터센터 운영. 클라우드·AI 인프라 폭증의 직접 수혜자." },
  DLR: { displayName: "Digital Realty", fullName: "Digital Realty Trust", group: "부동산 (REITs)", sector: "데이터센터 REIT 2위", color: "#0078c2", decimals: 2, currency: "USD", business: "글로벌 데이터센터 REIT 2위 (Equinix 와 양대). 하이퍼스케일·엔터프라이즈 데이터센터. AI 학습·추론 수요 수혜." },
  O: { displayName: "Realty Income", fullName: "Realty Income Corporation", group: "부동산 (REITs)", sector: "월 배당 'The Monthly Dividend Company'", color: "#1a3a6e", decimals: 2, currency: "USD", business: "월 단위 배당으로 유명 ('The Monthly Dividend Company'). 미국 단일 임차인 소매(Convenience store 등) 임대." },
  SPG: { displayName: "Simon Property", fullName: "Simon Property Group", group: "부동산 (REITs)", sector: "미국 최대 쇼핑몰 REIT", color: "#a90030", decimals: 2, currency: "USD", business: "미국 최대 쇼핑몰 REIT. 프리미엄 아웃렛 + 럭셔리 쇼핑몰. e-commerce 시대에도 프리미엄 입지 가치 유지." },
  WELL: { displayName: "Welltower", fullName: "Welltower Inc.", group: "부동산 (REITs)", sector: "시니어 헬스케어 REIT 1위", color: "#3aaa35", decimals: 2, currency: "USD", business: "시니어 헬스케어 REIT 1위. 요양원·시니어 아파트·메디컬 오피스. 인구 고령화 장기 수혜." },
  PSA: { displayName: "Public Storage", fullName: "Public Storage", group: "부동산 (REITs)", sector: "셀프 스토리지 REIT 1위", color: "#75b73b", decimals: 2, currency: "USD", business: "셀프 스토리지(개인 창고 임대) REIT 1위. 미국 전역에 ~3,000개 창고. 운영비 낮고 가격 결정력 강함." },
  VICI: { displayName: "VICI Properties", fullName: "VICI Properties Inc.", group: "부동산 (REITs)", sector: "카지노·엔터테인먼트 REIT", color: "#c8102e", decimals: 2, currency: "USD", business: "라스베이거스 카지노·엔터테인먼트 부동산 REIT. Caesars Palace·MGM Grand 등 임대. S&P 500 편입." },
  // ── 통신 / 미디어 ─────────────────────────────────────
  VZ: { displayName: "Verizon", fullName: "Verizon Communications", group: "통신 / 미디어", sector: "미국 1위 통신 (5G)", color: "#cd040b", decimals: 2, currency: "USD", business: "미국 1위 통신사 (무선 기준). 5G 네트워크 + 광케이블. 고배당 (수익률 6%대) 인컴주." },
  T: { displayName: "AT&T", fullName: "AT&T Inc.", group: "통신 / 미디어", sector: "미국 2위 통신 + 광케이블", color: "#00a8e0", decimals: 2, currency: "USD", business: "미국 2위 통신사. WarnerMedia 분사 후 통신 본업 집중. 광케이블 인터넷 확대 중. 고배당." },
  TMUS: { displayName: "T-Mobile", fullName: "T-Mobile US, Inc.", group: "통신 / 미디어", sector: "미국 3위 통신 (5G 1위)", color: "#e20074", decimals: 2, currency: "USD", business: "미국 3위 통신사. Sprint 인수로 5G 인프라 1위. VZ·T 와의 점유율 경쟁의 승자." },
  CMCSA: { displayName: "Comcast", fullName: "Comcast Corporation", group: "통신 / 미디어", sector: "미국 케이블·미디어 (NBCUniversal)", color: "#1d3a83", decimals: 2, currency: "USD", business: "미국 케이블·인터넷 1위 + NBCUniversal(영화·테마파크). 스트리밍(Peacock) 진출. 케이블 가입자 감소가 변수." },
  CHTR: { displayName: "Charter", fullName: "Charter Communications", group: "통신 / 미디어", sector: "미국 케이블·인터넷 2위 (Spectrum)", color: "#0099d8", decimals: 2, currency: "USD", business: "미국 케이블·인터넷 2위 (Spectrum 브랜드). Comcast 와 양대. 무선 사업(Spectrum Mobile) 확대 중." },
  NFLX: { displayName: "Netflix", fullName: "Netflix, Inc.", group: "통신 / 미디어", sector: "글로벌 스트리밍 1위", color: "#e50914", decimals: 2, currency: "USD", business: "글로벌 스트리밍 1위 (가입자 ~3억). 광고형 요금제 + 계정공유 단속으로 마진 개선. 자체 콘텐츠 강자." },
  DIS: { displayName: "Disney", fullName: "The Walt Disney Company", group: "통신 / 미디어", sector: "디즈니 — 종합 미디어·엔터", color: "#022a5e", decimals: 2, currency: "USD", business: "디즈니 — 종합 미디어·엔터 (영화·테마파크·ESPN·디즈니+). Marvel·Pixar·Star Wars IP 보유." },
  SPOT: { displayName: "Spotify", fullName: "Spotify Technology S.A.", group: "통신 / 미디어", sector: "글로벌 음악 스트리밍 1위", color: "#1db954", decimals: 2, currency: "USD", business: "글로벌 음악 스트리밍 1위 (스웨덴). 가입자 6억+. 팟캐스트·오디오북 확장. 음악 레이블에 로열티 지불 구조." },
  EA: { displayName: "Electronic Arts", fullName: "Electronic Arts Inc.", group: "통신 / 미디어", sector: "글로벌 게임 (FIFA·Apex)", color: "#ff4747", decimals: 2, currency: "USD", business: "글로벌 게임 퍼블리셔. FC(구 FIFA)·Madden NFL·Apex Legends·심즈. 스포츠 게임 라이선스 강자." },
  TTWO: { displayName: "Take-Two", fullName: "Take-Two Interactive", group: "통신 / 미디어", sector: "GTA·NBA 2K 개발사", color: "#e60012", decimals: 2, currency: "USD", business: "Grand Theft Auto·NBA 2K 개발사 (Rockstar Games·2K). GTA VI 출시(2025-26) 가 가장 큰 카탈리스트." },
  // ── 유틸리티 / 전력 ─────────────────────────────────────
  NEE: { displayName: "NextEra Energy", fullName: "NextEra Energy, Inc.", group: "유틸리티 / 전력", sector: "미국 1위 신재생 유틸리티", color: "#1ab394", decimals: 2, currency: "USD", business: "미국 1위 신재생(풍력·태양광) 유틸리티 + 플로리다 전력회사. 신재생 자산 규모 글로벌 최대급." },
  SO: { displayName: "Southern Co.", fullName: "The Southern Company", group: "유틸리티 / 전력", sector: "미국 남부 전력 유틸리티", color: "#005ba8", decimals: 2, currency: "USD", business: "미국 동남부 (조지아·앨라배마 등) 전력 유틸리티. 보글 원전(Vogtle 3·4호기) 가동 — 미국 최신 원전." },
  DUK: { displayName: "Duke Energy", fullName: "Duke Energy Corporation", group: "유틸리티 / 전력", sector: "미국 동남부 전력 유틸리티", color: "#003366", decimals: 2, currency: "USD", business: "미국 동남부 (노스캐롤라이나·플로리다 등) 전력·가스 유틸리티. 원전·가스·신재생 혼합 전원믹스." },
  AEP: { displayName: "American Electric", fullName: "American Electric Power", group: "유틸리티 / 전력", sector: "미국 송전망 최대 (765kV)", color: "#0072ce", decimals: 2, currency: "USD", business: "미국 송전망 1위 (765kV 초고압). 11개 주에 발전·송배전. AI 데이터센터 전력 수요 직접 수혜." },
  EXC: { displayName: "Exelon", fullName: "Exelon Corporation", group: "유틸리티 / 전력", sector: "송배전 전문 (Pure-play T&D)", color: "#0085ca", decimals: 2, currency: "USD", business: "송배전 전문 유틸리티 (발전 분리). 시카고(ComEd)·필라델피아(PECO)·볼티모어 등 대도시 전력 공급." },
  CEG: { displayName: "Constellation", fullName: "Constellation Energy", group: "유틸리티 / 전력", sector: "미국 1위 원자력 발전사", color: "#a3238e", decimals: 2, currency: "USD", business: "미국 1위 원자력 발전사 (~10% 전력 공급). 마이크로소프트와 24년 PPA (스리마일섬 재가동) 체결로 AI 전력 수혜 대표주." },
  VST: { displayName: "Vistra", fullName: "Vistra Corp.", group: "유틸리티 / 전력", sector: "원자력 + 가스 발전사", color: "#003c71", decimals: 2, currency: "USD", business: "텍사스 중심 발전사 (원자력 + 가스). 2024 Energy Harbor 인수로 원전 4기 추가. AI 전력 수요 수혜." },
  SRE: { displayName: "Sempra", fullName: "Sempra", group: "유틸리티 / 전력", sector: "남부캘리포니아 + LNG 수출", color: "#dd0c2f", decimals: 2, currency: "USD", business: "남부 캘리포니아 가스·전력 (SoCalGas·SDG&E) + 멕시코 / 미국 LNG 수출 터미널. 에너지·유틸리티 하이브리드." },
  ED: { displayName: "Con Edison", fullName: "Consolidated Edison", group: "유틸리티 / 전력", sector: "뉴욕시 전력·가스 독점", color: "#0033a0", decimals: 2, currency: "USD", business: "뉴욕시 전력·가스 독점 공급 (1823년 창업). 49년 연속 배당 증가. 가장 안정적인 인컴주 중 하나." },
  D: { displayName: "Dominion", fullName: "Dominion Energy, Inc.", group: "유틸리티 / 전력", sector: "버지니아 전력 (데이터센터 메카)", color: "#0066cc", decimals: 2, currency: "USD", business: "버지니아·캐롤라이나 전력. 버지니아 북부는 미국 최대 데이터센터 클러스터(~70% 인터넷 트래픽). AI 전력 수혜." },
  // ── 전력 인프라 (AI) ─────────────────────────────────────
  GEV: { displayName: "GE Vernova", fullName: "GE Vernova Inc.", group: "전력 인프라 (AI)", sector: "가스터빈·그리드 장비 1위", color: "#00b5e2", decimals: 2, currency: "USD", business: "GE 에서 분사한 발전·그리드 장비사. 대형 가스터빈 글로벌 1위 — 백로그 110GW+ 로 2029년까지 매진. AI 전력 붐의 최상류 공급 관문." },
  ETN: { displayName: "Eaton", fullName: "Eaton Corporation plc", group: "전력 인프라 (AI)", sector: "북미 전력기기 종합 강자", color: "#0033a0", decimals: 2, currency: "USD", business: "변압기·스위치기어·UPS 등 전력관리 종합. 데이터센터 인입에서 랙 배전까지 폭넓게 공급 — 변압기 리드타임 4~5년 병목의 핵심 수혜." },
  VRT: { displayName: "Vertiv", fullName: "Vertiv Holdings Co", group: "전력 인프라 (AI)", sector: "DC 전력·냉각 인프라 1위", color: "#f7403a", decimals: 2, currency: "USD", business: "데이터센터 내부 전력체인(UPS·PDU·부스웨이)과 액체냉각 1위권. NVIDIA GB200/GB300 레퍼런스 파트너 — 랙 전력밀도 급증의 직접 수혜." },
  PWR: { displayName: "Quanta Services", fullName: "Quanta Services, Inc.", group: "전력 인프라 (AI)", sector: "송전망 건설 (T&D EPC) 1위", color: "#0072ce", decimals: 2, currency: "USD", business: "미국 송전·변전 건설(T&D EPC) 1위. 백로그 $48.5B 사상최대 — 유틸리티 grid capex 슈퍼사이클과 DC 대형부하 접속 공사의 최대 수혜." },
  BE: { displayName: "Bloom Energy", fullName: "Bloom Energy Corporation", group: "전력 인프라 (AI)", sector: "고체산화물 연료전지 (SOFC) 1위", color: "#76b900", decimals: 2, currency: "USD", business: "천연가스 개질 SOFC 연료전지 1위. 터빈 없이 수개월 내 배치되는 BTM 전원 — Oracle 2.8GW·AEP 1GW·Brookfield $25B 파트너십." },
  OKLO: { displayName: "Oklo", fullName: "Oklo Inc.", group: "전력 인프라 (AI)", sector: "SMR (소형모듈원자로) 선두주", color: "#a3238e", decimals: 2, currency: "USD", business: "Aurora 소형 고속로 개발사 (샘 올트먼 초기 지원). INL 첫 호기 건설 중, Meta 등과 계약 — 데이터센터 전용 24/7 무탄소 전원의 차기 본명." },
  "034020.KS": { displayName: "두산에너빌리티", fullName: "Doosan Enerbility", group: "전력 인프라 (AI)", sector: "가스터빈·원전 주기기 (한국)", color: "#1a5cff", decimals: 0, currency: "KRW", business: "국산 가스터빈 + 원전·SMR 주기기 제작. 글로벌 터빈 3사 매진의 반사수혜로 미국향 누적 12기 — 체코 원전 5.6조 수주, SMR 파운드리 전략." },
  "267260.KS": { displayName: "HD현대일렉트릭", fullName: "HD Hyundai Electric", group: "전력 인프라 (AI)", sector: "대형 변압기 (북미 수출)", color: "#00787d", decimals: 0, currency: "KRW", business: "K-전력기기 대장주. 북미 대형 변압기 수출 — ’25 영업이익 1조 돌파, 수년치 수주잔고. 미국 변압기 리드타임 4~5년 병목의 직접 수혜." },
  "298040.KS": { displayName: "효성중공업", fullName: "Hyosung Heavy Industries", group: "전력 인프라 (AI)", sector: "초고압 변압기 (미국 증설)", color: "#e60027", decimals: 0, currency: "KRW", business: "초고압 변압기·차단기. 미국 현지 공장 증설로 북미 수요 대응 — ’25 영업이익 7,470억 사상최대, 1분기에 연간 수주 목표 절반 달성." },
  "010120.KS": { displayName: "LS일렉트릭", fullName: "LS ELECTRIC", group: "전력 인프라 (AI)", sector: "배전기기·DC 전력 패키지", color: "#c9252c", decimals: 0, currency: "KRW", business: "배전기기·전력 시스템. 데이터센터 내부 배전과 Bloom Energy 향 전력 패키지 공급 — 초고압부터 배전반까지 국내 최강 라인업." },
  // ── 조선 (한국) ─────────────────────────────────────
  "329180.KS": { displayName: "HD현대중공업", fullName: "HD Hyundai Heavy Industries", group: "조선 (한국)", sector: "한국 1위 조선사", color: "#22c55e", decimals: 0, currency: "KRW", business: "한국 1위 조선사. 친환경(LNG·암모니아 추진) 선박 분야 글로벌 1위. K-조선 르네상스의 대장주." },
  "042660.KS": { displayName: "한화오션", fullName: "Hanwha Ocean Co., Ltd.", group: "조선 (한국)", sector: "방산(잠수함) + 친환경 선박", color: "#ec6608", decimals: 0, currency: "KRW", business: "구 대우조선해양. 한화그룹 인수 후 방산(잠수함)·친환경 선박으로 사업 확장." },
  "010140.KS": { displayName: "삼성중공업", fullName: "Samsung Heavy Industries", group: "조선 (한국)", sector: "삼성그룹 조선·해양플랜트", color: "#1428a0", decimals: 0, currency: "KRW", business: "삼성그룹 조선·해양플랜트. LNG 운반선·드릴십·FPSO. 카타르·모잠비크 LNG 메가 프로젝트 참여." },
  "010620.KS": { displayName: "HD현대미포", fullName: "HD Hyundai Mipo Dockyard", group: "조선 (한국)", sector: "중형 선박 (MR 탱커) 전문", color: "#0072bc", decimals: 0, currency: "KRW", business: "HD현대그룹 중형 조선사. MR(Medium Range) 탱커·PC선·중형 컨테이너선 전문. 친환경 메탄올 추진 선박 강세." },
};
// 섹터 그룹 표시 순서 + 그룹별 한 줄 설명 (대시보드 헤더에 노출).
// 새 그룹을 추가하면 여기에도 한 줄 추가하여 카드 묶음 순서를 제어한다.
const STOCK_GROUPS = [
  { key: "빅테크 / 소프트웨어", desc: "글로벌 시총 상위 빅테크 + 엔터프라이즈 소프트웨어. 광고·SaaS·DB 등 다양한 수익모델." },
  { key: "반도체 — AI 칩 · 설계", desc: "GPU·커스텀 ASIC·모바일 AP·자율주행 SoC 를 설계하는 팹리스/IDM + 설계의 관문인 EDA·IP. 시장지도 'AI 컴퓨팅'과 '최종 수요(엣지)' 층." },
  { key: "반도체 — 메모리 (HBM·DRAM)", desc: "HBM·DRAM·NAND 3강. AI 가속기의 1순위 병목인 HBM 적층 경쟁과 범용 메모리 슈퍼사이클." },
  { key: "반도체 — 파운드리 · 패키징 · 기판", desc: "칩을 실제로 만드는 제조 기반 — 첨단 파운드리(≤3nm)·CoWoS 패키징(OSAT)·ABF 기판. 시장지도 '제조 기반' 층." },
  { key: "반도체 — 장비 · 소재", desc: "공급의 뿌리(picks & shovels) — EUV 노광·식각/증착·계측 전공정 장비 + HBM 본더·테스터·다이서 후공정 장비 + 웨이퍼/레지스트 소재." },
  { key: "AI 인프라 — 네트워킹 · 광 · 네오클라우드", desc: "GPU 를 잇는 스위치·광모듈, 칩까지 전력을 전달하는 전력반도체, GPU 컴퓨트를 임대하는 네오클라우드 — 시장지도 '자본 엔진'과 부품 층의 신흥 계층." },
  { key: "로보틱스 / 피지컬 AI", desc: "휴머노이드·산업로봇·자율 시스템과 그 부품(감속기·라이다·희토류 자석·로봇 테스트). 피지컬 AI 시대의 곡괭이와 삽." },
  { key: "자동차 / 모빌리티", desc: "내연기관·EV·자율주행 전환기. 기존 완성차 + 신규 진입자 + 한국 빅2." },
  { key: "바이오 / 제약 / 헬스케어", desc: "글로벌 시총 상위 제약 + 의료기기/진단 + 의료보험. 인구 고령화 장기 수혜." },
  { key: "에너지 / 원자재", desc: "원유·가스·구리·금·산업용가스 등 실물 자산. 인플레이션·달러 약세 국면 방어주." },
  { key: "금융", desc: "대형 은행·투자은행·결제망·지주회사. 금리·경기 사이클·신용 환경의 거울." },
  { key: "소비재", desc: "필수 + 임의 소비재 통합. 음료·생활용품·QSR·홈임프루브먼트·스포츠웨어." },
  { key: "산업재 / 방산", desc: "건설·항공기·방산·물류·산업복합기업. 인프라·국방예산 사이클 직접 수혜." },
  { key: "부동산 (REITs)", desc: "통신탑·물류창고·데이터센터·쇼핑몰·시니어 등 다양한 자산군의 REIT." },
  { key: "통신 / 미디어", desc: "통신사·케이블·스트리밍·종합 미디어·게임. 콘텐츠·구독 경제의 중심." },
  { key: "유틸리티 / 전력", desc: "전력·가스 유틸리티. 신재생·원자력 비중 확대 + AI 데이터센터 전력수요의 수혜." },
  { key: "전력 인프라 (AI)", desc: "가스터빈·변압기·T&D·연료전지·SMR — AI 데이터센터 전력 공급망(BTM vs 그리드)의 장비·건설·차세대 발전. K-전력기기 포함." },
  { key: "조선 (한국)", desc: "K-조선 르네상스. LNG·암모니아 친환경 선박 글로벌 1위 한국 조선사들." },
];
// 시장 지수 UI 메타데이터. summary 는 부제, description 은 한 줄 설명.
const INDEX_META = {
  "^GSPC": { displayName: "S&P 500",          color: "#c084fc", decimals: 2, summary: "미국 대형주 500개 가중평균",   description: "미국 시가총액 상위 500개 기업. 미국 시장 전체의 대표 지수." },
  "^IXIC": { displayName: "NASDAQ Composite", color: "#0096ff", decimals: 2, summary: "나스닥 전 종목 (테크 중심)",   description: "나스닥 상장 종목 전체. 빅테크 비중이 압도적." },
  "^DJI":  { displayName: "Dow Jones",        color: "#f5c842", decimals: 2, summary: "30개 우량 대기업 (가격 가중)", description: "미국 30개 우량주. 1896년~ 가장 오래된 지수." },
  "^RUT":  { displayName: "Russell 2000",     color: "#86efac", decimals: 2, summary: "미국 소형주 2,000개",          description: "내수 중심 중소기업. 미국 국내 경기를 반영." },
};

// 재무 지표 용어집 — 수식 + 해석 방향만 (한 줄씩)
const METRIC_GLOSSARY = {
  market_cap:       { label: "시가총액",       format: (v) => formatLargeMoney(v),                          formula: "주가 × 발행 주식 수",          direction: "회사 전체의 시장 가치 ($1T+ = 메가캡)" },
  pe_ratio:         { label: "P/E (TTM)",       format: (v) => v == null ? "—" : v.toFixed(1) + "배",         formula: "주가 ÷ 주당순이익",            direction: "낮을수록 저평가 · 높을수록 성장 기대 (S&P500 평균 ~22)" },
  forward_pe:       { label: "선행 P/E",        format: (v) => v == null ? "—" : v.toFixed(1) + "배",         formula: "주가 ÷ 향후 12개월 예상 EPS",  direction: "P/E(TTM)보다 낮으면 향후 이익 증가 기대" },
  eps_ttm:          { label: "EPS (TTM)",       format: (v) => v == null ? "—" : `$${v.toFixed(2)}`,           formula: "순이익 ÷ 주식 수",             direction: "1주당 1년간 번 돈 (음수면 적자)" },
  operating_margin: { label: "영업이익률",      format: (v) => formatPercent(v),                              formula: "영업이익 ÷ 매출",              direction: "본업 수익성 (소프트웨어 30%+, 제조업 5~15%)" },
  profit_margin:    { label: "순이익률",        format: (v) => formatPercent(v),                              formula: "순이익 ÷ 매출",                direction: "세금·이자까지 뺀 최종 수익성" },
  return_on_equity: { label: "ROE",             format: (v) => formatPercent(v),                              formula: "순이익 ÷ 자기자본",            direction: "주주 자본 효율 (15%+ 우량)" },
  dividend_yield:   { label: "배당수익률",      format: (v) => formatPercent(v),                              formula: "연간 배당 ÷ 주가",             direction: "주식 보유 시 받는 연 현금 수익률 (성장주는 0%)" },
};

// 비교 자산(Assets) UI 메타데이터.
// fetch_fred.py 의 ASSETS 와 대응.
const ASSET_META = {
  GOLD: { displayName: "금 (Gold)",              unit: "$", decimals: 0, color: "#d4af37" },
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
    secondary: ["GOLD", "DGS10"],
    note: "장단기 금리 역전은 침체 선행 신호. 주식·신용스프레드·VIX 가 어떻게 반응했는지 비교.",
  },
  T10YIE: {
    primary:   ["GOLD", "DGS10"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "기대 인플레이션이 오를 때 금·명목금리는 동행, 달러는 역행하는 경향.",
  },
  CPIAUCSL: {
    primary:   ["GOLD", "DTWEXBGS", "DGS10"],
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
    primary:   ["GOLD", "DGS10"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "Core CPI 가속기엔 명목금리·금 동행, 달러 약세 경향.",
  },
  PCEPI: {
    primary:   ["DGS10", "GOLD"],
    secondary: ["DTWEXBGS", "SP500"],
    note: "Fed 기준 지표. 목표(2%) 대비 이탈 국면에서 채권/달러 반응 확인.",
  },
  DCOILWTICO: {
    primary:   ["DTWEXBGS", "GOLD"],
    secondary: ["SP500", "DEXKOUS"],
    note: "유가 YoY 는 달러와 역상관, 인플레와 동행. 1·2차 오일쇼크·2008·COVID 전후가 관전 포인트.",
  },

  // ── 달러 가치 분석 지표 비교 추천 ────────────────────────────────────
  DGS10: {
    primary:   ["DEXKOUS", "IRLTLT01KRM156N", "DTWEXBGS"],
    secondary: ["GOLD", "SP500"],
    note: "미국 10Y 금리가 오를수록 달러 강세 압력. 한국 국채와의 스프레드, 원/달러 환율과 동시 비교.",
  },
  M2SL: {
    primary:   ["DEXKOUS", "DTWEXBGS", "GOLD"],
    secondary: ["SP500", "VIXCLS"],
    note: "M2 급증 구간(2020 등)에서 달러 지수 약세·금 강세 경향. 환율과의 시차 동행 확인.",
  },
  GFDEGDQ188S: {
    primary:   ["DGS10", "BAMLH0A0HYM2", "DEXKOUS"],
    secondary: ["GOLD", "DTWEXBGS"],
    note: "부채/GDP 급등 구간에서 장기금리·크레딧 스프레드 반응을 체크. 금·달러 약세와의 연관성.",
  },
  IRLTLT01KRM156N: {
    primary:   ["DEXKOUS", "DGS10", "KOSPI"],
    secondary: ["GOLD", "BAMLH0A0HYM2"],
    note: "한미 금리차 확대 시 원화 약세 경향. 원/달러 환율, 미국 10Y 국채와 동시에 비교.",
  },
  MYAGM2KRM189S: {
    primary:   ["DEXKOUS", "IRLTLT01KRM156N", "KOSPI"],
    secondary: ["GOLD", "SP500"],
    note: "한국 M2 팽창 속도를 미국 M2와 비교해 상대 통화 공급 과잉을 파악. 원/달러와 동행 확인.",
  },
  DEBTTLKRQ052N: {
    primary:   ["IRLTLT01KRM156N", "DEXKOUS", "KOSPI"],
    secondary: ["BAMLH0A0HYM2", "GOLD"],
    note: "한국 재정 건전성 추이. 부채 확대 시 장기금리·원화 방향성과의 관계를 확인.",
  },

  // ── 한국 지표 비교 추천 ────────────────────────────────────────────────
  KORCPIALLMINMEI: {
    primary:   ["DEXKOUS", "DCOILWTICO"],
    secondary: ["IRLTLT01KRM156N", "GOLD"],
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
    secondary: ["GOLD", "BAMLH0A0HYM2"],
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

// 차트 타임프레임 선택지. months == null 이면 전체 데이터.
// 분수 month(예: 1W = 0.23)는 일별 시계열에서만 유효 — filterAvailableTimeframes 가
// 데이터 포인트 밀도를 보고 자동으로 거른다.
const TIMEFRAMES = [
  { key: "1W",   label: "1주",   months: 7 / 30.44   },
  { key: "1M",   label: "1개월", months: 1           },
  { key: "3M",   label: "3개월", months: 3           },
  { key: "1Y",   label: "1년",   months: 12          },
  { key: "5Y",   label: "5년",   months: 60          },
  { key: "10Y",  label: "10년",  months: 120         },
  { key: "30Y",  label: "30년",  months: 360         },
  { key: "50Y",  label: "50년",  months: 600         },
  { key: "100Y", label: "100년", months: 1200        },
  { key: "ALL",  label: "전체",  months: null        },
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
  // (WIKI 탭은 지표 데이터와 무관하게 자체 JSON 을 가져온다)
  if (tab === "WIKI") {
    if (!_renderedTabs.has(tab)) {
      renderWikiTab();
      _renderedTabs.add(tab);
    }
  } else if (!_renderedTabs.has(tab) && _cachedData) {
    if (tab === "STOCKS") {
      renderStocksTab(_cachedData);
    } else if (tab === "PRINCIPLES") {
      renderPrinciplesTab();
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
  // 탭 버튼 이벤트 연결 — 데이터 로드 실패와 무관하게 탭 전환은 항상 동작
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
  });
  initSidebar();

  try {
    const idxRes = await fetch("data/index.json", { cache: "no-cache" });
    if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
    const idx = await idxRes.json();

    const indicatorEntries = idx.indicators || [];
    const assetEntries     = idx.assets     || [];
    const stockEntries     = idx.stocks     || [];
    const indexEntries     = idx.indices    || [];

    const fetchJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.json();
    });

    const [indicatorPayloads, assetPayloads, stockPayloads, indexPayloads] = await Promise.all([
      Promise.all(indicatorEntries.map((e) => fetchJson(`data/indicators/${e.code}.json`))),
      Promise.all(assetEntries.map((e)     => fetchJson(`data/assets/${e.code}.json`))),
      Promise.all(stockEntries.map((e)     => fetchJson(`data/stocks/${e.code}.json`))),
      Promise.all(indexEntries.map((e)     => fetchJson(`data/indices/${e.filename || e.code}.json`))),
    ]);

    const indicators = {};
    indicatorEntries.forEach((e, i) => { indicators[e.code] = indicatorPayloads[i]; });
    const assets = {};
    assetEntries.forEach((e, i) => { assets[e.code] = assetPayloads[i]; });
    const stocks = {};
    stockEntries.forEach((e, i) => { stocks[e.code] = stockPayloads[i]; });
    const indices = {};
    indexEntries.forEach((e, i) => { indices[e.code] = indexPayloads[i]; });

    const data = {
      last_updated:  idx.last_updated,
      indicators,
      assets,
      stocks,
      indices,
      assessment:    idx.assessment    || null,
      assessment_kr: idx.assessment_kr || null,
    };

    _cachedData = data;
    renderLastUpdated(data.last_updated);
    // US 탭 먼저 렌더링
    renderTabContent("US", data);
    _renderedTabs.add("US");
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
// assessment = { primary?, full, rolling_10y, config, trajectory }
//   primary — 백테스트 검증 모델(scripts/compare_models.py 승자)의 종합 판정.
//             US 에만 존재. full/rolling_10y 는 참조용 백분위 뷰.
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

  // 종합 판정 (primary) — 존재하는 탭(US)에서만 카드 표시
  const primary = assessment.primary || null;
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
  const canvas = document.getElementById(`assessment-scatter-${tab}`);
  if (!canvas) return;

  // primary(종합 판정) 가 있으면 그 궤적·현재값을 그린다. 없으면 장기 기준.
  const primary  = assessment.primary || null;
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

  // 시리즈의 평균 데이터 간격(일). 분수 month 타임프레임은 충분한 포인트가 있을 때만 노출.
  const totalDays = Math.max(1,
    Math.round((new Date(series[series.length - 1].date) - new Date(series[0].date)) / 86400000));
  const avgGapDays = totalDays / Math.max(1, series.length - 1);

  const available = TIMEFRAMES.filter((tf) => {
    if (tf.months == null) return true;
    if (tf.months > spanMonths) return false;
    // 짧은 타임프레임에 최소 3개 이상의 포인트가 들어가야 차트로 의미 있음.
    const tfDays = tf.months * 30.44;
    return tfDays / avgGapDays >= 3;
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
  // 분수 month(1W = 0.23) 도 정확하게 처리하기 위해 일 단위로 변환해서 차감.
  cutoff.setDate(cutoff.getDate() - Math.round(months * 30.44));
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

function renderStocksTab(data) {
  const stocks  = data.stocks  || {};
  const indices = data.indices || {};

  // ─ 시장 지수 ─
  const indexHost = document.getElementById("index-cards");
  if (indexHost) {
    if (Object.keys(indices).length === 0) {
      indexHost.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions를 실행해 주세요.");
    } else {
      for (const [code, payload] of Object.entries(indices)) {
        if (!payload || !payload.series || payload.series.length === 0) continue;
        indexHost.appendChild(renderIndexCard(code, payload));
      }
    }
  }

  // ─ 가치 발굴 (월간 스크리닝) — 먼저 로드해 두면 lazy 렌더되는 카드에 🎯 배지가 붙는다 ─
  const valueScreenReady = loadValueScreen().then((vs) => renderValuePicks(vs, stocks));

  // ─ 개별 종목 (섹터 그룹별 · 접이식 + 검색) ─
  const stockHost = document.getElementById("stock-cards");
  if (stockHost) {
    if (Object.keys(stocks).length === 0) {
      stockHost.innerHTML = emptyMessage("아직 데이터가 없습니다. GitHub Actions를 실행해 주세요.");
    } else {
      renderStocksByGroup(stockHost, stocks);
      wireStockToolbar(stocks);
      // 스크리닝 결과가 그룹 렌더 후 도착하면 이미 열린 그룹의 배지를 갱신
      valueScreenReady.then(() => refreshValuePassBadges());
    }
  }

  // ─ AI·반도체 시장 지도 (수요 캐스케이드 · 병목 중심) ─
  renderMarketCascade(stocks);

  // 서브 네비게이션 (시장 지수 / 개별 종목 / 시장 지도 토글)
  wireSectorNav("STOCKS");
}

// ════════════════════════════════════════════════════════════════════════
//  시장 구조도 (market diagram) — 공급의 뿌리(좌) → 최종 수요(우)
// ════════════════════════════════════════════════════════════════════════
//
// 기업이 아니라 '시장' 단위로 본 밸류체인 다이어그램. 산업별 지도를
// MARKET_MAPS 레지스트리(탭)로 전환한다 — AI·반도체 / 제약·바이오.
// 메인 체인(장비·소재 → 제조 → … → 자본 → 수요/지불자) + 하단 밴드로
// 배치되고, 모든 관계선이 항상 그려진다.
// 데이터 SSOT 는  data/markets/<id>.json  (지도당 1개)이며, 노드·관계·
// 병목·플레이어는 물론 다이어그램 배치(diagram 블록)까지 이 JSON 이 정한다.
//
// 색은 절제한다: '독점(structural)'·'병목(acute/easing/emerging)'만 색으로
// 강조하고, 그 외(수요 한계형·비병목)는 사이트 기본 톤(중립 회색)을 따른다.
//
// 시장 노드는 소속 기업(players[].ticker 중 watchlist 종목)의
// narrative_score 를 자동 집계해 "시장 분위기" 로 보여주고,
// weekly_note(주간 흐름)는 market-research 루틴이 채운다.
//
// 시장 단위 뉴스는 맵과 분리된  data/markets/news/<id>.json  에
// 시장 id 별로 누적된다. 웹은 노드 배지(건수·최신일), 노드 클릭 상세,
// 보드 하단의 통합 뉴스 피드(클릭 → 해당 시장 선택) 세 곳에 꽂아 보여준다.
//
// 세부 시장을 기업 단위로 확대한 '플레이어 지도'는 markets[].player_map 이
// 가리키는  data/markets/players/<id>.json  에 정의한다 (예: HBM). 해당
// 노드를 클릭하면 전용 화면(오버레이)이 열린다 — 아래 '플레이어 지도' 섹션.

// 시장 지도 레지스트리 — data/markets/<id>.json (+ news/<id>.json) 쌍을 추가하면 탭이 생긴다.
const MARKET_MAPS = [
  { id: "ai-semiconductor", label: "AI · 반도체" },
  { id: "power-ai",         label: "전력 · AI 인프라" },
  { id: "pharma-bio",       label: "제약 · 바이오" },
];
const MC_STATE = { mapId: MARKET_MAPS[0].id, cache: {}, map: null, news: null, pulse: null, activeNode: null, bottleneckOnly: false, loading: false, zoom: 1 };

// 강조 색 — 독점/병목만. demand_limited·비병목은 null(중립 톤).
const MC_SEVERITY_COLOR = {
  structural:     "#a855f7", // 보라 — 구조적 독점
  acute:          "#cc2424", // 사이트 레드 — 급성 병목
  easing:         "#b07d2b", // 머스타드 — 완화중 병목
  emerging:       "#b07d2b", // 머스타드 — 부상하는 병목
  demand_limited: null,      // 중립 — 수요 한계형(병목 아님)
};
const MC_SEV_SHORT = { structural: "독점", acute: "급성 병목", easing: "병목 완화", emerging: "병목 부상", demand_limited: "수요 한계" };
// 점유율 바 — 단색 회색 램프(톤 유지)
const MC_SHARE_RAMP = ["#e6e6e6", "#bcbcbc", "#929292", "#6c6c6c", "#525252"];

// 진입점 (renderStocksTab 에서 호출). 비동기 fetch 후 렌더. map 은 id 별 1회만 로드.
async function renderMarketCascade(stocks) {
  const board = document.getElementById("vc-board");
  if (!board) return;
  MC_STATE.stocks = stocks;
  const mapId = MC_STATE.mapId;
  if (!MC_STATE.cache[mapId] && !MC_STATE.loading) {
    MC_STATE.loading = true;
    board.innerHTML = emptyMessage("시장 지도를 불러오는 중…");
    try {
      const [mapRes, newsRes, pulseRes] = await Promise.all([
        fetch(`data/markets/${mapId}.json`, { cache: "no-cache" }),
        fetch(`data/markets/news/${mapId}.json`, { cache: "no-cache" }).catch(() => null),
        // 자동 병목 신호 (scripts/market_pulse.py 산출) — 없어도 지도는 그린다
        fetch(`data/markets/analysis/${mapId}.json`, { cache: "no-cache" }).catch(() => null),
      ]);
      if (!mapRes.ok) throw new Error(`HTTP ${mapRes.status}`);
      MC_STATE.cache[mapId] = {
        map: await mapRes.json(),
        // 뉴스 스토어는 없어도 지도는 그린다 (recent_news 폴백)
        news: newsRes && newsRes.ok ? await newsRes.json() : null,
        pulse: pulseRes && pulseRes.ok ? await pulseRes.json() : null,
      };
    } catch (err) {
      board.innerHTML = emptyMessage(`시장 지도를 불러오지 못했습니다 (${err.message}).`);
      MC_STATE.loading = false;
      return;
    }
    MC_STATE.loading = false;
  }
  const entry = MC_STATE.cache[mapId];
  if (!entry) return;
  MC_STATE.map = entry.map;
  MC_STATE.news = entry.news;
  MC_STATE.pulse = entry.pulse;
  renderMarketChrome();
  renderMarketBoard(stocks);
  renderMarketNewsFeed(stocks);
  mcWireCanvas();
}

// 지도 전환 (AI·반도체 ↔ 제약·바이오) — 선택·줌 상태를 초기화하고 다시 그린다
function mcSwitchMap(mapId) {
  if (mapId === MC_STATE.mapId) return;
  MC_STATE.mapId = mapId;
  MC_STATE.activeNode = null;
  MC_STATE.userZoomed = false;
  MC_STATE.fitted = false;
  const detail = document.getElementById("vc-detail");
  if (detail) detail.innerHTML = `<p class="vc-detail-hint">시장 노드를 클릭하면 상세 정보가 표시됩니다.</p>`;
  mcHideMarketNote();
  renderMarketCascade(MC_STATE.stocks || {});
}

// 상단 크롬: 강조 범례 + '병목만 강조' 토글
function renderMarketChrome() {
  const navHost = document.getElementById("vc-chain-nav");
  if (!navHost) return;
  const map = MC_STATE.map;
  const legend = Object.entries(map.severity_legend || {}).map(([k, v]) => {
    const c = MC_SEVERITY_COLOR[k] || "var(--text-dim)";
    return `<span class="mc-leg" title="${escapeHtml(v.desc || "")}" style="--mc-c:${c}">
       <i class="mc-leg-dot"></i>${escapeHtml(v.label || k)}</span>`;
  }).join("");
  const mapTabs = MARKET_MAPS.map((m) =>
    `<button type="button" class="vc-chain-btn mc-map-btn${m.id === MC_STATE.mapId ? " active" : ""}"
       data-map="${escapeHtml(m.id)}" role="tab" aria-selected="${m.id === MC_STATE.mapId}">${escapeHtml(m.label)}</button>`).join("");
  navHost.innerHTML = `
    <div class="mc-mapsel" role="tablist" aria-label="시장 지도 선택">${mapTabs}</div>
    <div class="mc-legend">${legend}</div>
    <label class="mc-toggle"><input type="checkbox" id="mc-bottleneck-only" ${MC_STATE.bottleneckOnly ? "checked" : ""}> 병목·독점만 강조</label>
    <div class="mc-zoom" role="group" aria-label="지도 줌">
      <button type="button" id="mc-zoom-out" title="축소">−</button>
      <span id="mc-zoom-val">${Math.round((MC_STATE.zoom || 1) * 100)}%</span>
      <button type="button" id="mc-zoom-in" title="확대">+</button>
      <button type="button" id="mc-zoom-fit" title="화면에 맞춤">맞춤</button>
      <button type="button" id="mc-full" title="전체 화면 (ESC 로 종료)">⛶</button>
      <span class="mc-zoom-hint">드래그 이동 · Ctrl+휠/핀치 줌</span>
    </div>`;
  navHost.querySelectorAll(".mc-map-btn").forEach((btn) =>
    btn.addEventListener("click", () => mcSwitchMap(btn.dataset.map)));
  const cb = document.getElementById("mc-bottleneck-only");
  if (cb) cb.addEventListener("change", () => {
    MC_STATE.bottleneckOnly = cb.checked;
    const b = document.getElementById("vc-board");
    if (b) b.classList.toggle("mc-board--btlonly", cb.checked);
  });
  const zoomBy = (f) => {
    const svg = document.getElementById("vc-links");
    const wrap = svg && svg.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    mcZoomTo(r.left + r.width / 2, r.top + r.height / 2, (MC_STATE.zoom || 1) * f);
  };
  const zi = document.getElementById("mc-zoom-in"), zo = document.getElementById("mc-zoom-out");
  if (zi) zi.addEventListener("click", () => zoomBy(1.15));
  if (zo) zo.addEventListener("click", () => zoomBy(1 / 1.15));
  const zf = document.getElementById("mc-zoom-fit");
  if (zf) zf.addEventListener("click", () => { MC_STATE.userZoomed = false; mcFitZoom(); });
  const fs = document.getElementById("mc-full");
  if (fs) fs.addEventListener("click", () => mcToggleFull());
}

// 시장 노드의 watchlist 기업 narrative_score 평균을 집계
function mcAggregateScore(m, stocks) {
  const scores = [];
  (m.players || []).forEach((p) => {
    if (!p.ticker || !p.in_watchlist) return;
    const q = stocks && stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number") scores.push(q.narrative_score);
  });
  if (!scores.length) return { count: 0, score: 0, tone: "neutral" };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { count: scores.length, score: avg, tone: avg > 0.05 ? "pos" : avg < -0.05 ? "neg" : "neutral" };
}

// 집계 점수 → 시장 분위기 라벨
function mcMood(agg) {
  if (!agg || agg.count === 0) return null;
  const s = agg.score;
  if (s >= 0.2)  return { t: "강한 긍정 모멘텀", tone: "pos" };
  if (s >= 0.05) return { t: "약한 긍정", tone: "pos" };
  if (s > -0.05) return { t: "중립", tone: "neutral" };
  if (s > -0.2)  return { t: "약한 부정", tone: "neg" };
  return { t: "강한 부정 모멘텀", tone: "neg" };
}

// 점유율 스택 바 (단색 회색 램프). 합이 100 미만이면 '기타' 세그먼트.
function mcShareBar(players) {
  const segs = (players || []).filter((p) => typeof p.share === "number" && p.share > 0)
    .slice().sort((a, b) => b.share - a.share);
  if (!segs.length) return "";
  const sum = segs.reduce((a, p) => a + p.share, 0);
  let html = segs.map((p, i) =>
    `<span class="mc-sb-seg" style="width:${p.share}%;background:${MC_SHARE_RAMP[Math.min(i, MC_SHARE_RAMP.length - 1)]}" title="${escapeHtml(p.name)} ${p.share}%"></span>`).join("");
  if (sum < 99) html += `<span class="mc-sb-seg mc-sb-etc" style="width:${100 - sum}%" title="기타 ${Math.round(100 - sum)}%"></span>`;
  return `<span class="mc-sb">${html}</span>`;
}

// ── 자동 병목 신호 (market pulse) 헬퍼 ──────────────────────────────────
// data/markets/analysis/<id>.json — scripts/market_pulse.py 가 뉴스 스토어의
// signals 를 집계해 산출한 병목 압력·수요 모멘텀·전이 제안. 지도(severity)는
// 루틴이 검증 후 반영하므로, 웹에서는 '자동 신호'로만 표시한다.
function mcPulseFor(mid) {
  const p = MC_STATE.pulse;
  const r = p && p.markets && p.markets[mid];
  return r && r.status === "ok" ? r : null;
}

// 노드용 압력 화살표: 조여옴(▲)/풀림(▼). |압력| 이 임계 미만이면 null.
function mcPulseArrow(mid) {
  const r = mcPulseFor(mid);
  if (!r) return null;
  const th = (MC_STATE.pulse.params && MC_STATE.pulse.params.node_arrow_threshold) || 0.35;
  if (r.bottleneck_pressure >= th) return { dir: "up", label: "▲", tone: "neg", v: r.bottleneck_pressure };
  if (r.bottleneck_pressure <= -th) return { dir: "down", label: "▼", tone: "pos", v: r.bottleneck_pressure };
  return null;
}

// ── 시장 단위 뉴스 헬퍼 ──────────────────────────────────────────────────
// 뉴스 스토어(분리 파일) 우선, 없으면 맵 안의 recent_news 폴백. 최신순 보장.
function mcNewsFor(m) {
  const store = MC_STATE.news && MC_STATE.news.markets;
  const items = (store && store[m.id]) || m.recent_news || [];
  return items.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// "2026-05-11" | "2026-05" → Date (월만 있으면 1일로). 실패 시 null.
function mcParseDate(s) {
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}$/.test(s) ? s + "-01" : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// 노드 배지용 짧은 날짜 라벨: 같은 해면 "M.D" / "M월", 다르면 "YY.M"
function mcDateShort(s) {
  const d = mcParseDate(s);
  if (!d) return "";
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return /^\d{4}-\d{2}$/.test(s) ? `${d.getMonth() + 1}월` : `${d.getMonth() + 1}.${d.getDate()}`;
  }
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`;
}

const MC_FRESH_DAYS = 14; // 이 기간 내 뉴스가 있으면 노드 배지를 '신규' 톤으로

function mcNewsFresh(items) {
  const d = items.length ? mcParseDate(items[0].date) : null;
  return !!d && (Date.now() - d.getTime()) / 86400000 <= MC_FRESH_DAYS;
}

// ── 다이어그램 배치 ──────────────────────────────────────────────────────
// JSON 의 diagram 블록이 배치의 SSOT: flow = 좌(공급의 뿌리)→우(최종 수요)
// 메인 체인 클러스터, bands = 하단 가로 밴드(피지컬 AI 체인·전력/DC 기반).
// diagram 에 없는 시장은 layer_default 가 가리키는 클러스터에 자동 배치.
function mcDiagramConfig(map) {
  let flow, bands, layerDefault;
  if (map.diagram && Array.isArray(map.diagram.flow)) {
    flow = map.diagram.flow.map((c) => ({ ...c, markets: [...(c.markets || [])] }));
    bands = (map.diagram.bands || []).map((c) => ({ ...c, markets: [...(c.markets || [])] }));
    layerDefault = map.diagram.layer_default || {};
  } else {
    // diagram 블록이 없으면 층 순서를 뒤집어(공급→수요) 클러스터로 사용
    flow = map.layers.slice().reverse().map((l) => ({
      id: l.id, title: l.label, desc: l.desc, color: null,
      markets: map.markets.filter((m) => m.layer === l.id).map((m) => m.id),
    }));
    bands = [];
    layerDefault = {};
  }
  const all = [...flow, ...bands];
  const placed = new Set(all.flatMap((c) => c.markets));
  map.markets.forEach((m) => {
    if (placed.has(m.id)) return;
    const target = all.find((c) => c.id === layerDefault[m.layer]) || flow[flow.length - 1];
    target.markets.push(m.id);
  });
  return { flow, bands };
}

// 클러스터 패널 (메인 체인은 세로 스택, 밴드는 가로 스트립)
function mcClusterEl(cl, stocks, band) {
  const map = MC_STATE.map;
  const el = document.createElement("section");
  el.className = "mcd-cluster" + (band ? " mcd-cluster--band" : "");
  el.dataset.cluster = cl.id;
  el.style.setProperty("--cl-c", cl.color || "#7f8a99");
  const nodes = cl.markets
    .map((id) => map.markets.find((m) => m.id === id))
    .filter(Boolean);
  el.innerHTML = `
    <header class="mcd-cluster-head">
      <h4>${escapeHtml(cl.title || cl.id)}</h4>
      ${cl.desc ? `<span>${escapeHtml(cl.desc)}</span>` : ""}
    </header>
    <div class="mcd-cluster-nodes">${nodes.map((m) => mcNodeHtml(m, stocks)).join("")}</div>`;
  return el;
}

// 보드 렌더: 메인 체인(좌→우) + 하단 밴드들
function renderMarketBoard(stocks) {
  const board = document.getElementById("vc-board");
  const map = MC_STATE.map;
  if (!board || !map) return;
  board.className = "vc-board mc-board" + (MC_STATE.bottleneckOnly ? " mc-board--btlonly" : "");
  board.innerHTML = "";

  const dia = mcDiagramConfig(map);
  // 시장 → 클러스터 매핑 (집계 흐름선용)
  MC_STATE.clusterOf = {};
  MC_STATE.bandClusters = new Set(dia.bands.map((c) => c.id));
  [...dia.flow, ...dia.bands].forEach((c) =>
    c.markets.forEach((mid) => { MC_STATE.clusterOf[mid] = c.id; }));

  const axis = document.createElement("div");
  axis.className = "mc-axis";
  const ax = (map.diagram && map.diagram.axis) || {};
  axis.innerHTML = `<span>${escapeHtml(ax.left || "공급의 뿌리 — 장비·소재")}</span>
                    <span class="mc-axis-mid">${escapeHtml(ax.mid || "물건·컴퓨트가 흐르는 방향 ▶")}</span>
                    <span>${escapeHtml(ax.right || "최종 수요 — 돈을 내는 곳")}</span>`;
  board.appendChild(axis);

  const strip = mcPulseStrip();
  if (strip) board.appendChild(strip);

  const main = document.createElement("div");
  main.className = "mcd-main";
  dia.flow.forEach((cl) => main.appendChild(mcClusterEl(cl, stocks, false)));
  board.appendChild(main);

  dia.bands.forEach((cl) => board.appendChild(mcClusterEl(cl, stocks, true)));

  board.querySelectorAll(".mc-node[data-id]").forEach((el) =>
    el.addEventListener("click", () => {
      selectMarketNode(el.dataset.id, stocks);
      // player_map 이 있는 세부 시장은 전용 화면(플레이어 지도)으로 확대
      const mm = map.markets.find((x) => x.id === el.dataset.id);
      if (mm && mm.player_map) pmOpen(mm.id);
      // 상세 패널이 지도 아래에 있으므로, 화면 밖이면 읽을 위치로 데려간다
      else mcScrollDetailIntoView();
    }));

  mcApplyZoom(false);
  // 레이아웃 확정 후 전체 관계선(다이어그램 엣지)을 그린다
  requestAnimationFrame(() => {
    drawAllMarketLinks();
    if (MC_STATE.activeNode && map.markets.some((m) => m.id === MC_STATE.activeNode)) {
      selectMarketNode(MC_STATE.activeNode, stocks);
    } else {
      clearMarketLinks();
    }
  });
}

// 자동 신호 스트립: 전이 제안·병목 이동 경보·주목 시장 (pulse 파일이 있을 때만)
function mcPulseStrip() {
  const p = MC_STATE.pulse;
  if (!p) return null;
  const alerts = p.alerts || [];
  const focus = p.top_focus || [];
  if (!alerts.length && !focus.length) return null;

  const chips = [];
  alerts.forEach((a) => {
    if (a.type === "severity_change_proposed") {
      const up = a.action === "escalate";
      chips.push(`<button class="mc-pulse-chip" data-goto="${escapeHtml(a.market)}" data-kind="${up ? "esc" : "de"}"
        title="뉴스 신호 기반 자동 제안 (압력 ${a.pressure >= 0 ? "+" : ""}${a.pressure}) — 루틴 검증 후 지도에 반영">
        ${up ? "⚠" : "▽"} ${escapeHtml(a.name_kr)} <em>${escapeHtml(a.from)} → ${escapeHtml(a.to)} 제안</em></button>`);
    } else if (a.type === "bottleneck_migration") {
      chips.push(`<button class="mc-pulse-chip" data-goto="${escapeHtml(a.to[0] || a.market)}" data-kind="mig"
        title="완화 중인 시장의 인접 시장이 조여옵니다">
        ⇢ 병목 이동? ${escapeHtml(a.name_kr)} → ${escapeHtml((a.to_names || []).join(" · "))}</button>`);
    }
  });
  const focusHtml = focus.length
    ? `<span class="mc-pulse-focus">주목: ${focus.slice(0, 3).map((f) =>
        `<button class="mc-pulse-mkt" data-goto="${escapeHtml(f.market)}"
           title="병목 압력·성장 전망 복합 점수 ${f.score >= 0 ? "+" : ""}${f.score}">${escapeHtml(f.name_kr)}</button>`).join(" · ")}</span>`
    : "";

  const el = document.createElement("div");
  el.className = "mc-pulse-strip";
  el.innerHTML = `<span class="mc-pulse-label" title="뉴스 스토어의 방향성 신호를 scripts/market_pulse.py 가 집계한 자동 신호 — 지도 반영은 주간 루틴이 검증 후 수행">
      📡 자동 신호 <em>${escapeHtml((p.generated || "").slice(0, 10))}</em></span>
    ${chips.join("")}${focusHtml}`;
  el.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => {
      selectMarketNode(b.dataset.goto, MC_STATE.stocks || {});
      const node = document.querySelector(`.mc-node[data-id="${CSS.escape(b.dataset.goto)}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  return el;
}

// 단일 시장 노드 — 콤팩트 (구조가 한눈에 읽히게 최소 정보만; 상세는 클릭 패널)
function mcNodeHtml(m, stocks) {
  const sev = m.bottleneck && m.bottleneck.severity;
  const hi = sev ? MC_SEVERITY_COLOR[sev] : null;   // 독점/병목만 강한 색, 그 외 클러스터 색
  const accent = hi || "var(--cl-c, var(--border-mid))";
  const tag = hi ? (MC_SEV_SHORT[sev] || "") : "";
  const agg = mcAggregateScore(m, stocks);
  const moodDot = agg.count > 0
    ? `<i class="mc-node-mood" data-tone="${agg.tone}" title="뉴스 시그널 ${agg.score >= 0 ? "+" : ""}${agg.score.toFixed(2)} (watchlist ${agg.count}곳)"></i>`
    : "";
  const news = mcNewsFor(m);
  const newsChip = news.length
    ? `<span class="mc-node-news${mcNewsFresh(news) ? " mc-node-news--fresh" : ""}"
         title="${escapeHtml(news[0].title || "")}">📰 ${news.length}</span>`
    : "";
  const wikiChip = (m.wiki || []).length
    ? `<span class="mc-node-wiki" title="옵시디언 위키 노트 ${m.wiki.length}개 연결 — 클릭하면 상세 패널에서 읽을 수 있습니다">📖 ${m.wiki.length}</span>`
    : "";
  const arrow = mcPulseArrow(m.id);
  const arrowChip = arrow
    ? `<span class="mc-node-pulse" data-dir="${arrow.dir}"
         title="자동 병목 신호 — 압력 ${arrow.v >= 0 ? "+" : ""}${arrow.v.toFixed(2)} (${arrow.dir === "up" ? "조여옴" : "풀림"})">${arrow.label}</span>`
    : "";
  const pmapChip = m.player_map
    ? `<span class="mc-node-pmap" title="클릭하면 이 시장만의 플레이어 지도(기업 단위)가 새 화면으로 열립니다">⤢ 플레이어 지도</span>`
    : "";
  return `<button class="mc-node${hi ? " mc-node--hi mc-node--" + sev : ""}" data-id="${escapeHtml(m.id)}"
            style="--mc-accent:${accent}" title="${escapeHtml(m.definition || "")}">
      ${tag ? `<span class="mc-node-tag">${escapeHtml(tag)}${arrowChip}</span>` : arrowChip ? `<span class="mc-node-tag mc-node-tag--pulse">${arrowChip}</span>` : ""}
      <span class="mc-node-name">${escapeHtml(m.name_kr)}${moodDot}</span>
      <span class="mc-node-size">${escapeHtml(m.size_label || "")}</span>
      ${newsChip}${wikiChip}${pmapChip}
    </button>`;
}

// 상세 패널(지도 아래)로 스크롤 — 이미 충분히 보이면 그대로 둔다.
// scroll-margin-top(CSS) 덕에 지도 하단이 문맥으로 함께 남는다.
function mcScrollDetailIntoView() {
  const host = document.getElementById("vc-detail");
  if (!host) return;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  if (host.getBoundingClientRect().top < vh * 0.65) return;
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 노드 선택: 강조 + 관계선 + 상세
function selectMarketNode(id, stocks) {
  MC_STATE.activeNode = id;
  const map = MC_STATE.map;
  const board = document.getElementById("vc-board");
  if (!map || !board) return;
  const needs    = map.links.filter((l) => l.from === id).map((l) => l.to);   // 의존하는 공급(우)
  const pulledBy = map.links.filter((l) => l.to === id).map((l) => l.from);   // 끌어당기는 수요(좌)
  const connected = new Set([...needs, ...pulledBy, id]);
  board.querySelectorAll(".mc-node").forEach((el) => {
    const t = el.dataset.id;
    el.classList.toggle("mc-node--active", t === id);
    el.classList.toggle("mc-node--linked", connected.has(t) && t !== id);
    el.classList.toggle("mc-node--dim", !connected.has(t));
  });
  highlightMarketLinks(id);
  renderMarketDetail(id, needs, pulledBy, stocks);
}

// ── 다이어그램 엣지 (피그마식) ──────────────────────────────────────────
// 모든 관계선을 항상 그려 한눈에 흐름이 보이게 하고, 노드 선택 시 그 노드의
// 선만 강조(+관계 라벨)하고 나머지는 흐리게 한다. 줌은 board/svg 에 같은
// scale 을 걸고, 좌표는 unscaled(레이아웃) 단위로 환산해 계산한다.

const MC_SVGNS = "http://www.w3.org/2000/svg";

// 노드의 보드 기준 좌표 (줌 보정된 레이아웃 단위)
function mcRectOf(id, wrap, wrapRect) {
  const el = wrap.querySelector(`.mc-node[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const z = MC_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

// 두 노드 사이 베지어 경로 + 라벨용 중점. 가로(컬럼 간)/세로(동일 컬럼) 자동 판별.
function mcEdgeGeo(a, b) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  let p1, p2, c1, c2;
  if (Math.abs(acx - bcx) >= Math.abs(acy - bcy)) {  // 가로: 왼쪽 노드 오른쪽 → 오른쪽 노드 왼쪽
    const aLeft = a.x < b.x;
    const lf = aLeft ? a : b, rt = aLeft ? b : a;
    p1 = { x: lf.x + lf.w, y: lf.y + lf.h / 2 };
    p2 = { x: rt.x, y: rt.y + rt.h / 2 };
    if (!aLeft) { const t = p1; p1 = p2; p2 = t; }     // 방향 보존 (a → b)
    const dx = Math.max(24, Math.abs(p2.x - p1.x) / 2) * (p2.x >= p1.x ? 1 : -1);
    c1 = { x: p1.x + dx, y: p1.y };
    c2 = { x: p2.x - dx, y: p2.y };
  } else {                                            // 세로: 위 노드 하단 → 아래 노드 상단
    const aUp = a.y < b.y;
    const up = aUp ? a : b, dn = aUp ? b : a;
    p1 = { x: up.x + up.w / 2, y: up.y + up.h };
    p2 = { x: dn.x + dn.w / 2, y: dn.y };
    if (!aUp) { const t = p1; p1 = p2; p2 = t; }
    const dy = Math.max(20, Math.abs(p2.y - p1.y) / 2) * (p2.y >= p1.y ? 1 : -1);
    c1 = { x: p1.x, y: p1.y + dy };
    c2 = { x: p2.x, y: p2.y - dy };
  }
  // 큐빅 베지어 t=0.5 지점 — 라벨 위치
  const mx = (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8;
  const my = (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8;
  return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, mx, my };
}

// 클러스터 패널의 보드 기준 좌표 (줌 보정)
function mcPanelRect(cid, wrap, wrapRect) {
  const el = wrap.querySelector(`.mcd-cluster[data-cluster="${CSS.escape(cid)}"]`);
  if (!el) return null;
  const z = MC_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

// 클러스터 흐름선 경로. 가로 흐름은 패널 상단 근처에 정렬해 선이 가지런하게.
function mcFlowPath(a, b, horiz, offA, offB) {
  if (horiz) {
    const dir = (b.x + b.w / 2) >= (a.x + a.w / 2) ? 1 : -1;
    const ay = a.y + Math.min(a.h / 2, 84) + offA;
    const by = b.y + Math.min(b.h / 2, 84) + offB;
    const p1 = { x: dir > 0 ? a.x + a.w : a.x, y: ay };
    const p2 = { x: dir > 0 ? b.x : b.x + b.w, y: by };
    const dx = Math.max(26, Math.abs(p2.x - p1.x) / 2) * dir;
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }
  // 세로(밴드 ↔ 메인): 상대 패널의 중심 x 에 맞춰 내리꽂는다
  const dir = (b.y + b.h / 2) >= (a.y + a.h / 2) ? 1 : -1;
  const bcx = b.x + b.w / 2;
  const x1 = Math.min(Math.max(bcx, a.x + 36), a.x + a.w - 36) + offA;
  const x2 = Math.min(Math.max(x1, b.x + 36), b.x + b.w - 36) + offB;
  const p1 = { x: x1, y: dir > 0 ? a.y + a.h : a.y };
  const p2 = { x: x2, y: dir > 0 ? b.y : b.y + b.h };
  const dy = Math.max(22, Math.abs(p2.y - p1.y) / 2) * dir;
  return `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + dy}, ${p2.x} ${p2.y - dy}, ${p2.x} ${p2.y}`;
}

// 노드 단위 엣지 1개 (밴드 내부 체인·선택 노드 세부선). 방향: 공급(to) → 수요(from)
function mcAddNodeEdge(svg, wrap, wrapRect, l, cls, marker, withLabel) {
  const a = mcRectOf(l.to, wrap, wrapRect), b = mcRectOf(l.from, wrap, wrapRect);
  if (!a || !b) return;
  const g = mcEdgeGeo(a, b);
  const path = document.createElementNS(MC_SVGNS, "path");
  path.setAttribute("d", g.d);
  path.setAttribute("class", cls);
  path.setAttribute("marker-end", `url(#${marker})`);
  svg.appendChild(path);
  if (withLabel && l.label) {
    const t = document.createElementNS(MC_SVGNS, "text");
    t.setAttribute("class", "mc-edge-label");
    t.setAttribute("x", g.mx.toFixed(1));
    t.setAttribute("y", (g.my - 5).toFixed(1));
    t.setAttribute("text-anchor", "middle");
    t.textContent = l.label;
    svg.appendChild(t);
  }
}

// 전체 엣지 렌더. 기본 상태는 '클러스터 사이 집계 흐름선'만 보여 깔끔하게 유지하고,
// 밴드 내부 체인(부품→로봇→국방 등)은 노드 단위로, 세부 관계선은 노드 선택 시에만.
function drawAllMarketLinks() {
  const svg  = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const map  = MC_STATE.map;
  if (!svg || !wrap || !map) return;
  const wrapRect = wrap.getBoundingClientRect();
  if (wrapRect.width === 0) return; // 패널이 숨겨져 있으면 skip

  // 처음 보일 때 화면 폭에 맞춰 자동 줌 (mcFitZoom → mcApplyZoom → 여기로 재진입)
  if (!MC_STATE.userZoomed && !MC_STATE.fitted) {
    MC_STATE.fitted = true;
    mcFitZoom();
    return;
  }

  svg.innerHTML = "";
  const board = document.getElementById("vc-board");
  svg.setAttribute("width", board ? board.scrollWidth : wrap.scrollWidth);
  svg.setAttribute("height", board ? board.scrollHeight : wrap.scrollHeight);

  const defs = document.createElementNS(MC_SVGNS, "defs");
  defs.innerHTML = `
    <marker id="mc-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#5c6470"></path>
    </marker>
    <marker id="mc-arr-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#c2c9d4"></path>
    </marker>`;
  svg.appendChild(defs);

  const cOf = MC_STATE.clusterOf || {};
  const bands = MC_STATE.bandClusters || new Set();

  // 1) 링크를 클러스터 쌍으로 집계 (방향: 공급 to → 수요 from)
  const flows = new Map();
  map.links.forEach((l) => {
    const src = cOf[l.to], dst = cOf[l.from];
    if (!src || !dst) return;
    if (src === dst) {
      // 같은 클러스터 안: 밴드의 체인(부품→로봇→국방)만 노드 단위로 표시
      if (bands.has(src)) mcAddNodeEdge(svg, wrap, wrapRect, l, "mc-edge mc-band-edge", "mc-arr", false);
      return;
    }
    const k = `${src}→${dst}`;
    const f = flows.get(k) || { src, dst, count: 0, labels: [] };
    f.count += 1;
    if (l.label && f.labels.length < 3) f.labels.push(l.label);
    flows.set(k, f);
  });

  // 2) 패널 좌표 + 방향 판별
  const items = [];
  flows.forEach((f) => {
    const a = mcPanelRect(f.src, wrap, wrapRect), b = mcPanelRect(f.dst, wrap, wrapRect);
    if (!a || !b) return;
    const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) >= Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    items.push({ ...f, a, b, horiz });
  });

  // 3) 같은 패널 면에서 나가는/들어오는 선끼리 anchor 를 벌려 겹침 방지
  const groupPush = (m, k, it) => { const arr = m.get(k) || []; arr.push(it); m.set(k, arr); };
  const outG = new Map(), inG = new Map();
  items.forEach((it) => {
    groupPush(outG, `${it.src}:${it.horiz ? "h" : "v"}`, it);
    groupPush(inG,  `${it.dst}:${it.horiz ? "h" : "v"}`, it);
  });
  outG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.b.y - q.b.y) : (p.b.x - q.b.x)));
    arr.forEach((it, i) => { it.offA = (i - (arr.length - 1) / 2) * 22; });
  });
  inG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.a.y - q.a.y) : (p.a.x - q.a.x)));
    arr.forEach((it, i) => { it.offB = (i - (arr.length - 1) / 2) * 22; });
  });

  // 4) 흐름선 그리기 — 연결 수에 따라 굵기
  items.forEach((it) => {
    const p = document.createElementNS(MC_SVGNS, "path");
    p.setAttribute("d", mcFlowPath(it.a, it.b, it.horiz, it.offA || 0, it.offB || 0));
    p.setAttribute("class", "mc-flow");
    p.setAttribute("stroke-width", (1.3 + Math.min(2.4, (it.count - 1) * 0.45)).toFixed(1));
    p.setAttribute("marker-end", "url(#mc-arr)");
    const ti = document.createElementNS(MC_SVGNS, "title");
    ti.textContent = `${it.count}개 연결 — ${it.labels.join(" · ")}`;
    p.appendChild(ti);
    svg.appendChild(p);
  });

  // 5) 활성 노드가 있으면 세부 관계선
  if (MC_STATE.activeNode) mcDrawActiveEdges(MC_STATE.activeNode);
}

// 선택 노드의 세부 관계선 + 라벨. 흐름선은 흐리게.
function mcDrawActiveEdges(id) {
  const svg  = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const map  = MC_STATE.map;
  if (!svg || !wrap || !map) return;
  svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
  svg.querySelectorAll(".mc-flow, .mc-band-edge").forEach((p) => p.classList.add("mc-flow--dim"));
  const wrapRect = wrap.getBoundingClientRect();
  map.links.filter((l) => l.from === id || l.to === id).forEach((l) =>
    mcAddNodeEdge(svg, wrap, wrapRect, l, "mc-edge mc-active-edge", "mc-arr-hi", true));
}

function highlightMarketLinks(id) {
  const svg = document.getElementById("vc-links");
  if (svg && !svg.querySelector(".mc-flow")) drawAllMarketLinks(); // 탭 숨김 중 스킵됐으면 재시도
  mcDrawActiveEdges(id);
}

function clearMarketLinks() {
  const svg = document.getElementById("vc-links");
  if (svg) {
    svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
    svg.querySelectorAll(".mc-flow--dim").forEach((p) => p.classList.remove("mc-flow--dim"));
  }
  const board = document.getElementById("vc-board");
  if (board) board.querySelectorAll(".mc-node").forEach((el) =>
    el.classList.remove("mc-node--active", "mc-node--linked", "mc-node--dim"));
}

// 줌 적용: board/svg 에 동일 scale, 좌표 재계산
function mcApplyZoom(redraw = true) {
  const board = document.getElementById("vc-board");
  const svg = document.getElementById("vc-links");
  const z = MC_STATE.zoom || 1;
  [board, svg].forEach((el) => {
    if (!el) return;
    el.style.transform = z === 1 ? "" : `scale(${z})`;
    el.style.transformOrigin = "0 0";
  });
  const v = document.getElementById("mc-zoom-val");
  if (v) v.textContent = `${Math.round(z * 100)}%`;
  if (redraw) {
    drawAllMarketLinks();
    if (MC_STATE.activeNode) highlightMarketLinks(MC_STATE.activeNode);
  }
}

// 화면 폭에 맞춰 자동 줌 (처음 표시·전체화면 전환 시)
function mcFitZoom() {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  const board = document.getElementById("vc-board");
  if (!wrap || !board || wrap.clientWidth === 0 || board.scrollWidth === 0) return;
  const z = Math.min(1.8, Math.max(0.55, (wrap.clientWidth - 16) / board.scrollWidth));
  MC_STATE.zoom = Math.round(z * 100) / 100;
  mcApplyZoom();
}

// 지정 화면 좌표를 고정점으로 줌 (휠·핀치·버튼 공용)
function mcZoomTo(clientX, clientY, z) {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  if (!wrap) return;
  const old = MC_STATE.zoom || 1;
  z = Math.min(2.2, Math.max(0.4, z));
  if (Math.abs(z - old) < 0.001) return;
  const r = wrap.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  const ratio = z / old;
  MC_STATE.zoom = Math.round(z * 1000) / 1000;
  MC_STATE.userZoomed = true;
  mcApplyZoom();
  wrap.scrollLeft = (wrap.scrollLeft + px) * ratio - px;
  wrap.scrollTop  = (wrap.scrollTop + py) * ratio - py;
}

// 캔버스 인터랙션 (1회 와이어링): Ctrl/⌘+휠 줌 · 터치 핀치 줌 · 마우스 드래그 패닝
function mcWireCanvas() {
  const svg = document.getElementById("vc-links");
  const wrap = svg && svg.parentElement;
  if (!wrap || wrap.dataset.mcWired) return;
  wrap.dataset.mcWired = "1";

  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // 일반 휠 = 스크롤
    e.preventDefault();
    mcZoomTo(e.clientX, e.clientY, (MC_STATE.zoom || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) pinch = { d: dist(e.touches), z: MC_STATE.zoom || 1 };
  }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    mcZoomTo(cx, cy, pinch.z * dist(e.touches) / pinch.d);
  }, { passive: false });
  wrap.addEventListener("touchend", () => { pinch = null; }, { passive: true });

  let drag = null;
  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".mc-node, button, a, input, label")) return;
    drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add("mc-grabbing");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    wrap.scrollLeft = drag.sl - (e.clientX - drag.x);
    wrap.scrollTop  = drag.st - (e.clientY - drag.y);
  });
  window.addEventListener("mouseup", () => { drag = null; wrap.classList.remove("mc-grabbing"); });
}

// 전체 화면 모드: 시장 지도 섹션을 화면에 고정하고 다시 맞춤 줌
function mcToggleFull(force) {
  const board = document.getElementById("vc-board");
  const section = board && board.closest(".sector-panel");
  if (!section) return;
  const on = force !== undefined ? force : !section.classList.contains("mc-full");
  if (force === false && !section.classList.contains("mc-full")) return;
  section.classList.toggle("mc-full", on);
  document.body.classList.toggle("mc-noscroll", on);
  const btn = document.getElementById("mc-full");
  if (btn) btn.textContent = on ? "✕" : "⛶";
  MC_STATE.fitted = false;
  MC_STATE.userZoomed = false;
  requestAnimationFrame(() => drawAllMarketLinks());
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (PM_STATE.open) { pmClose(); return; } // 플레이어 지도가 열려 있으면 그것부터 닫는다
  mcToggleFull(false);
});

// 보드 하단 통합 뉴스 피드 — 전 시장의 뉴스를 최신순 한 줄씩.
// 시장 칩을 클릭하면 지도에서 그 시장 노드가 선택·스크롤된다 (뉴스 ↔ 지도 연결).
function renderMarketNewsFeed(stocks) {
  const host = document.getElementById("mc-feed");
  const map = MC_STATE.map;
  if (!host || !map) return;
  const all = [];
  map.markets.forEach((m) => mcNewsFor(m).forEach((n) => all.push({ m, n })));
  all.sort((a, b) => String(b.n.date || "").localeCompare(String(a.n.date || "")));
  if (!all.length) { host.innerHTML = ""; return; }

  const row = ({ m, n }) => {
    const tone = n.impact === "+" ? "pos" : n.impact === "-" ? "neg" : "neutral";
    const sev = m.bottleneck && m.bottleneck.severity;
    const accent = (sev && MC_SEVERITY_COLOR[sev]) || "var(--border-mid)";
    const title = n.url
      ? `<a class="mc-feed-title" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title || "")}</a>`
      : `<span class="mc-feed-title">${escapeHtml(n.title || "")}</span>`;
    return `<li class="mc-feed-item" data-tone="${tone}">
        <span class="mc-feed-date">${escapeHtml(mcDateShort(n.date))}</span>
        <button class="mc-feed-mkt" data-market="${escapeHtml(m.id)}" style="--mc-accent:${accent}"
          title="지도에서 이 시장 보기">${escapeHtml(m.name_kr)}</button>
        <span class="mc-feed-body">${title}
          ${n.summary ? `<span class="mc-feed-sum">${escapeHtml(n.summary)}</span>` : ""}
        </span>
      </li>`;
  };

  const FEED_MAX = 12;
  host.innerHTML = `
    <header class="mc-feed-head">
      <h3>시장 뉴스 피드</h3>
      <span class="mc-feed-hint">전 시장 최신순 — 시장 이름을 누르면 지도에서 그 시장이 선택됩니다</span>
    </header>
    <ul class="mc-feed-list">${all.slice(0, FEED_MAX).map(row).join("")}</ul>
    ${all.length > FEED_MAX
      ? `<details class="mc-feed-more"><summary>지난 뉴스 ${all.length - FEED_MAX}건 더 보기</summary>
           <ul class="mc-feed-list">${all.slice(FEED_MAX).map(row).join("")}</ul></details>`
      : ""}`;

  host.querySelectorAll(".mc-feed-mkt[data-market]").forEach((b) =>
    b.addEventListener("click", () => {
      selectMarketNode(b.dataset.market, stocks);
      const node = document.querySelector(`.mc-node[data-id="${CSS.escape(b.dataset.market)}"]`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
}

// 상세 패널: 분위기 · 주간 흐름 · 병목 · 시장 뉴스 · 점유율/플레이어 · 관계 · 출처
function renderMarketDetail(id, needs, pulledBy, stocks) {
  const host = document.getElementById("vc-detail");
  const map = MC_STATE.map;
  if (!host || !map) return;
  const m = map.markets.find((x) => x.id === id);
  if (!m) return;

  const nameOf = (mid) => { const x = map.markets.find((y) => y.id === mid); return x ? x.name_kr : mid; };
  const labelFor = (mid, dir) => {
    const link = dir === "need"
      ? map.links.find((l) => l.from === id && l.to === mid)
      : map.links.find((l) => l.from === mid && l.to === id);
    return link ? link.label : "";
  };
  const relHtml = (list, dir, title) => {
    if (!list.length) return "";
    const items = list.map((mid) =>
      `<li><button class="mc-rel-link" data-goto="${escapeHtml(mid)}">${escapeHtml(nameOf(mid))}</button>
         <span class="mc-rel-label">${escapeHtml(labelFor(mid, dir))}</span></li>`).join("");
    return `<div class="mc-rel-block"><h5>${title}</h5><ul>${items}</ul></div>`;
  };

  let btlHtml = "";
  if (m.bottleneck) {
    const sev = m.bottleneck.severity, leg = map.severity_legend[sev] || {};
    const c = MC_SEVERITY_COLOR[sev] || "var(--text-dim)";
    btlHtml = `<div class="mc-btl-box" style="--mc-c:${c}">
        <span class="mc-btl-tag">${escapeHtml(leg.label || sev)}</span>
        <p class="mc-btl-text">${escapeHtml(m.bottleneck.limit)}</p>
      </div>`;
  }

  const agg = mcAggregateScore(m, stocks);
  const mood = mcMood(agg);
  const moodHtml = mood
    ? `<p class="mc-mood" data-tone="${mood.tone}"><span>시장 분위기</span> <strong>${escapeHtml(mood.t)}</strong> · 뉴스 시그널 ${agg.score >= 0 ? "+" : ""}${agg.score.toFixed(2)} (watchlist ${agg.count}곳)</p>`
    : `<p class="mc-mood mc-mood--none"><span>시장 분위기</span> watchlist 뉴스 데이터 연결 전</p>`;

  // 자동 병목 신호 (market pulse) — 압력·수요 모멘텀 게이지 + 전이 제안 + 근거
  let pulseHtml = "";
  const pr = mcPulseFor(id);
  if (pr) {
    const gauge = (v, label) => {
      const pct = Math.round(Math.abs(v) * 50);
      const side = v >= 0 ? "right" : "left";
      const tone = v >= 0.2 ? "neg" : v <= -0.2 ? "pos" : "neutral";
      return `<div class="mc-pulse-gauge" title="${escapeHtml(label)} ${v >= 0 ? "+" : ""}${v.toFixed(2)}">
          <span class="mc-pulse-gname">${escapeHtml(label)}</span>
          <span class="mc-pulse-bar"><i data-side="${side}" data-tone="${tone}" style="width:${pct}%"></i></span>
          <span class="mc-pulse-gval">${v >= 0 ? "+" : ""}${v.toFixed(2)}</span>
        </div>`;
    };
    const prop = pr.proposal
      ? `<p class="mc-pulse-prop" data-kind="${pr.proposal.action === "escalate" ? "esc" : "de"}">
           ${pr.proposal.action === "escalate" ? "⚠ 승급 제안" : "▽ 완화 제안"}:
           <strong>${escapeHtml(pr.proposal.from)} → ${escapeHtml(pr.proposal.to)}</strong>
           (신뢰도 ${escapeHtml(pr.proposal.confidence)}) — 루틴 검증 후 지도 반영</p>`
      : "";
    const noteHtml = pr.note ? `<p class="mc-pulse-note">${escapeHtml(pr.note)}</p>` : "";
    const bene = (pr.beneficiaries || []).length
      ? `<p class="mc-pulse-bene">가격결정력 신호 — ${pr.beneficiaries.map((b) =>
          `${escapeHtml(b.name)}${typeof b.share === "number" ? ` ${b.share}%` : ""}`).join(" · ")}</p>`
      : "";
    const evid = (pr.evidence || []).slice(0, 3).map((e) =>
      `<li><span class="mc-pulse-etype" data-t="${escapeHtml(e.type)}">${
          e.type === "supply_tightening" ? "긴축" : e.type === "supply_easing" ? "완화" :
          e.type === "demand_up" ? "수요↑" : "수요↓"}</span> ${escapeHtml(e.title)} <em>${escapeHtml(e.date || "")}</em></li>`).join("");
    pulseHtml = `<div class="mc-pulse-box">
        <h5>자동 병목 신호 <span class="mc-pulse-meta">뉴스 ${pr.signal_count}건 · 출처 ${pr.source_count}곳 (감쇠 가중)</span></h5>
        ${gauge(pr.bottleneck_pressure, "병목 압력")}
        ${gauge(pr.demand_momentum, "수요 모멘텀")}
        ${prop}${noteHtml}${bene}
        ${evid ? `<ul class="mc-pulse-evid">${evid}</ul>` : ""}
      </div>`;
  }

  const weeklyHtml = m.weekly_note
    ? `<div class="mc-weekly"><h5>이번 주 시장 흐름</h5><p>${escapeHtml(m.weekly_note)}</p></div>`
    : "";

  const newsItems = mcNewsFor(m);
  const newsLi = (n) => {
    const tone = n.impact === "+" ? "pos" : n.impact === "-" ? "neg" : "neutral";
    const meta = [n.source, n.date].filter(Boolean).join(" · ");
    const title = n.url
      ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title || "")}</a>`
      : escapeHtml(n.title || "");
    return `<li class="mc-news-item" data-tone="${tone}">
        <span class="mc-news-title">${title}</span>
        ${n.summary ? `<span class="mc-news-sum">${escapeHtml(n.summary)}</span>` : ""}
        ${meta ? `<span class="mc-news-src">${escapeHtml(meta)}</span>` : ""}
      </li>`;
  };
  const NEWS_VISIBLE = 6;
  const newsHtml = newsItems.length
    ? `<div class="mc-news"><h5>이 시장의 뉴스 <span class="mc-news-count">${newsItems.length}건</span></h5>
        <ul>${newsItems.slice(0, NEWS_VISIBLE).map(newsLi).join("")}</ul>
        ${newsItems.length > NEWS_VISIBLE
          ? `<details class="mc-news-more"><summary>지난 뉴스 ${newsItems.length - NEWS_VISIBLE}건 더 보기</summary>
               <ul>${newsItems.slice(NEWS_VISIBLE).map(newsLi).join("")}</ul></details>`
          : ""}
      </div>`
    : `<div class="mc-news mc-news--empty"><h5>이 시장의 뉴스</h5><p>아직 수집된 시장 뉴스가 없습니다 — 주간 리서치 루틴이 채웁니다.</p></div>`;

  // 점유율 바 + 플레이어 목록(점유율·뉴스 점수)
  const barHtml = mcShareBar(m.players);
  const playersHtml = (m.players || []).map((p) => {
    let chip = "", cls = "mc-player";
    if (p.ticker && p.in_watchlist) {
      cls += " mc-player--data";
      const q = stocks && stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
      if (q && typeof q.narrative_score === "number") {
        const tone = q.narrative_score > 0.05 ? "pos" : q.narrative_score < -0.05 ? "neg" : "neutral";
        chip = `<span class="mc-player-score" data-tone="${tone}">${q.narrative_score >= 0 ? "+" : ""}${q.narrative_score.toFixed(2)}</span>`;
      } else {
        chip = `<span class="mc-player-score" data-tone="neutral">—</span>`;
      }
    } else {
      chip = `<span class="mc-player-ext">${p.ticker ? "데이터 예정" : "비상장"}</span>`;
    }
    const tk = p.ticker ? `<span class="mc-player-tk">${escapeHtml(p.ticker)}</span>` : "";
    const share = typeof p.share === "number" ? `<span class="mc-player-share">${p.share}%</span>` : "";
    return `<li class="${cls}">
        <span class="mc-player-name">${escapeHtml(p.name)} ${tk}</span>
        <span class="mc-player-role">${escapeHtml(p.role || "")}</span>
        ${share}${chip}
      </li>`;
  }).join("");

  const sizeMeta = [
    m.size_label ? `규모 <strong>${escapeHtml(m.size_label)}</strong>` : "",
    m.growth ? `성장 ${escapeHtml(m.growth)}` : "",
    m.size_confidence ? `<span class="mc-conf mc-conf--${escapeHtml(m.size_confidence)}">신뢰도 ${escapeHtml(m.size_confidence)}</span>` : "",
  ].filter(Boolean).join(" · ");

  const srcHtml = (m.sources || []).length
    ? `<details class="mc-sources"><summary>출처 ${m.sources.length}</summary><ul>${
        m.sources.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(String(u).replace(/^https?:\/\//, "").split("/")[0])}</a></li>`).join("")
      }</ul></details>`
    : "";

  const layerLabel = (map.layers.find((l) => l.id === m.layer) || {}).label || "";
  const accent = m.bottleneck ? (MC_SEVERITY_COLOR[m.bottleneck.severity] || "var(--border-mid)") : "var(--border-mid)";

  const pmBtn = m.player_map
    ? `<button type="button" class="pm-open-btn" data-pm="${escapeHtml(m.id)}"
         title="이 시장만을 기업(플레이어) 단위로 펼친 전용 화면">⤢ 플레이어 지도 열기 — 기업 단위로 확대</button>`
    : "";

  host.innerHTML = `
    <header class="mc-detail-head" style="--mc-accent:${accent}">
      <span class="mc-detail-layer">${escapeHtml(layerLabel)}</span>
      <h4>${escapeHtml(m.name_kr)}</h4>
      <p class="mc-detail-en">${escapeHtml(m.name_en || "")}</p>
    </header>
    <p class="mc-detail-def">${escapeHtml(m.definition || "")}</p>
    ${pmBtn}
    ${sizeMeta ? `<p class="mc-detail-size">${sizeMeta}</p>` : ""}
    ${m.demand_driver ? `<p class="mc-detail-driver"><span>수요 동인</span>${escapeHtml(m.demand_driver)}</p>` : ""}
    ${btlHtml}
    ${pulseHtml}
    ${moodHtml}
    ${weeklyHtml}
    ${newsHtml}
    <div class="mc-wiki" hidden></div>
    <div class="mc-players">
      <h5>시장 점유율 · 핵심 플레이어</h5>
      ${barHtml ? `<div class="mc-share-wrap">${barHtml}</div>` : ""}
      <ul>${playersHtml}</ul>
    </div>
    ${relHtml(needs, "need", "◀ 의존하는 공급 (상류)")}
    ${relHtml(pulledBy, "pull", "끌어당기는 수요 (하류) ▶")}
    ${srcHtml}`;

  host.querySelectorAll(".mc-rel-link[data-goto]").forEach((b) =>
    b.addEventListener("click", () => selectMarketNode(b.dataset.goto, stocks)));
  const pb = host.querySelector(".pm-open-btn[data-pm]");
  if (pb) pb.addEventListener("click", () => pmOpen(pb.dataset.pm));
  mcFillWikiSlot(host.querySelector(".mc-wiki"), m.wiki, m.players);
  mcRenderMarketNote(m);
}

// ── 시장 노드 종합 노트 (지도 아래 인라인) ─────────────────────────────
// 루틴이 관리하는 luke_wiki 의 시장 노드별 종합 페이지
// (wiki/news/markets/{map_id}/{market_id}.md — 시장 정의·병목·기업 동향·뉴스 로그)
// 를 노드 선택 시 지도 아래에 바로 펼쳐 보여준다. 파일이 없는 지도(전력·바이오)는 숨김.

let MC_NOTE_REQ = 0;

async function mcRenderMarketNote(m) {
  const host = document.getElementById("mc-note");
  if (!host) return;
  const req = ++MC_NOTE_REQ;
  const graph = await wnLoadGraph();
  if (req !== MC_NOTE_REQ || !host.isConnected) return;  // 그 사이 다른 노드 선택
  const idx = graph ? wnNodeByPath(`wiki/news/markets/${MC_STATE.mapId}/${m.id}.md`) : -1;
  if (idx < 0) { mcHideMarketNote(); return; }
  await wnFillInlineNote(host, idx, { kind: "시장 종합 노트 (루틴 관리)", title: `${m.name_kr} — 시장 종합` });
  wnScrollNoteIntoView(host);
}

// 노트가 화면 밖(아래)이면 읽을 위치로 데려간다 — 이미 보이면 건드리지 않는다
function wnScrollNoteIntoView(host) {
  if (!host || host.hidden || !host.isConnected) return;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const top = host.getBoundingClientRect().top;
  if (top >= 0 && top < vh * 0.7) return;
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

function mcHideMarketNote() {
  const host = document.getElementById("mc-note");
  if (host) { host.hidden = true; host.innerHTML = ""; }
}

// ── 옵시디언 위키 노트 연결 ─────────────────────────────────────────────
// 시장 지도의 짧은 요약을 luke_wiki 의 긴 글로 확장하는 다리.
// 두 경로로 노트를 모은다:
//   1) 큐레이션 — 시장 JSON 의 markets[].wiki: [{path, label}] (vault 상대 경로)
//   2) 자동     — players[].ticker 와 루틴 뉴스 로그(wiki/news/tickers/) 매칭
// graph.json 이 아직 동기화 전이면 섹션을 통째로 숨긴다 (위키 탭에 안내 있음).

const MC_WIKI_KIND = {
  "wiki/principles": "원칙", "wiki/concepts": "개념", "wiki/topics": "주제",
  "wiki/entities": "기업·조직", "wiki/syntheses": "내 판단", "wiki/comparisons": "비교",
  "wiki/news": "뉴스 로그", "sources": "원문",
};

async function mcFillWikiSlot(slot, curated, players) {
  if (!slot) return;
  const graph = await wnLoadGraph();
  // fetch 대기 중 다른 노드를 선택했으면 slot 은 이미 DOM 에서 떨어져 있다
  if (!graph || !slot.isConnected) return;

  const refs = [], seen = new Set();
  (curated || []).forEach((w) => {
    const i = wnNodeByPath(w.path);
    if (i < 0 || seen.has(i)) return;
    seen.add(i);
    const n = graph.nodes[i];
    refs.push({ idx: i, label: w.label || n.title, kind: MC_WIKI_KIND[n.folder] || n.folder, mtime: n.mtime });
  });
  (players || []).forEach((p) => {
    if (!p.ticker) return;
    const i = wnNodeByTicker(p.ticker);
    if (i < 0 || seen.has(i)) return;
    seen.add(i);
    refs.push({ idx: i, label: `${p.name} 뉴스 로그`, kind: "뉴스 로그", auto: true, mtime: graph.nodes[i].mtime });
  });
  if (!refs.length) return;

  slot.innerHTML = `
    <h5>옵시디언 위키 노트 <span class="mc-news-count">${refs.length}</span></h5>
    <p class="mc-wiki-hint">루틴·공부로 쌓인 긴 글 — 클릭하면 이 화면에서 읽습니다.</p>
    <ul>${refs.map((r, k) => `
      <li><button type="button" class="mc-wiki-btn" data-ref="${k}">
        <span class="mc-wiki-kind${r.auto ? " mc-wiki-kind--auto" : ""}">${escapeHtml(r.kind)}</span>
        <span class="mc-wiki-title">${escapeHtml(r.label)}</span>
        ${r.mtime ? `<span class="mc-wiki-mtime">${escapeHtml(r.mtime)}</span>` : ""}
      </button></li>`).join("")}
    </ul>`;
  slot.hidden = false;
  slot.querySelectorAll(".mc-wiki-btn").forEach((b) =>
    b.addEventListener("click", () => wnOpenByIdx(refs[Number(b.dataset.ref)].idx)));
}

// 서브탭이 보일 때 / 리사이즈 시 전체 엣지 다시 그리기
// (wireSectorNav 가 서브탭 전환마다 window resize 를 디스패치한다)
window.addEventListener("resize", () => {
  if (PM_STATE.open) {
    if (!PM_STATE.userZoomed) pmFitZoom();
    pmDrawLinks();
  }
  if (!MC_STATE.map) return;
  drawAllMarketLinks();
  if (MC_STATE.activeNode) highlightMarketLinks(MC_STATE.activeNode);
});

// ════════════════════════════════════════════════════════════════════════
//  플레이어 지도 (player map) — 세부 시장 하나를 기업 단위로 펼친 전용 화면
// ════════════════════════════════════════════════════════════════════════
//
// 시장 지도가 '시장(수요)' 단위라면, 플레이어 지도는 그 중 한 시장을 골라
// 기업(플레이어) 단위로 다시 그린 확대경이다. 시장 JSON 의 markets[].player_map
// 이 가리키는  data/markets/players/<id>.json  이 데이터 SSOT 이며,
// 그 시장의 밸류체인을 그룹(컬럼: 장비·소재 → 제조 → 패키징 → 고객)과
// 기업 노드·거래선(links: 공급자 from → 수요자 to)으로 정의한다.
//
// 시각 문법은 시장 지도와 동일: 기본은 그룹 사이 집계 흐름선만 보여주고,
// 기업을 클릭하면 그 기업의 거래선(+라벨)만 강조하고 나머지는 흐려진다.
// 우측 패널은 처음엔 시장 요약, 기업 선택 시 그 기업의 상세·거래 관계.
// 지도 노드 클릭 → 오버레이(새 화면)로 열리고, ESC / ← 로 시장 지도에 복귀.

const PM_STATE = { open: false, data: null, market: null, cache: {}, active: null, zoom: 1, userZoomed: false };
const PM_FLAGS = { KR: "🇰🇷", US: "🇺🇸", JP: "🇯🇵", NL: "🇳🇱", TW: "🇹🇼", HK: "🇭🇰", CN: "🇨🇳", EU: "🇪🇺" };

// 진입점: 시장 id 로 플레이어 지도 데이터를 로드(1회 캐시)하고 오버레이를 연다
async function pmOpen(marketId) {
  const map = MC_STATE.map;
  const m = map && map.markets.find((x) => x.id === marketId);
  const host = document.getElementById("pm-overlay");
  if (!m || !m.player_map || !host) return;
  if (!PM_STATE.cache[m.id]) {
    try {
      const res = await fetch(`data/markets/${m.player_map}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      PM_STATE.cache[m.id] = await res.json();
    } catch (err) {
      host.hidden = false;
      host.innerHTML = `<header class="pm-head">
          <button type="button" class="pm-back" id="pm-back">← 시장 지도</button>
          <div class="pm-title"><h3>${escapeHtml(m.name_kr)} 플레이어 지도</h3>
            <p>데이터를 불러오지 못했습니다 (${escapeHtml(err.message)})</p></div></header>`;
      PM_STATE.open = true;
      document.body.classList.add("mc-noscroll");
      host.querySelector("#pm-back").addEventListener("click", pmClose);
      return;
    }
  }
  PM_STATE.data = PM_STATE.cache[m.id];
  PM_STATE.market = m;
  PM_STATE.active = null;
  PM_STATE.zoom = 1;
  PM_STATE.userZoomed = false;
  PM_STATE.open = true;
  document.body.classList.add("mc-noscroll");
  pmRender();
}

function pmClose() {
  const host = document.getElementById("pm-overlay");
  if (host) { host.hidden = true; host.innerHTML = ""; }
  PM_STATE.open = false;
  PM_STATE.active = null;
  // 시장 지도 전체화면(mc-full)에서 열렸다면 스크롤 잠금은 유지한다
  if (!document.querySelector(".sector-panel.mc-full")) document.body.classList.remove("mc-noscroll");
}

// 오버레이 전체 렌더: 헤더(복귀·병목 태그) + 축 + 그룹 컬럼 보드 + 우측 패널
function pmRender() {
  const host = document.getElementById("pm-overlay");
  const d = PM_STATE.data, m = PM_STATE.market;
  if (!host || !d || !m) return;
  const sev = m.bottleneck && m.bottleneck.severity;
  const sevLeg = sev ? (MC_STATE.map.severity_legend[sev] || {}) : null;
  const sevChip = sevLeg
    ? `<span class="pm-sev" style="--mc-c:${MC_SEVERITY_COLOR[sev] || "var(--text-dim)"}">${escapeHtml(sevLeg.label || sev)}</span>`
    : "";
  const ax = d.axis || {};
  host.hidden = false;
  host.innerHTML = `
    <header class="pm-head">
      <button type="button" class="pm-back" id="pm-back" title="시장 지도로 돌아가기 (ESC)">← 시장 지도</button>
      <div class="pm-title">
        <h3>${escapeHtml(d.name_kr || m.name_kr)} <span class="pm-title-sub">플레이어 지도</span>${sevChip}</h3>
        <p>${escapeHtml(d.subtitle || "")}${d.as_of ? ` <span class="pm-asof">· 기준 ${escapeHtml(d.as_of)}</span>` : ""}</p>
      </div>
      <button type="button" class="pm-close" id="pm-close" title="닫기 (ESC)">✕</button>
    </header>
    <div class="pm-layout">
      <div class="pm-board-wrap" id="pm-board-wrap">
        <svg class="pm-links" id="pm-links" aria-hidden="true"></svg>
        <div class="pm-board" id="pm-board">
          <div class="mc-axis">
            <span>${escapeHtml(ax.left || "장비·소재 — 공정을 가능케 하는 곳")}</span>
            <span class="mc-axis-mid">${escapeHtml(ax.mid || "물건이 흐르는 방향 ▶")}</span>
            <span>${escapeHtml(ax.right || "최종 고객 — 돈을 내는 곳")}</span>
          </div>
          <div class="pm-cols">${(d.groups || []).map((g) => pmGroupEl(g, d)).join("")}</div>
        </div>
      </div>
      <aside class="pm-detail" id="pm-detail">${pmMarketSummaryHtml()}</aside>
    </div>
    <section class="pm-note wn-inline" id="pm-note" hidden aria-label="옵시디언 노트"></section>`;
  host.querySelector("#pm-back").addEventListener("click", pmClose);
  host.querySelector("#pm-close").addEventListener("click", pmClose);
  host.querySelectorAll(".pm-player[data-id]").forEach((el) =>
    el.addEventListener("click", () => pmSelect(el.dataset.id)));
  pmWireCanvas();
  requestAnimationFrame(() => { pmFitZoom(); pmDrawLinks(); });
  pmShowMarketNote();
}

// ── 플레이어 지도 아래 인라인 옵시디언 노트 ─────────────────────────────
// 초기·선택해제 상태: 이 시장의 종합 노트. 기업 선택: 그 기업의 뉴스 로그.

async function pmShowMarketNote() {
  const host = document.getElementById("pm-note");
  const m = PM_STATE.market;
  if (!host || !m) return;
  const graph = await wnLoadGraph();
  if (!host.isConnected || PM_STATE.active) return;  // 그 사이 기업을 선택했으면 양보
  const idx = graph ? wnNodeByPath(`wiki/news/markets/${MC_STATE.mapId}/${m.id}.md`) : -1;
  if (idx < 0) { host.hidden = true; host.innerHTML = ""; return; }
  wnFillInlineNote(host, idx, { kind: "시장 종합 노트 (루틴 관리)", title: `${m.name_kr} — 시장 종합` });
}

async function pmShowPlayerNote(p) {
  const host = document.getElementById("pm-note");
  if (!host || !p) return;
  const graph = await wnLoadGraph();
  if (!host.isConnected || PM_STATE.active !== p.id) return;  // 선택이 바뀌었으면 중단
  const idx = graph && p.ticker ? wnNodeByTicker(p.ticker) : -1;
  if (idx < 0) {
    host.hidden = false;
    host.innerHTML = `
      <header class="wn-inline-head">
        <span class="wn-inline-kind">기업 뉴스 로그</span>
        <h4>${escapeHtml(p.name)}</h4>
      </header>
      <div class="wn-body wn-inline-body"><p class="wn-error">이 기업의 옵시디언 뉴스 로그가 아직 없습니다${p.ticker ? "" : " (비상장)"} — watchlist 편입 후 루틴이 생성합니다.</p></div>`;
    wnScrollNoteIntoView(host);
    return;
  }
  await wnFillInlineNote(host, idx, { kind: "기업 뉴스 로그 (루틴 관리)", title: `${p.name} — Routine News Log` });
  if (PM_STATE.active === p.id) wnScrollNoteIntoView(host);
}

// 그룹 컬럼 (center 그룹은 강조)
function pmGroupEl(g, d) {
  const players = (d.players || []).filter((p) => p.group === g.id);
  return `<section class="pm-col${g.center ? " pm-col--center" : ""}" data-group="${escapeHtml(g.id)}"
      style="--cl-c:${g.color || "#7f8a99"}">
    <header class="pm-col-head">
      <h4>${escapeHtml(g.title || g.id)}</h4>
      ${g.desc ? `<span>${escapeHtml(g.desc)}</span>` : ""}
    </header>
    <div class="pm-col-nodes">${players.map((p) => pmNodeHtml(p)).join("")}</div>
  </section>`;
}

// 기업 노드 — 국기 + 이름 (+점유율) + 역할 + 티커. watchlist 종목은 뉴스 시그널 점.
function pmNodeHtml(p) {
  const flag = PM_FLAGS[p.country] || "";
  const share = typeof p.share === "number" ? `<span class="pm-share">${p.share}%</span>` : "";
  let dot = "";
  const stocks = MC_STATE.stocks || {};
  if (p.ticker && p.in_watchlist) {
    const q = stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number") {
      const tone = q.narrative_score > 0.05 ? "pos" : q.narrative_score < -0.05 ? "neg" : "neutral";
      dot = `<i class="mc-node-mood" data-tone="${tone}" title="뉴스 시그널 ${q.narrative_score >= 0 ? "+" : ""}${q.narrative_score.toFixed(2)}"></i>`;
    }
  }
  const tk = p.ticker
    ? `<span class="pm-tk">${escapeHtml(p.ticker)}</span>`
    : `<span class="pm-tk pm-tk--private">비상장</span>`;
  return `<button type="button" class="pm-player" data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.role || "")}">
      <span class="pm-player-name">${flag ? `<span class="pm-flag">${flag}</span>` : ""}<span>${escapeHtml(p.name)}</span>${dot}${share}</span>
      <span class="pm-player-role">${escapeHtml(p.role || "")}</span>
      ${tk}
    </button>`;
}

// 기업 선택: 노드 강조 + 그 기업의 거래선만 표시 + 상세 패널
function pmSelect(id) {
  const d = PM_STATE.data;
  const board = document.getElementById("pm-board");
  if (!d || !board) return;
  PM_STATE.active = id;
  const suppliers = d.links.filter((l) => l.to === id).map((l) => l.from);   // 이 기업에 공급하는 곳
  const customers = d.links.filter((l) => l.from === id).map((l) => l.to);   // 이 기업이 공급하는 곳
  const connected = new Set([...suppliers, ...customers, id]);
  board.querySelectorAll(".pm-player").forEach((el) => {
    const t = el.dataset.id;
    el.classList.toggle("pm-player--active", t === id);
    el.classList.toggle("pm-player--linked", connected.has(t) && t !== id);
    el.classList.toggle("pm-player--dim", !connected.has(t));
  });
  pmDrawActiveEdges(id);
  pmRenderDetail(id, suppliers, customers);
  const p = (d.players || []).find((x) => x.id === id);
  if (p) pmShowPlayerNote(p);
}

// 선택 해제 → 시장 요약으로 복귀
function pmClearSelect() {
  const board = document.getElementById("pm-board");
  const svg = document.getElementById("pm-links");
  PM_STATE.active = null;
  if (board) board.querySelectorAll(".pm-player").forEach((el) =>
    el.classList.remove("pm-player--active", "pm-player--linked", "pm-player--dim"));
  if (svg) {
    svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
    svg.querySelectorAll(".mc-flow--dim").forEach((p) => p.classList.remove("mc-flow--dim"));
  }
  const detail = document.getElementById("pm-detail");
  if (detail) detail.innerHTML = pmMarketSummaryHtml();
  pmShowMarketNote();
}

// 우측 패널 초기 상태 — 이 세부 시장의 요약 (정의·병목·3사 점유율·읽는 법)
function pmMarketSummaryHtml() {
  const m = PM_STATE.market, d = PM_STATE.data, map = MC_STATE.map;
  if (!m || !d) return "";
  const accent = m.bottleneck ? (MC_SEVERITY_COLOR[m.bottleneck.severity] || "var(--border-mid)") : "var(--border-mid)";
  let btlHtml = "";
  if (m.bottleneck && map) {
    const leg = map.severity_legend[m.bottleneck.severity] || {};
    btlHtml = `<div class="mc-btl-box" style="--mc-c:${accent}">
        <span class="mc-btl-tag">${escapeHtml(leg.label || m.bottleneck.severity)}</span>
        <p class="mc-btl-text">${escapeHtml(m.bottleneck.limit || "")}</p>
      </div>`;
  }
  const sizeMeta = [
    m.size_label ? `규모 <strong>${escapeHtml(m.size_label)}</strong>` : "",
    m.growth ? `성장 ${escapeHtml(m.growth)}` : "",
  ].filter(Boolean).join(" · ");
  const bar = mcShareBar((d.players || []).filter((p) => typeof p.share === "number"));
  const srcHtml = (d.sources || []).length
    ? `<details class="mc-sources"><summary>출처 ${d.sources.length}</summary><ul>${
        d.sources.map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(String(u).replace(/^https?:\/\//, "").split("/")[0])}</a></li>`).join("")
      }</ul></details>`
    : "";
  return `
    <header class="mc-detail-head" style="--mc-accent:${accent}">
      <span class="mc-detail-layer">시장 요약</span>
      <h4>${escapeHtml(m.name_kr)}</h4>
      <p class="mc-detail-en">${escapeHtml(m.name_en || "")}</p>
    </header>
    <p class="mc-detail-def">${escapeHtml(m.definition || "")}</p>
    ${sizeMeta ? `<p class="mc-detail-size">${sizeMeta}</p>` : ""}
    ${btlHtml}
    ${d.intro ? `<div class="mc-weekly"><h5>지도 읽는 법</h5><p>${escapeHtml(d.intro)}</p></div>` : ""}
    ${bar ? `<div class="mc-players"><h5>제조사 점유율</h5><div class="mc-share-wrap">${bar}</div></div>` : ""}
    <p class="vc-detail-hint">기업 노드를 클릭하면 상세와 거래 관계가 표시됩니다.</p>
    ${srcHtml}`;
}

// 기업 상세 패널 — 역할·설명·거래 관계(조달/공급). 관계 클릭 → 그 기업 선택.
function pmRenderDetail(id, suppliers, customers) {
  const host = document.getElementById("pm-detail");
  const d = PM_STATE.data;
  const p = d && d.players.find((x) => x.id === id);
  if (!host || !p) return;
  const g = (d.groups || []).find((x) => x.id === p.group) || {};
  const flag = PM_FLAGS[p.country] || "";
  const nameOf = (pid) => { const x = d.players.find((y) => y.id === pid); return x ? x.name : pid; };
  const labelFor = (pid, dir) => {
    const l = dir === "sup"
      ? d.links.find((x) => x.to === id && x.from === pid)
      : d.links.find((x) => x.from === id && x.to === pid);
    return l ? l.label : "";
  };
  const relHtml = (list, dir, title) => {
    if (!list.length) return "";
    const items = list.map((pid) =>
      `<li><button class="mc-rel-link" data-goto="${escapeHtml(pid)}">${escapeHtml(nameOf(pid))}</button>
         <span class="mc-rel-label">${escapeHtml(labelFor(pid, dir))}</span></li>`).join("");
    return `<div class="mc-rel-block"><h5>${title}</h5><ul>${items}</ul></div>`;
  };
  let scoreHtml = "";
  const stocks = MC_STATE.stocks || {};
  if (p.ticker && p.in_watchlist) {
    const q = stocks[p.ticker] && stocks[p.ticker].valuation && stocks[p.ticker].valuation.qualitative;
    if (q && typeof q.narrative_score === "number") {
      const tone = q.narrative_score > 0.05 ? "pos" : q.narrative_score < -0.05 ? "neg" : "neutral";
      scoreHtml = `<p class="mc-mood" data-tone="${tone}"><span>뉴스 시그널</span> <strong>${q.narrative_score >= 0 ? "+" : ""}${q.narrative_score.toFixed(2)}</strong> · watchlist 추적 중</p>`;
    }
  }
  const share = typeof p.share === "number" ? ` · 점유 ${p.share}%` : "";
  host.innerHTML = `
    <button type="button" class="pm-detail-back" id="pm-detail-back">← ${escapeHtml((PM_STATE.market && PM_STATE.market.name_kr) || "시장")} 요약으로</button>
    <header class="mc-detail-head" style="--mc-accent:${g.color || "var(--border-mid)"}">
      <span class="mc-detail-layer">${escapeHtml(g.title || "")}</span>
      <h4>${flag ? flag + " " : ""}${escapeHtml(p.name)}</h4>
      <p class="mc-detail-en">${escapeHtml(p.name_en || "")}${p.ticker ? ` · ${escapeHtml(p.ticker)}` : " · 비상장"}${share}</p>
    </header>
    ${p.role ? `<p class="mc-detail-size"><strong>${escapeHtml(p.role)}</strong></p>` : ""}
    ${p.note ? `<p class="mc-detail-def">${escapeHtml(p.note)}</p>` : ""}
    ${scoreHtml}
    <div class="mc-wiki" hidden></div>
    ${relHtml(suppliers, "sup", "◀ 이 기업에 공급 (조달처)")}
    ${relHtml(customers, "cust", "이 기업이 공급하는 곳 ▶")}`;
  host.querySelector("#pm-detail-back").addEventListener("click", pmClearSelect);
  host.querySelectorAll(".mc-rel-link[data-goto]").forEach((b) =>
    b.addEventListener("click", () => pmSelect(b.dataset.goto)));
  // 기업 노트(큐레이션 p.wiki) + 이 기업 티커의 루틴 뉴스 로그
  mcFillWikiSlot(host.querySelector(".mc-wiki"), p.wiki, [p]);
}

// ── 플레이어 지도 엣지 (시장 지도와 동일한 문법·좌표계) ────────────────────
// 좌표 계산은 mcEdgeGeo / mcFlowPath (순수 함수)를 재사용한다.
// links 방향: from(공급자) → to(수요자) — 화살표가 사는 쪽을 가리킨다.

function pmRectOf(id, wrap, wrapRect) {
  const el = wrap.querySelector(`.pm-player[data-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const z = PM_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

function pmGroupRect(gid, wrap, wrapRect) {
  const el = wrap.querySelector(`.pm-col[data-group="${CSS.escape(gid)}"]`);
  if (!el) return null;
  const z = PM_STATE.zoom || 1;
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - wrapRect.left + wrap.scrollLeft) / z,
    y: (r.top - wrapRect.top + wrap.scrollTop) / z,
    w: r.width / z, h: r.height / z,
  };
}

function pmAddEdge(svg, wrap, wrapRect, l, cls, marker, withLabel) {
  const a = pmRectOf(l.from, wrap, wrapRect), b = pmRectOf(l.to, wrap, wrapRect);
  if (!a || !b) return;
  const g = mcEdgeGeo(a, b);
  const path = document.createElementNS(MC_SVGNS, "path");
  path.setAttribute("d", g.d);
  path.setAttribute("class", cls);
  path.setAttribute("marker-end", `url(#${marker})`);
  svg.appendChild(path);
  if (withLabel && l.label) {
    const t = document.createElementNS(MC_SVGNS, "text");
    t.setAttribute("class", "mc-edge-label");
    t.setAttribute("x", g.mx.toFixed(1));
    t.setAttribute("y", (g.my - 5).toFixed(1));
    t.setAttribute("text-anchor", "middle");
    t.textContent = l.label;
    svg.appendChild(t);
  }
}

// 기본 상태: 그룹 사이 집계 흐름선(굵기 = 거래선 수). 같은 그룹 내부는 선택 시에만.
function pmDrawLinks() {
  const svg = document.getElementById("pm-links");
  const wrap = document.getElementById("pm-board-wrap");
  const d = PM_STATE.data;
  if (!svg || !wrap || !d) return;
  const wrapRect = wrap.getBoundingClientRect();
  if (wrapRect.width === 0) return;

  svg.innerHTML = "";
  const board = document.getElementById("pm-board");
  svg.setAttribute("width", board ? board.scrollWidth : wrap.scrollWidth);
  svg.setAttribute("height", board ? board.scrollHeight : wrap.scrollHeight);

  const defs = document.createElementNS(MC_SVGNS, "defs");
  defs.innerHTML = `
    <marker id="pm-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#5c6470"></path>
    </marker>
    <marker id="pm-arr-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#c2c9d4"></path>
    </marker>`;
  svg.appendChild(defs);

  const gOf = {};
  (d.players || []).forEach((p) => { gOf[p.id] = p.group; });

  // 1) 거래선을 그룹 쌍으로 집계
  const flows = new Map();
  (d.links || []).forEach((l) => {
    const src = gOf[l.from], dst = gOf[l.to];
    if (!src || !dst || src === dst) return;
    const k = `${src}→${dst}`;
    const f = flows.get(k) || { src, dst, count: 0, labels: [] };
    f.count += 1;
    if (l.label && f.labels.length < 3) f.labels.push(l.label);
    flows.set(k, f);
  });

  // 2) 컬럼 좌표 + 방향 판별
  const items = [];
  flows.forEach((f) => {
    const a = pmGroupRect(f.src, wrap, wrapRect), b = pmGroupRect(f.dst, wrap, wrapRect);
    if (!a || !b) return;
    const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) >= Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    items.push({ ...f, a, b, horiz });
  });

  // 3) 같은 면에서 나가는/들어오는 선끼리 anchor 를 벌려 겹침 방지
  const groupPush = (m2, k, it) => { const arr = m2.get(k) || []; arr.push(it); m2.set(k, arr); };
  const outG = new Map(), inG = new Map();
  items.forEach((it) => {
    groupPush(outG, `${it.src}:${it.horiz ? "h" : "v"}`, it);
    groupPush(inG, `${it.dst}:${it.horiz ? "h" : "v"}`, it);
  });
  outG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.b.y - q.b.y) : (p.b.x - q.b.x)));
    arr.forEach((it, i) => { it.offA = (i - (arr.length - 1) / 2) * 22; });
  });
  inG.forEach((arr) => {
    arr.sort((p, q) => (p.horiz ? (p.a.y - q.a.y) : (p.a.x - q.a.x)));
    arr.forEach((it, i) => { it.offB = (i - (arr.length - 1) / 2) * 22; });
  });

  // 4) 흐름선 — 연결 수에 따라 굵기
  items.forEach((it) => {
    const p = document.createElementNS(MC_SVGNS, "path");
    p.setAttribute("d", mcFlowPath(it.a, it.b, it.horiz, it.offA || 0, it.offB || 0));
    p.setAttribute("class", "mc-flow");
    p.setAttribute("stroke-width", (1.3 + Math.min(2.4, (it.count - 1) * 0.45)).toFixed(1));
    p.setAttribute("marker-end", "url(#pm-arr)");
    const ti = document.createElementNS(MC_SVGNS, "title");
    ti.textContent = `${it.count}개 거래선 — ${it.labels.join(" · ")}`;
    p.appendChild(ti);
    svg.appendChild(p);
  });

  // 5) 활성 기업이 있으면 세부 거래선
  if (PM_STATE.active) pmDrawActiveEdges(PM_STATE.active);
}

// 선택 기업의 거래선 + 라벨. 집계 흐름선은 흐리게.
function pmDrawActiveEdges(id) {
  const svg = document.getElementById("pm-links");
  const wrap = document.getElementById("pm-board-wrap");
  const d = PM_STATE.data;
  if (!svg || !wrap || !d) return;
  svg.querySelectorAll(".mc-active-edge, .mc-edge-label").forEach((el) => el.remove());
  svg.querySelectorAll(".mc-flow").forEach((p) => p.classList.add("mc-flow--dim"));
  const wrapRect = wrap.getBoundingClientRect();
  d.links.filter((l) => l.from === id || l.to === id).forEach((l) =>
    pmAddEdge(svg, wrap, wrapRect, l, "mc-edge mc-active-edge", "pm-arr-hi", true));
}

// ── 플레이어 지도 캔버스: 맞춤 줌 · Ctrl+휠 줌 · 드래그 패닝 ───────────────
function pmApplyZoom() {
  const board = document.getElementById("pm-board");
  const svg = document.getElementById("pm-links");
  const z = PM_STATE.zoom || 1;
  [board, svg].forEach((el) => {
    if (!el) return;
    el.style.transform = z === 1 ? "" : `scale(${z})`;
    el.style.transformOrigin = "0 0";
  });
}

function pmFitZoom() {
  const wrap = document.getElementById("pm-board-wrap");
  const board = document.getElementById("pm-board");
  if (!wrap || !board || wrap.clientWidth === 0 || board.scrollWidth === 0) return;
  PM_STATE.zoom = Math.min(1.6, Math.max(0.5, Math.round(((wrap.clientWidth - 18) / board.scrollWidth) * 100) / 100));
  pmApplyZoom();
}

let pmDrag = null; // 드래그 패닝 상태 (window 리스너는 1회만 등록)
window.addEventListener("mousemove", (e) => {
  if (!pmDrag) return;
  pmDrag.wrap.scrollLeft = pmDrag.sl - (e.clientX - pmDrag.x);
  pmDrag.wrap.scrollTop = pmDrag.st - (e.clientY - pmDrag.y);
});
window.addEventListener("mouseup", () => {
  if (pmDrag) pmDrag.wrap.classList.remove("mc-grabbing");
  pmDrag = null;
});

function pmWireCanvas() {
  const wrap = document.getElementById("pm-board-wrap");
  if (!wrap || wrap.dataset.pmWired) return;
  wrap.dataset.pmWired = "1";
  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // 일반 휠 = 스크롤
    e.preventDefault();
    const old = PM_STATE.zoom || 1;
    const z = Math.min(2.2, Math.max(0.4, old * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    if (Math.abs(z - old) < 0.001) return;
    const r = wrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    PM_STATE.zoom = Math.round(z * 1000) / 1000;
    PM_STATE.userZoomed = true;
    pmApplyZoom();
    const ratio = PM_STATE.zoom / old;
    wrap.scrollLeft = (wrap.scrollLeft + px) * ratio - px;
    wrap.scrollTop = (wrap.scrollTop + py) * ratio - py;
    pmDrawLinks();
  }, { passive: false });
  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".pm-player, button, a")) return;
    pmDrag = { wrap, x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add("mc-grabbing");
    e.preventDefault();
  });
}

// ─── 개별 종목: 섹터 토글 + 검색 ─────────────────────────────────────
//
// 섹터 그룹은 기본으로 접혀 있고 헤더를 누르면 열린다. 카드(차트 포함)는
// 그룹이 처음 열릴 때만 렌더한다 (150+ 종목 전체를 한 번에 그리지 않음).
// 뉴스 루틴이 '오늘' 갱신한 종목(valuation.qualitative.as_of == 오늘)이 있는
// 섹터는 페이지를 연 그날에만 자동으로 펼쳐지고 🗞️ 배지가 붙는다.
// 검색창은 접힘 상태와 무관하게 전 종목을 훑어, 일치하는 종목이 있는
// 그룹만 열어서 그 카드만 보여준다.

const STOCK_GROUP_STATES = []; // renderStocksByGroup 이 채움 — 검색/전체펼치기가 사용

function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 뉴스 루틴이 오늘 이 종목을 갱신했는가 — 정성 분석의 as_of 가 오늘 날짜면 true.
function stockNewsUpdatedToday(payload, today) {
  const asOf = payload && payload.valuation && payload.valuation.qualitative && payload.valuation.qualitative.as_of;
  return !!asOf && asOf === today;
}

// 개별 주식을 STOCK_GROUPS 순서대로 묶어서 접이식 섹터 섹션으로 배치.
function renderStocksByGroup(host, stocks) {
  host.innerHTML = "";
  STOCK_GROUP_STATES.length = 0;
  const today = localTodayStr();

  // 그룹별로 ticker 묶기. payload 의 group (index.json 의 값) 또는 STOCK_META 의 group
  // 둘 중 하나라도 있으면 사용. 아무것도 없으면 "기타" 로 분류.
  const buckets = new Map();
  for (const [ticker, payload] of Object.entries(stocks)) {
    if (!payload || !payload.series || payload.series.length === 0) continue;
    const meta  = STOCK_META[ticker];
    const group = (meta && meta.group) || payload.group || "기타";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(ticker);
  }

  // 정의된 순서로 먼저 렌더하고, 정의에 없는 그룹은 마지막에 alphabetical 로.
  const orderedGroups = STOCK_GROUPS.filter((g) => buckets.has(g.key));
  const extraGroups = [...buckets.keys()]
    .filter((k) => !STOCK_GROUPS.some((g) => g.key === k))
    .sort()
    .map((k) => ({ key: k, desc: "" }));

  for (const g of [...orderedGroups, ...extraGroups]) {
    const tickers = buckets.get(g.key) || [];
    if (tickers.length === 0) continue;

    const freshTickers = tickers.filter((t) => stockNewsUpdatedToday(stocks[t], today));

    const section = document.createElement("section");
    section.className = "stock-group";
    section.innerHTML = `
      <button type="button" class="stock-group-header" aria-expanded="false">
        <span class="sg-chevron" aria-hidden="true">▸</span>
        <h3 class="stock-group-title">${escapeHtml(g.key)}</h3>
        <span class="stock-group-count">${tickers.length}종목</span>
        ${freshTickers.length > 0 ? `<span class="stock-group-badge" title="오늘 뉴스 루틴이 갱신한 종목: ${escapeHtml(freshTickers.join(", "))}">🗞️ 오늘 뉴스 ${freshTickers.length}</span>` : ""}
        ${g.desc ? `<p class="stock-group-desc">${escapeHtml(g.desc)}</p>` : ""}
      </button>
      <div class="cards stock-group-cards" hidden></div>
    `;

    const headerBtn = section.querySelector(".stock-group-header");
    const cardsHost = section.querySelector(".stock-group-cards");

    // 카드 자리(slot)만 먼저 만들어 두고, 실제 카드는 열릴 때 slot 을 교체한다.
    const els = new Map(); // ticker → slot(div) 또는 렌더된 카드(article)
    for (const ticker of tickers) {
      const slot = document.createElement("div");
      slot.className = "stock-slot";
      slot.dataset.ticker = ticker;
      cardsHost.appendChild(slot);
      els.set(ticker, slot);
    }

    const state = {
      key: g.key,
      section, headerBtn, cardsHost, els, tickers,
      collapsed: freshTickers.length === 0, // 오늘 뉴스가 있는 섹터만 열어 둔다
      ensureCard(ticker) {
        const el = this.els.get(ticker);
        if (!el || el.tagName === "ARTICLE") return;
        const card = renderStockCard(ticker, stocks[ticker], stocks);
        el.replaceWith(card);
        this.els.set(ticker, card);
      },
      setOpen(open) {
        this.collapsed = !open;
        this.cardsHost.hidden = !open;
        this.headerBtn.setAttribute("aria-expanded", String(open));
        const chev = this.headerBtn.querySelector(".sg-chevron");
        if (chev) chev.textContent = open ? "▾" : "▸";
        // 카드는 컨테이너가 보이는 상태에서 렌더해야 차트 크기가 잡힌다
        if (open) for (const t of this.tickers) this.ensureCard(t);
      },
    };
    STOCK_GROUP_STATES.push(state);

    headerBtn.addEventListener("click", () => state.setOpen(state.collapsed));
    state.setOpen(!state.collapsed);
    host.appendChild(section);
  }
}

// 검색창 + '전체 펼치기' 버튼 연결. 검색 중에는 그룹 접힘 상태를 무시하고
// 일치 종목이 있는 그룹만 펼쳐 보여주며, 검색어를 지우면 원래 상태로 복원.
function wireStockToolbar(stocks) {
  const input = document.getElementById("stock-search");
  const expandBtn = document.getElementById("stock-expand-all");
  const host = document.getElementById("stock-cards");
  if (!host) return;

  // 검색 대상 문자열 사전 (소문자) — 티커·한/영 이름·섹터 부제·그룹명
  const haystacks = new Map();
  for (const state of STOCK_GROUP_STATES) {
    for (const t of state.tickers) {
      const meta = STOCK_META[t] || {};
      const payload = stocks[t] || {};
      haystacks.set(t, [t, meta.displayName, meta.fullName, meta.sector, payload.name, state.key]
        .filter(Boolean).join(" ").toLowerCase());
    }
  }

  let emptyNote = null;
  const applySearch = (raw) => {
    const q = raw.trim().toLowerCase();
    let totalHits = 0;

    for (const state of STOCK_GROUP_STATES) {
      if (!q) {
        // 복원 — 모든 종목 표시 + 접힘 상태는 사용자가 두었던 그대로
        state.section.hidden = false;
        for (const t of state.tickers) { const el = state.els.get(t); if (el) el.hidden = false; }
        state.setOpen(!state.collapsed);
        continue;
      }
      const hits = state.tickers.filter((t) => haystacks.get(t).includes(q));
      totalHits += hits.length;
      if (hits.length === 0) { state.section.hidden = true; continue; }
      state.section.hidden = false;
      // 검색 결과는 항상 펼쳐 보여주되 collapsed(사용자 상태)는 건드리지 않는다
      state.cardsHost.hidden = false;
      state.headerBtn.setAttribute("aria-expanded", "true");
      const chev = state.headerBtn.querySelector(".sg-chevron");
      if (chev) chev.textContent = "▾";
      for (const t of state.tickers) {
        const isHit = hits.includes(t);
        if (isHit) state.ensureCard(t); // 카드가 보이는 상태에서 렌더
        const el = state.els.get(t);
        if (el) el.hidden = !isHit;
      }
    }

    if (emptyNote) { emptyNote.remove(); emptyNote = null; }
    if (q && totalHits === 0) {
      emptyNote = document.createElement("p");
      emptyNote.className = "stock-search-empty";
      emptyNote.textContent = `"${raw.trim()}" 에 해당하는 종목이 없습니다 — 티커·회사명·섹터로 검색해 보세요.`;
      host.prepend(emptyNote);
    }
    window.dispatchEvent(new Event("resize"));
  };

  if (input && input.dataset.wired !== "1") {
    input.dataset.wired = "1";
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => applySearch(input.value), 120);
    });
  }

  if (expandBtn && expandBtn.dataset.wired !== "1") {
    expandBtn.dataset.wired = "1";
    expandBtn.addEventListener("click", () => {
      const anyClosed = STOCK_GROUP_STATES.some((s) => s.collapsed);
      for (const s of STOCK_GROUP_STATES) s.setOpen(anyClosed);
      expandBtn.textContent = anyClosed ? "전체 접기" : "전체 펼치기";
    });
  }
}

// ─── 가치 발굴 (월간 버핏식 스크리닝) ─────────────────────────────────
//
// scripts/value_screen.py 가 매월 1일 data/value_screen.json 을 생성한다 —
// 사업의 질 3가지(ROE·영업이익률·연속 흑자) × 가격 1가지(저평가 갭)를
// 모두 통과한 기업 목록. 여기서는 그 파일을 읽어 '가치 발굴' 서브탭을
// 채우고, 통과 종목의 일반 카드 헤더에 🎯 배지를 붙인다.

const VALUE_SCREEN = { promise: null, data: null, passSet: new Set() };

function loadValueScreen() {
  if (!VALUE_SCREEN.promise) {
    VALUE_SCREEN.promise = fetch("data/value_screen.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
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
      <span>가격만 남은 기업 <b>${nearMiss.length}</b></span>
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
      <p class="category-desc">대부분 <strong>'좋은 기업인데 아직 비싼'</strong> 경우다. 가격 기준이 채워지는 달을 기다린다.</p>
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
      wrap.appendChild(renderStockCard(ticker, stocks[ticker], stocks));
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

function renderStockCard(ticker, payload, allStocks = null) {
  const meta   = STOCK_META[ticker] ?? { displayName: ticker, fullName: ticker, sector: "", color: "#9aa0a9", decimals: 2, currency: "USD", business: "", moat: "" };
  const series = payload.series;
  const latest = series[series.length - 1];

  // 1년 전 대비 % 변화 — 단기보다 1년 추세가 사용자에게 유의미
  const prior = findPriorPoint(series, latest.date, 365);
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
  const valuation  = payload.valuation || null;

  const metricsHtml      = renderStockMetricsHtml(snapshot, meta);
  const valuationBadge   = renderValuationBadgeHtml(valuation, meta);
  const peerCompareHtml  = renderPeerCompareHtml(ticker, valuation, allStocks);
  const valuationSection = renderValuationSectionHtml(valuation, peerCompareHtml, meta);
  const hasFinancials    = metricsHtml !== "" || quarterly.length > 0 || valuationSection !== "";

  const card = document.createElement("article");
  card.className = "card stock-card";
  card.dataset.ticker = ticker;
  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${escapeHtml(meta.displayName)}</span>${valuePassBadgeHtml(ticker)}
      <span class="card-code">${escapeHtml(ticker)}</span>
    </header>
    <div>
      <span class="card-value">${formatStockPrice(latest.value, meta)}</span>
      <span class="card-change ${changeClass}" title="1년 전 대비">${changeStr} <span class="change-period">(1년)</span></span>
    </div>
    <p class="card-desc">${escapeHtml(meta.fullName)} · ${escapeHtml(meta.sector)}</p>
    ${meta.business ? `<p class="card-business">${escapeHtml(meta.business)}</p>` : ""}
    ${valuationBadge}

    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>

    ${hasFinancials ? `
      <div class="stock-details">
        <button type="button" class="details-toggle" aria-expanded="false">
          <span class="details-toggle-label">상세 분석 보기</span>
          <span class="details-toggle-icon" aria-hidden="true">▾</span>
        </button>
        <div class="details-body" hidden>
          ${valuationSection}
          ${metricsHtml}
          ${quarterly.length > 0 ? `
            <div class="section-title">분기 실적 (단위: ${meta.currency === "KRW" ? "₩조" : "$B"})</div>
            <div class="card-chart financials-chart"><canvas></canvas></div>
          ` : ""}
        </div>
      </div>
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
      primaryMeta: { decimals: meta.decimals, unit: stockCurrencySymbol(meta), displayName: meta.displayName },
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

  // 상세 분석 토글 — 차트는 펼쳐질 때 lazy 렌더 (hidden 상태에선 캔버스 크기 측정 불가)
  const toggleBtn   = card.querySelector(".details-toggle");
  const detailsBody = card.querySelector(".details-body");
  if (toggleBtn && detailsBody) {
    let lazyRendered = false;
    toggleBtn.addEventListener("click", () => {
      const next = toggleBtn.getAttribute("aria-expanded") !== "true";
      toggleBtn.setAttribute("aria-expanded", String(next));
      detailsBody.hidden = !next;
      const labelEl = toggleBtn.querySelector(".details-toggle-label");
      const iconEl  = toggleBtn.querySelector(".details-toggle-icon");
      if (labelEl) labelEl.textContent = next ? "상세 분석 숨기기" : "상세 분석 보기";
      if (iconEl)  iconEl.textContent  = next ? "▴" : "▾";
      if (next && !lazyRendered) {
        const finCanvas = card.querySelector(".financials-chart canvas");
        if (finCanvas && quarterly.length > 0) renderFinancialsChart(finCanvas, quarterly, meta);
        const valCanvas = card.querySelector(".valuation-chart canvas");
        if (valCanvas && valuation && (valuation.gap_series_weekly || []).length > 1) {
          renderValuationGapChart(valCanvas, valuation.gap_series_weekly);
        }
        lazyRendered = true;
      }
    });
  }

  return card;
}

// ─── 재무/실적 표시 헬퍼 ─────────────────────────────────────────────

// 거물 투자자(버핏·달리오) 관점에서 본 4개 핵심 지표.
//  - ROE: 자본을 얼마나 효율적으로 굴리는가 (Buffett 의 사업 질 척도)
//  - 영업이익률: 본업의 수익성 = 해자(moat) 의 강도
//  - P/E: 가격이 적정한가 (밸류에이션)
//  - 시가총액: 회사의 규모/성숙도 컨텍스트
const STOCK_KEY_METRICS = [
  { key: "return_on_equity", label: "ROE",        hint: "자본 효율 · 15%+ 우량",         format: (v, meta) => formatPercent(v) },
  { key: "operating_margin", label: "영업이익률", hint: "본업 수익성 · 해자 강도",       format: (v, meta) => formatPercent(v) },
  { key: "pe_ratio",         label: "P/E",        hint: "가격/이익 · S&P500 ~22배",      format: (v, meta) => v == null ? "—" : v.toFixed(1) + "배" },
  { key: "market_cap",       label: "시가총액",   hint: "회사 규모",                     format: (v, meta) => formatLargeMoney(v, meta) },
];

function renderStockMetricsHtml(snap, stockMeta) {
  if (!snap || Object.values(snap).every((v) => v == null)) return "";
  const items = STOCK_KEY_METRICS.map(({ key, label, hint, format }) => `
    <div class="key-metric">
      <div class="km-head">
        <span class="km-label">${escapeHtml(label)}</span>
        <span class="km-value">${escapeHtml(format(snap[key], stockMeta))}</span>
      </div>
      <p class="km-hint">${escapeHtml(hint)}</p>
    </div>
  `).join("");
  return `
    <div class="section-title">핵심 지표</div>
    <div class="key-metrics">${items}</div>
    <p class="key-metrics-note">사업의 질(ROE·영업이익률) × 가격(P/E) — 거물 투자자가 가장 먼저 보는 4가지.</p>
  `;
}

// ─── Valuation (기업가치 vs 시장가격) ───────────────────────────────
//   signal       라벨            색
//   deep_value   강한 저평가     green-strong
//   undervalued  저평가          green
//   fair         적정            neutral
//   overvalued   고평가          orange
//   expensive    과대평가        red
const VALUATION_SIGNALS = {
  deep_value:  { label: "강한 저평가", tone: "value-strong" },
  undervalued: { label: "저평가",     tone: "value" },
  fair:        { label: "적정",       tone: "fair" },
  overvalued:  { label: "고평가",     tone: "over" },
  expensive:   { label: "과대평가",   tone: "over-strong" },
  "n/a":       { label: "산출 불가",  tone: "fair" },
};

function renderValuationBadgeHtml(val, stockMeta) {
  if (!val || val.valuation_gap == null || !val.signal) return "";
  const sigMeta = VALUATION_SIGNALS[val.signal] || VALUATION_SIGNALS.fair;
  const gapPct = (val.valuation_gap * 100);
  const sign = gapPct >= 0 ? "+" : "";
  const qual = val.qualitative;
  const narrative = qual && qual.narrative_score != null
    ? renderNarrativeChipHtml(qual.narrative_score, qual.as_of)
    : "";
  return `
    <div class="valuation-badge-row">
      <div class="valuation-badge" data-tone="${sigMeta.tone}" title="현재가 대비 적정가치 갭 (음수=저평가, 양수=고평가)">
        <span class="vb-label">${escapeHtml(sigMeta.label)}</span>
        <span class="vb-gap">${sign}${gapPct.toFixed(1)}%</span>
        <span class="vb-fair">vs 적정 ${formatStockPrice(val.fair_value, stockMeta)}</span>
      </div>
      ${narrative}
    </div>
  `;
}

function renderNarrativeChipHtml(score, asOf) {
  // -1.0 (악화) ~ +1.0 (개선) — Routine 산출 정성 점수
  const tone = score <= -0.2 ? "narr-neg-strong"
             : score <  0    ? "narr-neg"
             : score <  0.2  ? "narr-neutral"
             : score <  0.5  ? "narr-pos"
             :                  "narr-pos-strong";
  const sign = score >= 0 ? "+" : "";
  const dateLabel = asOf ? ` (${escapeHtml(asOf)})` : "";
  return `
    <div class="narrative-chip" data-tone="${tone}" title="Routine 정성 분석 점수${dateLabel}">
      <span class="nc-icon" aria-hidden="true">📰</span>
      <span class="nc-label">정성</span>
      <span class="nc-score">${sign}${score.toFixed(2)}</span>
    </div>
  `;
}

function renderValuationSectionHtml(val, peerCompareHtml = "", stockMeta = null) {
  if (!val) return "";
  const hasMethods = val.methods && Object.keys(val.methods).length > 0;
  if (!hasMethods) {
    return `
      <div class="section-title">기업가치 vs 시장가격</div>
      <p class="valuation-empty">${escapeHtml(val.note || "fair value 산출 불가")}</p>
    `;
  }
  const totalWeight = Object.values(val.methods).reduce((s, m) => s + (m.weight || 0), 0);
  const methodRows = Object.entries(val.methods).map(([key, m]) => {
    const w = totalWeight > 0 ? (m.weight / totalWeight * 100) : 0;
    return `
      <div class="method-row">
        <div class="method-name">${escapeHtml(m.note || key)}</div>
        <div class="method-fair">${formatStockPrice(m.fair_value, stockMeta)}</div>
        <div class="method-weight">${w.toFixed(0)}%</div>
      </div>
    `;
  }).join("");

  const hasSeries = (val.gap_series_weekly || []).length > 1;

  return `
    <div class="section-title">기업가치 vs 시장가격</div>
    <div class="valuation-summary">
      <div class="vs-row">
        <span class="vs-label">현재가</span>
        <span class="vs-value">${formatStockPrice(val.current_price, stockMeta)}</span>
      </div>
      <div class="vs-row vs-fair">
        <span class="vs-label">적정 가치 (composite)</span>
        <span class="vs-value">${formatStockPrice(val.fair_value, stockMeta)}</span>
      </div>
    </div>
    <div class="method-table">
      <div class="method-row method-head">
        <div class="method-name">산출 방법</div>
        <div class="method-fair">적정가</div>
        <div class="method-weight">가중</div>
      </div>
      ${methodRows}
    </div>
    ${hasSeries ? `
      <div class="section-title sub">최근 valuation gap 추이 (주간)</div>
      <div class="card-chart valuation-chart"><canvas></canvas></div>
      <p class="valuation-note">분기 실적 데이터가 쌓일수록 추이가 길어집니다. 0% 선이 적정 가치이며, 양수=고평가·음수=저평가입니다.</p>
    ` : `
      <p class="valuation-note">분기 실적 누적 후 valuation gap 추이 차트가 표시됩니다.</p>
    `}
    ${peerCompareHtml}
    ${renderQualitativeBlockHtml(val.qualitative)}
  `;
}

// 같은 watchlist 내 경쟁사들과 valuation gap 을 한 줄로 비교.
// scripts/competitors.py 의 COMPETITORS 와 동기화. 여기엔 watchlist 내 종목만 남긴다.
const PEER_COMPETITORS = {
  // ── 빅테크 / 소프트웨어 ─────────────────────────────────────
  AAPL: ["MSFT", "GOOGL", "AMZN"],
  MSFT: ["AAPL", "GOOGL", "AMZN", "ORCL", "CRM"],
  GOOGL: ["MSFT", "META", "AMZN"],
  AMZN: ["MSFT", "GOOGL", "AAPL", "WMT"],
  META: ["GOOGL"],
  ORCL: ["MSFT", "CRM", "IBM"],
  CRM: ["MSFT", "ORCL", "ADBE"],
  ADBE: ["MSFT", "CRM"],
  IBM: ["MSFT", "ORCL"],
  PLTR: ["MSFT", "ORCL", "IBM"],
  // ── 반도체 — AI 칩 · 설계 ─────────────────────────────────────
  NVDA: ["AMD", "AVGO", "TSM", "INTC"],
  AMD: ["NVDA", "INTC", "AVGO", "TSM"],
  INTC: ["AMD", "TSM", "QCOM"],
  QCOM: ["2454.TW", "INTC", "AVGO", "MU"],
  AVGO: ["MRVL", "NVDA", "AMD", "QCOM"],
  MRVL: ["AVGO", "NVDA", "AMD", "ANET"],
  "2454.TW": ["QCOM", "005930.KS", "AAPL"],
  MBLY: ["NVDA", "QCOM", "TSLA", "HSAI"],
  SNPS: ["CDNS", "ARM"],
  CDNS: ["SNPS", "ARM"],
  ARM: ["SNPS", "CDNS", "INTC", "AMD"],
  // ── 반도체 — 메모리 (HBM·DRAM) ─────────────────────────────────────
  "005930.KS": ["000660.KS", "MU", "TSM", "INTC"],
  "000660.KS": ["005930.KS", "MU"],
  MU: ["000660.KS", "005930.KS", "INTC"],
  // ── 반도체 — 파운드리 · 패키징 · 기판 ─────────────────────────────────────
  TSM: ["005930.KS", "INTC", "AMKR"],
  AMKR: ["TSM", "INTC"],
  "4062.T": ["AMKR"],
  // ── 반도체 — 장비 · 소재 ─────────────────────────────────────
  ASML: ["AMAT", "LRCX", "KLAC", "TOELY"],
  AMAT: ["LRCX", "ASML", "KLAC", "TOELY"],
  LRCX: ["AMAT", "ASML", "KLAC", "TOELY"],
  TOELY: ["AMAT", "LRCX", "ASML", "KLAC"],
  KLAC: ["AMAT", "LRCX", "ASML", "TOELY"],
  "042700.KS": ["BESI.AS", "6857.T"],
  "6857.T": ["TER", "042700.KS"],
  "6146.T": ["042700.KS", "BESI.AS"],
  "BESI.AS": ["042700.KS", "AMAT"],
  "4063.T": ["4062.T", "TOELY"],
  // ── AI 인프라 — 네트워킹 · 광 · 네오클라우드 ─────────────────────────────────────
  ANET: ["AVGO", "NVDA", "MRVL"],
  COHR: ["AVGO", "MRVL"],
  MPWR: [],
  CRWV: ["NBIS", "ORCL", "AMZN", "MSFT"],
  NBIS: ["CRWV", "ORCL"],
  // ── 로보틱스 / 피지컬 AI ─────────────────────────────────────
  TER: ["6857.T", "AMAT", "LRCX"],
  HSAI: ["MBLY"],
  MP: ["FCX", "NEM"],
  "6954.T": ["TER"],
  "6324.T": ["TER"],
  // ── 자동차 / 모빌리티 ─────────────────────────────────────
  TSLA: ["GM", "F", "RIVN", "NIO"],
  TM: ["GM", "F", "HMC", "STLA"],
  F: ["GM", "TSLA", "STLA", "TM"],
  GM: ["F", "TSLA", "STLA", "TM"],
  STLA: ["F", "GM", "TM", "HMC"],
  HMC: ["TM", "F", "GM"],
  RIVN: ["TSLA", "F", "GM", "NIO"],
  NIO: ["TSLA", "RIVN"],
  "005380.KS": ["000270.KS", "TM", "HMC", "TSLA"],
  "000270.KS": ["005380.KS", "TM", "HMC", "TSLA"],
  // ── 바이오 / 제약 / 헬스케어 ─────────────────────────────────────
  LLY: ["NVO", "JNJ", "MRK", "PFE"],
  NVO: ["LLY", "JNJ", "MRK"],
  JNJ: ["LLY", "PFE", "MRK", "ABBV"],
  PFE: ["JNJ", "MRK", "ABBV", "AZN"],
  MRK: ["JNJ", "PFE", "AZN"],
  ABBV: ["JNJ", "MRK", "PFE"],
  AZN: ["PFE", "MRK", "ABBV"],
  UNH: ["JNJ"],
  TMO: ["ABT"],
  ABT: ["JNJ", "TMO"],
  // ── 에너지 / 원자재 ─────────────────────────────────────
  XOM: ["CVX", "SHEL", "COP"],
  CVX: ["XOM", "SHEL", "COP", "OXY"],
  COP: ["XOM", "CVX", "OXY"],
  SHEL: ["XOM", "CVX"],
  OXY: ["COP", "XOM", "CVX"],
  SLB: [],
  FCX: ["NEM"],
  NEM: ["FCX"],
  LIN: ["APD"],
  APD: ["LIN"],
  // ── 금융 ─────────────────────────────────────
  JPM: ["BAC", "WFC", "C", "GS"],
  BAC: ["JPM", "WFC", "C"],
  WFC: ["JPM", "BAC", "C"],
  C: ["JPM", "BAC", "WFC", "GS"],
  GS: ["MS", "JPM", "C"],
  MS: ["GS", "JPM"],
  V: ["MA", "AXP"],
  MA: ["V", "AXP"],
  AXP: ["V", "MA"],
  "BRK-B": ["JPM", "BAC", "V", "AAPL"],
  // ── 소비재 ─────────────────────────────────────
  WMT: ["COST", "AMZN"],
  COST: ["WMT"],
  KO: ["PEP"],
  PEP: ["KO"],
  PG: [],
  MO: [],
  MCD: ["SBUX"],
  HD: [],
  NKE: [],
  SBUX: ["MCD"],
  // ── 산업재 / 방산 ─────────────────────────────────────
  CAT: ["DE"],
  DE: ["CAT"],
  BA: ["LMT", "RTX", "NOC"],
  LMT: ["RTX", "NOC", "BA"],
  RTX: ["LMT", "NOC", "BA"],
  NOC: ["LMT", "RTX", "BA"],
  HON: ["GE", "RTX"],
  GE: ["RTX", "HON", "BA"],
  UPS: ["FDX", "AMZN"],
  FDX: ["UPS", "AMZN"],
  AVAV: ["KTOS", "LMT", "NOC"],
  KTOS: ["AVAV", "NOC", "GE"],
  "012450.KS": ["079550.KS", "042660.KS", "LMT"],
  "079550.KS": ["012450.KS", "LMT", "RTX"],
  // ── 부동산 (REITs) ─────────────────────────────────────
  AMT: ["CCI", "EQIX", "DLR"],
  CCI: ["AMT", "DLR"],
  PLD: ["PSA"],
  EQIX: ["DLR", "AMT"],
  DLR: ["EQIX", "AMT"],
  O: [],
  SPG: [],
  WELL: [],
  PSA: [],
  VICI: [],
  // ── 통신 / 미디어 ─────────────────────────────────────
  VZ: ["T", "TMUS"],
  T: ["VZ", "TMUS"],
  TMUS: ["VZ", "T"],
  CMCSA: ["CHTR", "DIS", "NFLX"],
  CHTR: ["CMCSA", "VZ", "T"],
  NFLX: ["DIS", "AMZN", "SPOT"],
  DIS: ["NFLX", "CMCSA"],
  SPOT: ["NFLX", "AAPL"],
  EA: ["TTWO", "MSFT"],
  TTWO: ["EA", "MSFT"],
  // ── 유틸리티 / 전력 ─────────────────────────────────────
  NEE: ["DUK", "SO", "AEP"],
  SO: ["DUK", "AEP", "NEE"],
  DUK: ["NEE", "SO", "AEP"],
  AEP: ["DUK", "SO", "NEE", "EXC"],
  EXC: ["AEP", "ED", "SO"],
  CEG: ["VST", "NEE", "DUK"],
  VST: ["CEG", "NEE"],
  SRE: ["AEP", "DUK", "NEE"],
  ED: ["EXC", "AEP", "DUK"],
  D: ["DUK", "NEE", "SO", "AEP"],
  // ── 전력 인프라 (AI) ─────────────────────────────────────
  GEV: ["ETN", "034020.KS", "PWR"],
  ETN: ["GEV", "VRT", "267260.KS", "298040.KS"],
  VRT: ["ETN", "GEV", "010120.KS"],
  PWR: ["GEV", "ETN"],
  BE: ["GEV"],
  OKLO: ["CEG", "034020.KS"],
  "034020.KS": ["GEV", "OKLO", "298040.KS"],
  "267260.KS": ["298040.KS", "010120.KS", "ETN"],
  "298040.KS": ["267260.KS", "010120.KS", "ETN"],
  "010120.KS": ["267260.KS", "298040.KS", "VRT"],
  // ── 조선 (한국) ─────────────────────────────────────
  "329180.KS": ["042660.KS", "010140.KS", "010620.KS"],
  "042660.KS": ["329180.KS", "010140.KS", "010620.KS"],
  "010140.KS": ["329180.KS", "042660.KS", "010620.KS"],
  "010620.KS": ["329180.KS", "042660.KS", "010140.KS"],
};
function renderPeerCompareHtml(ticker, val, allStocks) {
  if (!val || val.valuation_gap == null || !allStocks) return "";
  const peers = PEER_COMPETITORS[ticker] || [];
  const present = peers
    .map((p) => ({ ticker: p, payload: allStocks[p] }))
    .filter((x) => x.payload && x.payload.valuation && x.payload.valuation.valuation_gap != null);

  if (present.length === 0) return "";

  // 자기 자신을 맨 앞에 두고, 경쟁사 정렬은 valuation_gap 오름차순(저평가 순)
  const rows = [
    { ticker, gap: val.valuation_gap, signal: val.signal, narr: val.qualitative?.narrative_score, self: true },
    ...present
      .map((x) => ({
        ticker: x.ticker,
        gap:    x.payload.valuation.valuation_gap,
        signal: x.payload.valuation.signal,
        narr:   x.payload.valuation.qualitative?.narrative_score,
        self:   false,
      }))
      .sort((a, b) => a.gap - b.gap),
  ];

  const rowHtml = rows.map((r) => {
    const meta = VALUATION_SIGNALS[r.signal] || VALUATION_SIGNALS.fair;
    const gapPct = r.gap * 100;
    const sign = gapPct >= 0 ? "+" : "";
    const narrChip = r.narr != null
      ? `<span class="peer-narr" data-sign="${r.narr >= 0 ? "pos" : "neg"}">${r.narr >= 0 ? "+" : ""}${r.narr.toFixed(2)}</span>`
      : `<span class="peer-narr peer-narr-empty">—</span>`;
    return `
      <tr class="peer-row${r.self ? " peer-self" : ""}" data-tone="${meta.tone}">
        <td class="peer-ticker">${escapeHtml(r.ticker)}${r.self ? '<span class="peer-self-mark">현재</span>' : ""}</td>
        <td class="peer-gap">${sign}${gapPct.toFixed(1)}%</td>
        <td class="peer-signal">${escapeHtml(meta.label)}</td>
        <td class="peer-narr-cell">${narrChip}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="section-title sub">경쟁사 비교 (watchlist 내)</div>
    <table class="peer-table">
      <thead>
        <tr>
          <th>종목</th>
          <th>Gap</th>
          <th>신호</th>
          <th>정성</th>
        </tr>
      </thead>
      <tbody>${rowHtml}</tbody>
    </table>
  `;
}

function renderQualitativeBlockHtml(qual) {
  if (!qual) {
    return `
      <div class="section-title sub">정성 분석 (뉴스·경쟁사)</div>
      <p class="valuation-note">Claude Code Routine이 매일 뉴스를 수집해 채워넣습니다. <code>.claude/routines/daily-market-analysis.md</code> 참고.</p>
    `;
  }

  const score = qual.narrative_score;
  const scorePct = score != null ? (score * 100).toFixed(0) : "—";
  const summary = qual.summary_kr ? `<p class="qual-summary">${escapeHtml(qual.summary_kr)}</p>` : "";

  const events = (qual.key_events || []).slice(0, 5);
  const risks  = (qual.risks      || []).slice(0, 5);
  const eventsHtml = events.length > 0 ? `
    <div class="qual-list">
      <div class="qual-list-title qual-event">주요 이벤트</div>
      <ul>${events.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
    </div>
  ` : "";
  const risksHtml = risks.length > 0 ? `
    <div class="qual-list">
      <div class="qual-list-title qual-risk">리스크</div>
      <ul>${risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    </div>
  ` : "";

  const competitors = (qual.competitor_context || []).slice(0, 4);
  const competitorsHtml = competitors.length > 0 ? `
    <div class="qual-competitor-block">
      <div class="qual-list-title">경쟁사 동향</div>
      <ul class="qual-competitor-list">
        ${competitors.map((c) => `
          <li>
            <span class="qc-ticker">${escapeHtml(c.ticker || "")}</span>
            <span class="qc-headline">${escapeHtml(c.headline || "")}</span>
            ${c.implication_for_target ? `<div class="qc-implication">→ ${escapeHtml(c.implication_for_target)}</div>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  ` : "";

  const asOfLabel = qual.as_of ? ` · ${escapeHtml(qual.as_of)} 기준` : "";

  return `
    <div class="section-title sub">정성 분석 (뉴스·경쟁사)${asOfLabel}</div>
    <div class="qual-summary-row">
      <div class="qual-score-pill" data-sign="${score >= 0 ? "pos" : "neg"}" title="Routine 산출 정성 점수 (-1.0 ~ +1.0)">
        narrative_score <strong>${score >= 0 ? "+" : ""}${score != null ? score.toFixed(2) : "—"}</strong>
        <span class="qual-news-count">뉴스 ${qual.news_count ?? 0}건</span>
      </div>
    </div>
    ${summary}
    <div class="qual-grid">${eventsHtml}${risksHtml}</div>
    ${competitorsHtml}
  `;
}

function renderValuationGapChart(canvas, gapSeries) {
  if (!gapSeries || gapSeries.length === 0) return null;
  const labels = gapSeries.map((p) => p.date);
  const data   = gapSeries.map((p) => p.gap * 100);  // %
  // 색은 부호별로 다르게 — 위는 빨강, 아래는 그린
  const positiveColor = "rgba(204, 36, 36, 0.85)";
  const negativeColor = "rgba(90, 205, 128, 0.85)";

  return new Chart(canvas.getContext("2d"), {
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

// ─── 시장 지수 카드 ─────────────────────────────────────────────────

function renderIndexCard(code, payload) {
  const meta   = INDEX_META[code] ?? { displayName: payload.name || code, color: "#9aa0a9", decimals: 2, summary: "", description: payload.description || "" };
  const series = payload.series;
  const latest = series[series.length - 1];

  // 1주/1개월/1년 변화율 — 단기·중기·장기 흐름 한눈에
  const w1  = priorChangePct(series, 7);
  const m1  = priorChangePct(series, 30);
  const yoy = priorChangePct(series, 365);

  const fmtChange = (v) => v == null ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}%`;
  const cls       = (v) => v == null ? "" : v >= 0 ? "up" : "down";

  const availableFrames = filterAvailableTimeframes(series);
  const tfButtonsHtml = availableFrames.map((tf) => {
    const active = tf.key === DEFAULT_TIMEFRAME_KEY ? " active" : "";
    return `<button type="button" class="tf-btn${active}" data-tf="${tf.key}">${tf.label}</button>`;
  }).join("");

  const card = document.createElement("article");
  card.className = "card index-card";
  card.innerHTML = `
    <header class="card-header">
      <span class="card-title">${escapeHtml(meta.displayName)}</span>
      <span class="card-code">${escapeHtml(code)}</span>
    </header>
    <div>
      <span class="card-value">${latest.value.toLocaleString("en-US", { maximumFractionDigits: meta.decimals })}</span>
      <span class="card-change ${cls(yoy)}" title="1년 전 대비">${fmtChange(yoy)} <span class="change-period">(1년)</span></span>
    </div>
    <p class="card-desc">${escapeHtml(meta.summary || payload.name || "")}</p>
    <p class="card-business">${escapeHtml(meta.description || payload.description || "")}</p>

    <div class="returns-row">
      <div class="return-cell"><span class="return-label">1주</span>   <span class="return-val ${cls(w1)}">${fmtChange(w1)}</span></div>
      <div class="return-cell"><span class="return-label">1개월</span> <span class="return-val ${cls(m1)}">${fmtChange(m1)}</span></div>
      <div class="return-cell"><span class="return-label">1년</span>   <span class="return-val ${cls(yoy)}">${fmtChange(yoy)}</span></div>
    </div>

    <div class="tf-selector" role="group" aria-label="차트 기간 선택">${tfButtonsHtml}</div>
    <div class="card-chart main-chart"><canvas></canvas></div>
  `;

  // 차트 렌더링
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
    chartInstance = renderChart(mainCanvas, sliced, "index", {
      assetColor:  meta.color,
      primaryMeta: { decimals: meta.decimals, unit: "", displayName: meta.displayName },
    });
  }
  tfSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    state.tfKey = btn.dataset.tf;
    tfSelector.querySelectorAll(".tf-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tf === state.tfKey));
    redraw();
  });
  redraw();
  return card;
}

// 시리즈에서 days 일 전 대비 % 변화. 데이터가 없으면 null.
function priorChangePct(series, days) {
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1];
  const prior  = findPriorPoint(series, latest.date, days);
  if (!prior || prior.value === 0) return null;
  return ((latest.value - prior.value) / prior.value) * 100;
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


// =====================================================================
// 원칙 (Principles) 탭 — 레이 달리오식 시나리오 타임머신
//
// 과거의 한 시점(예: 1999-06)으로 돌아가 "그 때 알 수 있었던 정보만" 으로
// 국면을 확인하고, 자산배분을 정한 뒤, 나중 시점에 팔았다면 수익률이
// 어땠을지 계산한다. data/principles/timeline.json (scripts/build_principles.py
// 가 생성) 을 lazy-fetch 해서 전부 클라이언트에서 계산한다 — 백엔드 없음.
// =====================================================================

const PR_JOURNAL_KEY = "principles_journal_v1";

const PR_ASSET_META = {
  bond_us10y:     { short: "미국 10년 국채" },
  cash:           { short: "현금" },
  stock_us_sp500: { short: "미국 주식 (S&P500)" },
  stock_kr_kospi: { short: "한국 주식 (코스피)" },
  gold_xau:       { short: "금 (XAU/USD)" },
};
// 정식 순서 — 실제 사용 가능한 자산은 timeline.json 에 든 것만 (prAssets()).
// gold_xau 는 GOLD 시세가 수집된 뒤부터 나타난다.
const PR_ASSET_ORDER = ["bond_us10y", "cash", "stock_us_sp500", "stock_kr_kospi", "gold_xau"];

// 국면별 "참고용 추천 배분" — README 4분면 표(원자재·신흥국 주식·인플레연동채 /
// 선진국 주식·회사채 / 금·인플레연동채·원자재 / 장기국채·현금)를 이 레포에 있는
// 자산으로 근사한 예시일 뿐이다. 금 데이터가 없는 기간에는 prFitAllocToRange 가
// 금 비중을 나머지 자산으로 재분배한다 — 투자 조언이 아니라 비교용 참고선이다.
const PR_QUADRANT_ALLOC = {
  Q1: { bond_us10y: 10, cash: 10, stock_us_sp500: 20, stock_kr_kospi: 40, gold_xau: 20 },
  Q2: { bond_us10y: 20, cash: 10, stock_us_sp500: 55, stock_kr_kospi: 15, gold_xau: 0 },
  Q3: { bond_us10y: 10, cash: 30, stock_us_sp500: 10, stock_kr_kospi: 15, gold_xau: 35 },
  Q4: { bond_us10y: 55, cash: 25, stock_us_sp500: 10, stock_kr_kospi: 5,  gold_xau: 5 },
};

// 진입/청산 시점과 과거 국면 카드에 보여줄 시장 지표 정의.
// timeline.json 의 months[i] 에 같은 key 로 값이 실려 온다 (없으면 null).
const PR_MKT_DEFS = [
  { key: "fed_funds", label: "기준금리",  kind: "pct" },
  { key: "us10y",     label: "미 10년물", kind: "pct" },
  { key: "gold",      label: "금",       kind: "usd" },
  { key: "cpi_yoy",   label: "CPI YoY",  kind: "pct" },
];

const PR_DRAFT_PRINCIPLE = {
  Q1: "성장과 인플레가 함께 뜨거워지는 국면에서는 명목 장기채 비중을 줄이고 실물·신흥시장 비중을 늘리는 것을 원칙으로 검토한다.",
  Q2: "성장은 개선되는데 인플레가 잠잠한 국면(골디락스)에서는 위험자산(주식) 비중을 늘리는 것을 원칙으로 검토한다.",
  Q3: "성장이 꺾이는데 물가가 오르는 국면(스태그플레이션)에서는 현금·방어자산 비중을 늘리고 위험자산 비중을 줄이는 것을 원칙으로 검토한다 — 주식·채권이 동시에 흔들리기 쉬운 구간이다.",
  Q4: "성장과 물가가 함께 식는 국면에서는 장기 국채·현금 비중을 늘리는 것을 원칙으로 검토한다 — 금리 하락(채권 가격 상승) 수혜 국면이다.",
};
const PR_DRAFT_DEFAULT = "국면이 뚜렷하지 않은 경계·중립 구간에서는 특정 자산에 몰빵하기보다 배분을 분산하는 것을 원칙으로 검토한다.";

const PR_STATE = {
  data: null,
  monthsByYm: new Map(),
  monthsSorted: [],
  assetByYm: {},
  assetOrder: PR_ASSET_ORDER.slice(0, 4), // prInit 에서 실제 데이터 기준으로 갱신
  allocation: {},
  minYm: null,
  maxYm: null,
  lastScenario: null,
  pathChart: null,
  episodesByQuadrant: null, // {Q1: [{startYm, endYm, months, ongoing}], ...}
  selectedQuadrant: null,
};

// timeline.json 에 실제로 존재하는 자산만, 정식 순서대로.
function prAssets() { return PR_STATE.assetOrder; }

// 프리셋을 사용 가능한 자산 기준으로 동적 생성 — 금 자산이 생기면 자동 반영.
function prPresetAlloc(key) {
  const order = prAssets();
  const alloc = {};
  for (const k of order) alloc[k] = 0;
  const single = {
    all_bond: "bond_us10y", all_cash: "cash", all_us: "stock_us_sp500",
    all_kr: "stock_kr_kospi", all_gold: "gold_xau",
  }[key];
  if (single && order.includes(single)) {
    alloc[single] = 100;
    return alloc;
  }
  // balanced (기본): 균등분산 + 반올림 잔여분은 첫 자산에
  const w = Math.floor(100 / order.length);
  for (const k of order) alloc[k] = w;
  alloc[order[0]] += 100 - w * order.length;
  return alloc;
}

// ---------- 날짜(YYYY-MM) 유틸 ----------
function prYm(dateStr) { return dateStr.slice(0, 7); }
function prYmToN(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}
function prNToYm(n) {
  const y = Math.floor(n / 12);
  const m = (n % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function prAddMonths(ym, delta) { return prNToYm(prYmToN(ym) + delta); }
function prMonthsBetween(a, b) { return prYmToN(b) - prYmToN(a); }

function prFmtPct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(digits)}%`;
}
function prSignAttr(x) {
  if (x == null || Number.isNaN(x)) return "";
  return x > 0.0001 ? "pos" : (x < -0.0001 ? "neg" : "");
}

// ---------- 시장 지표(기준금리/10년물/금/CPI) 표시 유틸 ----------
function prFmtMktValue(def, value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (def.kind === "usd") return `$${Math.round(value).toLocaleString("en-US")}`;
  return `${value.toFixed(2)}%`;
}

// 두 시점 사이 지표 변화: 금리·CPI 는 %p 차이, 금은 % 변화율.
function prFmtMktDelta(def, v0, v1) {
  if (v0 == null || v1 == null) return null;
  if (def.kind === "usd") {
    const pct = v1 / v0 - 1;
    return { text: prFmtPct(pct), sign: prSignAttr(pct) };
  }
  const diff = v1 - v0;
  const sign = prSignAttr(diff);
  const arrow = diff > 0.001 ? "▲" : (diff < -0.001 ? "▼" : "");
  return { text: `${arrow}${Math.abs(diff).toFixed(2)}%p`, sign };
}

// 한 시점의 시장 지표 칩 목록 (진입 스냅샷·과거 국면 카드 공용).
function prMarketChips(row) {
  if (!row) return "";
  const chips = PR_MKT_DEFS.map((def) => {
    const val = prFmtMktValue(def, row[def.key]);
    const yoy = def.key === "gold" && row.gold_yoy != null
      ? ` <small>(YoY ${row.gold_yoy > 0 ? "+" : ""}${row.gold_yoy.toFixed(1)}%)</small>` : "";
    return `<span class="pr-mkt-chip">${escapeHtml(def.label)} <b>${escapeHtml(val)}</b>${yoy}</span>`;
  });
  return `<div class="pr-mkt-chips">${chips.join("")}</div>`;
}

// 아직 수집 전(available=false)인 지표 안내 문구.
function prMissingIndicatorNote() {
  const mi = PR_STATE.data.market_indicators || {};
  const missing = PR_MKT_DEFS
    .filter((d) => mi[d.key] && mi[d.key].available === false)
    .map((d) => d.label);
  if (missing.length === 0) return "";
  return `<p class="pr-mkt-missing">${escapeHtml(missing.join(", "))} 데이터는 다음 주간 데이터 갱신 때 채워집니다.</p>`;
}

// ---------- 진입점 ----------
async function renderPrinciplesTab() {
  const setup = document.getElementById("principles-setup");
  if (!setup) return;
  try {
    const res = await fetch("data/principles/timeline.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    prInit(data);
  } catch (err) {
    setup.hidden = false;
    setup.innerHTML = emptyMessage(
      `시나리오 데이터를 불러오지 못했습니다 (${err.message}). ` +
      `scripts/build_principles.py 를 실행해 data/principles/timeline.json 을 생성해 주세요.`,
    );
  }
}

function prInit(data) {
  PR_STATE.data = data;
  for (const row of data.months) {
    PR_STATE.monthsByYm.set(prYm(row.date), row);
  }
  PR_STATE.monthsSorted = data.months.map((r) => prYm(r.date));
  PR_STATE.minYm = PR_STATE.monthsSorted[0];
  PR_STATE.maxYm = PR_STATE.monthsSorted[PR_STATE.monthsSorted.length - 1];

  for (const [key, asset] of Object.entries(data.assets)) {
    if (asset.synthetic_flat) continue;
    const map = new Map();
    for (const p of asset.index) map.set(prYm(p.date), p.value);
    PR_STATE.assetByYm[key] = map;
  }

  PR_STATE.assetOrder = PR_ASSET_ORDER.filter((k) => k === "cash" || data.assets[k]);
  PR_STATE.allocation = prPresetAlloc("balanced");
  PR_STATE.episodesByQuadrant = prBuildEpisodes(data.months);

  const setup = document.getElementById("principles-setup");
  setup.hidden = false;

  const entryInput = document.getElementById("pr-entry-date");
  const exitInput  = document.getElementById("pr-exit-date");
  entryInput.min = PR_STATE.minYm; entryInput.max = PR_STATE.maxYm;
  exitInput.min  = PR_STATE.minYm; exitInput.max  = PR_STATE.maxYm;

  const wantDefault = "1999-06";
  const defaultEntry = (prYmToN(wantDefault) >= prYmToN(PR_STATE.minYm) &&
                        prYmToN(wantDefault) <= prYmToN(PR_STATE.maxYm))
    ? wantDefault : PR_STATE.minYm;
  entryInput.value = defaultEntry;
  exitInput.value  = PR_STATE.maxYm;

  prRenderAllocGrid();
  prRenderPresetRow();
  prRenderEntrySnapshot();

  entryInput.addEventListener("change", prRenderEntrySnapshot);
  document.getElementById("pr-run-btn").addEventListener("click", prRunScenario);
  document.getElementById("pr-save-btn").addEventListener("click", prSaveScenario);
  document.getElementById("pr-journal-export").addEventListener("click", prExportJournal);
  document.getElementById("pr-journal-clear").addEventListener("click", prClearJournal);

  prInitSimilar();
  prRenderJournal();
}

// ---------- 자산배분 UI ----------
function prRenderAllocGrid() {
  const host = document.getElementById("pr-alloc-grid");
  host.innerHTML = prAssets().map((key) => {
    const meta = PR_ASSET_META[key];
    const asset = PR_STATE.data.assets[key];
    const w = PR_STATE.allocation[key] ?? 0;
    const note = asset.synthetic_flat
      ? asset.note
      : `데이터 범위: ${asset.start.slice(0, 7)} ~ ${asset.end.slice(0, 7)}`;
    return `
      <div class="pr-alloc-item" data-asset="${key}">
        <div class="pr-alloc-name"><span>${escapeHtml(meta.short)}</span><b data-role="val">${w}%</b></div>
        <input type="range" class="pr-alloc-range" data-asset="${key}" min="0" max="100" step="1" value="${w}">
        <div class="pr-alloc-note">${escapeHtml(note)}</div>
      </div>`;
  }).join("");

  host.querySelectorAll(".pr-alloc-range").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.asset;
      PR_STATE.allocation[key] = Number(input.value);
      host.querySelector(`.pr-alloc-item[data-asset="${key}"] b[data-role="val"]`).textContent = `${input.value}%`;
      prUpdateAllocTotal();
    });
  });
  prUpdateAllocTotal();
}

function prUpdateAllocTotal() {
  const total = prAssets().reduce((s, k) => s + (PR_STATE.allocation[k] || 0), 0);
  const el = document.getElementById("pr-alloc-total-val");
  el.textContent = total;
  el.parentElement.classList.toggle("pr-alloc-bad", total !== 100);
  return total;
}

function prRenderPresetRow() {
  const host = document.getElementById("pr-preset-row");
  const hasGold = prAssets().includes("gold_xau");
  const presets = [
    { key: "all_bond", label: "100% 국채" },
    { key: "all_cash", label: "100% 현금" },
    { key: "all_us",   label: "100% 미국주식" },
    { key: "all_kr",   label: "100% 코스피" },
    ...(hasGold ? [{ key: "all_gold", label: "100% 금" }] : []),
    { key: "balanced", label: "균등분산" },
    { key: "quadrant", label: "이 국면 추천 배분" },
  ];
  host.innerHTML = presets.map((p) =>
    `<button type="button" class="pr-preset-btn" data-preset="${p.key}">${escapeHtml(p.label)}</button>`,
  ).join("");
  host.querySelectorAll(".pr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => prApplyPreset(btn.dataset.preset));
  });
}

// 추천 배분 중 이 기간에 데이터가 없는 자산(예: 2006년 이전 S&P500)은 0으로
// 낮추고, 남은 자산끼리 비중을 다시 100%로 재분배한다.
function prFitAllocToRange(alloc, entryYm, exitYm) {
  const available = {};
  let availSum = 0;
  for (const k of prAssets()) {
    const w = alloc[k] || 0;
    if (w > 0 && prAssetRangeOk(k, entryYm, exitYm)) { available[k] = w; availSum += w; }
  }
  if (availSum === 0) return prPresetAlloc("all_cash");
  const out = {};
  for (const k of prAssets()) out[k] = 0;
  for (const [k, w] of Object.entries(available)) out[k] = Math.round((w / availSum) * 100);
  const diff = 100 - prAssets().reduce((s, k) => s + out[k], 0);
  if (diff !== 0) {
    const biggest = Object.keys(available).reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[biggest] += diff;
  }
  return out;
}

function prApplyPreset(key) {
  let alloc;
  if (key === "quadrant") {
    const entryYm = document.getElementById("pr-entry-date").value;
    const exitYm  = document.getElementById("pr-exit-date").value;
    const row = PR_STATE.monthsByYm.get(entryYm);
    const q = row ? row.quadrant : null;
    const base = PR_QUADRANT_ALLOC[q] || prPresetAlloc("balanced");
    alloc = prFitAllocToRange(base, entryYm, exitYm);
  } else {
    alloc = prPresetAlloc(key);
  }
  PR_STATE.allocation = { ...alloc };
  prRenderAllocGrid();
}

// ---------- 진입 시점 국면 스냅샷 ----------
function prRenderEntrySnapshot() {
  const host = document.getElementById("pr-entry-snapshot");
  const ym = document.getElementById("pr-entry-date").value;
  const row = PR_STATE.monthsByYm.get(ym);
  if (!row) {
    host.innerHTML = `<p class="pr-snapshot-empty">이 시점의 국면 데이터가 없습니다.</p>`;
    return;
  }
  const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : "";
  const playbook = PR_STATE.data.quadrant_playbook[q] || null;
  host.innerHTML = `
    <div class="assessment-card assessment-card-primary">
      <div class="aw-header">
        <span class="aw-title">${escapeHtml(ym)} 시점의 국면</span>
        <span class="aw-sub">그 때 알 수 있었던 데이터만 사용 (발표 지연 반영, 모델 H)</span>
      </div>
      <div class="aw-quadrant" data-quadrant="${escapeHtml(q)}">${escapeHtml(row.quadrant || "—")}${playbook ? ` · ${escapeHtml(playbook.label)}` : ""}</div>
      <div class="aw-scores">
        <span class="aw-score">성장 <b data-label="${row.growth_label || ""}">${row.growth_score ?? "—"}</b></span>
        <span class="aw-score">인플레 <b data-label="${row.inflation_label || ""}">${row.inflation_score ?? "—"}</b></span>
      </div>
      <div class="pr-snapshot-market">
        <span class="pr-mkt-title">그 때의 시장 지표</span>
        ${prMarketChips(row)}
      </div>
    </div>
    ${prMissingIndicatorNote()}
    ${playbook ? `<p class="pr-snapshot-hint">${escapeHtml(playbook.hint)} — ${escapeHtml(playbook.principle)}</p>` : ""}
    ${q ? `<button type="button" class="pr-similar-jump" data-quadrant="${q}">🔍 과거의 ${q} 국면들과 비교하기 ↓</button>` : ""}
  `;
  const jumpBtn = host.querySelector(".pr-similar-jump");
  if (jumpBtn) {
    jumpBtn.addEventListener("click", () => {
      prSelectQuadrant(jumpBtn.dataset.quadrant);
      document.getElementById("pr-similar").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

// ---------- 시뮬레이션 엔진 ----------
function prAssetValueAt(key, ym) {
  if (key === "cash") return 100;
  const map = PR_STATE.assetByYm[key];
  return map ? (map.get(ym) ?? null) : null;
}

function prAssetRangeOk(key, entryYm, exitYm) {
  if (key === "cash") return true;
  const asset = PR_STATE.data.assets[key];
  if (!asset) return false;
  return entryYm >= asset.start.slice(0, 7) && exitYm <= asset.end.slice(0, 7);
}

// 진입~청산 사이 인플레이션 누적 배수. entry 로부터 정확히 12개월씩 떨어진
// 월(연간 YoY)만 체인으로 곱해 오차를 피하고, 마지막 잔여 개월(<12)만
// 최근 YoY 로 선형(기하) 근사한다.
function prInflationMultiple(entryYm, exitYm) {
  const totalMonths = prMonthsBetween(entryYm, exitYm);
  const fullYears = Math.floor(totalMonths / 12);
  const remainder = totalMonths - fullYears * 12;
  let mult = 1;
  for (let k = 1; k <= fullYears; k++) {
    const row = PR_STATE.monthsByYm.get(prAddMonths(entryYm, k * 12));
    if (row && row.cpi_yoy != null) mult *= (1 + row.cpi_yoy / 100);
  }
  if (remainder > 0) {
    const row = PR_STATE.monthsByYm.get(exitYm);
    if (row && row.cpi_yoy != null) mult *= Math.pow(1 + row.cpi_yoy / 100, remainder / 12);
  }
  return mult;
}

// buy & hold 가정: 자산별 (청산가/진입가) 를 비중으로 가중합.
function prPortfolioMultiple(alloc, entryYm, exitYm) {
  let mult = 0;
  let totalWeight = 0;
  for (const key of prAssets()) {
    const w = alloc[key] || 0;
    if (w <= 0) continue;
    totalWeight += w;
    const v0 = prAssetValueAt(key, entryYm);
    const v1 = prAssetValueAt(key, exitYm);
    if (v0 == null || v1 == null) return null;
    mult += (w / 100) * (v1 / v0);
  }
  if (totalWeight === 0) return null;
  return mult;
}

function prInRecession(ym) {
  for (const ep of PR_STATE.data.recession_episodes) {
    const start = prAddMonths(ep.peak, 1);
    if (ym >= start && ym <= ep.trough) return true;
  }
  return false;
}
function prInInflationEpisode(ym) {
  for (const ep of PR_STATE.data.inflation_episodes) {
    if (ym >= ep.start && ym <= ep.end) return true;
  }
  return false;
}

function prShowError(msg) {
  const el = document.getElementById("pr-error");
  el.hidden = false;
  el.textContent = msg;
  document.getElementById("pr-result").hidden = true;
}

function prRunScenario() {
  const errEl = document.getElementById("pr-error");
  errEl.hidden = true;

  const entryYm = document.getElementById("pr-entry-date").value;
  const exitYm  = document.getElementById("pr-exit-date").value;
  const total = prUpdateAllocTotal();

  if (!entryYm || !exitYm) return prShowError("진입/청산 시점을 선택하세요.");
  if (prYmToN(exitYm) <= prYmToN(entryYm)) return prShowError("청산 시점은 진입 시점보다 뒤여야 합니다.");
  if (total !== 100) return prShowError(`자산배분 합계가 ${total}% 입니다 — 100%로 맞춰주세요.`);

  const missing = prAssets().filter(
    (k) => (PR_STATE.allocation[k] || 0) > 0 && !prAssetRangeOk(k, entryYm, exitYm),
  );
  if (missing.length > 0) {
    const names = missing.map((k) => PR_ASSET_META[k].short).join(", ");
    return prShowError(`${names} 은(는) 이 기간의 데이터가 없습니다. 기간을 조정하거나 비중을 0으로 낮춰주세요.`);
  }

  const alloc = { ...PR_STATE.allocation };
  const portfolioMult = prPortfolioMultiple(alloc, entryYm, exitYm);
  if (portfolioMult == null) return prShowError("수익률을 계산할 수 없습니다 (데이터 누락).");

  const monthsHeld = prMonthsBetween(entryYm, exitYm);
  const years = monthsHeld / 12;
  const cagr = Math.pow(portfolioMult, 1 / years) - 1;
  const inflMult = prInflationMultiple(entryYm, exitYm);
  const realMult = portfolioMult / inflMult;

  const benchmarks = prAssets().map((key) => {
    const ok = prAssetRangeOk(key, entryYm, exitYm);
    const mult = ok ? prPortfolioMultiple({ [key]: 100 }, entryYm, exitYm) : null;
    return { key, label: PR_ASSET_META[key].short, ret: mult != null ? mult - 1 : null };
  });

  const entryRow = PR_STATE.monthsByYm.get(entryYm);
  const exitRow  = PR_STATE.monthsByYm.get(exitYm);
  const q = entryRow && ["Q1", "Q2", "Q3", "Q4"].includes(entryRow.quadrant) ? entryRow.quadrant : null;
  // 추천 배분에 든 자산 중 이 기간 데이터가 없는 것(예: 초기 금·S&P500)은
  // 나머지 자산으로 재분배해 비교가 항상 가능하게 한다.
  const recommendedAlloc = q ? prFitAllocToRange(PR_QUADRANT_ALLOC[q], entryYm, exitYm) : null;
  let recommendedRet = null;
  if (recommendedAlloc) {
    const okAll = prAssets().every(
      (k) => (recommendedAlloc[k] || 0) === 0 || prAssetRangeOk(k, entryYm, exitYm),
    );
    if (okAll) {
      const m = prPortfolioMultiple(recommendedAlloc, entryYm, exitYm);
      if (m != null) recommendedRet = m - 1;
    }
  }

  const pathYms = PR_STATE.monthsSorted.filter((ym) => ym >= entryYm && ym <= exitYm);
  const pathRows = pathYms.map((ym) => PR_STATE.monthsByYm.get(ym));
  let transitions = 0, recessionMonths = 0, inflationMonths = 0;
  for (let i = 0; i < pathRows.length; i++) {
    if (i > 0 && pathRows[i].quadrant !== pathRows[i - 1].quadrant) transitions++;
    if (prInRecession(pathYms[i])) recessionMonths++;
    if (prInInflationEpisode(pathYms[i])) inflationMonths++;
  }

  const scenario = {
    entryYm, exitYm, monthsHeld, allocation: alloc,
    totalReturn: portfolioMult - 1, cagr, realReturn: realMult - 1,
    benchmarks, recommendedRet, entryQuadrant: q,
    transitions, recessionMonths, inflationMonths,
    pathYms, pathRows,
    entryRow, exitRow,
  };
  PR_STATE.lastScenario = scenario;
  prRenderResult(scenario);
}

// ---------- 결과 렌더링 ----------
function prRenderResult(sc) {
  document.getElementById("pr-result").hidden = false;

  document.getElementById("pr-metric-months").textContent = `${sc.monthsHeld}개월`;

  const totalEl = document.getElementById("pr-metric-total");
  totalEl.textContent = prFmtPct(sc.totalReturn);
  totalEl.dataset.sign = prSignAttr(sc.totalReturn);

  const cagrEl = document.getElementById("pr-metric-cagr");
  cagrEl.textContent = prFmtPct(sc.cagr);
  cagrEl.dataset.sign = prSignAttr(sc.cagr);

  const realEl = document.getElementById("pr-metric-real");
  realEl.textContent = prFmtPct(sc.realReturn);
  realEl.dataset.sign = prSignAttr(sc.realReturn);

  const benchHost = document.getElementById("pr-benchmarks");
  benchHost.innerHTML = sc.benchmarks.map((b) => {
    const color = b.ret == null ? "var(--text-dim)" : (b.ret >= 0 ? "var(--up)" : "var(--down)");
    const val = b.ret == null ? "데이터없음" : prFmtPct(b.ret);
    return `<span>${escapeHtml(b.label)} 100%: <b style="color:${color}">${val}</b></span>`;
  }).join("");

  prRenderIndicatorCompare(sc);
  prRenderPathStrip(sc);
  prRenderPathChart(sc);
  document.getElementById("pr-insight").innerHTML = prBuildInsight(sc);
}

// 진입 vs 청산 시점의 시장 지표(기준금리·10년물·금·CPI) 비교표.
function prRenderIndicatorCompare(sc) {
  const host = document.getElementById("pr-indicator-compare");
  if (!host) return;
  const rows = PR_MKT_DEFS.map((def) => {
    const v0 = sc.entryRow ? sc.entryRow[def.key] : null;
    const v1 = sc.exitRow ? sc.exitRow[def.key] : null;
    const delta = prFmtMktDelta(def, v0, v1);
    const deltaHtml = delta
      ? `<span class="pr-ic-delta" data-sign="${delta.sign}">${escapeHtml(delta.text)}</span>`
      : "—";
    return `
      <tr>
        <th>${escapeHtml(def.label)}</th>
        <td>${escapeHtml(prFmtMktValue(def, v0))}</td>
        <td>${escapeHtml(prFmtMktValue(def, v1))}</td>
        <td>${deltaHtml}</td>
      </tr>`;
  }).join("");
  host.innerHTML = `
    <h3>진입 vs 청산 시점의 시장 지표</h3>
    <table class="pr-ic-table">
      <thead>
        <tr>
          <th></th>
          <th>진입 (${escapeHtml(sc.entryYm)})</th>
          <th>청산 (${escapeHtml(sc.exitYm)})</th>
          <th>변화</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${prMissingIndicatorNote()}
  `;
}

function prRenderPathStrip(sc) {
  const host = document.getElementById("pr-path-strip");
  host.innerHTML = sc.pathRows.map((row, i) => {
    const ym = sc.pathYms[i];
    const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : "";
    const rec  = prInRecession(ym) ? "1" : "0";
    const infl = prInInflationEpisode(ym) ? "1" : "0";
    return `<div class="pr-path-cell" data-quadrant="${q}" data-recession="${rec}" ` +
           `data-inflation-episode="${infl}" title="${escapeHtml(ym)} · ${escapeHtml(row.quadrant || "—")}"></div>`;
  }).join("");
}

function prRenderPathChart(sc) {
  const canvas = document.getElementById("pr-path-canvas");
  if (!canvas) return;
  if (PR_STATE.pathChart) { PR_STATE.pathChart.destroy(); PR_STATE.pathChart = null; }
  // eslint-disable-next-line no-undef
  PR_STATE.pathChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: sc.pathYms,
      datasets: [
        {
          label: "성장 점수", data: sc.pathRows.map((r) => r.growth_score),
          borderColor: "#c8d8ea", backgroundColor: "transparent",
          borderWidth: 1.5, pointRadius: 0, tension: 0.15,
        },
        {
          label: "인플레 점수", data: sc.pathRows.map((r) => r.inflation_score),
          borderColor: "#cc2424", backgroundColor: "transparent",
          borderWidth: 1.5, pointRadius: 0, tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#787878", font: { size: 10 } } },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: { ticks: { color: "#787878", maxTicksLimit: 8, font: { size: 9 } }, grid: { color: "#1c1c1c" } },
        y: { min: 0, max: 100, ticks: { color: "#787878", font: { size: 9 } }, grid: { color: "#222222" } },
      },
    },
  });
}

function prBuildInsight(sc) {
  const q = sc.entryQuadrant;
  const playbook = q ? PR_STATE.data.quadrant_playbook[q] : null;
  const draft = q ? (PR_DRAFT_PRINCIPLE[q] || PR_DRAFT_DEFAULT) : PR_DRAFT_DEFAULT;
  const allocSummary = PR_ASSET_ORDER
    .filter((k) => (sc.allocation[k] || 0) > 0)
    .map((k) => `${PR_ASSET_META[k].short} ${sc.allocation[k]}%`)
    .join(" · ");

  const lines = [];
  lines.push(
    `진입 시점(${escapeHtml(sc.entryYm)})의 국면은 <strong>${escapeHtml(q || "경계/중립")}</strong>` +
    `${playbook ? ` (${escapeHtml(playbook.label)})` : ""}이었다.`,
  );
  if (playbook) {
    lines.push(`역사적으로 이 국면에서 유리했던 자산: ${escapeHtml(playbook.hint)}. ${escapeHtml(playbook.principle)}`);
  }
  lines.push(
    `보유 ${sc.monthsHeld}개월 동안 국면이 ${sc.transitions}번 바뀌었고, ` +
    `${sc.recessionMonths}개월은 NBER 공식 침체, ${sc.inflationMonths}개월은 고인플레 episode 구간과 겹쳤다.`,
  );
  const mktMoves = PR_MKT_DEFS
    .map((def) => {
      const v0 = sc.entryRow ? sc.entryRow[def.key] : null;
      const v1 = sc.exitRow ? sc.exitRow[def.key] : null;
      if (v0 == null || v1 == null) return null;
      return `${def.label} ${prFmtMktValue(def, v0)} → ${prFmtMktValue(def, v1)}`;
    })
    .filter(Boolean);
  if (mktMoves.length > 0) {
    lines.push(`같은 기간 시장 지표는 ${escapeHtml(mktMoves.join(", "))} 로 움직였다.`);
  }
  lines.push(
    `내 배분(${escapeHtml(allocSummary)})의 실현수익률은 <strong>${prFmtPct(sc.totalReturn)}</strong> ` +
    `(연환산 ${prFmtPct(sc.cagr)}, 물가반영 실질 ${prFmtPct(sc.realReturn)}).`,
  );
  if (sc.recommendedRet != null) {
    lines.push(
      `같은 기간 이 국면의 '참고용 추천 배분'을 따랐다면 <strong>${prFmtPct(sc.recommendedRet)}</strong> 였다 ` +
      `(원자재·금 데이터가 없어 코스피·현금으로 근사한 예시 배분 — 투자 조언 아님).`,
    );
  }
  lines.push(`원칙 초안: ${escapeHtml(draft)}`);
  return lines.join("\n\n");
}

// =====================================================================
// 비슷한 과거 국면 찾기 — 4분면 필터
//
// "내가 지금 Q1 에 있다면, 과거의 Q1 들은 어떻게 흘러갔나?" 를 보여준다.
// 월별 타임라인에서 같은 분면이 연속된 구간(episode)을 묶고, 각 구간의
// 시장 지표(기준금리·10년물·금·CPI) 변화와 자산 성과를 카드로 나열한다.
// =====================================================================

const PR_EPISODE_PAGE = 10; // 처음에 보여줄 에피소드 수

// 같은 분면이 연속된 구간들. 경계(edge) 판정 월은 구간을 끊는다.
function prBuildEpisodes(months) {
  const out = { Q1: [], Q2: [], Q3: [], Q4: [] };
  let cur = null;
  for (const row of months) {
    const ym = prYm(row.date);
    const q = ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant) ? row.quadrant : null;
    if (cur && q === cur.quadrant) {
      cur.endYm = ym;
      cur.months++;
    } else {
      if (cur) out[cur.quadrant].push(cur);
      cur = q ? { quadrant: q, startYm: ym, endYm: ym, months: 1 } : null;
    }
  }
  if (cur) out[cur.quadrant].push(cur);
  const lastYm = months.length > 0 ? prYm(months[months.length - 1].date) : null;
  for (const q of Object.keys(out)) {
    for (const ep of out[q]) ep.ongoing = ep.endYm === lastYm;
    out[q].reverse(); // 최신순
  }
  return out;
}

function prRangeReturn(assetKey, startYm, endYm) {
  const map = PR_STATE.assetByYm[assetKey];
  if (!map) return null;
  const v0 = map.get(startYm);
  const v1 = map.get(endYm);
  if (v0 == null || v1 == null) return null;
  return v1 / v0 - 1;
}

// 가장 최근의 뚜렷한(Q1~Q4) 분면. isNow 는 그것이 최신 월인 경우에만 true —
// 최신 월이 경계/중립 판정이면 "지금 여기" 로 표시하지 않는다.
function prCurrentQuadrant() {
  for (let i = PR_STATE.monthsSorted.length - 1; i >= 0; i--) {
    const ym = PR_STATE.monthsSorted[i];
    const row = PR_STATE.monthsByYm.get(ym);
    if (row && ["Q1", "Q2", "Q3", "Q4"].includes(row.quadrant)) {
      return { quadrant: row.quadrant, ym, isNow: ym === PR_STATE.maxYm };
    }
  }
  return null;
}

function prInitSimilar() {
  const section = document.getElementById("pr-similar");
  if (!section) return;
  section.hidden = false;

  const current = prCurrentQuadrant();
  const host = document.getElementById("pr-quad-filter");
  host.innerHTML = ["Q1", "Q2", "Q3", "Q4"].map((q) => {
    const pb = PR_STATE.data.quadrant_playbook[q];
    const nowBadge = current && current.quadrant === q
      ? `<em class="pr-quad-now">${current.isNow ? "지금 여기" : `최근 (${escapeHtml(current.ym)})`}</em>` : "";
    return `
      <button type="button" class="pr-quad-btn" data-quadrant="${q}">
        <b>${q}</b>
        <span>${escapeHtml(pb ? pb.label : "")}</span>
        ${nowBadge}
      </button>`;
  }).join("");
  host.querySelectorAll(".pr-quad-btn").forEach((btn) => {
    btn.addEventListener("click", () => prSelectQuadrant(btn.dataset.quadrant));
  });

  prSelectQuadrant(current ? current.quadrant : "Q2");
}

function prSelectQuadrant(q) {
  PR_STATE.selectedQuadrant = q;
  PR_STATE.similarShowAll = false;
  document.querySelectorAll("#pr-quad-filter .pr-quad-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.quadrant === q);
  });
  prRenderEpisodes(q);
}

// 에피소드 구간에 NBER 침체가 한 달이라도 겹치는가
function prEpisodeHasRecession(ep) {
  for (let ym = ep.startYm; ym <= ep.endYm; ym = prAddMonths(ym, 1)) {
    if (prInRecession(ym)) return true;
  }
  return false;
}

function prEpisodeIndicatorRows(startRow, endRow, singleMonth) {
  return PR_MKT_DEFS.map((def) => {
    const v0 = startRow ? startRow[def.key] : null;
    const v1 = endRow ? endRow[def.key] : null;
    if (v0 == null && v1 == null) return "";
    // 1개월짜리 국면은 시작=끝이므로 화살표 없이 그 달의 값만 보여준다.
    if (singleMonth) {
      return `
        <div class="pr-ep-ind-row">
          <span class="pr-ep-ind-label">${escapeHtml(def.label)}</span>
          <span class="pr-ep-ind-vals">${escapeHtml(prFmtMktValue(def, v1 ?? v0))}</span>
        </div>`;
    }
    const delta = prFmtMktDelta(def, v0, v1);
    const deltaHtml = delta
      ? ` <span class="pr-ic-delta" data-sign="${delta.sign}">${escapeHtml(delta.text)}</span>` : "";
    return `
      <div class="pr-ep-ind-row">
        <span class="pr-ep-ind-label">${escapeHtml(def.label)}</span>
        <span class="pr-ep-ind-vals">${escapeHtml(prFmtMktValue(def, v0))} → ${escapeHtml(prFmtMktValue(def, v1))}${deltaHtml}</span>
      </div>`;
  }).join("");
}

const PR_EP_ASSETS = [
  ["stock_us_sp500", "S&P500"],
  ["stock_kr_kospi", "코스피"],
  ["gold_xau", "금"],
  ["bond_us10y", "채권(근사)"],
];

// 국면 중 자산 수익률의 기준점은 국면 시작 전월 말 — 국면에 들어선 첫 달의
// 움직임까지 포함한다 (전월 데이터가 없으면 시작월 기준으로 폴백).
function prEpisodeReturn(assetKey, ep) {
  const prevYm = prAddMonths(ep.startYm, -1);
  const r = prRangeReturn(assetKey, prevYm, ep.endYm);
  return r != null ? r : prRangeReturn(assetKey, ep.startYm, ep.endYm);
}

function prEpisodeAssetPerf(ep) {
  const parts = [];
  for (const [key, label] of PR_EP_ASSETS) {
    const r = prEpisodeReturn(key, ep);
    if (r == null) continue;
    parts.push(`${escapeHtml(label)} <b data-sign="${prSignAttr(r)}">${prFmtPct(r)}</b>`);
  }
  return parts.length > 0 ? parts.join(" · ") : `<span class="pr-ep-nodata">이 구간의 자산 가격 데이터 없음</span>`;
}

// 국면 종료 후 12개월 동안의 자산 성과 — "그 다음에 무슨 일이 있었나".
function prEpisodeAfterPerf(ep) {
  if (ep.ongoing) return "";
  const afterYm = prAddMonths(ep.endYm, 12);
  if (afterYm > PR_STATE.maxYm) return "";
  const parts = [];
  for (const [key, label] of PR_EP_ASSETS) {
    const r = prRangeReturn(key, ep.endYm, afterYm);
    if (r == null) continue;
    parts.push(`${escapeHtml(label)} <b data-sign="${prSignAttr(r)}">${prFmtPct(r)}</b>`);
  }
  if (parts.length === 0) return "";
  return `<div class="pr-ep-after">국면 종료 후 12개월: ${parts.join(" · ")}</div>`;
}

function prRenderEpisodes(q) {
  const episodes = (PR_STATE.episodesByQuadrant && PR_STATE.episodesByQuadrant[q]) || [];
  const summaryHost = document.getElementById("pr-quad-summary");
  const listHost = document.getElementById("pr-episode-list");
  const pb = PR_STATE.data.quadrant_playbook[q];
  const current = prCurrentQuadrant();

  if (episodes.length === 0) {
    summaryHost.innerHTML = "";
    listHost.innerHTML = `<p class="pr-journal-empty">${q} 국면으로 판정된 과거 구간이 없습니다.</p>`;
    return;
  }

  const avgMonths = episodes.reduce((s, ep) => s + ep.months, 0) / episodes.length;
  const spReturns = episodes
    .map((ep) => prEpisodeReturn("stock_us_sp500", ep))
    .filter((r) => r != null);
  const avgSp = spReturns.length > 0
    ? spReturns.reduce((s, r) => s + r, 0) / spReturns.length : null;

  summaryHost.innerHTML = `
    <div class="pr-quad-summary-card" data-quadrant="${q}">
      <p>
        <strong>${q} · ${escapeHtml(pb ? pb.label : "")}</strong> 국면은 1980년 이후
        <b>${episodes.length}번</b> 있었고, 평균 <b>${avgMonths.toFixed(1)}개월</b> 지속됐다.
        ${avgSp != null ? `국면 중 S&P500 평균 수익률은 <b data-sign="${prSignAttr(avgSp)}">${prFmtPct(avgSp)}</b> (데이터가 있는 ${spReturns.length}개 구간 기준).` : ""}
        ${current && current.quadrant === q
          ? (current.isNow
              ? `<em class="pr-quad-now-inline">지금(${escapeHtml(current.ym)})이 바로 이 국면이다.</em>`
              : `<em class="pr-quad-now-inline">가장 최근엔 ${escapeHtml(current.ym)}에 이 국면이었다 (그 이후는 경계/중립 판정).</em>`)
          : ""}
      </p>
      ${pb ? `<p class="pr-snapshot-hint">${escapeHtml(pb.hint)} — ${escapeHtml(pb.principle)}</p>` : ""}
    </div>`;

  const showAll = PR_STATE.similarShowAll;
  const visible = showAll ? episodes : episodes.slice(0, PR_EPISODE_PAGE);
  const cards = visible.map((ep) => {
    const startRow = PR_STATE.monthsByYm.get(ep.startYm);
    const endRow = PR_STATE.monthsByYm.get(ep.endYm);
    const badges = [
      ep.ongoing ? `<em class="pr-ep-badge pr-ep-ongoing">진행 중</em>` : "",
      prEpisodeHasRecession(ep) ? `<em class="pr-ep-badge pr-ep-recession">NBER 침체 겹침</em>` : "",
    ].join("");
    return `
      <div class="pr-episode-card" data-quadrant="${q}">
        <div class="pr-ep-head">
          <b>${escapeHtml(ep.startYm)} ~ ${escapeHtml(ep.endYm)}</b>
          <span>${ep.months}개월</span>
          ${badges}
        </div>
        <div class="pr-ep-ind">${prEpisodeIndicatorRows(startRow, endRow, ep.months === 1)}</div>
        <div class="pr-ep-assets">국면 중 성과: ${prEpisodeAssetPerf(ep)}</div>
        ${prEpisodeAfterPerf(ep)}
      </div>`;
  }).join("");

  const moreBtn = !showAll && episodes.length > PR_EPISODE_PAGE
    ? `<button type="button" class="pr-ep-more" id="pr-ep-more">전체 ${episodes.length}개 구간 모두 보기</button>` : "";
  listHost.innerHTML = cards + moreBtn + prMissingIndicatorNote();

  const moreEl = document.getElementById("pr-ep-more");
  if (moreEl) {
    moreEl.addEventListener("click", () => {
      PR_STATE.similarShowAll = true;
      prRenderEpisodes(q);
    });
  }
}

// ---------- 원칙 저널 (localStorage) ----------
function prLoadJournal() {
  try {
    return JSON.parse(localStorage.getItem(PR_JOURNAL_KEY) || "[]");
  } catch {
    return [];
  }
}
function prSaveJournalList(list) {
  localStorage.setItem(PR_JOURNAL_KEY, JSON.stringify(list));
}

function prSaveScenario() {
  const sc = PR_STATE.lastScenario;
  if (!sc) return;
  const list = prLoadJournal();
  list.unshift({
    savedAt: new Date().toISOString(),
    entryYm: sc.entryYm, exitYm: sc.exitYm, monthsHeld: sc.monthsHeld,
    allocation: sc.allocation, totalReturn: sc.totalReturn, cagr: sc.cagr,
    realReturn: sc.realReturn, entryQuadrant: sc.entryQuadrant,
    insight: prBuildInsight(sc).replace(/<[^>]+>/g, ""),
  });
  prSaveJournalList(list);
  prRenderJournal();
}

function prRenderJournal() {
  const host = document.getElementById("pr-journal-list");
  const list = prLoadJournal();
  if (list.length === 0) {
    host.innerHTML = `<p class="pr-journal-empty">아직 저장된 시나리오가 없습니다. 위에서 계산 후 "원칙 저널에 저장"을 눌러보세요.</p>`;
    return;
  }
  host.innerHTML = list.map((item, i) => {
    const allocSummary = PR_ASSET_ORDER
      .filter((k) => (item.allocation[k] || 0) > 0)
      .map((k) => `${PR_ASSET_META[k].short} ${item.allocation[k]}%`)
      .join(" · ");
    return `
      <div class="pr-journal-item">
        <div class="pr-journal-item-head">
          <b>${escapeHtml(item.entryYm)} → ${escapeHtml(item.exitYm)}</b>
          <span>(${item.monthsHeld}개월, 진입국면 ${escapeHtml(item.entryQuadrant || "—")})</span>
          <span class="pr-journal-item-return" data-sign="${prSignAttr(item.totalReturn)}">${prFmtPct(item.totalReturn)}</span>
        </div>
        <div class="pr-journal-item-alloc">${escapeHtml(allocSummary)}</div>
        <div class="pr-journal-item-note">${escapeHtml(item.insight)}</div>
        <button type="button" class="pr-journal-item-del" data-idx="${i}">삭제</button>
      </div>`;
  }).join("");
  host.querySelectorAll(".pr-journal-item-del").forEach((btn) => {
    btn.addEventListener("click", () => prDeleteJournalItem(Number(btn.dataset.idx)));
  });
}

function prDeleteJournalItem(idx) {
  const list = prLoadJournal();
  list.splice(idx, 1);
  prSaveJournalList(list);
  prRenderJournal();
}

function prExportJournal() {
  const list = prLoadJournal();
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `principles-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function prClearJournal() {
  if (!confirm("저장된 모든 시나리오를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
  prSaveJournalList([]);
  prRenderJournal();
}


// ════════════════════════════════════════════════════════════════
// 사이드바 — 열기/닫기
//   데스크톱: 접힌 상태를 localStorage 에 저장, ☰ 플로팅 버튼으로 복원
//   모바일(≤900px): 드로어 방식 — ☰ 로 열고, 배경/탭 선택/✕ 로 닫기
// ════════════════════════════════════════════════════════════════
const SIDEBAR_LS_KEY = "lukeDashSidebarCollapsed";

function sbGetCollapsed() {
  try { return localStorage.getItem(SIDEBAR_LS_KEY) === "1"; } catch { return false; }
}
function sbSetCollapsed(v) {
  try { localStorage.setItem(SIDEBAR_LS_KEY, v ? "1" : "0"); } catch { /* private mode 등 */ }
}

function initSidebar() {
  const openBtn  = document.getElementById("sidebar-open");
  const closeBtn = document.getElementById("sidebar-close");
  const backdrop = document.getElementById("sidebar-backdrop");
  const nav      = document.querySelector(".sidebar-nav");
  if (!openBtn || !closeBtn || !backdrop) return;

  const mq = window.matchMedia("(max-width: 900px)");

  function apply() {
    if (mq.matches) {
      // 모바일: transform 드로어 — 닫혀 있을 때만 ☰ 버튼 표시
      const open = document.body.classList.contains("sb-mobile-open");
      openBtn.hidden = open;
      backdrop.hidden = !open;
    } else {
      document.body.classList.remove("sb-mobile-open");
      backdrop.hidden = true;
      const collapsed = sbGetCollapsed();
      document.body.classList.toggle("sb-collapsed", collapsed);
      openBtn.hidden = !collapsed;
    }
  }

  openBtn.addEventListener("click", () => {
    if (mq.matches) document.body.classList.add("sb-mobile-open");
    else sbSetCollapsed(false);
    apply();
  });
  closeBtn.addEventListener("click", () => {
    if (mq.matches) document.body.classList.remove("sb-mobile-open");
    else sbSetCollapsed(true);
    apply();
  });
  backdrop.addEventListener("click", () => {
    document.body.classList.remove("sb-mobile-open");
    apply();
  });
  // 모바일 드로어에서 탭을 고르면 자동으로 닫는다
  if (nav) {
    nav.addEventListener("click", (e) => {
      if (mq.matches && e.target.closest(".tab-btn")) {
        document.body.classList.remove("sb-mobile-open");
        apply();
      }
    });
  }
  mq.addEventListener("change", apply);
  apply();
}


// ════════════════════════════════════════════════════════════════
// 위키 지식 그래프 — luke_wiki (Obsidian vault) 시각화
//
// data/wiki/graph.json (scripts/build_wiki_graph.py 가 생성) 을 읽어
// 노트=노드, [[위키링크]]=엣지인 force-directed 그래프를 캔버스에 그린다.
// 노드 크기 = 연결 수, 색 = 폴더. 휠 줌 / 배경 팬 / 노드 드래그 지원.
// ════════════════════════════════════════════════════════════════

// 폴더별 카테고리 색 — 다크 배경(#121212) 기준 CVD 검증 통과 팔레트, 순서 고정
const WIKI_FOLDER_COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9", "#e66767", "#d55181"];
const WIKI_OTHER_COLOR   = "#8a8a8a";
const WIKI_OTHER_LABEL   = "기타";

// ── 공유 노트 뷰어 ──────────────────────────────────────────────
// graph.json 로드·색인과 노트 본문 모달은 위키 탭 전용이 아니라 전역이다:
// 시장 지도의 '위키 노트' 버튼도 같은 뷰어로 노트를 연다.
//  - wnLoadGraph(): graph.json 1회 로드 + (경로→노드, 티커→뉴스 로그) 색인
//  - wnOpenByIdx(idx): data/wiki/notes/<idx>.json 본문을 모달로 렌더
const WN_STATE = { promise: null, graph: null, byPath: null, byTicker: null, overlay: null };

function wnLoadGraph() {
  if (!WN_STATE.promise) {
    WN_STATE.promise = fetch("data/wiki/graph.json", { cache: "no-cache" })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
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
    const res = await fetch(`data/wiki/notes/${idx}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const note = await res.json();
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
    const res = await fetch(`data/wiki/notes/${idx}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const note = await res.json();
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

function wikiInitGraph(graph) {
  const canvas = document.getElementById("wiki-canvas");
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

  // ---------- 초기 배치: 폴더별 클러스터 원형 배치 ----------
  const W = () => wrap.clientWidth, H = () => wrap.clientHeight;
  const cx = W() / 2, cy = H() / 2;
  const folders = [...new Set(nodes.map((n) => n.folder))];
  folders.forEach((f, fi) => {
    const angle = (fi / folders.length) * Math.PI * 2;
    const fx = cx + Math.cos(angle) * Math.min(cx, cy) * 0.45;
    const fy = cy + Math.sin(angle) * Math.min(cx, cy) * 0.45;
    nodes.filter((n) => n.folder === f).forEach((n) => {
      n.x = fx + (Math.random() - 0.5) * 120;
      n.y = fy + (Math.random() - 0.5) * 120;
    });
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
    draw();
  }

  // ---------- force 시뮬레이션 (O(n²) — 수백 노드까지 충분) ----------
  // 초기 배치의 거친 움직임은 화면에 보여주지 않는다: 먼저 warm-up 을
  // 그리지 않고 돌려 레이아웃을 잡은 뒤, 낮은 온도 + 속도 상한 상태로
  // 천천히 정착하는 모습만 보여준다 (Obsidian 그래프 뷰와 같은 느낌).
  const LIVE_ALPHA = 0.18;  // 화면에 보이는 단계의 시작 온도
  const MAX_SPEED  = 2.2;   // px/frame — 노드가 화면에서 튀지 않는 상한

  function tick(live) {
    const K = 46;                    // 반발 상수
    const REST = 76, SPRING = 0.025; // 스프링 길이/강도 — 노드 간격을 넓혀 제목이 겹치지 않게
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 90000) continue;    // 300px 밖 반발 무시 (성능)
        const d = Math.sqrt(d2);
        const f = (K * K) / d2 * alpha;
        const fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    edges.forEach(([i, j]) => {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - REST) * SPRING * alpha;
      const fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    nodes.forEach((n) => {
      // 중심으로 약한 중력 — 그래프가 흩어지지 않게
      n.vx += (cx - n.x) * 0.004 * alpha;
      n.vy += (cy - n.y) * 0.004 * alpha;
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

  // 화면에 그리기 전 레이아웃을 미리 잡는다 (거친 초기 움직임 숨김)
  function warmup() {
    alpha = 1;
    for (let i = 0; i < 220 && alpha > 0.05; i++) tick(false);
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
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });
    const pad = 50;
    const gw = Math.max(maxX - minX, 1), gh = Math.max(maxY - minY, 1);
    view.scale = Math.min((W() - pad * 2) / gw, (H() - pad * 2) / gh, 1.6);
    view.ox = (W() - gw * view.scale) / 2 - minX * view.scale;
    view.oy = (H() - gh * view.scale) / 2 - minY * view.scale;
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

    // 노드
    nodes.forEach((n, i) => {
      let dim = false;
      if (query) dim = !matchesQuery(n);
      else if (focus >= 0) dim = i !== focus && !focusSet.has(i);
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
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
        (!query && focus < 0 && n.deg >= 5 && view.scale > 0.42);
      if (!show) return;
      const y = n.y - n.r - 5 / view.scale;
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
      const hit = n.r + 4 / view.scale;
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
  });
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
  });
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
  });
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
  }, { passive: false });
  canvas.addEventListener("dblclick", () => { userAdjusted = false; fitView(); });

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
  }, { passive: true });
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
  }, { passive: false });
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
  }, { passive: true });

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  });

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
  new ResizeObserver(resize).observe(wrap);
  resize();
  warmup();          // 레이아웃을 먼저 잡고
  fitView();         // 전체가 보이게 맞춘 뒤
  wake(LIVE_ALPHA);  // 낮은 온도로 천천히 정착하는 모습만 보여준다
}
