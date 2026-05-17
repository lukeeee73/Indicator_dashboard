# Daily Market Analysis Routine

이 문서는 Claude Code Routine 이 매일 한 번 실행할 때 따라야 할 작업 절차다.
**섹터별 watchlist 종목**의 뉴스를 수집·요약하고, 같은 섹터 경쟁사 동향과 함께
정성(qualitative) 평가를 산출한다.

**출력은 두 곳으로 동시에 나간다 (dual-output):**

1. **Luke_wiki** (`lukeeee73/luke_wiki` 의 `main` 브랜치, 폴더: `wiki/news/`):
   - 사실 추적이 가능한 풍부한 마크다운 누적 로그.
   - 폰의 Obsidian 에서 바로 보는 1차 산출물.
2. **이 레포** (`data/news/{TICKER}/{YYYY-MM-DD}.json`):
   - 대시보드 표시를 위한 최소 JSON (score + 한 줄 요약).
   - `scripts/merge_qualitative.py` 가 `data/stocks/{TICKER}.json` 에 주입.

> 이 루틴은 **종목 목록이 늘어도 그대로 작동**하도록 일반화되어 있다.
> 종목·섹터·요일 매핑은 다음 단일 파일에서 관리한다:
>
> - `scripts/watchlist_data.py` — `STOCKS` / `COMPETITORS` / `GROUPS` /
>   `DAY_OF_WEEK_SECTORS` 의 단일 진실 공급원
>
> 편집 후 `python scripts/gen_watchlist.py` 를 한 번 실행하면 다음 파일들이
> 일관되게 재생성된다:
>   - `scripts/fetch_fred.py` 의 `STOCKS`
>   - `scripts/competitors.py` 의 `COMPETITORS`
>   - `app.js` 의 `STOCK_META` / `STOCK_GROUPS` / `PEER_COMPETITORS`
>
> 루틴은 그 결과물인 `data/index.json` 의 `stocks[]` 배열을 watchlist 의
> 진실 공급원으로 사용한다.

---

## 0. 요일별 섹터 라운드로빈

watchlist 가 100+ 종목으로 커졌으므로, 한 번에 전부 처리하지 않고 **요일별로
배정된 섹터만** 처리한다. 매핑은 `scripts/watchlist_data.py` 의
`DAY_OF_WEEK_SECTORS` 에 정의되어 있다 (월=0, ..., 일=6):

| 요일 | 처리 섹터 |
|---|---|
| 월요일 | 빅테크 / 소프트웨어 |
| 화요일 | 반도체 |
| 수요일 | 자동차 / 모빌리티, 조선 (한국) |
| 목요일 | 바이오 / 제약 / 헬스케어 |
| 금요일 | 에너지 / 원자재, 유틸리티 / 전력 |
| 토요일 | 금융, 부동산 (REITs) |
| 일요일 | 소비재, 산업재 / 방산, 통신 / 미디어 |

**실행 시 흐름:**

1. UTC 기준 오늘의 요일 (`datetime.utcnow().weekday()`) 확인
2. `DAY_OF_WEEK_SECTORS[weekday]` 에서 오늘 처리할 섹터 리스트 얻기
3. `data/index.json` 의 `stocks[]` 중 `group` 이 위 리스트에 포함된 종목만 필터링
4. 나머지 섹터는 **건드리지 않는다** (기존 qualitative 블록·뉴스 그대로 유지)

> 사용자가 수동으로 다른 섹터를 추가 실행하고 싶을 때는 routine 호출 시
> "오늘은 추가로 X 섹터도 처리해줘" 라고 자연어로 지시할 수 있다.

## 0.5 Watchlist 로딩

```
data/index.json 의 stocks[] 배열을 읽는다.
각 항목은 다음 필드를 가진다:
  - code   : 티커 (예: "AAPL", "329180.KS")
  - name   : 정식 회사명 (예: "Apple Inc.")
  - sector : GICS 영문 섹터 (예: "Technology", "Healthcare")
  - group  : 한국어 섹터 묶음 (예: "반도체", "바이오 / 제약 / 헬스케어")
  - competitors_in_watchlist : watchlist 내 경쟁사 티커 배열
```

