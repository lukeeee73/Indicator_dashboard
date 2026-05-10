# Daily Market Analysis Routine

이 문서는 Claude Code Routines가 매일 한 번 실행할 때 따라야 할 작업 절차다.
사용자(개인)의 watchlist 종목에 대한 뉴스를 수집·요약하고, 경쟁사 동향과 함께
정성(qualitative) 평가를 산출해 레포에 누적한다.

---

## Watchlist (9 종목)

| Ticker | 회사 | 섹터 | 주요 경쟁사 |
|---|---|---|---|
| AAPL  | Apple Inc.            | Technology              | MSFT, GOOGL, AMZN |
| MSFT  | Microsoft Corp.       | Technology              | AAPL, GOOGL, AMZN, ORCL |
| GOOGL | Alphabet Inc.         | Communication Services  | MSFT, META, AMZN |
| AMZN  | Amazon.com Inc.       | Consumer Discretionary  | MSFT, GOOGL, AAPL |
| NVDA  | NVIDIA Corp.          | Technology              | AMD, INTC, QCOM, AVGO |
| META  | Meta Platforms Inc.   | Communication Services  | GOOGL, SNAP, PINS |
| ORCL  | Oracle Corp.          | Technology              | MSFT, SAP, IBM, CRM |
| PLTR  | Palantir Technologies | Technology              | SNOW, IBM, MSFT |
| TSLA  | Tesla Inc.            | Consumer Discretionary  | BYD, GM, F, RIVN |

---

## 작업 순서

### 1. 각 종목의 최근 뉴스 수집

각 ticker에 대해 다음 소스에서 **최근 24시간 뉴스 3~5건**을 수집하라.

권장 소스 (WebFetch로 접근 가능):
- Yahoo Finance: `https://finance.yahoo.com/quote/{TICKER}/news/`
- Google News RSS: `https://news.google.com/rss/search?q={TICKER}+stock&hl=en-US`
- MarketWatch: `https://www.marketwatch.com/investing/stock/{ticker}` (lower-case)
- Seeking Alpha (요약만): `https://seekingalpha.com/symbol/{TICKER}/news`

수집 시 주의:
- 헤드라인이 광고·추천형이면(예: "10 stocks to buy") 제외
- 동일 사건의 중복 기사면 가장 신뢰도 높은 한 건만 채택 (Reuters/Bloomberg/WSJ/FT > 그 외)
- 24시간 내 새 뉴스가 없으면 빈 배열로 두고 `note` 필드에 명시

### 2. 경쟁사 동향 비교

각 ticker의 경쟁사 표(위)에 따라, 같은 24시간 내 경쟁사의 주요 뉴스 1~2건을
요약하라. 비교 관점은 다음 중 가장 관련 있는 것:
- 시장 점유율 변화 (특히 NVDA vs AMD, AAPL vs Android)
- 가격 정책 (예: AWS 인하 → MSFT Azure 영향)
- 신제품·신서비스 출시 (예: GOOGL Gemini → MSFT Copilot 영향)
- M&A·투자 동향
- 규제·소송 (반독점, 데이터 프라이버시)

### 3. Narrative score 산출

다음 4개 축으로 -1.0 ~ +1.0 점수를 매기고, 단순 평균으로 종합 점수 도출:

| 축 | 음수(-) | 양수(+) |
|---|---|---|
| **earnings_outlook** | 가이던스 하향, 컨센서스 하회 | 가이던스 상향, 어닝 서프라이즈 |
| **competitive_position** | 점유율 하락, 경쟁사 약진 | 점유율 상승, 해자 강화 |
| **regulatory_risk** | 규제·소송 악재 | 규제 완화, 소송 승소 |
| **macro_sensitivity** | 금리·환율·관세 악영향 | 매크로 우호 환경 |

종합 `narrative_score` = round((earnings + competitive + regulatory + macro) / 4, 2)

### 4. JSON 파일 저장

각 ticker마다 다음 경로에 JSON 한 건 작성:
`data/news/{TICKER}/{YYYY-MM-DD}.json`

