// Display metadata and chart choices. Watchlist-generated declarations live in watchlist.js.
// Classic browser script: index.html defines dependency order; functions stay global for inline handlers.

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
    sector: "labor",
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
    sector: "consumer",
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
    description: "미국 연방 정부 빚의 GDP 대비 비율. 재정 건전성을 장기적으로 보여주는 지표로 분기 단위로 발표된다. 단 이 '총부채'에는 사회보장 신탁기금 같은 정부 내부 계정이 들고 있는 국채(정부간 부채)가 포함돼 있어, 시장이 실제로 소화해야 하는 물량보다 크게 나온다.",
    unit: "% GDP",
    decimals: 1,
  },

  // ── 미국 부채 수준 (stock) ────────────────────────────────────────────
  GFDEBTN: {
    displayName: "미국 연방 부채 총액",
    description: "미국 연방 정부가 지고 있는 빚의 절대 규모(조 달러). 정부간 부채까지 포함한 전체 숫자로, 뉴스에서 '미국 국가부채 OO조 달러'라고 할 때 쓰는 값이 이것이다.",
    unit: "조$",
    decimals: 2,
  },
  FYGFDPUN: {
    displayName: "미국 연방 부채 (공공 보유)",
    description: "전체 부채 중 정부 바깥, 즉 시장이 실제로 들고 있는 부분(조 달러). 총액에서 이 값을 빼면 정부가 자기 왼쪽 주머니에서 오른쪽 주머니로 빌린 정부간 부채가 나온다. 시장 관점에서는 이쪽이 진짜 부채다.",
    unit: "조$",
    decimals: 2,
  },
  FYGFGDQ188S: {
    displayName: "미국 연방 부채 공공보유 (% of GDP)",
    description: "공공 보유 부채를 GDP로 나눈 비율. 위의 총부채 %GDP와 나란히 보면 두 숫자의 간격이 곧 정부간 부채의 크기다. 국제 비교나 시장 부담을 볼 때는 이 쪽을 쓴다.",
    unit: "% GDP",
    decimals: 1,
  },
  GDP: {
    displayName: "미국 명목 GDP",
    description: "물가를 조정하지 않은 미국 경제의 크기(조 달러). 부채 비율의 분모이며, 부채가 경제 성장보다 빠르게 늘고 있는지 확인하는 기준선이 된다.",
    unit: "조$",
    decimals: 2,
  },

  // ── 미국 국채 수요 (demand) ───────────────────────────────────────────
  TREAST: {
    displayName: "Fed 보유 국채",
    description: "연준이 들고 있는 미국 국채 규모(조 달러, 주간). 늘고 있으면 연준이 사는 중(QE), 줄고 있으면 파는 중(QT)이다. 연준은 입찰에서 직접 살 수 없고 유통시장에서만 매입하며, 재정 지원이 아니라 통화정책 목적으로 움직인다. 연준이 흡수해 주는 만큼 민간이 소화할 물량은 줄어들기 때문에, 시장 수요를 볼 때는 이 몫을 빼고 봐야 한다.",
    unit: "조$",
    decimals: 3,
  },
  THREEFYTP10: {
    displayName: "10Y 텀 프리미엄",
    description: "투자자가 10년짜리 국채를 들어주는 대가로 요구하는 추가 수익. 금리 상승분 중 '불안해서 요구하는 몫'만 떼어낸 값이다. 금리가 올랐을 때 경기가 좋아져서인지 정부를 못 믿어서인지가 여기서 갈린다. 수요가 넘치면 마이너스까지 내려가고, 수요가 마르면 올라간다.",
    unit: "%",
    decimals: 2,
    zeroline: true,
  },
  // ── 국채 입찰 결과 (TreasuryDirect) ───────────────────────────────────
  // 미 국채 입찰은 딜러 응찰 의무 때문에 사실상 유찰되지 않는다. 그래서 수요 약화는
  // "안 팔림"이 아니라 "더 높은 금리를 줘야 팔림"으로 나타난다 — 겉보기엔 늘 성공한
  // 입찰이라, 응찰률과 낙찰 배분을 봐야 그 안이 보인다.
  AUCT_BTC_2Y: {
    displayName: "입찰 응찰률 (2년)",
    description: "2년물 입찰에서 파는 물량 대비 들어온 주문 총액의 배수. 2년물은 재정 우려보다 기준금리 기대에 좌우되므로, 10년·30년물과 비교하는 대조군으로 쓴다.",
    unit: "배",
    decimals: 2,
  },
  AUCT_BTC_10Y: {
    displayName: "입찰 응찰률 (10년)",
    description: "10년물 입찰의 응찰률. 낮아질수록 같은 물량을 소화시키기 위해 금리를 더 얹어줘야 한다는 뜻이다. 발행량과 함께 봐야 한다 — 300억 달러를 팔 때의 2.4와 600억 달러를 팔 때의 2.4는 다른 얘기다.",
    unit: "배",
    decimals: 2,
  },
  AUCT_BTC_30Y: {
    displayName: "입찰 응찰률 (30년)",
    description: "30년물 입찰의 응찰률. 재정에 대한 불안은 만기가 긴 쪽에서 먼저 드러나기 때문에, 수요 이탈의 조기 신호로는 이 계열이 가장 예민하다.",
    unit: "배",
    decimals: 2,
  },
  AUCT_IND_2Y: {
    displayName: "indirect 낙찰 비중 (2년)",
    description: "2년물 경쟁입찰 낙찰액 중 indirect(딜러를 통해 들어온 고객 주문) 몫. 주로 외국 중앙은행·국부펀드다.",
    unit: "%",
    decimals: 1,
  },
  AUCT_IND_10Y: {
    displayName: "indirect 낙찰 비중 (10년)",
    description: "10년물 낙찰액 중 외국 중앙은행·국부펀드 등이 가져간 비중. 외국 수요를 실시간에 가깝게 볼 수 있는 유일한 창구로, 분기 발표인 외국인 보유 잔액(FDHBFIN)보다 훨씬 빠르다. 이 비중이 빠지면 그만큼을 국내 투자자나 딜러가 떠안아야 한다.",
    unit: "%",
    decimals: 1,
  },
  AUCT_IND_30Y: {
    displayName: "indirect 낙찰 비중 (30년)",
    description: "30년물 낙찰액 중 indirect 몫. 이 비중이 떨어지면서 응찰률도 같이 낮아지면, 장기 국채를 들어줄 주체가 줄고 있다는 신호다.",
    unit: "%",
    decimals: 1,
  },

  FDHBFIN: {
    displayName: "외국인 보유 미국 국채",
    description: "외국 정부·중앙은행·국제기구가 보유한 미국 연방 부채(조 달러, 분기). 외국 수요가 쌓인 결과를 보여준다. 분기 발표라 반응이 느리므로, 실시간 외국 수요는 입찰의 indirect 낙찰 비중으로 봐야 한다.",
    unit: "조$",
    decimals: 3,
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
  GGGDTAKRA188N: {
    displayName: "🇰🇷 한국 일반정부 부채 (% of GDP)",
    description: "한국 일반정부(중앙+지방) 총부채의 GDP 대비 비율 (IMF WEO). 미국과 함께 보면 두 나라의 재정 여력을 비교할 수 있다. 연간 발표라 1~2년 늦게 반영된다.",
    unit: "% GDP",
    decimals: 1,
    region: "KR",
  },

  // ── 한국 지표 ─────────────────────────────────────────────────────────
  KORCPIALLMINMEI: {
    displayName: "🇰🇷 한국 CPI YoY",
    description: "한국 소비자물가의 전년 대비 상승률. 국내 물가의 변화를 보여준다.",
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
  // ── 생활·실물 관점 (미국) ─────────────────────────────────────────────
  // sector 를 따로 적지 않으면 수집 payload 의 category 가 곧 섹터다.
  GASREGW: {
    displayName: "미국 휘발유 소매가격",
    description: "미국 일반 휘발유의 주간 전국 평균 소매가격(갤런당 달러, EIA). 가계가 주유소에서 체감하는 물가 그 자체로, 원유가격이 몇 주 시차로 전가된다.",
    unit: "$", decimals: 3, valueLabel: "갤런당",
  },
  GASDESW: {
    displayName: "미국 경유 소매가격",
    description: "미국 경유(디젤)의 주간 전국 평균 소매가격(갤런당 달러, EIA). 트럭·농기계·물류 원가에 직결돼 휘발유보다 기업 비용과 운송 물가를 더 잘 보여준다.",
    unit: "$", decimals: 3, valueLabel: "갤런당",
  },
  DHHNGSP: {
    displayName: "천연가스 (헨리허브)",
    description: "미국 천연가스 현물 가격(MMBtu당 달러). 난방비·발전 단가와 비료·화학 원가에 영향을 준다. 날씨에 따라 크게 출렁인다.",
    unit: "$", decimals: 2, valueLabel: "MMBtu당",
  },
  APU000072610: {
    displayName: "미국 가정용 전기요금",
    description: "도시 가구가 실제 내는 전기 1kWh당 평균 가격(BLS). 데이터센터 수요·발전 연료비가 가계 전기료로 어떻게 넘어오는지 볼 수 있다.",
    unit: "$", decimals: 3, valueLabel: "kWh당",
  },
  UNRATE: {
    displayName: "미국 실업률",
    description: "경제활동인구 중 일자리를 찾고 있지만 구하지 못한 사람의 비율. 저점에서 0.5%p 이상 오르기 시작하면 침체 경고로 읽힌다(삼 룰).",
    unit: "%", decimals: 1,
  },
  LNS12300060: {
    displayName: "핵심연령(25~54세) 고용률",
    description: "25~54세 인구 중 실제로 일하는 사람의 비율. 은퇴·학업 같은 인구구조 효과를 걸러내 실업률보다 노동시장의 실제 체력을 객관적으로 보여준다.",
    unit: "%", decimals: 1,
  },
  JTSJOL: {
    displayName: "미국 구인 건수 (JOLTS)",
    description: "기업이 채우려고 내놓은 빈 일자리 수(백만 건). 실업자 수보다 많으면 노동자 우위 시장이며, 빠르게 줄면 고용 둔화가 뒤따른다.",
    unit: "백만", decimals: 2, valueLabel: "백만 건",
  },
  CES0500000003: {
    displayName: "미국 시간당 임금 YoY",
    description: "민간 근로자 평균 시간당 임금의 전년 대비 상승률. CPI보다 높으면 실질임금이 오르는 중이다.",
    unit: "%", decimals: 2, zeroline: true,
  },
  RSAFS: {
    displayName: "미국 소매판매 YoY",
    description: "소매·외식 판매액의 전년 대비 증가율(명목). 물가 상승률을 빼고 봐야 실제 소비량의 변화가 보인다.",
    unit: "%", decimals: 2, zeroline: true,
  },
  DSPIC96: {
    displayName: "미국 실질 가처분소득 YoY",
    description: "세금을 내고 물가를 감안한 뒤 가계가 실제로 쓸 수 있는 소득의 전년 대비 변화. 소비 여력의 근본 체력.",
    unit: "%", decimals: 2, zeroline: true,
  },
  PSAVERT: {
    displayName: "미국 개인 저축률",
    description: "가처분소득 중 저축으로 남기는 비율. 낮으면 소비가 저축을 깎아 유지되고 있다는 뜻으로, 충격에 대한 완충력이 약하다.",
    unit: "%", decimals: 1,
  },
  CSUSHPINSA: {
    displayName: "미국 집값 YoY (케이스-실러)",
    description: "케이스-실러 전국 주택가격지수의 전년 대비 상승률. 같은 집의 반복 거래로 측정해 거래 구성 변화에 덜 흔들린다. 약 2개월 늦게 발표된다.",
    unit: "%", decimals: 2, zeroline: true,
  },
  MORTGAGE30US: {
    displayName: "미국 30년 고정 모기지 금리",
    description: "주택 구입자가 받는 30년 고정금리 평균(프레디맥, 주간). 10년 국채금리에 가산금리를 얹은 값이라 주거비 부담과 주택 거래량을 좌우한다.",
    unit: "%", decimals: 2,
  },
  HOUST: {
    displayName: "미국 주택 착공",
    description: "새로 공사를 시작한 주택 수(연율, 천 호). 금리에 가장 민감한 실물 활동으로, 미래 주택 공급과 건설 고용의 선행 신호.",
    unit: "천호", decimals: 0, valueLabel: "천 호(연율)",
  },
  CUSR0000SAH1: {
    displayName: "미국 주거비 CPI YoY",
    description: "CPI에서 임대료·자가주거비 등 주거 항목의 전년 대비 상승률. CPI 비중이 약 1/3로 가장 크고, 시장 임대료를 1년가량 늦게 따라간다.",
    unit: "%", decimals: 2, zeroline: true,
  },
  DRCCLACBS: {
    displayName: "미국 신용카드 연체율",
    description: "상업은행 신용카드 대출 중 30일 이상 연체된 비율(분기). 가계의 상환 여력이 한계에 다가가는지를 보여준다.",
    unit: "%", decimals: 2,
  },
  DRTSCILM: {
    displayName: "은행 기업대출 기준 강화 비율",
    description: "연준 대출 담당자 설문(SLOOS)에서 대·중견기업 대출 기준을 '강화했다'에서 '완화했다'를 뺀 순비율(분기). 플러스로 크게 오르면 신용 경색이 시작된다는 신호.",
    unit: "%", decimals: 1, zeroline: true,
  },
  NFCI: {
    displayName: "시카고 연은 금융여건지수",
    description: "금리·신용·주식·레버리지 등 105개 지표로 만든 금융여건지수(주간). 0보다 크면 평균보다 빡빡, 작으면 느슨한 상태.",
    unit: "", decimals: 2, zeroline: true, valueLabel: "지수",
  },
  BOPGSTB: {
    displayName: "미국 무역수지",
    description: "상품·서비스 수출에서 수입을 뺀 값(월, 십억 달러). 마이너스가 클수록 해외에서 사오는 것이 더 많다는 뜻이며, 관세 정책 효과를 직접 확인할 수 있다.",
    unit: "십억$", decimals: 1, zeroline: true, valueLabel: "십억 달러",
  },
  IR: {
    displayName: "미국 수입물가 YoY",
    description: "미국이 수입하는 상품 가격의 전년 대비 변화. 달러 가치·관세·해외 물가가 미국 소비자물가로 들어오는 입구다.",
    unit: "%", decimals: 2, zeroline: true,
  },

  // ── 생활·실물 관점 (한국, FRED 경유) ──────────────────────────────────
  LRHUTTTTKRM156S: {
    displayName: "🇰🇷 한국 실업률",
    description: "OECD 기준으로 맞춘 한국 실업률(계절조정). 국제 비교가 가능하도록 정의를 통일한 값이다. 한국은 구직단념자가 실업자에서 빠져 수치가 낮게 나오므로 고용률과 함께 봐야 한다.",
    unit: "%", decimals: 1, region: "KR",
  },
  QKRR628BIS: {
    displayName: "🇰🇷 한국 실질 주택가격 (BIS)",
    description: "물가 상승분을 뺀 한국 주택가격 지수(2010=100, 분기, BIS). 명목 집값이 올라도 이 값이 제자리면 물가만큼만 오른 것이다.",
    unit: "", decimals: 1, region: "KR", valueLabel: "지수(2010=100)",
  },
  QKRHAM770A: {
    displayName: "🇰🇷 가계부채 (% of GDP, BIS)",
    description: "한국 가계부채의 GDP 대비 비율(분기, BIS). 주요국 중 최상위권으로, 금리 인상기에 소비를 짓누르는 구조적 부담이다.",
    unit: "% GDP", decimals: 1, region: "KR",
  },
  XTEXVA01KRM667S: {
    displayName: "🇰🇷 한국 수출 YoY",
    description: "달러 기준 한국 수출액(계절조정)의 전년 대비 증가율(OECD). 반도체 업황과 글로벌 수요를 가장 빨리 반영하는 한국 경기의 핵심 지표.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  XTIMVA01KRM667S: {
    displayName: "🇰🇷 한국 수입 YoY",
    description: "달러 기준 한국 수입액(계절조정)의 전년 대비 증가율(OECD). 에너지 수입 비중이 커서 유가와 내수 경기가 함께 반영된다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  RBKRBIS: {
    displayName: "🇰🇷 원화 실질실효환율 (BIS)",
    description: "교역 상대국 통화 바스켓 대비 원화 가치를 물가 차이까지 감안해 지수화한 값(2020=100, BIS). 원/달러 하나만 볼 때보다 원화의 실제 대외 구매력을 객관적으로 보여준다. 높을수록 원화 강세.",
    unit: "", decimals: 1, region: "KR", valueLabel: "지수(2020=100)",
  },
  // ── 한국은행 ECOS (scripts/fetch_ecos.py) ────────────────────────────
  KR_CPI: {
    displayName: "🇰🇷 소비자물가 YoY",
    description: "통계청 소비자물가지수의 전년 동월 대비 상승률(ECOS). 한국은행 물가안정목표는 2%다. 갱신이 멈춘 OECD 계열(KORCPIALLMINMEI)을 대체한다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_CORE_CPI: {
    displayName: "🇰🇷 근원물가 YoY (농산물·석유류 제외)",
    description: "날씨와 국제유가에 크게 흔들리는 농산물·석유류를 뺀 소비자물가 상승률. 물가가 기조적으로 얼마나 끈적한지 보여준다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_PPI: {
    displayName: "🇰🇷 생산자물가 YoY",
    description: "국내 생산자가 출하하는 상품·서비스 가격의 전년 대비 변화. 원가 부담이 소비자물가로 넘어오기 전에 먼저 움직인다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_PETROLEUM_CPI: {
    displayName: "🇰🇷 석유류 소비자물가 YoY",
    description: "휘발유·경유·등유·LPG 등 석유류 소비자물가의 전년 대비 상승률. 국제유가와 원/달러 환율, 유류세 조정이 함께 반영된 가계의 연료비 체감치다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_BASE_RATE: {
    displayName: "🇰🇷 한국은행 기준금리",
    description: "한국은행 금융통화위원회가 정하는 정책금리(월말 기준). 미국 기준금리와의 차이가 원/달러 환율과 자본 유출입에 영향을 준다.",
    unit: "%", decimals: 2, region: "KR",
  },
  KR_M2: {
    displayName: "🇰🇷 M2 통화량 YoY",
    description: "광의통화(M2, 평잔·원계열)의 전년 대비 증가율(ECOS). 미국 M2와 비교해 어느 쪽이 더 빠르게 돈을 풀고 있는지 볼 수 있다. 갱신이 멈춘 OECD 계열을 대체한다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_JPYKRW: {
    displayName: "🇰🇷 원/엔 환율 (100엔)",
    description: "100엔당 원화 금액(월평균 매매기준율). 수출 경쟁국 일본과의 가격 경쟁력을 보여준다. 오르면 원화가 엔화보다 약해진 것이다.",
    unit: "₩", decimals: 2, region: "KR", valueLabel: "원/100엔",
  },
  KR_CNYKRW: {
    displayName: "🇰🇷 원/위안 환율",
    description: "1위안당 원화 금액(월평균 매매기준율). 최대 교역국 중국과의 교역 조건을 보여준다.",
    unit: "₩", decimals: 2, region: "KR", valueLabel: "원/위안",
  },
  KR_EMP_RATE: {
    displayName: "🇰🇷 고용률 (계절조정)",
    description: "15세 이상 인구 중 취업자 비율. 구직을 포기한 사람이 실업자에서 빠지는 문제를 피할 수 있어 한국에서는 실업률보다 고용 상황을 객관적으로 보여준다.",
    unit: "%", decimals: 1, region: "KR",
  },
  KR_EMPLOYED_YOY: {
    displayName: "🇰🇷 취업자 수 전년 대비 증감",
    description: "취업자 수가 1년 전보다 몇 명 늘었는지(천 명). 매달 고용동향 발표에서 가장 먼저 보도되는 숫자다.",
    unit: "천명", decimals: 0, region: "KR", zeroline: true, valueLabel: "천 명",
  },
  KR_CCSI: {
    displayName: "🇰🇷 소비자심리지수 (CCSI)",
    description: "한국은행 소비자동향조사의 종합 심리지수. 100보다 크면 장기 평균보다 낙관적이라는 뜻이다. 갱신이 멈춘 OECD 소비자신뢰 계열 대신 쓴다.",
    unit: "", decimals: 1, region: "KR", valueLabel: "지수",
  },
  KR_KB_APT: {
    displayName: "🇰🇷 아파트 매매가격 YoY (전국, KB)",
    description: "KB국민은행 아파트 매매가격지수의 전년 대비 상승률. BIS 분기 지수보다 빨리, 월 단위로 주택 경기를 보여준다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_KB_APT_SEOUL: {
    displayName: "🇰🇷 아파트 매매가격 YoY (서울, KB)",
    description: "서울 아파트 매매가격지수의 전년 대비 상승률. 전국과의 격차가 커지면 수도권 쏠림이 심해지고 있다는 신호다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_HH_LOANS: {
    displayName: "🇰🇷 가계대출 YoY",
    description: "예금취급기관 가계대출 잔액의 전년 대비 증가율. 소득보다 빨리 늘면 가계부채 부담이 커지고 있다는 뜻이다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
  },
  KR_LOAN_RATE: {
    displayName: "🇰🇷 은행 대출금리 (신규취급)",
    description: "예금은행이 새로 내준 대출의 평균 금리. 기준금리 변화가 실제 가계·기업의 이자 부담으로 얼마나 전달되는지 보여준다.",
    unit: "%", decimals: 2, region: "KR",
  },
  KR_GOODS_BALANCE: {
    displayName: "🇰🇷 상품수지",
    description: "국제수지 기준 상품 수출에서 수입을 뺀 값(월, 십억 달러). 반도체 업황과 에너지 수입 비용이 함께 드러나며, 원화 수급의 기초가 된다.",
    unit: "", decimals: 1, region: "KR", zeroline: true, valueLabel: "십억 달러",
  },
  KR_IMPORT_PRICE: {
    displayName: "🇰🇷 수입물가 YoY (원화 기준)",
    description: "원화로 환산한 수입물가의 전년 대비 변화. 국제 원자재 가격과 환율이 합쳐진 값이라 몇 달 뒤 생산자·소비자물가로 이어진다.",
    unit: "%", decimals: 1, region: "KR", zeroline: true,
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
  DTWEXBGS: {
    displayName: "무역가중 달러 지수 (광의)",
    description: "교역 상대국 통화에 대한 달러의 가치를 무역 비중으로 가중한 광의 지수. 환율 수준을 지수로 나타내며, 전년 대비 상승률(%)이 아니다.",
    unit: "", valueLabel: "지수", decimals: 2, color: "#7dd3fc",
  },
  SP500:            { displayName: "S&P 500",                unit: "",  decimals: 2, color: "#c084fc" },
  DGS10:            { displayName: "10년 국채금리",          unit: "%", decimals: 2, color: "#fb923c" },
  VIXCLS:           { displayName: "VIX (공포지수)",         unit: "",  decimals: 2, color: "#f87171" },
  DEXKOUS: {
    displayName: "원/달러 환율",
    description: "미국 달러 1달러당 원화 금액. 환율이 오르면 달러 대비 원화 가치가 낮아지고, 내리면 높아진다.",
    unit: "₩", valueLabel: "원/달러", decimals: 2, color: "#86efac", region: "KR",
  },
  BAMLH0A0HYM2:     { displayName: "미국 하이일드 스프레드", unit: "%", decimals: 2, color: "#fca5a5" },
  IRLTLT01KRM156N:  { displayName: "한국 국채 10년",         unit: "%", decimals: 2, color: "#4c9ef7" },
  KOSPI:            { displayName: "코스피 (원시)",          unit: "",  decimals: 0, color: "#a78bfa" },
};

// 지표별 비교 대상. primary 는 "주요 비교", secondary 는 "관련" 그룹에 표시.
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
  GFDEBTN: {
    primary:   ["DGS10", "GOLD", "DTWEXBGS"],
    secondary: ["SP500", "BAMLH0A0HYM2"],
    note: "부채 절대 규모의 증가 속도를 장기금리·금과 비교. 규모 자체보다 기울기가 급해지는 구간이 중요.",
  },
  FYGFDPUN: {
    primary:   ["DGS10", "DTWEXBGS", "GOLD"],
    secondary: ["BAMLH0A0HYM2", "SP500"],
    note: "시장이 실제로 흡수해야 하는 물량. 이 계열이 총액보다 빠르게 늘면 장기금리 상방 압력이 커진다.",
  },
  FYGFGDQ188S: {
    primary:   ["DGS10", "BAMLH0A0HYM2", "DEXKOUS"],
    secondary: ["GOLD", "DTWEXBGS"],
    note: "총부채 %GDP(GFDEGDQ188S)와 겹쳐 보면 두 선의 간격이 정부간 부채. 국제 비교는 이 쪽 기준.",
  },
  GDP: {
    primary:   ["SP500", "DGS10", "DTWEXBGS"],
    secondary: ["GOLD", "VIXCLS"],
    note: "부채 계열과 겹쳐 보는 용도. 부채가 GDP보다 가파르면 비율이 올라간다는 뜻.",
  },
  TREAST: {
    primary:   ["DGS10", "SP500", "GOLD"],
    secondary: ["DTWEXBGS", "BAMLH0A0HYM2"],
    note: "연준 보유가 늘던 구간(QE)과 줄던 구간(QT)에서 장기금리·위험자산이 어떻게 갈렸는지 확인.",
  },
  THREEFYTP10: {
    primary:   ["DGS10", "GOLD", "DTWEXBGS"],
    secondary: ["BAMLH0A0HYM2", "SP500"],
    note: "10Y 금리와 겹쳐 보면 금리 상승분 중 리스크 프리미엄 몫이 보인다. 금리는 올랐는데 텀프리미엄이 그대로면 성장·정책 기대, 텀프리미엄이 같이 오르면 재정 우려 쪽.",
  },
  FDHBFIN: {
    primary:   ["DGS10", "DTWEXBGS", "DEXKOUS"],
    secondary: ["GOLD", "SP500"],
    note: "외국인 보유가 정체·감소하는 구간에서 장기금리와 달러가 어떻게 반응했는지 확인.",
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
  GGGDTAKRA188N: {
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
  LRHUTTTTKRM156S: {
    primary:   ["KOSPI", "DEXKOUS"],
    secondary: ["VIXCLS", "SP500"],
    note: "실업률 상승은 내수 위축 신호. 코스피 하락과 동행하는지 확인.",
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
  energy:    "#fb923c",
  labor:     "#60a5fa",
  consumer:  "#a78bfa",
  housing:   "#34d399",
  credit:    "#f472b6",
  trade:     "#2dd4bf",
};

// 국가 탭(KR·US, 이후 CN·JP …) 안의 섹터 서브탭. 이 순서대로 표시한다.
// dollar/inflation 은 index.html 에 정적으로 있고(환율 카드가 항상 먼저 보여야 함),
// 나머지는 해당 국가에 데이터가 있을 때만 dashboard.js 가 버튼과 패널을 만든다.
// 새 국가 탭은 panel-<CODE> 와 .sector-nav 만 있으면 같은 섹터 구성을 그대로 쓴다.
const SECTOR_META = {
  dollar:    { label: "통화 가치·환율" },
  inflation: { label: "물가·인플레이션" },
  energy:    { label: "에너지·연료",   desc: "휘발유·경유·가스·전기 — 가계와 기업이 실제로 내는 에너지 가격" },
  labor:     { label: "고용·임금",     desc: "실업률·고용률·구인·임금 — 일자리의 양과 질" },
  consumer:  { label: "소비·소득",     desc: "소매판매·실질소득·저축률·소비심리 — 가계의 지출 여력" },
  housing:   { label: "주거·부동산",   desc: "집값·주택담보대출 금리·착공·주거비 — 주거 부담과 부동산 경기" },
  credit:    { label: "신용·금융여건", desc: "연체율·대출 기준·가계부채·금융여건 — 빚과 돈줄의 상태" },
  trade:     { label: "무역·대외",     desc: "수출입·무역수지·수입물가 — 바깥 세계와의 거래" },
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