또한 `scripts/competitors.py` 의 `COMPETITORS` 딕셔너리에서 **watchlist 외부
경쟁사**까지 포함한 전체 경쟁사 목록을 읽을 수 있다 (경쟁사 동향 비교용).

---

## 작업 순서 (요약)

오늘 처리 대상 ticker 각각에 대해:

1. **위키 로드** — `lukeeee73/luke_wiki` 의 `wiki/news/{TICKER}.md` 를 MCP 로 읽어 [미해결 가설] 과 [일자별 기록] 최근 7 일 파악.
2. **뉴스 수집** — 최근 24 시간 뉴스 3~5 건 (한국 종목은 한국 매체 포함).
3. **경쟁사 동향** — 1~2 건 (섹터별 비교 관점에 맞춰).
4. **사실 추적** — 오늘 뉴스를 [미해결 가설] 과 대조하여 verified/refuted/pending/aged-out 판정. 패턴(연속·모순·동기화) 감지.
5. **Narrative score** 산출.
6. **위키 마크다운 갱신** — 새 [일자별 기록] 섹션 prepend + [미해결 가설] 갱신 + 검증된 사실 [사실 누적] 으로 이동.
7. **JSON 작성** — 대시보드용 최소 JSON.
8. **valuation.qualitative 블록 갱신** — `data/stocks/{TICKER}.json` 에 주입 (또는 `merge_qualitative.py` 에 위임).

마지막에 한 번:

9. **_dashboard.md 갱신** — 오늘 처리한 ticker 행 갱신 + 오늘의 시그널.
10. **푸시** — Luke_wiki main 직접 푸시 (PR 없음) + indicator_dashboard `claude/news-daily` 푸시 (PR 자동 갱신).

---

## 1. 위키 현재 상태 로드 (매 ticker 첫 단계)

각 ticker 에 대해 작업 시작 전에 다음을 호출:

```
mcp__github__get_file_contents(
  owner="lukeeee73",
  repo="luke_wiki",
  path="wiki/news/{TICKER}.md",
  ref="main"
)
```

추출할 것:

- `<!-- OPEN_CLAIMS_START -->` 와 `<!-- OPEN_CLAIMS_END -->` 사이의 checkbox 목록 → 메모리에 `open_claims: list[{date, text, status}]` 로 보관.
- `<!-- FACTS_START -->` 와 `<!-- FACTS_END -->` 사이 → `verified_facts` (중복 추가 방지용 키 셋).
- `<!-- DAILY_START -->` 직후부터 가장 최근 7 일의 `### YYYY-MM-DD` 헤더와 본문 → `recent_history` (연속성·모순 감지용).
- 파일 SHA → 나중 푸시 시 사용.

파일이 없으면 (`404`) → 빈 상태로 진행하되 마크다운 신규 생성. `tags` 에 `[routine-news, watchlist, {TICKER}]` 를 포함하고 기존 ticker 파일(예: `AAPL.md`) 의 구조를 복사.

## 2. 뉴스 수집

각 ticker 에 대해 다음 소스에서 **최근 24 시간 뉴스 3~5 건**을 수집한다.

권장 소스 (WebFetch 로 접근 가능):

- Yahoo Finance: `https://finance.yahoo.com/quote/{TICKER}/news/`
- Google News RSS: `https://news.google.com/rss/search?q={TICKER}+stock&hl=en-US`
- MarketWatch: `https://www.marketwatch.com/investing/stock/{ticker}` (lower-case)
- Seeking Alpha (요약만): `https://seekingalpha.com/symbol/{TICKER}/news`

**한국 종목 (`*.KS` 티커)** 의 경우:
- Yahoo Finance: `https://finance.yahoo.com/quote/{TICKER}/news/` (영문 뉴스가 있음)
- Naver Finance: `https://finance.naver.com/item/news.naver?code={TICKER_NUMBER}` — `.KS` 를 떼고 6자리 숫자만 사용 (예: `329180`)
- 한국경제·연합뉴스 등 한국 매체 검색: `https://news.google.com/rss/search?q={회사명_한글}&hl=ko`