스키마:
```json
{
  "ticker": "AAPL",
  "date": "2026-05-10",
  "as_of_utc": "2026-05-10T21:00:00Z",
  "news": [
    {
      "title": "Apple raises iPhone 17 pricing in EU...",
      "source": "Reuters",
      "url": "https://...",
      "published": "2026-05-10T08:30:00Z",
      "summary": "한 줄 한국어 요약 (50자 내외)",
      "impact": "+ / - / neutral",
      "category": "product | earnings | regulation | m&a | macro | other"
    }
  ],
  "competitor_context": [
    {
      "ticker": "MSFT",
      "headline": "Azure unveils new AI inference SKU at 30% lower price",
      "implication_for_target": "AAPL Services 마진 압박 가능성"
    }
  ],
  "scores": {
    "earnings_outlook":      0.3,
    "competitive_position":  -0.1,
    "regulatory_risk":       0.0,
    "macro_sensitivity":     -0.2
  },
  "narrative_score": 0.0,
  "summary_kr": "종합 1-2 문장 한국어 요약. 가장 중요한 신호와 그 의미.",
  "key_events": ["EU 가격 인상", "Azure 가격 압박"],
  "risks":      ["EU 규제 대응 지연 시 매출 둔화"]
}
```

빈 뉴스 데이로:
```json
{
  "ticker": "AAPL",
  "date": "2026-05-10",
  "as_of_utc": "2026-05-10T21:00:00Z",
  "news": [],
  "note": "최근 24시간 내 의미 있는 뉴스 없음",
  "narrative_score": 0.0
}
```

### 5. valuation.qualitative 블록 갱신

각 ticker마다 `data/stocks/{TICKER}.json` 의 `valuation` 블록에 `qualitative`
서브블록을 추가/갱신하라:

```json
"valuation": {
  ...,
  "qualitative": {
    "as_of": "2026-05-10",
    "narrative_score": 0.05,
    "summary_kr": "...",
    "key_events": [...],
    "risks": [...],
    "history": [
      {"date": "2026-05-09", "narrative_score": -0.1},
      {"date": "2026-05-10", "narrative_score":  0.05}
    ]
  }
}
```

`history` 배열은 기존 값을 유지하면서 오늘 점수를 append (최근 30개만 유지).

### 6. Git commit & push

작업 완료 후 다음 명령으로 커밋:
```bash
git add data/news/ data/stocks/*.json
git commit -m "chore(news): daily qualitative analysis ($(date -u +%Y-%m-%d))"
git push origin claude/stock-valuation-tracker-uv3D8
```

만약 변경된 파일이 없으면 (예: 모든 ticker가 빈 뉴스) 커밋하지 않는다.

---

## 안전 가이드라인

- **하루에 한 번만 실행한다.** 같은 날짜 파일이 이미 있으면 덮어쓰지 말고 종료.
- **유료 사이트(Bloomberg Terminal 등)는 시도하지 않는다.** 무료로 접근 가능한
  소스만 사용. 페이월 만나면 다음 소스로 넘어간다.
- **추측·창작 금지.** 출처 URL이 확인되지 않으면 해당 뉴스 항목은 제외한다.
- **개인 투자 조언 금지.** 점수와 요약만 제공하고 "buy/sell" 같은 권유 표현은
  쓰지 않는다.
- **민감 정보 주의.** Tier-1 매체(Reuters, Bloomberg, WSJ, FT, NYT)의 헤드라인
  요약 정도는 fair use에 해당하지만 본문 통째로 복제하지 않는다.

---

## 실패 처리

- 특정 ticker가 실패해도 나머지 처리는 계속 진행
- 9개 모두 실패 시 커밋하지 않고 종료
- 어떤 단계에서 실패했는지 마지막에 콘솔에 요약 출력

## 검증

저장 직전 각 JSON에 대해:
- `narrative_score` 가 -1.0 ~ +1.0 범위인지
- `news[].url` 이 http(s):// 로 시작하는지
- `news[].published` 가 ISO 8601 형식인지

위반 시 해당 항목 제외 후 재시도 또는 스킵.
