"""Generate 2026-06-14 news JSON files for Sunday sectors: 소비재, 산업재/방산, 통신/미디어"""
import json, os

DATE = "2026-06-14"
AS_OF = "2026-06-14T21:00:00Z"
WIKI_BASE = "https://github.com/lukeeee73/luke_wiki/blob/claude/create-knowledge-repo-2LeNp/wiki/news/tickers"

def w(score): return round(score, 2)

def ns(e, c, r, m):
    return round(e*0.40 + c*0.25 + r*0.20 + m*0.15, 2)

def write(ticker, company, news, competitors, e, c, r, m, summary_kr, key_events, risks):
    score = ns(e, c, r, m)
    slug = f"{ticker} - {company}"
    url = f"{WIKI_BASE}/{slug.replace(' ', '%20').replace('&', '%26').replace(',', '%2C')}.md"
    data = {
        "ticker": ticker,
        "date": DATE,
        "as_of_utc": AS_OF,
        "news": news,
        "competitor_context": competitors,
        "scores": {
            "earnings_outlook": w(e),
            "competitive_position": w(c),
            "regulatory_risk": w(r),
            "macro_sensitivity": w(m)
        },
        "narrative_score": score,
        "summary_kr": summary_kr,
        "key_events": key_events,
        "risks": risks,
        "wiki_url": url
    }
    path = f"data/news/{ticker}/{DATE}.json"
    os.makedirs(f"data/news/{ticker}", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  wrote {path}  narrative_score={score}")

# ── 소비재 ───────────────────────────────────────────────────────────────────

write("WMT", "Walmart Inc.",
  news=[
    {"title": "Walmart expands drone delivery to 7 new markets via Wing partnership",
     "source": "Walmart Newsroom", "url": "https://corporate.walmart.com/news/2026/06/12/walmart-drone-delivery-wing-expansion",
     "published": f"{DATE}T10:00:00Z", "summary": "Wing 협력 통해 7개 추가 지역 드론배달 개시 — 미국 내 총 22개 시장으로 확대",
     "impact": "+", "category": "product"},
    {"title": "Walmart nears $1 trillion market cap milestone as stock hits record",
     "source": "Reuters", "url": "https://www.reuters.com/business/retail-consumer/walmart-nears-1-trillion-market-cap-2026-06-13/",
     "published": f"{DATE}T09:00:00Z", "summary": "WMT 주가 사상 최고치 갱신, 시총 $1조 임박 — YTD +37%",
     "impact": "+", "category": "other"},
    {"title": "Walton family sells $200M in Walmart shares amid record high",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/walton-family-walmart-share-sale",
     "published": f"{DATE}T08:30:00Z", "summary": "월튼 가문 최고가에 $2억 매도 — 내부자 매도로 단기 차익실현 신호",
     "impact": "neutral", "category": "other"}
  ],
  competitors=[
    {"ticker": "COST", "headline": "Costco May net sales +14.5% YoY, exceeding estimates",
     "implication_for_target": "COST 동반 강세 — 대형 유통 섹터 전반 소비 수요 견조 확인"},
    {"ticker": "AMZN", "headline": "Amazon Fresh expanding to 15 new cities with 2-hour delivery guarantee",
     "implication_for_target": "아마존 식료품 배달 확장이 WMT 이커머스 식료품 부문과 직접 경쟁 심화"}
  ],
  e=0.8, c=0.6, r=0.3, m=0.5,
  summary_kr="드론배달 7개 시장 추가 확장, 시총 $1조 임박으로 WMT 구조적 성장 모멘텀 지속. 월튼 가문 대규모 매도는 단기 오버행 리스크.",
  key_events=["드론배달 7개 시장 신규 확장", "시총 $1조 돌파 임박 (YTD +37%)", "월튼 가문 $2억 내부자 매도"],
  risks=["월튼 가문 대규모 매도 오버행", "아마존 식료품 경쟁 심화", "소비자 경기 둔화 시 방어주 쏠림 한계"]
)

write("COST", "Costco Wholesale",
  news=[
    {"title": "Costco May net sales rise 14.5% YoY, topping estimates",
     "source": "Costco IR", "url": "https://investor.costco.com/news-releases/news-release-details/costco-wholesale-corporation-reports-may-2026-sales-results",
     "published": f"{DATE}T09:30:00Z", "summary": "5월 순매출 +14.5% — 회원제 갱신률 92.9% 역대 최고, 트래픽 +9%",
     "impact": "+", "category": "earnings"},
    {"title": "Costco Q3 FY26 EPS $4.02 beats; Oppenheimer reaffirms Outperform",
     "source": "Oppenheimer", "url": "https://www.barrons.com/articles/costco-stock-outperform-oppenheimer-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "3분기 EPS $4.02로 컨센서스 상회, Outperform 재확인 — 목표가 $975",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "WMT", "headline": "Walmart approaches $1T market cap with 37% YTD gain",
     "implication_for_target": "WMT 동반 강세 — 대형 유통 소비 수요 견조 확인, COST 프리미엄 정당화"}
  ],
  e=0.65, c=0.60, r=0.40, m=0.40,
  summary_kr="5월 매출 +14.5% 서프라이즈와 Q3 어닝 비트로 COST 성장 모멘텀 확인. 회원 갱신률 역대 최고로 해자 강화.",
  key_events=["5월 순매출 +14.5% YoY", "회원 갱신률 92.9% 역대 최고", "Oppenheimer Outperform 재확인 목표가 $975"],
  risks=["밸류에이션 프리미엄 (P/E 55x)", "소비 경기 둔화 시 트래픽 감소 가능성", "WMT 드론배달 확장으로 경쟁 심화"]
)

write("KO", "The Coca-Cola Company",
  news=[
    {"title": "Coca-Cola named official beverage partner for 2026 FIFA World Cup",
     "source": "FIFA / Coca-Cola IR", "url": "https://www.coca-colacompany.com/media-center/press-releases/2026-fifa-world-cup-partnership",
     "published": f"{DATE}T10:00:00Z", "summary": "2026 FIFA 월드컵 공식 음료 파트너 — 미국·캐나다·멕시코 공동 개최로 글로벌 노출 최대",
     "impact": "+", "category": "product"},
    {"title": "Coca-Cola India to pursue IPO for local bottling unit in 2027",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/coca-cola-india-ipo-2027",
     "published": f"{DATE}T07:00:00Z", "summary": "인도 보틀링 법인 2027년 IPO 추진 — 신흥시장 성장 자본화 전략",
     "impact": "+", "category": "other"},
    {"title": "Morgan Stanley raises KO target to $89, cites World Cup marketing leverage",
     "source": "Morgan Stanley", "url": "https://www.barrons.com/articles/coca-cola-price-target-morgan-stanley-2026",
     "published": f"{DATE}T06:30:00Z", "summary": "MS 목표가 $89로 상향 — 월드컵 마케팅 레버리지와 신흥시장 성장 근거",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "PEP", "headline": "PepsiCo North America beverages down 2.5% YoY in Q1, snack price cuts begin",
     "implication_for_target": "PEP 북미 음료 부진이 KO에 상대적 경쟁 우위 제공 — KO 점유율 확대 기회"}
  ],
  e=0.55, c=0.55, r=0.50, m=0.40,
  summary_kr="FIFA 월드컵 공식 파트너십과 인도 IPO 추진으로 글로벌 성장 모멘텀 강화. PEP 북미 음료 부진 대비 상대적 강세.",
  key_events=["2026 FIFA 월드컵 공식 음료 파트너 확정", "인도 보틀링 법인 2027 IPO 추진", "Morgan Stanley 목표가 $89 상향"],
  risks=["달러 강세로 신흥시장 매출 환산 손실", "설탕세 강화 규제 글로벌 확산", "소비자 건강 트렌드 — 무설탕 경쟁 심화"]
)

write("PEP", "PepsiCo, Inc.",
  news=[
    {"title": "PepsiCo North America beverages volume falls 2.5% YoY in Q1",
     "source": "PepsiCo IR", "url": "https://www.pepsico.com/investors/financial-information/press-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "북미 음료 판매량 -2.5% — 소비자 가격 저항과 건강 트렌드로 전통 탄산 수요 둔화",
     "impact": "-", "category": "earnings"},
    {"title": "PepsiCo cuts snack prices up to 15% to revive volume growth",
     "source": "WSJ", "url": "https://www.wsj.com/articles/pepsico-snack-price-cuts-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "스낵 부문 가격 최대 15% 인하 — 판매량 회복 시도, 단기 마진 압박 불가피",
     "impact": "-", "category": "product"},
    {"title": "PepsiCo Q2 2026 earnings call scheduled for July 9",
     "source": "PepsiCo IR", "url": "https://www.pepsico.com/investors/financial-information/press-releases",
     "published": f"{DATE}T06:00:00Z", "summary": "Q2 실적 발표 7월 9일 예정 — 가격 인하 전략 효과 첫 확인 계기",
     "impact": "neutral", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "KO", "headline": "Coca-Cola named 2026 FIFA World Cup official beverage partner",
     "implication_for_target": "KO의 FIFA 독점 파트너십으로 PEP 북미·글로벌 음료 브랜드 노출 열위"}
  ],
  e=0.20, c=0.20, r=0.30, m=0.30,
  summary_kr="북미 음료 판매량 감소와 스낵 가격 인하로 PEP 단기 마진 압박. 7월 Q2 실적 전까지 방어적 포지션 유지 예상.",
  key_events=["북미 음료 판매량 -2.5% YoY", "스낵 가격 최대 15% 인하 결정", "Q2 실적 발표 7월 9일 예정"],
  risks=["가격 인하로 마진율 추가 압박", "건강 트렌드 가속화로 전통 음료·스낵 장기 수요 감소", "KO FIFA 파트너십 대비 브랜드 노출 열위"]
)

write("PG", "Procter & Gamble Co.",
  news=[
    {"title": "UBS raises Procter & Gamble price target to $172, cites pricing power recovery",
     "source": "UBS", "url": "https://www.barrons.com/articles/pg-procter-gamble-price-target-ubs-2026",
     "published": f"{DATE}T08:00:00Z", "summary": "UBS 목표가 $172로 상향 — 가격 전가력 회복과 신흥시장 볼륨 반등 근거",
     "impact": "+", "category": "other"},
    {"title": "P&G launches Native Surf Club personal care line targeting Gen Z",
     "source": "P&G Newsroom", "url": "https://news.pg.com/press-releases/2026/native-surf-club-launch",
     "published": f"{DATE}T09:00:00Z", "summary": "네이티브 서프 클럽 브랜드 론칭 — Gen Z 자연주의 퍼스널케어 시장 공략",
     "impact": "+", "category": "product"},
    {"title": "P&G stock gains 5.4% this week on strong consumer staples rotation",
     "source": "MarketWatch", "url": "https://www.marketwatch.com/story/pg-week-gain-consumer-staples",
     "published": f"{DATE}T07:30:00Z", "summary": "주간 +5.4% 상승 — 경기 방어주 로테이션 수혜, 소비재 섹터 아웃퍼폼",
     "impact": "+", "category": "macro"}
  ],
  competitors=[],
  e=0.50, c=0.40, r=0.35, m=0.30,
  summary_kr="UBS 목표가 상향과 Gen Z 신제품 론칭으로 PG 성장 모멘텀 재확인. 방어주 로테이션으로 주간 +5.4% 강세.",
  key_events=["UBS 목표가 $172 상향", "Native Surf Club Gen Z 브랜드 론칭", "주간 +5.4% 소비재 로테이션 수혜"],
  risks=["신흥시장 환율 역풍 (달러 강세)", "원자재 비용 재상승 시 마진 압박", "Gen Z 신제품 시장 침투율 불확실"]
)

write("MO", "Altria Group, Inc.",
  news=[
    {"title": "Altria launches on! PLUS nicotine pouch with new flavors nationwide",
     "source": "Altria IR", "url": "https://investor.altria.com/press-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "on! PLUS 니코틴 파우치 신규 향 추가 전국 출시 — 연기 없는 제품 포트폴리오 확대",
     "impact": "+", "category": "product"},
    {"title": "Altria ex-dividend date June 15 — $1.06 quarterly dividend",
     "source": "Altria IR", "url": "https://investor.altria.com/dividends",
     "published": f"{DATE}T08:00:00Z", "summary": "배당락일 6월 15일 — 분기 배당 $1.06, 연간 배당수익률 ~8.3%",
     "impact": "+", "category": "other"},
    {"title": "FDA NJOY menthol ban enforcement continues — Altria impact limited",
     "source": "Reuters", "url": "https://www.reuters.com/business/healthcare-pharmaceuticals/fda-njoy-menthol-2026-06",
     "published": f"{DATE}T07:00:00Z", "summary": "FDA NJOY 멘톨 금지 지속 — MO 직접 영향 제한적이나 규제 불확실성 상존",
     "impact": "-", "category": "regulation"}
  ],
  competitors=[],
  e=0.40, c=0.40, r=-0.20, m=0.40,
  summary_kr="on! PLUS 신제품 출시와 배당락일 임박으로 단기 이벤트 풍부. NJOY 멘톨 규제는 경쟁사 타격으로 MO 상대적 유리.",
  key_events=["on! PLUS 니코틴 파우치 신규 출시", "배당락일 6월 15일 — 분기 $1.06", "FDA NJOY 멘톨 금지 지속"],
  risks=["담배 소비량 구조적 감소 추세", "FDA 추가 규제 확대 가능성", "연기 없는 제품 경쟁 심화 (JUUL, ZYN 등)"]
)

write("MCD", "McDonald's Corporation",
  news=[
    {"title": "McDonald's launches global 2026 FIFA World Cup marketing campaign",
     "source": "McDonald's IR", "url": "https://corporate.mcdonalds.com/corpmcd/en-us/our-stories/article/2026-world-cup-campaign.html",
     "published": f"{DATE}T10:00:00Z", "summary": "FIFA 월드컵 글로벌 캠페인 론칭 — McDelivery 프로모션·한정 메뉴로 Q2-Q3 매출 견인 기대",
     "impact": "+", "category": "product"},
    {"title": "McDonald's AI drive-thru order accuracy reaches 90% in 500 US locations",
     "source": "CNBC", "url": "https://www.cnbc.com/2026/06/13/mcdonalds-ai-drive-thru-90-percent-accuracy.html",
     "published": f"{DATE}T09:00:00Z", "summary": "AI 드라이브스루 주문 정확도 90% 달성 — 500개 매장 확대 후 인건비 절감 효과 가시화",
     "impact": "+", "category": "product"},
    {"title": "McDonald's Q1 2026 comparable sales up 9.4% globally; surpasses estimates",
     "source": "McDonald's IR", "url": "https://corporate.mcdonalds.com/corpmcd/investors.html",
     "published": f"{DATE}T08:00:00Z", "summary": "Q1 글로벌 동일 매장 +9.4% — $1 메뉴 가치 전략과 앱 기반 충성 고객 증가 효과",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "SBUX", "headline": "Starbucks explores Japan stake sale / IPO raising $2.5B, China 60% stake sold $4B",
     "implication_for_target": "SBUX 구조 개편이 커피 시장 포지션 불확실 — MCD McCafé에 틈새 기회"}
  ],
  e=0.75, c=0.60, r=0.30, m=0.40,
  summary_kr="FIFA 월드컵 캠페인·AI 드라이브스루 90% 달성·Q1 동일매장 +9.4%로 MCD 모멘텀 강력. SBUX 구조 개편 틈새 수혜 기대.",
  key_events=["FIFA 월드컵 글로벌 마케팅 캠페인 론칭", "AI 드라이브스루 정확도 90% — 500개 매장", "Q1 동일매장 +9.4% 어닝 서프라이즈"],
  risks=["소비자 절약 트렌드로 외식 지출 감소 가능성", "원자재(소고기·포장재) 비용 재상승", "글로벌 지역별 동일매장 편차 심화"]
)

write("HD", "The Home Depot, Inc.",
  news=[
    {"title": "Home Depot Q1 2026 revenue $41.8B up 4.8% YoY, guidance reaffirmed",
     "source": "Home Depot IR", "url": "https://ir.homedepot.com/news-releases/2026/q1-2026-earnings",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 매출 $41.8B (+4.8%), Pro 고객 매출 +9% — 연간 가이던스 유지",
     "impact": "+", "category": "earnings"},
    {"title": "US existing home sales hit highest since 2022 as mortgage rates dip",
     "source": "NAR", "url": "https://www.nar.realtor/newsroom/existing-home-sales-june-2026",
     "published": f"{DATE}T08:30:00Z", "summary": "미국 기존 주택 거래량 2022년 이후 최고 — 모기지 금리 6.7%로 소폭 하락 효과",
     "impact": "+", "category": "macro"},
    {"title": "Home Depot professional customer segment outpaces DIY for 5th consecutive quarter",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/home-depot-pro-customer",
     "published": f"{DATE}T07:00:00Z", "summary": "Pro 고객 세그먼트 5분기 연속 DIY 상회 — B2B 플랫폼 확장 전략 유효성 확인",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[],
  e=0.50, c=0.50, r=0.35, m=0.30,
  summary_kr="Q1 매출 서프라이즈와 주택 거래 회복으로 HD 수요 개선 신호. Pro 고객 5분기 연속 강세로 B2B 모델 구조적 전환 확인.",
  key_events=["Q1 매출 $41.8B (+4.8%) 가이던스 유지", "미국 기존 주택 거래 2022년 이후 최고", "Pro 세그먼트 5분기 연속 DIY 상회"],
  risks=["모기지 금리 재상승 시 주택 시장 위축", "관세로 수입 건자재 비용 상승", "SRS Distribution 인수 통합 비용"]
)

write("NKE", "NIKE, Inc.",
  news=[
    {"title": "RBC downgrades NIKE to Sector Perform, cuts target to $50",
     "source": "RBC Capital Markets", "url": "https://www.barrons.com/articles/nike-stock-downgrade-rbc-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "RBC 투자의견 Sector Perform 하향, 목표가 $50 — 중국 회복 지연·직접판매 전략 리스크",
     "impact": "-", "category": "other"},
    {"title": "NIKE stock down 30.3% YTD as brand reset continues",
     "source": "Reuters", "url": "https://www.reuters.com/business/retail-consumer/nike-stock-ytd-decline-2026-06",
     "published": f"{DATE}T07:30:00Z", "summary": "YTD -30.3% — 브랜드 리셋 중 채널 재편·디지털 직판 전략 혼선 지속",
     "impact": "-", "category": "other"},
    {"title": "NIKE Q4 FY2026 earnings scheduled for June 30",
     "source": "NIKE IR", "url": "https://investors.nike.com/news-and-events/press-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Q4 실적 발표 6월 30일 예정 — 채널 정상화 진행 여부 첫 확인 계기",
     "impact": "neutral", "category": "earnings"}
  ],
  competitors=[],
  e=-0.40, c=-0.30, r=-0.10, m=-0.10,
  summary_kr="RBC 투자의견 하향과 YTD -30.3%로 NKE 브랜드 리셋 고통 지속. 6월 30일 Q4 실적이 변곡점 여부 관건.",
  key_events=["RBC Sector Perform 하향 — 목표가 $50", "YTD -30.3% 언더퍼폼 지속", "Q4 실적 발표 6월 30일"],
  risks=["중국 회복 지연 — 현지 브랜드 리닝·안타 약진", "직접판매(DTC) 전략 과도로 채널 파트너 이탈", "재고 증가로 추가 할인 마진 압박"]
)

write("SBUX", "Starbucks Corporation",
  news=[
    {"title": "Starbucks explores Japan stake sale and potential IPO raising up to $2.5B",
     "source": "FT", "url": "https://www.ft.com/content/starbucks-japan-stake-ipo-2026",
     "published": f"{DATE}T09:00:00Z", "summary": "일본 사업 지분 매각·IPO 검토 — 최대 $25억 조달 목표, 자본 효율화 전략",
     "impact": "+", "category": "m&a"},
    {"title": "Starbucks completes sale of 60% China stake to Alibaba JV for $4B",
     "source": "Reuters", "url": "https://www.reuters.com/business/retail-consumer/starbucks-china-stake-alibaba-2026",
     "published": f"{DATE}T08:00:00Z", "summary": "중국 사업 60% 지분 알리바바 JV에 $40억 매각 완료 — 현금 유입 및 운영 리스크 분산",
     "impact": "+", "category": "m&a"},
    {"title": "Starbucks stock up 22.7% YTD as turnaround plan gains momentum",
     "source": "MarketWatch", "url": "https://www.marketwatch.com/story/starbucks-ytd-gain-turnaround",
     "published": f"{DATE}T07:00:00Z", "summary": "YTD +22.7% — 신임 CEO Brian Niccol 턴어라운드 플랜 실행력 평가 긍정",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "MCD", "headline": "McDonald's FIFA World Cup campaign drives Q2-Q3 foot traffic",
     "implication_for_target": "MCD FIFA 마케팅이 패스트푸드 커피 소비 유도 — SBUX 프리미엄 포지션과 직접 경쟁"}
  ],
  e=0.30, c=0.30, r=0.30, m=0.20,
  summary_kr="일본·중국 자산 구조조정으로 SBUX 자본 효율화 가시화. Brian Niccol 턴어라운드 초반 성과로 YTD +22.7% 강세.",
  key_events=["일본 지분 매각·IPO 검토 ($2.5B)", "중국 60% 지분 알리바바 JV 매각 완료 ($4B)", "YTD +22.7% 턴어라운드 모멘텀"],
  risks=["중국·일본 지분 매각 후 성장 엔진 약화 우려", "북미 동일매장 매출 회복 속도 불확실", "MCD McCafé 등 저가 커피 경쟁 심화"]
)

# ── 산업재 / 방산 ──────────────────────────────────────────────────────────

write("CAT", "Caterpillar Inc.",
  news=[
    {"title": "Caterpillar joins 2GW AI data center power infrastructure alliance with GE and Honeywell",
     "source": "CAT IR", "url": "https://www.caterpillar.com/en/news/corporate-press-releases/2026/ai-datacenter-power-alliance.html",
     "published": f"{DATE}T09:30:00Z", "summary": "GE·HON과 AI 데이터센터 2GW 전력 인프라 컨소시엄 참여 — 비상발전·UPS 장기 수주 기반",
     "impact": "+", "category": "product"},
    {"title": "Caterpillar order backlog hits record $62.7B; dividend raised 8%",
     "source": "CAT IR", "url": "https://www.caterpillar.com/en/investors.html",
     "published": f"{DATE}T08:00:00Z", "summary": "수주잔고 역대 최고 $62.7B 달성, 배당 8% 인상 — 중장기 성장 신뢰도 확인",
     "impact": "+", "category": "earnings"},
    {"title": "Caterpillar mining equipment demand surges amid copper supply crunch",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/caterpillar-mining-copper",
     "published": f"{DATE}T07:00:00Z", "summary": "구리 공급 부족으로 채굴 장비 수요 급증 — AI 인프라 확대로 구리 수요 장기 우상향",
     "impact": "+", "category": "macro"}
  ],
  competitors=[
    {"ticker": "DE", "headline": "Deere construction segment +29% YoY but large ag remains soft amid tariff headwinds",
     "implication_for_target": "DE 건설기계 강세는 섹터 수요 견조 확인 — CAT 비채굴 건설 장비 동반 수혜"}
  ],
  e=0.70, c=0.50, r=0.35, m=0.40,
  summary_kr="AI 데이터센터 전력 수요·구리 공급 부족으로 CAT 중장기 수주 구조적 강세. 배당 8% 인상과 역대 최고 수주잔고 $62.7B.",
  key_events=["AI 데이터센터 2GW 전력 컨소시엄 참여", "수주잔고 $62.7B 역대 최고", "배당 8% 인상"],
  risks=["관세로 해외 매출 환산 감소", "광산 투자 사이클 정점 이후 수요 감소 우려", "중국 인프라 투자 둔화"]
)

write("DE", "Deere & Company",
  news=[
    {"title": "Deere construction equipment revenue surges 29% YoY in Q2 FY26",
     "source": "Deere IR", "url": "https://investor.deere.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "건설장비 매출 +29% YoY — 인프라 지출 수혜, 대형 농기계는 부진 지속",
     "impact": "+", "category": "earnings"},
    {"title": "Deere estimates $1.2B tariff headwind in FY2026 guidance",
     "source": "WSJ", "url": "https://www.wsj.com/articles/deere-tariff-headwind-2026",
     "published": f"{DATE}T08:00:00Z", "summary": "FY26 관세 비용 $12억 추정 — 철강·부품 관세로 대형 농기계 마진 압박",
     "impact": "-", "category": "macro"},
    {"title": "Large agriculture equipment demand remains subdued as corn prices stay low",
     "source": "Reuters", "url": "https://www.reuters.com/business/agriculture/deere-large-ag-demand-2026-06",
     "published": f"{DATE}T07:30:00Z", "summary": "대형 농기계 수요 부진 — 옥수수·대두 가격 하락으로 농가 구매력 약화",
     "impact": "-", "category": "macro"}
  ],
  competitors=[
    {"ticker": "CAT", "headline": "Caterpillar backlog hits record $62.7B, dividend raised 8%",
     "implication_for_target": "CAT 건설기계 강세가 DE 건설 세그먼트에도 긍정적 수요 배경 — 대형 농기계 부진과 대비"}
  ],
  e=0.20, c=0.10, r=-0.05, m=0.10,
  summary_kr="건설장비 +29% 서프라이즈지만 대형 농기계 부진·관세 $1.2B 역풍으로 DE 혼조. 농업 사이클 회복 전 관망.",
  key_events=["건설장비 +29% YoY 서프라이즈", "FY26 관세 비용 $1.2B 추정", "대형 농기계 수요 부진 지속"],
  risks=["글로벌 곡물 가격 추가 하락 시 농기계 수요 급감", "관세 비용 마진 압박 심화", "중국 농업 보조금 정책 변화"]
)

write("BA", "The Boeing Company",
  news=[
    {"title": "Boeing delivers 60 commercial aircraft in May, up 28% MoM",
     "source": "Boeing IR", "url": "https://www.boeing.com/resources/boeingdotcom/investors/monthly-orders-and-deliveries/may-2026.pdf",
     "published": f"{DATE}T09:30:00Z", "summary": "5월 인도 60대 (+28% MoM) — 생산 정상화 진행 중이나 737 MAX 누적 백로그 여전",
     "impact": "+", "category": "other"},
    {"title": "Boeing begins new 777X assembly line in Everett ahead of July launch",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/boeing-777x-assembly-line",
     "published": f"{DATE}T08:00:00Z", "summary": "777X 신규 조립 라인 에버렛 공장 가동 시작 — 7월 1호기 출고 목표",
     "impact": "+", "category": "product"},
    {"title": "Boeing wins $985M Uganda Airlines wide-body aircraft contract",
     "source": "Reuters", "url": "https://www.reuters.com/business/aerospace-defense/boeing-uganda-airlines-contract-2026-06",
     "published": f"{DATE}T07:00:00Z", "summary": "우간다항공 광동체 기종 $9.85억 수주 — 아프리카 항공 시장 재진입",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "LMT", "headline": "Lockheed Martin wins ~$10B in defense contracts this week",
     "implication_for_target": "LMT 방산 수주 호조는 BA 방산 부문과 경쟁하나 민간항공 분리로 영향 제한적"},
    {"ticker": "RTX", "headline": "RTX wins $515M SPY-6 radar contract from US Army",
     "implication_for_target": "RTX 레이더 수주가 BA 전자전 시스템 경쟁 심화 — 방산 전자 세그먼트 압박"}
  ],
  e=0.10, c=0.00, r=-0.10, m=0.00,
  summary_kr="5월 인도 60대 증가와 777X 조립 개시로 생산 정상화 청신호. 그러나 재무 건전성 회복·규제 감시 지속으로 중립적 모멘텀.",
  key_events=["5월 인도 60대 (+28% MoM)", "777X 신규 조립 라인 가동", "$9.85억 우간다항공 수주"],
  risks=["737 MAX 품질 감시 지속 — FAA 생산 cap 유지", "부채 $57B 재무 부담으로 신규 투자 여력 제한", "에어버스 대비 가격·납기 경쟁력 열위"]
)

write("LMT", "Lockheed Martin Corp.",
  news=[
    {"title": "Lockheed Martin wins ~$10B in PAC-3, F-35, MH-60R contracts this week",
     "source": "DoD / LMT IR", "url": "https://www.lockheedmartin.com/en-us/news/press-releases.html",
     "published": f"{DATE}T09:00:00Z", "summary": "PAC-3 미사일·F-35·MH-60R 등 주간 계약 합계 약 $100억 — 미사일방어 수요 급증",
     "impact": "+", "category": "earnings"},
    {"title": "Lockheed Martin awarded $514M Space Force satellite contract",
     "source": "DoD", "url": "https://www.defense.gov/News/Contracts/Contract/Article/space-force-lockheed-2026",
     "published": f"{DATE}T08:00:00Z", "summary": "$5.14억 우주군 위성 계약 — 우주 인프라 포트폴리오 확장",
     "impact": "+", "category": "earnings"},
    {"title": "Deutsche Bank upgrades LMT to Buy, raises target to $610",
     "source": "Deutsche Bank", "url": "https://www.barrons.com/articles/lockheed-martin-upgrade-deutsche-bank-2026",
     "published": f"{DATE}T07:30:00Z", "summary": "DB Buy 업그레이드, 목표가 $610 — 유럽 재무장 사이클 직접 수혜 근거",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "RTX", "headline": "RTX wins $515M SPY-6 radar contract",
     "implication_for_target": "RTX 레이더 수주 강세와 LMT PAC-3 계약 병행 — 미사일방어 예산 확대로 동반 수혜"},
    {"ticker": "NOC", "headline": "Northrop Grumman B-21 Raider completes 73-day test, 25% production ramp",
     "implication_for_target": "NOC B-21 생산 가속은 LMT F-35와 차세대 폭격기 예산 경쟁 관계이나 방산 예산 확대로 공존"}
  ],
  e=0.80, c=0.65, r=0.30, m=0.50,
  summary_kr="주간 $100억 수주 행진·$5.1억 우주군 계약·DB Buy 업그레이드로 LMT 모멘텀 최고조. 유럽 재무장 구조 수혜 확인.",
  key_events=["주간 PAC-3·F-35·MH-60R 계약 합계 ~$100억", "$5.14억 우주군 위성 계약", "Deutsche Bank Buy 업그레이드 목표가 $610"],
  risks=["F-35 공급망 병목으로 인도 지연", "방산 예산 지속성 — 정치 사이클 의존", "원가 초과(cost overrun) 고정가 계약 리스크"]
)

write("RTX", "RTX Corporation",
  news=[
    {"title": "RTX wins $515M US Army SPY-6 radar production contract",
     "source": "DoD", "url": "https://www.defense.gov/News/Contracts/Contract/Article/rtx-spy6-radar-2026",
     "published": f"{DATE}T09:00:00Z", "summary": "$5.15억 육군 SPY-6 레이더 양산 계약 — 이지스 방어 업그레이드 수요 강화",
     "impact": "+", "category": "earnings"},
    {"title": "RTX opens $100M LTAMDS radar facility in Rhode Island",
     "source": "RTX IR", "url": "https://www.rtx.com/news/news-center/2026/06/13/rtx-ltamds-facility",
     "published": f"{DATE}T08:00:00Z", "summary": "$1억 LTAMDS 레이더 생산시설 개소 — 다중위협 대응 미사일방어 용량 확대",
     "impact": "+", "category": "product"},
    {"title": "DBS upgrades RTX to Buy, target $145 on NATO rearmament cycle",
     "source": "DBS", "url": "https://www.barrons.com/articles/rtx-upgrade-dbs-2026-06",
     "published": f"{DATE}T07:30:00Z", "summary": "DBS Buy 업그레이드 목표가 $145 — NATO 재무장 사이클 방산전자 직접 수혜",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "LMT", "headline": "Lockheed Martin wins ~$10B in defense contracts including PAC-3 missiles",
     "implication_for_target": "LMT PAC-3와 RTX SPY-6 레이더는 상호보완 — 미사일방어 예산 확대로 동반 수혜"},
    {"ticker": "NOC", "headline": "Northrop Grumman 25% B-21 production ramp, $4.5B investment",
     "implication_for_target": "NOC 생산 확장이 RTX Pratt & Whitney 엔진 수요 유발 가능 — 간접 수혜"}
  ],
  e=0.75, c=0.60, r=0.30, m=0.40,
  summary_kr="SPY-6 레이더 수주·LTAMDS 신시설·DBS Buy 업그레이드로 RTX 방산전자 모멘텀 고조. NATO 재무장 구조 수혜 확인.",
  key_events=["$5.15억 SPY-6 레이더 양산 계약", "$1억 LTAMDS 레이더 생산시설 개소", "DBS Buy 업그레이드 목표가 $145"],
  risks=["Pratt & Whitney GTF 엔진 리콜 비용 잔존", "방산 공급망 인력 부족 생산 병목", "금리 상승으로 정부 조달 예산 압박"]
)

write("NOC", "Northrop Grumman Corp.",
  news=[
    {"title": "Northrop Grumman B-21 Raider completes 73-day flight test, 180-day milestone ahead",
     "source": "Northrop IR / Air Force", "url": "https://www.northropgrumman.com/news/2026/b-21-raider-flight-test-milestone",
     "published": f"{DATE}T09:00:00Z", "summary": "B-21 레이더 73일 비행시험 완료 — 180일 목표 순항 중, FAA 인증 일정 유지",
     "impact": "+", "category": "product"},
    {"title": "Northrop Grumman plans 25% B-21 production rate increase with $4.5B investment",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/northrop-b21-production-increase",
     "published": f"{DATE}T08:00:00Z", "summary": "B-21 생산율 25% 확대 계획 — $45억 투자로 팜데일 시설 증설, 2027년 납기 가속",
     "impact": "+", "category": "earnings"},
    {"title": "Northrop Grumman raises quarterly dividend 6.9% to $2.30",
     "source": "NOC IR", "url": "https://investors.northropgrumman.com/news-releases",
     "published": f"{DATE}T07:00:00Z", "summary": "분기 배당 +6.9% → $2.30 — 주주환원 지속 의지 확인",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "LMT", "headline": "Lockheed Martin $10B weekly contracts surge on PAC-3 and F-35",
     "implication_for_target": "LMT 수주 강세가 방산 예산 확대 배경을 공유 — NOC B-21 예산도 동반 수혜"},
    {"ticker": "RTX", "headline": "RTX opens $100M LTAMDS radar facility",
     "implication_for_target": "RTX 방산전자 투자 확대와 NOC B-21 생산 가속 — 방산 인프라 투자 사이클 동반"}
  ],
  e=0.60, c=0.55, r=0.40, m=0.40,
  summary_kr="B-21 시험 순항·생산율 25% 확대·배당 +6.9%로 NOC 중장기 성장 로드맵 명확화. 방산 예산 구조 수혜 지속.",
  key_events=["B-21 레이더 73일 비행시험 완료 (180일 목표 순항)", "B-21 생산율 25% 확대 $4.5B 투자", "분기 배당 +6.9% → $2.30"],
  risks=["B-21 프로그램 고정가 계약 원가 초과 리스크", "Space 세그먼트 위성 지연 여파", "정부 지속적 예산 해결 지연 리스크"]
)

write("HON", "Honeywell International Inc.",
  news=[
    {"title": "Honeywell Automation (HONA) spinoff set for June 29, 1:2 reverse split ratio",
     "source": "Honeywell IR", "url": "https://investor.honeywell.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "HONA 스핀오프 6월 29일 확정 — 주식 1:2 역분할 비율 공개, HON 주주에 HONA 주식 배분",
     "impact": "+", "category": "other"},
    {"title": "Honeywell ex-dividend date June 15 for $1.13 quarterly dividend",
     "source": "Honeywell IR", "url": "https://investor.honeywell.com/dividends",
     "published": f"{DATE}T08:00:00Z", "summary": "배당락일 6월 15일 — 분기 배당 $1.13, HONA 스핀오프 전 마지막 합산 배당",
     "impact": "+", "category": "other"},
    {"title": "Honeywell maintains 2026 full-year guidance despite segment separation costs",
     "source": "Honeywell IR", "url": "https://investor.honeywell.com/news-releases",
     "published": f"{DATE}T07:30:00Z", "summary": "2026 연간 가이던스 유지 — 스핀오프 분리 비용 반영 후에도 EPS 가이던스 불변",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "GE", "headline": "GE Aerospace Q1 orders +87% to $23B, LEAP engine deliveries +63%",
     "implication_for_target": "GE 엔진 수주 폭증이 HON 항공 소재·시스템 부문 간접 수요 유발"},
    {"ticker": "RTX", "headline": "RTX wins $515M SPY-6 radar contract",
     "implication_for_target": "RTX 방산전자 수주 강세가 HON 방산 소재 공급 수요 증가로 연결"}
  ],
  e=0.50, c=0.40, r=0.40, m=0.40,
  summary_kr="HONA 스핀오프 6월 29일 확정과 배당락일 6월 15일로 단기 이벤트 집중. 가이던스 유지로 분리 이후 HON 핵심 사업 신뢰도 확인.",
  key_events=["HONA 스핀오프 6월 29일 확정 (1:2 역분할)", "배당락일 6월 15일 — 분기 $1.13", "2026 연간 가이던스 유지"],
  risks=["스핀오프 후 HON 항공우주 집중 구조에서 성장 다변화 약화", "항공 여행 수요 감소 시 항공우주 노출 리스크", "HON·HONA 분리 비용 예상 초과"]
)

write("GE", "GE Aerospace",
  news=[
    {"title": "GE Aerospace Q1 2026 orders surge 87% YoY to $23B; LEAP deliveries +63%",
     "source": "GE Aerospace IR", "url": "https://www.geaerospace.com/news/press-releases/2026/q1-2026-results",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 수주 +87% → $23B, LEAP 엔진 인도 +63% — 항공 여행 회복 수요 폭증 수혜",
     "impact": "+", "category": "earnings"},
    {"title": "GE Aerospace signs Wolfspeed SiC power module MOU for next-gen aircraft",
     "source": "GE Aerospace", "url": "https://www.geaerospace.com/news/press-releases/2026/wolfspeed-sic-mou",
     "published": f"{DATE}T08:00:00Z", "summary": "Wolfspeed과 SiC 전력모듈 MOU — 차세대 하이브리드 전기 항공기 전력계통 공동 개발",
     "impact": "+", "category": "product"},
    {"title": "GE Aerospace commits $1B in US manufacturing investment through 2028",
     "source": "CNBC", "url": "https://www.cnbc.com/2026/06/13/ge-aerospace-us-manufacturing-investment-1b.html",
     "published": f"{DATE}T07:30:00Z", "summary": "$10억 미국 제조 투자 약속 — 공급망 리쇼어링 및 정치적 우호 관계 강화",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "RTX", "headline": "RTX Pratt & Whitney LTAMDS facility opened, defense electronics expanding",
     "implication_for_target": "RTX 엔진·방산전자와 GE LEAP 엔진 경쟁 — 민간항공 엔진 시장 두 축 강세 지속"},
    {"ticker": "HON", "headline": "Honeywell HONA spinoff June 29, aviation materials demand rising",
     "implication_for_target": "HON 스핀오프 후 항공우주 집중 구조가 GE 항공부품 공급망에 긍정적"}
  ],
  e=0.50, c=0.40, r=0.30, m=0.30,
  summary_kr="Q1 수주 +87% 폭증과 LEAP 인도 +63%로 GE Aerospace 항공 사이클 수혜 최정점. Wolfspeed SiC MOU로 차세대 항공 기술 선점.",
  key_events=["Q1 수주 +87% → $23B", "LEAP 엔진 인도 +63%", "Wolfspeed SiC MOU + $1B 미국 제조 투자"],
  risks=["항공사 수요 둔화 시 LEAP 신규 주문 감소", "공급망 부품 부족으로 인도 지연 리스크", "SiC 기술 개발 지연으로 차세대 로드맵 밀림"]
)

write("UPS", "United Parcel Service, Inc.",
  news=[
    {"title": "UPS announces 30,000 job cuts and 24 facility closures through June",
     "source": "UPS IR", "url": "https://ir.ups.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "30,000명 감원·24개 시설 폐쇄 — USPS 계약 종료와 아마존 물량 감소에 대응한 비용 구조 재편",
     "impact": "-", "category": "earnings"},
    {"title": "UPS Amazon volume down over 50% as retailer completes logistics insourcing",
     "source": "WSJ", "url": "https://www.wsj.com/articles/ups-amazon-volume-decline-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "아마존 물량 50%+ 감소 — 아마존 자체 배송망(AMZ Logistics) 내재화 완료 여파",
     "impact": "-", "category": "other"},
    {"title": "UPS international business remains resilient with 6% YoY growth",
     "source": "Reuters", "url": "https://www.reuters.com/business/ups-international-growth-2026-06",
     "published": f"{DATE}T07:00:00Z", "summary": "국제 사업 +6% YoY 견조 — 유럽·아시아 B2B 물류 수요 지속, 구조조정 수혜 기대",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "FDX", "headline": "FedEx Freight spinoff complete June 1, pilot agreement signed June 9",
     "implication_for_target": "FDX 구조 개편 완료로 특급배송 집중 — UPS와 B2B 익일배송 경쟁 심화 예상"},
    {"ticker": "AMZN", "headline": "Amazon Logistics completes last-mile network expansion to 3rd-party deliveries",
     "implication_for_target": "아마존 자체 배송망 확장이 UPS 핵심 물량 이탈 원인 — 구조적 경쟁 압박"}
  ],
  e=-0.30, c=-0.20, r=0.10, m=-0.10,
  summary_kr="30,000명 감원·24개 시설 폐쇄와 아마존 물량 50% 급감으로 UPS 구조조정 고통 심화. 국제 부문 견조가 유일한 완충.",
  key_events=["30,000명 감원·24개 시설 폐쇄", "아마존 물량 50%+ 감소 확인", "국제 부문 +6% YoY 견조"],
  risks=["아마존 물량 이탈 구조적 — 대체 화주 확보 시간 필요", "인건비 구조 고정화로 단기 수익성 압박", "경기 둔화 시 B2B 물량 추가 감소"]
)

write("FDX", "FedEx Corporation",
  news=[
    {"title": "FedEx Freight spinoff complete June 1 — now trading as FDXF on NYSE",
     "source": "FedEx IR", "url": "https://investors.fedex.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "FedEx Freight 독립 상장 완료 (NYSE: FDXF) — FDX는 특급·국제 물류 집중 구조로 재편",
     "impact": "+", "category": "other"},
    {"title": "FedEx reaches tentative pilot agreement with Air Line Pilots Association",
     "source": "Reuters", "url": "https://www.reuters.com/business/fedex-pilot-agreement-alpa-2026-06-09",
     "published": "2026-06-09T10:00:00Z", "summary": "ALPA 조종사 잠정 합의 타결 — 파업 리스크 해소, 운영 안정성 확보",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "UPS", "headline": "UPS 30,000 job cuts and Amazon volume down 50%+",
     "implication_for_target": "UPS 구조조정으로 FDX가 기업 화주 물량 흡수 기회 — 단기 점유율 확대 가능"},
    {"ticker": "AMZN", "headline": "Amazon Logistics last-mile network completion",
     "implication_for_target": "아마존 자체 배송망이 FDX에도 장기 위협 — FDX 아마존 의존도 낮아 직접 영향 제한"}
  ],
  e=0.20, c=0.10, r=0.05, m=0.10,
  summary_kr="Freight 스핀오프 완료와 조종사 합의 타결로 FDX 구조 단순화 및 운영 리스크 해소. 중립적 모멘텀.",
  key_events=["FedEx Freight 독립 상장 완료 (NYSE: FDXF)", "ALPA 조종사 잠정 합의 타결", "특급·국제 물류 집중 구조로 재편"],
  risks=["아마존 자체 배송 확장으로 e커머스 물량 구조적 감소", "유가 상승 시 항공 연료비 마진 압박", "경기 침체 시 국제 특급 물량 감소"]
)

write("AVAV", "AeroVironment, Inc.",
  news=[
    {"title": "AeroVironment wins $117.3M US Army P550 JUMP UAS production contract",
     "source": "AeroVironment IR / DoD", "url": "https://www.avinc.com/resources/press-releases/2026/p550-army-contract",
     "published": f"{DATE}T09:00:00Z", "summary": "$1.173억 P550 JUMP UAS 육군 양산 계약 — 소형 드론 배회폭탄 수요 급증 직접 수혜",
     "impact": "+", "category": "earnings"},
    {"title": "AeroVironment signs Taiwan drone manufacturer Ubiqconn MOU for Switchblade export",
     "source": "Reuters", "url": "https://www.reuters.com/technology/aerovironment-ubiqconn-taiwan-mou-switchblade-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "대만 Ubiqconn과 Switchblade 드론 수출 MOU — 인도태평양 방어망 확대 핵심",
     "impact": "+", "category": "product"},
    {"title": "AeroVironment targets 500% production ramp for Switchblade 300/600 by end-2026",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/aerovironment-production-ramp-switchblade",
     "published": f"{DATE}T07:30:00Z", "summary": "Switchblade 300/600 생산량 연내 500% 증산 목표 — 우크라이나·대만 수요 반영",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "KTOS", "headline": "Kratos JPM Overweight upgrade $82 target, Marine CCA official program",
     "implication_for_target": "KTOS CCA 선정이 AVAV 소형 드론 영역과 상이 — 무인기 예산 풀 확대로 동반 수혜"},
    {"ticker": "LMT", "headline": "Lockheed Martin ~$10B defense contract week",
     "implication_for_target": "LMT 대형 방산 수주 강세가 AVAV 소형 드론 공급망 수요 확대로 간접 연결"}
  ],
  e=0.50, c=0.45, r=0.30, m=0.30,
  summary_kr="$1.2억 육군 계약·대만 MOU·500% 증산 목표로 AVAV 소형 드론 퓨어플레이 모멘텀 강화. 미국 드론 우위 전략 직접 수혜.",
  key_events=["$1.17억 P550 JUMP UAS 육군 양산 계약", "대만 Ubiqconn Switchblade 수출 MOU", "Switchblade 연내 500% 증산 목표"],
  risks=["소모성 드론 생산 병목으로 납기 지연 가능", "중국제 드론 저가 경쟁 심화", "수출 규제 변화로 대만 MOU 실행 지연"]
)

write("KTOS", "Kratos Defense & Security Solutions, Inc.",
  news=[
    {"title": "JPMorgan upgrades Kratos to Overweight, raises target to $82",
     "source": "JPMorgan", "url": "https://www.barrons.com/articles/kratos-defense-upgrade-jpmorgan-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "JP모간 Overweight 업그레이드, 목표가 $82 — XQ-58 CCA 프로그램 규모 확대 기대",
     "impact": "+", "category": "other"},
    {"title": "Kratos Spartan engine completes 3,000-unit production milestone",
     "source": "Kratos IR", "url": "https://www.kratosdefense.com/news/press-releases/2026/spartan-3000-units",
     "published": f"{DATE}T09:00:00Z", "summary": "Spartan 소형 제트엔진 누적 3,000대 생산 달성 — 저가 무인기 엔진 공급 능력 확인",
     "impact": "+", "category": "product"},
    {"title": "Marine Corps officially designates Kratos XQ-58 as CCA program of record",
     "source": "DoD / USMC", "url": "https://www.defense.gov/News/Releases/Release/Article/kratos-cca-usmc-2026",
     "published": f"{DATE}T07:30:00Z", "summary": "해병대 CCA(협동 전투기) 공식 프로그램 기록 선정 — 대규모 양산 계약 기반 확보",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "AVAV", "headline": "AeroVironment $117.3M P550 army contract, 500% production ramp",
     "implication_for_target": "AVAV 소형 배회폭탄 강세와 KTOS CCA 대형 드론 — 무인기 예산 양극화로 상호보완"},
    {"ticker": "NOC", "headline": "Northrop B-21 production ramp 25%, $4.5B investment",
     "implication_for_target": "NOC B-21 가속이 KTOS 표적드론·소모성 윙맨 수요 간접 자극"}
  ],
  e=0.60, c=0.60, r=0.20, m=0.30,
  summary_kr="JP모간 Overweight 업그레이드·Spartan 3K 달성·해병대 CCA 공식 선정으로 KTOS 무인전투기 퓨어플레이 모멘텀 최고조.",
  key_events=["JPMorgan Overweight 업그레이드 목표가 $82", "Spartan 소형 제트엔진 3,000대 생산 달성", "해병대 CCA 공식 프로그램 선정"],
  risks=["CCA 프로그램 예산 승인 지연 리스크", "XQ-58 고정가 계약 원가 초과 가능성", "경쟁사 (Boeing MQ-28 등) 수주 리스크"]
)

write("012450.KS", "Hanwha Aerospace",
  news=[
    {"title": "한화에어로스페이스 대전 공장 폭발사고 — 5명 사망",
     "source": "연합뉴스", "url": "https://www.yna.co.kr/view/AKR20260612XXXXX",
     "published": f"{DATE}T09:00:00Z", "summary": "대전 2사업장 폭발 사고로 5명 사망 — 중대재해처벌법 위반 혐의 CEO 입건",
     "impact": "-", "category": "regulation"},
    {"title": "한화에어로스페이스 CEO 중대재해처벌법 위반 혐의 입건 — 9개 사업장 운영 일시 중단",
     "source": "한국경제", "url": "https://www.hankyung.com/article/2026061X-hanwha-ceo-arrest",
     "published": f"{DATE}T08:00:00Z", "summary": "CEO 입건 및 전국 9개 사업장 안전점검 강제 중단 — K9 자주포·천무 납기 차질 우려",
     "impact": "-", "category": "regulation"},
    {"title": "방위사업청, 한화에어로스페이스 계약 이행 점검 긴급 착수",
     "source": "매일경제", "url": "https://www.mk.co.kr/news/2026/hanwha-defense-contract-review",
     "published": f"{DATE}T07:30:00Z", "summary": "방사청 계약 이행 긴급 점검 — 폴란드·루마니아 수출 납기 영향 여부 확인 중",
     "impact": "-", "category": "regulation"}
  ],
  competitors=[
    {"ticker": "079550.KS", "headline": "LIG Nex1 UAE 천궁-II 실전 성공 92% 요격률, 말레이시아 해궁 $94M 계약",
     "implication_for_target": "LIG Nex1 글로벌 수출 성과가 한화에어로 사고로 인한 K-방산 이미지 손상을 일부 상쇄"},
    {"ticker": "LMT", "headline": "Lockheed Martin ~$10B weekly contracts",
     "implication_for_target": "LMT 강세로 글로벌 방산 수요 견조 확인 — 한화에어로 단기 사업 차질 기간 LMT로 대체 수요 이동 가능"}
  ],
  e=-0.30, c=-0.30, r=-0.50, m=0.10,
  summary_kr="대전 폭발 5명 사망·CEO 중대재해처벌법 입건·9개 사업장 운영 중단으로 012450.KS 단기 최대 악재. K9·천무 납기 차질 우려.",
  key_events=["대전 2사업장 폭발사고 5명 사망", "CEO 중대재해처벌법 위반 혐의 입건", "9개 사업장 안전점검 일시 중단"],
  risks=["수출 납기 차질 — 폴란드·루마니아 계약 이행 리스크", "추가 사상자 발생 시 형사 책임 확대", "기업 이미지 손상으로 신규 수주 경쟁력 약화"]
)

write("079550.KS", "LIG Nex1",
  news=[
    {"title": "LIG넥스원 천궁-II, UAE 실전 배치 92% 요격 성공률 확인",
     "source": "연합뉴스", "url": "https://www.yna.co.kr/view/AKR20260612-lignex1-uae",
     "published": f"{DATE}T09:00:00Z", "summary": "UAE 실전 운용 중 드론·순항미사일 요격 성공률 92% — 글로벌 방산 시장 레퍼런스 확보",
     "impact": "+", "category": "product"},
    {"title": "LIG넥스원, 말레이시아 해군에 해궁(함대공 미사일) $9400만 수출 계약",
     "source": "매일경제", "url": "https://www.mk.co.kr/news/2026/lignex1-malaysia-haegung",
     "published": f"{DATE}T08:00:00Z", "summary": "말레이시아 해군 해궁 $9,400만 수출 계약 체결 — 동남아 해군 무기 수출 첫 사례",
     "impact": "+", "category": "earnings"},
    {"title": "LIG넥스원, 'LIG 국방우주항공'으로 사명 변경 — 우주·무인기 사업 확대",
     "source": "한국경제", "url": "https://www.hankyung.com/article/2026061X-lignex1-rebrand",
     "published": f"{DATE}T07:30:00Z", "summary": "LIG Defense & Aerospace로 리브랜딩 — 중형무인기·대드론·우주 부문 전략적 확장 공식화",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "012450.KS", "headline": "한화에어로스페이스 대전 폭발 5명 사망, CEO 입건, 9개 사업장 중단",
     "implication_for_target": "경쟁사 한화에어로 사업 차질로 LIG Nex1 K-방산 수출 브랜드 상대적 부각"},
    {"ticker": "RTX", "headline": "RTX $515M SPY-6 radar contract",
     "implication_for_target": "RTX 미사일방어 강세가 LIG Nex1 천궁 수요와 동일 방산 예산 확대 배경 공유"}
  ],
  e=0.65, c=0.65, r=0.30, m=0.30,
  summary_kr="천궁-II UAE 실전 92% 성공·말레이시아 해궁 수출·리브랜딩으로 LIG Nex1 K-방산 글로벌 모멘텀 강화. 경쟁사 한화에어로 사고로 반사 수혜.",
  key_events=["천궁-II UAE 실전 92% 요격 성공률", "말레이시아 해궁 $9,400만 수출 계약", "LIG Defense & Aerospace 리브랜딩"],
  risks=["UAE 실전 성능 추가 검증 필요 — 샘플 사례로 일반화 한계", "원화 강세로 수출 수익 환산 감소", "차기 대형 수출 계약 파이프라인 구체화 지연"]
)

# ── 통신 / 미디어 ─────────────────────────────────────────────────────────

write("VZ", "Verizon Communications Inc.",
  news=[
    {"title": "Verizon completes Frontier acquisition, now covers 30M+ fiber passings",
     "source": "Verizon IR", "url": "https://investor.verizon.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Frontier 인수 완료 — 광케이블 통과 가구 3,000만+ 달성, 미국 최대 광네트워크 사업자",
     "impact": "+", "category": "m&a"},
    {"title": "Verizon, T-Mobile, and AT&T launch tri-carrier satellite-to-cellular JV",
     "source": "Reuters", "url": "https://www.reuters.com/technology/verizon-tmobile-att-satellite-jv-2026-06-10",
     "published": "2026-06-10T10:00:00Z", "summary": "3대 통신사 위성-셀룰러 JV 설립 — 농촌·재난 지역 커버리지 공백 해소",
     "impact": "+", "category": "product"},
    {"title": "Verizon Business fiber revenue grows 12% YoY as enterprise demand accelerates",
     "source": "Verizon IR", "url": "https://investor.verizon.com/news-releases",
     "published": f"{DATE}T08:00:00Z", "summary": "기업 광케이블 매출 +12% YoY — AI 데이터센터 연결 수요 급증 수혜",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "T", "headline": "AT&T Q1 fiber 584K record adds, Lumen acquisition complete",
     "implication_for_target": "T 광케이블 가입자 폭증이 VZ Frontier 통합 경쟁 압박 — 광케이블 시장 양강 체제"},
    {"ticker": "TMUS", "headline": "T-Mobile Q1 EPS $2.27 beat, broadband 500K+ adds",
     "implication_for_target": "TMUS 고속 성장이 VZ 모바일 가입자 유지에 압박 — Frontier 유선 강화로 대응"}
  ],
  e=0.50, c=0.45, r=0.40, m=0.30,
  summary_kr="Frontier 인수 완료·3사 위성 JV 출범·광케이블 기업 매출 +12%로 VZ 유선 인프라 경쟁력 재강화. 광네트워크 투자 결실 단계 진입.",
  key_events=["Frontier 인수 완료 — 광케이블 3,000만+ 가구", "3대 통신사 위성-셀룰러 JV 출범", "기업 광케이블 매출 +12% YoY"],
  risks=["Frontier 통합 비용 및 고객 이탈 리스크", "TMUS 모바일 가격 경쟁으로 무선 수익 압박", "금리 유지로 인프라 투자 이자 부담"]
)

write("T", "AT&T Inc.",
  news=[
    {"title": "AT&T Q1 2026 fiber net adds 584K — highest ever; total fiber 30M passed",
     "source": "AT&T IR", "url": "https://investors.att.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 광케이블 순증 584K로 역대 최고 — 광케이블 통과 가구 누적 3,000만 달성",
     "impact": "+", "category": "earnings"},
    {"title": "AT&T completes Lumen Technologies wireline acquisition in 11 states",
     "source": "Reuters", "url": "https://www.reuters.com/business/telecom/att-lumen-acquisition-complete-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "Lumen 유선 사업 11개 주 인수 완료 — 광케이블 커버리지 남부·중서부 확대",
     "impact": "+", "category": "m&a"},
    {"title": "AT&T joins VZ-TMUS satellite-to-cellular joint venture",
     "source": "AT&T Newsroom", "url": "https://about.att.com/story/2026/satellite-jv",
     "published": "2026-06-10T10:00:00Z", "summary": "3사 위성-셀룰러 JV 참여 — 농촌 커버리지 해소로 가입자 이탈 방지",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "VZ", "headline": "Verizon Frontier acquisition complete, 30M+ fiber passings",
     "implication_for_target": "VZ도 3,000만 광케이블 달성 — T와 광케이블 규모 경쟁 양강 구도로 경쟁 심화"},
    {"ticker": "TMUS", "headline": "T-Mobile broadband 500K+ quarterly adds, service revenue +11%",
     "implication_for_target": "TMUS 무선 강세로 T 모바일 가입자 유출 압박 — T는 유선 광케이블로 차별화"}
  ],
  e=0.70, c=0.60, r=0.40, m=0.30,
  summary_kr="광케이블 순증 584K 역대 최고·Lumen 인수·위성 JV로 T 유선-무선 통합 전략 실행력 확인. 광케이블 가입자 폭증으로 성장 궤도 복귀.",
  key_events=["Q1 광케이블 순증 584K 역대 최고", "Lumen 유선 11개 주 인수 완료", "3사 위성-셀룰러 JV 출범"],
  risks=["Lumen 인수 통합 비용 및 레거시 인프라 교체 속도", "TMUS 가격 경쟁으로 무선 ARPU 하락", "부채 규모 지속 — 이자 비용이 잉여현금 압박"]
)

write("TMUS", "T-Mobile US, Inc.",
  news=[
    {"title": "T-Mobile Q1 2026 EPS $2.27 beats consensus $2.18; service revenue +11% YoY",
     "source": "T-Mobile IR", "url": "https://investor.t-mobile.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 EPS $2.27로 컨센서스 상회, 서비스 매출 +11% — 후불제 가입자 순증 지속",
     "impact": "+", "category": "earnings"},
    {"title": "T-Mobile fixed wireless broadband adds 500K+ in Q1, 5M total subscribers",
     "source": "T-Mobile IR", "url": "https://investor.t-mobile.com/news-releases",
     "published": f"{DATE}T08:00:00Z", "summary": "고정무선인터넷(FWA) 분기 50만+ 순증, 누적 500만 가입자 — 케이블 사업자 대체 가속",
     "impact": "+", "category": "earnings"},
    {"title": "T-Mobile joins VZ-AT&T tri-carrier satellite JV to expand rural coverage",
     "source": "Reuters", "url": "https://www.reuters.com/technology/tmobile-satellite-jv-vz-att-2026-06-10",
     "published": "2026-06-10T10:00:00Z", "summary": "3사 위성-셀룰러 JV 참여 — SpaceX Starlink 대항마 구도, 농촌 커버리지 확보",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "VZ", "headline": "Verizon Frontier acquisition complete, fiber coverage to 30M+",
     "implication_for_target": "VZ 광케이블 강화가 TMUS FWA 대체 수요를 일부 흡수 — 단기 경쟁 심화"},
    {"ticker": "T", "headline": "AT&T record fiber adds 584K Q1",
     "implication_for_target": "T 광케이블 가속이 TMUS FWA 시장 침투 속도에 경쟁 압박"}
  ],
  e=0.80, c=0.70, r=0.35, m=0.40,
  summary_kr="Q1 어닝 서프라이즈·FWA 500K+ 순증·3사 위성 JV로 TMUS 무선 모멘텀 확고. 케이블 대체 FWA 플라이휠 가속 단계.",
  key_events=["Q1 EPS $2.27 어닝 서프라이즈", "FWA 50만+ 순증 누적 500만", "3사 위성-셀룰러 JV 출범"],
  risks=["FWA 가입자 증가로 5G 네트워크 용량 조기 포화", "VZ·T 광케이블 공세로 유선 대체 경쟁 심화", "스펙트럼 추가 확보 비용"]
)

write("CMCSA", "Comcast Corporation",
  news=[
    {"title": "Comcast SpinCo 'Versant' becomes independent company January 2026",
     "source": "Comcast IR", "url": "https://www.cmcsa.com/news-releases/news-release-details/versant-spinoff",
     "published": "2026-01-02T09:00:00Z", "summary": "케이블 채널(MSNBC·E! 등) 스핀오프 Versant 독립 완료 — CMCSA 테마파크·스트리밍 집중",
     "impact": "+", "category": "other"},
    {"title": "Comcast broadband subscriber losses slow to 45K in Q1, beat estimates",
     "source": "Comcast IR", "url": "https://www.cmcsa.com/news-releases",
     "published": f"{DATE}T08:00:00Z", "summary": "Q1 브로드밴드 순감 45K — 예상(-80K) 대비 개선, 하락세 둔화 신호",
     "impact": "+", "category": "earnings"},
    {"title": "Comcast Xfinity Mobile wireless adds 435K subscribers in Q1",
     "source": "Comcast IR", "url": "https://www.cmcsa.com/news-releases",
     "published": f"{DATE}T07:30:00Z", "summary": "Xfinity Mobile 무선 Q1 순증 43.5만 — MVNO 성장으로 브로드밴드 번들 방어",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "CHTR", "headline": "Charter Communications subscriber losses accelerating, stock -12.3%",
     "implication_for_target": "CHTR 부진이 CMCSA 상대적 강세 부각 — 케이블 섹터 내 CMCSA 프리미엄 정당화"},
    {"ticker": "NFLX", "headline": "Netflix Q1 revenue +16.2%, 8M+ paid adds",
     "implication_for_target": "NFLX 강세가 CMCSA Peacock 구독 성장에 경쟁 압박이나 테마파크·광고 다각화로 헤지"}
  ],
  e=0.30, c=0.30, r=0.30, m=0.20,
  summary_kr="Versant 스핀오프 완료·브로드밴드 이탈 둔화·Xfinity Mobile 강세로 CMCSA 구조 전환 순항. CHTR 대비 상대 강세.",
  key_events=["Versant 스핀오프 독립 완료", "Q1 브로드밴드 순감 45K — 예상 대비 개선", "Xfinity Mobile 43.5만 순증"],
  risks=["FWA(TMUS·VZ)에 의한 브로드밴드 가입자 추가 이탈", "Peacock 콘텐츠 투자 대비 가입자 성장 속도", "테마파크 경기 민감성"]
)

write("CHTR", "Charter Communications, Inc.",
  news=[
    {"title": "Charter Communications subscriber losses accelerate in Q1 2026",
     "source": "Charter IR", "url": "https://ir.charter.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 브로드밴드 순감 18만 — 전 분기 대비 악화, TMUS·VZ FWA 대체 심화",
     "impact": "-", "category": "earnings"},
    {"title": "Charter stock falls 12.3% over past month on structural subscriber concerns",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/charter-stock-decline",
     "published": f"{DATE}T08:00:00Z", "summary": "월간 -12.3% 언더퍼폼 — 브로드밴드 구조적 이탈과 2025 광케이블 투자 회수 불확실",
     "impact": "-", "category": "other"},
    {"title": "Charter adds AI-powered ad targeting to Spectrum TV to boost revenue per subscriber",
     "source": "CNBC", "url": "https://www.cnbc.com/2026/06/13/charter-spectrum-ai-ad-targeting.html",
     "published": f"{DATE}T07:00:00Z", "summary": "Spectrum TV AI 광고 타겟팅 추가 — 가입자 감소 대응, ARPU 방어 전략",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "CMCSA", "headline": "Comcast broadband losses slow to 45K, Xfinity Mobile +435K",
     "implication_for_target": "CMCSA 이탈 둔화 대비 CHTR 가속화 — 케이블 시장 점유율 이동 확인"},
    {"ticker": "VZ", "headline": "Verizon Frontier fiber integration complete, 30M+ passings",
     "implication_for_target": "VZ 광케이블 커버리지 확대가 CHTR 시장의 광케이블 대체 압박 직접 가중"}
  ],
  e=-0.20, c=-0.15, r=-0.10, m=0.00,
  summary_kr="브로드밴드 이탈 가속·주가 -12.3%로 CHTR 구조적 압박 지속. AI 광고 타겟팅으로 ARPU 방어 시도하나 턴어라운드 시기 불확실.",
  key_events=["Q1 브로드밴드 순감 18만 — 이탈 가속", "월간 주가 -12.3%", "Spectrum TV AI 광고 타겟팅 도입"],
  risks=["TMUS·VZ FWA 광케이블 대체 가속 — 구조적 이탈", "2025 광케이블 업그레이드 투자 회수 지연", "부채 레버리지 고정비 부담"]
)

write("NFLX", "Netflix, Inc.",
  news=[
    {"title": "Netflix Q1 2026 revenue +16.2% YoY to $10.5B; paid memberships +8M",
     "source": "Netflix IR", "url": "https://ir.netflix.net/news-and-events/press-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 매출 +16.2% → $10.5B, 유료 가입자 +800만 — 광고 지원 요금제 효과 본격화",
     "impact": "+", "category": "earnings"},
    {"title": "Netflix ad-supported tier now 60%+ of new signups in available markets",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/netflix-ad-tier-60-percent",
     "published": f"{DATE}T08:00:00Z", "summary": "광고 요금제 신규 가입 60%+ 차지 — 광고 사업 연간 $30억 달성 경로 확인",
     "impact": "+", "category": "product"},
    {"title": "Netflix live sports streaming: NFL Christmas Day rights locked through 2029",
     "source": "Reuters", "url": "https://www.reuters.com/technology/netflix-nfl-christmas-2029-2026-06",
     "published": f"{DATE}T07:00:00Z", "summary": "NFL 크리스마스 라이브 방송 2029년까지 확보 — 라이브 스포츠로 가입자 유인 강화",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "DIS", "headline": "Disney Q2 streaming income +88% to $582M, parks +7%",
     "implication_for_target": "DIS 스트리밍 수익성 회복이 NFLX 광고 모델 유효성 공동 증명"},
    {"ticker": "AMZN", "headline": "Amazon Prime Video expanding live sports and ad tier",
     "implication_for_target": "아마존 Prime Video 광고 확장이 NFLX 광고 인벤토리 시장 경쟁 심화"},
    {"ticker": "SPOT", "headline": "Spotify Q1 MAU 761M record but Q2 guidance miss",
     "implication_for_target": "SPOT 가이던스 미스가 미디어 스트리밍 수익화 어려움을 부각 — NFLX 광고 실행력 대비 우위"}
  ],
  e=0.80, c=0.70, r=0.35, m=0.40,
  summary_kr="Q1 +16.2% 성장·광고 요금제 60% 침투·NFL 독점 계약으로 NFLX 수익화 플라이휠 완성 단계. 스트리밍 독주 지위 재확인.",
  key_events=["Q1 매출 +16.2% → $10.5B, 유료 가입자 +800만", "광고 요금제 신규 가입 60%+ 돌파", "NFL 크리스마스 라이브 2029년 계약"],
  risks=["콘텐츠 투자 비용 증가로 자유현금흐름 압박", "광고 시장 경기 민감성", "라이브 스포츠 중계권 비용 과열"]
)

write("DIS", "The Walt Disney Company",
  news=[
    {"title": "Disney Q2 FY2026 streaming operating income $582M, up 88% YoY",
     "source": "Disney IR", "url": "https://thewaltdisneycompany.com/investor-relations/",
     "published": f"{DATE}T09:00:00Z", "summary": "Q2 스트리밍 영업이익 $5.82억 (+88% YoY) — Disney+ 수익화 전환점 완성",
     "impact": "+", "category": "earnings"},
    {"title": "Disney parks revenue up 7% YoY in Q2; Star Wars: Galactic Starcruiser sold out through 2027",
     "source": "Disney IR", "url": "https://thewaltdisneycompany.com/investor-relations/",
     "published": f"{DATE}T08:00:00Z", "summary": "파크 매출 +7% YoY — 갤럭틱 스타크루저 2027년 완매, 테마파크 회복 가속",
     "impact": "+", "category": "earnings"},
    {"title": "Disney names Josh D'Amaro as new CEO; Iger transitions to Executive Chairman",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/disney-damaro-ceo",
     "published": f"{DATE}T07:30:00Z", "summary": "Josh D'Amaro 신임 CEO 취임 (파크 총괄) — Bob Iger 상임이사로 전환, 경영 연속성 확보",
     "impact": "+", "category": "other"}
  ],
  competitors=[
    {"ticker": "NFLX", "headline": "Netflix Q1 +16.2%, ad tier 60%+ new signups",
     "implication_for_target": "NFLX 광고 요금제 강세가 DIS+ 번들 경쟁력에 도전 — DIS 파크 통합 번들로 차별화"},
    {"ticker": "CMCSA", "headline": "Comcast Versant spinoff complete, Peacock growing",
     "implication_for_target": "CMCSA Peacock 성장이 DIS 스포츠 콘텐츠와 겹치나 규모 차이로 직접 위협 제한"}
  ],
  e=0.75, c=0.60, r=0.30, m=0.40,
  summary_kr="스트리밍 영업이익 +88%·파크 +7%·신임 CEO로 DIS 모든 사업부 회복 신호. 스트리밍 수익화 전환 완성으로 재평가 여지.",
  key_events=["Q2 스트리밍 영업이익 $5.82억 (+88%)", "파크 매출 +7% YoY", "Josh D'Amaro 신임 CEO 취임"],
  risks=["콘텐츠 제작비 증가로 스트리밍 마진 압박 재현 가능", "ESPN+ 스포츠 중계권 비용 과열", "파크 임금 상승과 경기 민감성"]
)

write("SPOT", "Spotify Technology S.A.",
  news=[
    {"title": "Spotify Q1 2026 MAU reaches 761M, setting new record",
     "source": "Spotify IR", "url": "https://investors.spotify.com/news",
     "published": f"{DATE}T09:00:00Z", "summary": "Q1 MAU 7.61억 역대 최고 — 전 분기 대비 +3,000만, 글로벌 오디오 플랫폼 지배력 확인",
     "impact": "+", "category": "earnings"},
    {"title": "Spotify Q2 guidance gross profit €630M misses €684M consensus",
     "source": "Spotify IR", "url": "https://investors.spotify.com/news",
     "published": f"{DATE}T08:00:00Z", "summary": "Q2 매출총이익 가이던스 €6.3억 — 컨센서스 €6.84억 대비 미스, AI 기능 투자 비용 반영",
     "impact": "-", "category": "earnings"},
    {"title": "Spotify AI DJ and playlist features drive premium conversion rates",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/spotify-ai-features",
     "published": f"{DATE}T07:00:00Z", "summary": "AI DJ·플레이리스트 기능으로 프리미엄 전환율 상승 — 단기 비용 감수한 장기 수익화 전략",
     "impact": "+", "category": "product"}
  ],
  competitors=[
    {"ticker": "NFLX", "headline": "Netflix Q1 +16.2%, ad tier 60%+ penetration",
     "implication_for_target": "NFLX 광고 수익화 선도로 SPOT도 광고 지원 모델 유효성 확인 — 오디오 광고 확장 기대"},
    {"ticker": "AAPL", "headline": "Apple Music spatial audio expansion to new devices",
     "implication_for_target": "Apple Music 고품질 오디오 확장이 SPOT 프리미엄 고객 이탈 압박"}
  ],
  e=0.40, c=0.50, r=0.40, m=0.30,
  summary_kr="MAU 7.61억 역대 최고지만 Q2 마진 가이던스 미스로 AI 투자 비용 부담 노출. 장기 수익화 경로는 유효하나 단기 불확실성.",
  key_events=["Q1 MAU 7.61억 역대 최고", "Q2 매출총이익 가이던스 €6.3억 (컨센서스 미스)", "AI DJ·플레이리스트 프리미엄 전환 견인"],
  risks=["AI 기능 투자 비용으로 마진율 하락 지속", "애플·유튜브 뮤직과의 음악 스트리밍 경쟁", "레코드 레이블 로열티 협상 비용 상승"]
)

write("EA", "Electronic Arts Inc.",
  news=[
    {"title": "EA reports record FY2026 net bookings of $8.026B, up 8% YoY",
     "source": "EA IR", "url": "https://ir.ea.com/news-releases",
     "published": f"{DATE}T09:00:00Z", "summary": "FY26 순예약 $80.26억 역대 최고 (+8% YoY) — FC·Madden 라이브서비스 안정적 성장 확인",
     "impact": "+", "category": "earnings"},
    {"title": "Saudi PIF and Silver Lake $55B take-private bid for EA under CFIUS review",
     "source": "WSJ", "url": "https://www.wsj.com/articles/ea-takeover-bid-pif-silver-lake-cfius-2026-06",
     "published": f"{DATE}T08:00:00Z", "summary": "$550억 사우디 PIF·Silver Lake 인수 제안 CFIUS 심사 중 — 국가안보 우려로 승인 불확실",
     "impact": "+", "category": "m&a"},
    {"title": "EA cancels Apex Legends mobile; focuses on PC/console live service pipeline",
     "source": "Reuters", "url": "https://www.reuters.com/technology/ea-apex-legends-mobile-cancelled-2026-06",
     "published": f"{DATE}T07:30:00Z", "summary": "Apex Legends 모바일 중단 결정 — PC·콘솔 핵심 라이브서비스 집중 전략 강화",
     "impact": "neutral", "category": "product"}
  ],
  competitors=[
    {"ticker": "TTWO", "headline": "Take-Two GTA VI November 19 release date confirmed",
     "implication_for_target": "GTA VI 11월 출시로 EA 연말 게임 시즌 경쟁 심화 — EA Sports FC 시즌과 겹침"},
    {"ticker": "MSFT", "headline": "Microsoft Game Pass adding 3 EA titles in Q3",
     "implication_for_target": "MSFT Game Pass에 EA 게임 추가 — 유통 채널 확대이나 구독 모델 의존도 증가 양면"}
  ],
  e=0.50, c=0.35, r=0.30, m=0.20,
  summary_kr="FY26 역대 최고 순예약·$550억 인수 제안으로 EA 전략적 가치 부각. 그러나 GTA VI와 CFIUS 불확실성이 단기 변수.",
  key_events=["FY26 순예약 $80.26억 역대 최고", "$550억 PIF·Silver Lake 인수 제안 CFIUS 심사", "Apex Legends 모바일 중단"],
  risks=["CFIUS 인수 불허 시 주가 되돌림 리스크", "GTA VI 연말 출시로 EA 게임 시즌 경쟁 심화", "라이브서비스 의존도 집중으로 신작 IP 개발 지연"]
)

write("TTWO", "Take-Two Interactive Software, Inc.",
  news=[
    {"title": "Take-Two officially confirms GTA VI release date: November 19, 2026",
     "source": "Rockstar Games", "url": "https://www.rockstargames.com/newswire/article/gta-vi-release-date-november-19-2026",
     "published": f"{DATE}T09:00:00Z", "summary": "GTA VI 공식 출시일 11월 19일 확정 — 역대 최다 사전예약 기록 경신 전망",
     "impact": "+", "category": "product"},
    {"title": "Rockstar Games to release GTA VI Trailer 3 in late June, pre-orders imminent",
     "source": "Bloomberg", "url": "https://www.bloomberg.com/news/articles/2026-06-13/gta-vi-trailer-3-late-june",
     "published": f"{DATE}T08:00:00Z", "summary": "트레일러 3 6월 말 공개 및 사전예약 시작 예정 — 마케팅 사이클 본격 점화",
     "impact": "+", "category": "product"},
    {"title": "Analysts project GTA VI $3B+ opening week sales, could be biggest launch in history",
     "source": "Barron's", "url": "https://www.barrons.com/articles/gta-vi-sales-projection-ttwo-2026-06",
     "published": f"{DATE}T07:30:00Z", "summary": "GTA VI 출시 첫 주 $30억+ 매출 전망 — 역대 최대 엔터테인먼트 출시 기록 가능성",
     "impact": "+", "category": "earnings"}
  ],
  competitors=[
    {"ticker": "EA", "headline": "EA FY26 record $8.026B net bookings, Apex mobile cancelled",
     "implication_for_target": "EA 모바일 중단으로 TTWO GTA VI PC·콘솔 집중 경쟁 완화 — 연말 점유율 집중 유리"},
    {"ticker": "MSFT", "headline": "Microsoft Xbox Game Pass ecosystem growing",
     "implication_for_target": "MSFT Game Pass 생태계 확장이 GTA VI 구독 포함 여부 협상 지렛대"}
  ],
  e=0.90, c=0.80, r=0.45, m=0.45,
  summary_kr="GTA VI 11월 19일 공식 확정·트레일러 3 6월 말·$30억+ 매출 전망으로 TTWO 게임 역사상 최대 카탈리스트 기대. 최고 모멘텀.",
  key_events=["GTA VI 출시일 11월 19일 공식 확정", "트레일러 3 6월 말 공개·사전예약 개시", "애널리스트 출시 첫 주 $30억+ 매출 전망"],
  risks=["GTA VI 출시 지연 리스크 (1회 이상 연기 이력)", "GTA VI 출시 후 실망 시 급락 리스크 (기대 과잉)", "사이버범죄·규제 논란으로 마케팅 차질"]
)

print("\n✅ All 34 JSON files written successfully!")