수집 시 주의:

- 헤드라인이 광고·추천형이면 (예: "10 stocks to buy") 제외.
- 동일 사건의 중복 기사면 가장 신뢰도 높은 한 건만 채택.
  - Tier-1: Reuters / Bloomberg / WSJ / FT / NYT / 회사 IR
  - Tier-2: CNBC / Barron's / Forbes / Yahoo Finance / 연합뉴스 / 한국경제 / 매일경제
- 24 시간 내 새 뉴스가 없으면 빈 배열. JSON 에는 `note` 필드 명시. 위키에는 그 날짜 섹션을 만들지 않는다 (단, [미해결 가설] 의 aged-out 처리는 수행).
- **섹터 헤드라인** (예: 반도체 업황, 비만치료제 임상 데이터, 유가) 도 해당 섹터의 모든 종목에 영향을 주므로 적극적으로 채택한다.

## 3. 경쟁사 동향 비교

각 ticker 의 경쟁사 목록 (`competitors_in_watchlist` 또는 `scripts/competitors.py` 의 `COMPETITORS[ticker]`) 에 따라, 같은 24 시간 내 경쟁사의 주요 뉴스 1~2 건을 요약한다. 비교 관점은 섹터별로 다음 중 가장 관련 있는 것을 채택:

| 섹터 그룹 | 비교 관점 |
|---|---|
| 빅테크 / AI 플랫폼 | 시장 점유율, AI 제품/서비스 출시, 클라우드 가격 정책, 규제·소송 |
| 반도체 | 점유율 변화 (NVDA vs AMD), 신제품 출시, 공정 로드맵, 공급 부족·과잉 |
| 자동차 / 모빌리티 | EV 인도량, 가격 인하 경쟁, 자율주행 진척, 보조금·관세 |
| 바이오 / 제약 | 임상 데이터, FDA 승인·거절, 특허 만료, 가격 정책, M&A |
| 에너지 / 원자재 | 유가·구리·금 가격, OPEC+ 결정, 생산 가이던스, 인수합병 |
| 금융 | 금리 환경, 신용 손실 충당금, 대출 성장, M&A·자사주매입 |
| 소비재 | 동일 점포 매출, 마진 압박 (인플레이션), 가격 전가력 |
| 산업재 / 방산 | 수주 잔고, 국방예산 변화, 항공기 인도, 글로벌 인프라 투자 |
| 부동산 (REITs) | FFO 가이던스, 임대료·공실률, 금리 환경, 신규 공급 |
| 조선 (한국) | 신규 수주, LNG·암모니아 친환경 선박 점유율, 환율, 후판 가격 |

watchlist 외부 경쟁사 (예: NVDA 입장의 `INTC`, JNJ 입장의 `PFE`) 도 `COMPETITORS` 매핑에 있으면 적극적으로 활용해 비교 맥락을 풍부하게 한다.

## 4. 사실 추적 (핵심 단계)

이 단계가 단순 JSON 누적 방식에서 위키 누적 방식으로 옮긴 가장 큰 이유다.

### 4.1 미해결 가설 (Open Claims) 갱신

`recent_history` 로 읽어둔 `open_claims` 각 항목에 대해 오늘 뉴스(타겟 + 경쟁사)와 대조:

| 판정 | 조건 | 처리 |
|---|---|---|
| **verified** | 독립 Tier-1 매체(Reuters/Bloomberg/WSJ/FT/NYT) 또는 회사 IR/공시가 같은 사실을 1 건 이상 추가 보고 | checkbox `[x]` 로 변경, `(verified YYYY-MM-DD by 출처)` 추가. [사실 누적] 으로 새 `[!fact]` 블록 이동. |
| **refuted** | 회사 공식 부인, 정정 보도, 후속 데이터가 반대 방향 | checkbox `[~]` 로 변경, `(refuted YYYY-MM-DD by 출처)` 추가. 일자별 기록에 반증 노트 추가. [사실 누적] 으로 이동하지 않음. |
| **pending** | 위 둘 다 아님 | 그대로 둠. 단 최초 등록일로부터 7 일 초과 시 → **aged-out** 으로 자동 처리 (Open Claims 에서 제거, 일자별 기록은 보존). |

> ⚠️ 섹터 라운드로빈으로 한 종목은 7 일에 한 번만 처리된다.
> 따라서 위 "7 일 초과" 기준은 **이 종목의 직전 실행일** 기준이 아니라
> **달력 기준**으로 적용한다 (즉 한 번의 라운드로빈 사이클이 곧 1 회 체크).
> aged-out 처리도 라운드로빈 다음 차례 때 한 번에 일어난다.

### 4.2 신규 가설 등록

오늘 수집한 뉴스 중 다음 조건을 만족하는 항목을 **신규 Open Claim** 으로 등록 (checkbox `[ ]`):

- Tier-1 매체 단독 보도이거나
- impact 가 `+` / `-` 인 (즉 neutral 이 아닌) 항목이거나
- key_events 에 포함된 항목

(헤드라인 한 줄로 요약, 30 자 내외. 일자 prefix 필수.)

### 4.3 패턴 감지 (오늘의 시그널)

`recent_history` 와 오늘 뉴스를 합쳐 다음 패턴을 감지하고, 감지되면 `wiki/news/_dashboard.md` 의 "오늘의 시그널" 섹션에 한 줄로 기록:

- **연속성**: 같은 테마 키워드가 같은 종목의 직전 3 회 실행 (≈ 3 주) 연속 등장 (예: `capex`, `regulation`, `tariff`).
- **모순**: 직전 실행 (보통 7 일 전) narrative_score 와 오늘 narrative_score 의 부호가 반대이면서 절댓값 0.3 이상 변동.
- **섹터 동기화**: 오늘 처리한 같은 섹터 내 3 종목 이상이 같은 매크로 이벤트 (예: FOMC, 관세, 환율) 로 동시에 같은 부호로 움직임.

## 5. Narrative Score 산출

다음 4 개 축으로 -1.0 ~ +1.0 점수, 단순 평균으로 종합:

| 축 | 음수(-) | 양수(+) |
|---|---|---|
| **earnings_outlook** | 가이던스 하향, 컨센서스 하회 | 가이던스 상향, 어닝 서프라이즈 |
| **competitive_position** | 점유율 하락, 경쟁사 약진 | 점유율 상승, 해자 강화 |
| **regulatory_risk** | 규제·소송 악재 | 규제 완화, 소송 승소 |
| **macro_sensitivity** | 금리·환율·관세·유가 악영향 | 매크로 우호 환경 |

종합 `narrative_score = round((earnings + competitive + regulatory + macro) / 4, 2)`

뉴스가 전혀 없는 종목은 `narrative_score = 0.0` 으로 두고 `note` 에 사유 명시.

## 6. 위키 마크다운 갱신

`wiki/news/{TICKER}.md` 전체를 다음과 같이 재구성한다 (HTML 앵커 마커는 보존):

### 6.1 [미해결 가설] 섹션 재작성

`<!-- OPEN_CLAIMS_START -->` 와 `<!-- OPEN_CLAIMS_END -->` 사이를 (verified 로 빠진 것 + aged-out 제외) + 신규 항목들로 갱신.

예시:

```markdown
<!-- OPEN_CLAIMS_START -->
- [ ] **2026-05-16**: iPhone 17 EU 출시 → 매출 영향 (pending)
- [x] **2026-05-12**: Q1 매출 +33% YoY (verified 2026-05-14 by Reuters)
- [~] **2026-05-10**: Vision Pro Q2 단종 루머 (refuted 2026-05-13 by Apple IR)
<!-- OPEN_CLAIMS_END -->
```

### 6.2 [사실 누적] 섹션 append

`<!-- FACTS_START -->` 와 `<!-- FACTS_END -->` 사이에 오늘 verified 로 승격된 항목을 `[!fact]` 블록으로 append.

```markdown
<!-- FACTS_START -->
> [!fact] (검증일 2026-05-14, 출처: Reuters + Apple 10-Q) Apple Q1 2026 매출 $YYB (+33% YoY)
> 4월 28일 Apple 자체 보고와 5월 14일 Reuters 확인. 컨센서스 $XXB 대비 +%.

(이전 fact 들...)
<!-- FACTS_END -->
```

이미 같은 키(요약 첫 50자)가 [사실 누적] 또는 사람-promote 노트(`→ wiki/topics/{slug}.md 로 승격됨`)에 있으면 중복 추가하지 않는다.

### 6.3 [일자별 기록] 섹션 prepend

`<!-- DAILY_START -->` 직후에 오늘 섹션을 추가 (역순 = 위가 최신):

```markdown
<!-- DAILY_START -->

### 2026-05-16

**narrative_score**: +0.15 (전회 +0.05, Δ +0.10)
**key_events**: iPhone 17 EU 출시, App Store 수수료 EU 조정안
**risks**: EU DMA 추가 규제 가능성

> [!claim] (출처: Reuters, 2026-05-16) iPhone 17 EU 출시
> 매출 가이던스 영향 미정. impact: + / category: product

> [!claim] (출처: Bloomberg, 2026-05-16) App Store 수수료 EU 조정안
> 27% → 17% 인하 검토. impact: - / category: regulation

**경쟁사 동향**:
- MSFT: Surface 신모델 발표 — Apple Silicon 대비 가성비 강조 (impact for AAPL: -)
- GOOGL: Pixel Watch 3 출시 — Apple Watch 점유율 침식 우려 (impact for AAPL: -)

**검증·반증 노트** (해당 시에만):
- ✅ 2026-05-12 가설 "Q1 매출 +33%" — Reuters 추가 보도로 verified, [사실 누적] 으로 이동.
- ❌ 2026-05-10 가설 "Vision Pro Q2 단종" — Apple IR 부인, refuted 처리.

(이전 일자 섹션들...)

<!-- DAILY_END -->
```

### 6.4 frontmatter `updated` 필드 오늘 날짜로 갱신.

### 6.5 절단

[일자별 기록] 은 **최근 60 일분만 유지**. 60 일 이상 된 섹션은 잘라낸다 (git 히스토리에는 남음).

> 섹터 라운드로빈상 한 종목당 60 일은 약 8~9 회 실행분에 해당한다.

## 7. JSON 저장 (대시보드용 최소 출력)

각 ticker 마다 다음 경로에 JSON 한 건 작성:

`data/news/{TICKER}/{YYYY-MM-DD}.json`

> **티커에 점이 포함된 한국 종목** (예: `329180.KS`) 도 디렉토리명에
> 그대로 사용한다: `data/news/329180.KS/2026-05-16.json`. 파일 시스템과
> `merge_qualitative.py` 모두 점을 정상 처리한다.

스키마:

```json
{
  "ticker": "AAPL",
  "date": "2026-05-16",
  "as_of_utc": "2026-05-16T21:00:00Z",
  "news": [
    {
      "title": "Apple raises iPhone 17 pricing in EU...",
      "source": "Reuters",
      "url": "https://...",
      "published": "2026-05-16T08:30:00Z",
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
  "risks":      ["EU 규제 대응 지연 시 매출 둔화"],
  "wiki_url":   "https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/AAPL.md"
}
```

빈 뉴스 데이로:

```json
{
  "ticker": "AAPL",
  "date": "2026-05-16",
  "as_of_utc": "2026-05-16T21:00:00Z",
  "news": [],
  "note": "최근 24시간 내 의미 있는 뉴스 없음",
  "narrative_score": 0.0,
  "wiki_url": "https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/AAPL.md"
}
```

`wiki_url` 필드는 대시보드에서 "자세히 보기" 링크로 활용 가능.

## 8. valuation.qualitative 블록 갱신

각 ticker 마다 `data/stocks/{TICKER}.json` 의 `valuation.qualitative` 서브블록을 추가/갱신:

```json
"valuation": {
  ...,
  "qualitative": {
    "as_of": "2026-05-16",
    "narrative_score": 0.05,
    "summary_kr": "...",
    "key_events": [...],
    "risks": [...],
    "wiki_url": "https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/AAPL.md",
    "history": [
      {"date": "2026-05-09", "narrative_score": -0.1},
      {"date": "2026-05-16", "narrative_score":  0.05}
    ]
  }
}
```

`history` 배열은 기존 값을 유지하면서 오늘 점수를 append (최근 30 개만 유지).

> 자동화 가능: `scripts/merge_qualitative.py` 가 `data/news/` 의 모든
> `{TICKER}/{YYYY-MM-DD}.json` 을 읽어 `data/stocks/{TICKER}.json` 의
> qualitative 블록을 자동으로 채운다. 루틴은 JSON 만 정확히 쓰면 되고
> 8 단계를 직접 수행할 필요는 없다 (다음 fetch_fred 실행 때 동기화됨).

## 9. _dashboard.md 갱신

오늘 처리한 ticker 들을 모두 처리한 뒤 `wiki/news/_dashboard.md` 의 "최신 스냅샷" 표에서 **오늘 처리한 행만** 갱신:

```
| [AAPL](AAPL.md) | 2026-05-16 | +0.15 | iPhone 17 EU 출시, App Store 수수료 EU 조정안 | 3 |
```

(open claims 컬럼 = [미해결 가설] 의 pending 항목 수)

표가 **섹터 그룹별 헤더**로 나뉘어 있을 수 있다 (예: `### 반도체`, `### 바이오 / 제약`). 헤더는 보존하고 행만 갱신. 새 ticker 라면 해당 섹터 헤더 아래 새 행 추가.

오늘 처리하지 않은 섹터의 행은 **건드리지 않는다** (직전 라운드로빈 데이터 그대로 유지). 단 각 행의 `as_of` 컬럼으로 신선도를 알 수 있다.

"오늘의 시그널" 섹션도 4.3 에서 감지한 패턴들로 갱신.

## 10. 푸시

### 10.1 Luke_wiki 푸시 (`main` 직접)

변경된 모든 `wiki/news/*.md` 파일을 한 번의 커밋으로 푸시:

```
mcp__github__push_files(
  owner="lukeeee73",
  repo="luke_wiki",
  branch="main",
  files=[
    {"path": "wiki/news/AAPL.md", "content": "..."},
    {"path": "wiki/news/MSFT.md", "content": "..."},
    ...,
    {"path": "wiki/news/_dashboard.md", "content": "..."}
  ],
  message="[routine-news] daily watchlist update YYYY-MM-DD ({처리한 섹터})"
)
```

- 커밋 메시지 prefix `[routine-news]` 로 사람 작업과 구분.
- PR 만들지 않는다 — 개인 위키, 직접 main 푸시가 정책.
- 변경 없는 파일은 보내지 않는다.
- `wiki/news/` 외 폴더는 절대 건드리지 않는다.

### 10.2 indicator_dashboard 커밋 & 푸시 (`claude/news-daily` 브랜치)

```bash
git add data/news/ data/stocks/*.json
git commit -m "chore(news): daily qualitative analysis ($(date -u +%Y-%m-%d))"
git push origin claude/news-daily
```

변경된 파일이 없으면 (모든 ticker 빈 뉴스) 커밋하지 않는다.

### 10.3 PR 생성 또는 스킵 (indicator_dashboard 만)

`mcp__github__list_pull_requests` 로 `claude/news-daily` → base 방향의 열린 PR 이 있는지 확인.

- **PR 이 이미 열려 있으면**: 아무것도 하지 않는다 (푸시한 커밋이 자동 반영).
- **PR 이 없으면**: `mcp__github__create_pull_request` 로 새 PR 생성:
  - **repo**: `lukeeee73/indicator_dashboard`
  - **title**: `chore(news): daily qualitative analysis (YYYY-MM-DD ~)`
  - **head**: `claude/news-daily`
  - **base**: 현재 운영 base 브랜치 (예: `claude/build-indicators-pipeline-QFtLk` 또는 `main`)
  - **body**: 다음 형식. 오늘 처리한 섹터만 포함한다 (요일 라운드로빈):

```markdown
## Daily Market Analysis — {요일} ({처리한 섹터들})

### 처리된 종목

#### {오늘의 섹터 1}
| Ticker | 뉴스 건수 | narrative_score | 위키 |
|--------|-----------|-----------------|------|
| AAPL   | 3         | +0.10           | [AAPL.md](https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/AAPL.md) |
| ...    | ...       | ...             | ... |

#### {오늘의 섹터 2}  (해당 요일에 2 개 섹터가 배정된 경우만)
...

> 다른 섹터는 다른 요일에 처리됨 — `.claude/routines/daily-market-analysis.md` 의 요일별 라운드로빈 표 참고.

### 오늘의 시그널 (위키 _dashboard.md 동기)
- ...

### 주요 이슈
오늘 가장 큰 이슈 2~3 개를 bullet point 로 요약 (한국어). 가능하면 섹터 연쇄 효과 (예: "NVDA 가이던스 상향 → 반도체 섹터 동조 상승") 도 표기.

### 변경 파일
- `data/news/{TICKER}/YYYY-MM-DD.json` (N 개, 오늘 섹터만)
- `data/stocks/*.json` (해당 섹터 종목의 qualitative 블록 갱신)
- (위키 변경은 `lukeeee73/luke_wiki` 의 `main` 으로 직접 푸시됨 — 본 PR 에 포함되지 않음)

> 이 PR 은 머지 전까지 매일 자동으로 커밋이 추가됩니다.
> 7 일에 한 번 모든 섹터가 한 바퀴 돕니다.
```

---

## 안전 가이드라인

- **하루에 한 번만 실행한다.** 같은 날짜 JSON 파일이 이미 있고 위키 [일자별 기록] 맨 위 헤더가 오늘이면 중복 실행으로 보고 종료.
- **유료 사이트 (Bloomberg Terminal 등) 는 시도하지 않는다.** 페이월 만나면 다음 소스로 넘어간다.
- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 해당 항목 제외.
- **개인 투자 조언 금지.** 점수와 요약만, "buy/sell" 권유 표현 금지.
- **fair use.** Tier-1 매체 헤드라인 요약은 OK, 본문 통째 복제 금지.
- **종목 가산점·차별 금지.** 모든 watchlist 종목에 동일한 기준 적용. 특정 섹터·종목에 점수 보너스를 주지 않는다.
- **위키 사람 영역 건드리지 않는다.** `wiki/news/` 외 폴더는 절대 수정하지 않는다 (CLAUDE.md, index.md, domains/ 포함 — 인덱스는 사람이 promote 시 직접 갱신).
- **HTML 마커 보존.** `<!-- OPEN_CLAIMS_START -->` 등의 마커 라인은 절대 지우지 말 것 (다음 실행이 그 마커로 파싱한다).

## 실패 처리

- 특정 ticker 가 실패해도 나머지 처리는 계속 진행.
- 오늘 처리 대상 전부 실패 시 커밋·푸시 모두 스킵하고 종료.
- 위키 푸시만 실패하면 JSON 은 그대로 푸시하고 위키 푸시는 다음 라운드로빈 차례에 재시도 (위키 파일은 멱등적으로 다시 작성되므로 안전).
- 새로 추가된 종목의 뉴스 소스가 정상 응답하지 않으면 (예: 신규 상장이라 뉴스 누적 부족) 빈 뉴스 데이로 기록하고 계속 진행.
- 어떤 단계에서 실패했는지 마지막에 콘솔에 요약 출력.

## 검증

저장 직전 각 JSON 에 대해:

- `narrative_score` 가 -1.0 ~ +1.0 범위인지
- `news[].url` 이 http(s):// 로 시작하는지
- `news[].published` 가 ISO 8601 형식인지
- `ticker` 필드가 `data/index.json` 의 stocks[] 코드 중 하나인지

위키 마크다운에 대해:

- HTML 마커 4 종 (`OPEN_CLAIMS_START/END`, `FACTS_START/END`, `DAILY_START/END`) 모두 보존되어 있는지
- frontmatter `updated` 가 오늘 날짜인지
- frontmatter `tags` 에 `routine-news` 가 들어있는지

위반 시 해당 항목 제외 후 재시도 또는 스킵.

---

## 첫 실행 시 (one-time bootstrap)

각 `wiki/news/{TICKER}.md` 의 [미해결 가설] / [사실 누적] / [일자별 기록] 섹션은 stub 상태(비어 있음). 첫 실행은 단순히 오늘 데이터로 [일자별 기록] 첫 항목을 만들고, 4.2 규칙으로 신규 가설들을 등록한다. 4.1 의 verified/refuted 처리는 둘째 실행 (= 다음 라운드로빈 차례, 7 일 뒤) 부터 의미를 갖는다.

신규 종목이 watchlist 에 추가되어 `wiki/news/{TICKER}.md` 가 아직 없으면, §1 에서 404 를 만나는 즉시 기존 ticker 파일을 템플릿 삼아 새로 만든다.

---

## 종목·섹터 추가 가이드 (사람용)

새 종목·섹터를 watchlist 에 추가하고 싶다면, **`scripts/watchlist_data.py` 단 한 파일만** 편집한다:

1. **`scripts/watchlist_data.py` 의 `STOCKS` 리스트에 한 줄 추가**
   ```python
   ("TICKER", "Full Name", "GICS Sector EN", "한국어 그룹",
    "한국어 섹터 부제", "#color", decimals, "USD"|"KRW",
    "초보자도 이해 가능한 사업 모델 한 줄 설명"),
   ```
   - `GICS Sector EN` 은 `scripts/valuation.py` 의 `SECTOR_PE_BENCHMARK` 키 중 하나 (Technology / Healthcare / Energy / Materials / ...).
   - `한국어 그룹` 은 `GROUPS` 리스트에 정의된 그룹명과 일치해야 함. 새 그룹을 만들고 싶으면 `GROUPS` 에 한 줄 추가 + `DAY_OF_WEEK_SECTORS` 에서 어떤 요일에 처리할지 배정.

2. **`scripts/watchlist_data.py` 의 `COMPETITORS` 에 경쟁사 목록 추가** (watchlist 내 종목 + 일부 외부 peer 모두 OK)

3. **재생성 명령 실행**
   ```bash
   python scripts/gen_watchlist.py
   ```
   이 한 줄이 다음을 모두 갱신한다:
   - `scripts/fetch_fred.py` 의 `STOCKS`
   - `scripts/competitors.py` 의 `COMPETITORS`
   - `app.js` 의 `STOCK_META` / `STOCK_GROUPS` / `PEER_COMPETITORS`

4. **Luke_wiki 의 `wiki/news/{TICKER}.md` 신규 생성은 선택**
   루틴이 다음 라운드로빈 차례에 자동으로 만들어준다 (§1, §첫 실행 참고). 미리 만들어두고 싶다면 기존 파일 (예: `wiki/news/AAPL.md`) 을 복사해 frontmatter 의 ticker / subtitle 만 바꾼다. `_dashboard.md` 표 행도 해당 섹터 헤더 아래에 추가한다 (없으면 루틴이 자동 추가).

5. 다음 주간 GitHub Actions 실행 (`update.yml`) 이 자동으로 종목 데이터를 채워준다. 그 이후 첫 daily routine 실행이 (해당 종목의 요일 차례에) 뉴스를 누적하기 시작한다.

루틴 자체는 이 모든 단계를 마치고 나면 코드 수정 없이 새 종목을 인식한다.
