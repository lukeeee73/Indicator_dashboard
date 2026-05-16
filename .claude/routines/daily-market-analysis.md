# Daily Market Analysis Routine

이 문서는 Claude Code Routines 가 매일 한 번 실행할 때 따라야 할 작업 절차다.
watchlist 종목의 뉴스를 수집·요약하고, 경쟁사 동향과 함께 정성(qualitative)
평가를 산출한다.

**출력은 두 곳으로 동시에 나간다 (dual-output):**

1. **Luke_wiki** (`lukeeee73/luke_wiki` 의 `main` 브랜치, 폴더: `wiki/news/`):
   - 사실 추적이 가능한 풍부한 마크다운 누적 로그.
   - 폰의 Obsidian 에서 바로 보는 1차 산출물.
2. **이 레포** (`data/news/{TICKER}/{YYYY-MM-DD}.json`):
   - 대시보드 표시를 위한 최소 JSON (score + 한 줄 요약).
   - `scripts/merge_qualitative.py` 가 `data/stocks/{TICKER}.json` 에 주입.

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

## 작업 순서 (요약)

각 ticker 마다:

1. **위키 로드** — `lukeeee73/luke_wiki` 의 `wiki/news/{TICKER}.md` 를 MCP 로 읽어 [미해결 가설] 과 [일자별 기록] 최근 7 일 파악.
2. **뉴스 수집** — 최근 24 시간 뉴스 3~5 건.
3. **경쟁사 동향** — 1~2 건.
4. **사실 추적 (NEW)** — 오늘 뉴스를 [미해결 가설] 과 대조하여 verified/refuted/pending/aged-out 판정. 패턴(연속·모순·동기화) 감지.
5. **Narrative score** 산출.
6. **위키 마크다운 갱신** — 새 [일자별 기록] 섹션 prepend + [미해결 가설] 갱신 + 검증된 사실 [사실 누적] 으로 이동.
7. **JSON 작성** — 대시보드용 최소 JSON.

마지막에:

8. **Luke_wiki 푸시** — MCP `push_files` 로 변경된 `wiki/news/*.md` 들을 `main` 에 단일 커밋으로 푸시 (PR 없음).
9. **indicator_dashboard 커밋** — JSON 변경을 `claude/news-daily` 브랜치에 푸시. PR 자동 갱신.

---

## 1. 위키 현재 상태 로드 (NEW, 매 ticker 첫 단계)

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

파일이 없으면 (`404`) → 빈 상태로 진행하되 마크다운 신규 생성.

## 2. 뉴스 수집

권장 소스 (WebFetch 로 접근 가능):

- Yahoo Finance: `https://finance.yahoo.com/quote/{TICKER}/news/`
- Google News RSS: `https://news.google.com/rss/search?q={TICKER}+stock&hl=en-US`
- MarketWatch: `https://www.marketwatch.com/investing/stock/{ticker}` (lower-case)
- Seeking Alpha (요약만): `https://seekingalpha.com/symbol/{TICKER}/news`

수집 규칙:

- 헤드라인이 광고·추천형이면 제외 (예: "10 stocks to buy").
- 동일 사건의 중복 기사면 가장 신뢰도 높은 한 건만 채택 (Reuters/Bloomberg/WSJ/FT > 그 외).
- 24 시간 내 새 뉴스가 없으면 빈 배열. JSON 에는 `note` 필드 명시. 위키에는 그 날짜 섹션을 만들지 않는다 (단, [미해결 가설] 의 aged-out 처리는 수행).

## 3. 경쟁사 동향 비교

각 ticker 의 경쟁사 표(위)에 따라, 같은 24 시간 내 경쟁사 주요 뉴스 1~2 건 요약. 비교 관점:

- 시장 점유율 변화 (특히 NVDA vs AMD, AAPL vs Android)
- 가격 정책 (예: AWS 인하 → MSFT Azure 영향)
- 신제품·신서비스 출시 (예: GOOGL Gemini → MSFT Copilot 영향)
- M&A·투자 동향
- 규제·소송 (반독점, 데이터 프라이버시)

## 4. 사실 추적 (NEW, 핵심 단계)

이 단계가 단순 JSON 누적 방식에서 위키 누적 방식으로 옮긴 가장 큰 이유다.

### 4.1 미해결 가설 (Open Claims) 갱신

`recent_history` 로 읽어둔 `open_claims` 각 항목에 대해 오늘 뉴스(타겟 + 경쟁사)와 대조:

| 판정 | 조건 | 처리 |
|---|---|---|
| **verified** | 독립 Tier-1 매체(Reuters/Bloomberg/WSJ/FT/NYT) 또는 회사 IR/공시 가 같은 사실을 1 건 이상 추가 보고 | checkbox `[x]` 로 변경, `(verified YYYY-MM-DD by 출처)` 추가. [사실 누적] 으로 새 `[!fact]` 블록 이동. |
| **refuted** | 회사 공식 부인, 정정 보도, 후속 데이터가 반대 방향 | checkbox `[~]` 로 변경, `(refuted YYYY-MM-DD by 출처)` 추가. 일자별 기록에 반증 노트 추가. [사실 누적] 으로 이동하지 않음. |
| **pending** | 위 둘 다 아님 | 그대로 둠. 단 최초 등록일로부터 7 일 초과 시 → **aged-out** 으로 자동 처리 (Open Claims 에서 제거, 일자별 기록은 보존). |

### 4.2 신규 가설 등록

오늘 수집한 뉴스 중 다음 조건을 만족하는 항목을 **신규 Open Claim** 으로 등록 (checkbox `[ ]`):

- Tier-1 매체 단독 보도이거나
- impact 가 `+` / `-` 인 (즉 neutral 이 아닌) 항목이거나
- key_events 에 포함된 항목

(헤드라인 한 줄로 요약, 30 자 내외. 일자 prefix 필수.)

### 4.3 패턴 감지 (오늘의 시그널)

`recent_history` 와 오늘 뉴스를 합쳐 다음 패턴을 감지하고, 감지되면 [_dashboard.md](https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/_dashboard.md) 의 "오늘의 시그널" 섹션에 한 줄로 기록:

- **연속성**: 같은 테마 키워드가 3 일 이상 연속 등장 (예: `capex`, `regulation`, `tariff`).
- **모순**: 어제 narrative_score 와 오늘 narrative_score 의 부호가 반대이면서 절댓값 0.3 이상 변동.
- **섹터 동기화**: 3 종목 이상이 같은 매크로 이벤트(예: FOMC, 관세, 환율)로 동시에 같은 부호로 움직임.

## 5. Narrative Score 산출

다음 4 개 축으로 -1.0 ~ +1.0 점수, 단순 평균으로 종합:

| 축 | 음수(-) | 양수(+) |
|---|---|---|
| **earnings_outlook** | 가이던스 하향, 컨센서스 하회 | 가이던스 상향, 어닝 서프라이즈 |
| **competitive_position** | 점유율 하락, 경쟁사 약진 | 점유율 상승, 해자 강화 |
| **regulatory_risk** | 규제·소송 악재 | 규제 완화, 소송 승소 |
| **macro_sensitivity** | 금리·환율·관세 악영향 | 매크로 우호 환경 |

`narrative_score = round((earnings + competitive + regulatory + macro) / 4, 2)`

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

**narrative_score**: +0.15 (전일 +0.05, Δ +0.10)
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

## 7. JSON 저장 (대시보드용 최소 출력)

각 ticker 마다 다음 경로에 JSON 한 건 작성:

`data/news/{TICKER}/{YYYY-MM-DD}.json`

스키마 (이전과 동일, 변경 없음):

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

각 ticker 마다 `data/stocks/{TICKER}.json` 의 `valuation.qualitative` 서브블록 갱신 (이전과 동일):

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
      {"date": "2026-05-15", "narrative_score": -0.1},
      {"date": "2026-05-16", "narrative_score":  0.05}
    ]
  }
}
```

`history` 배열은 기존 값을 유지하면서 오늘 점수를 append (최근 30 개만 유지).

## 9. _dashboard.md 갱신 (한 번만)

9 종목 모두 처리한 뒤 `wiki/news/_dashboard.md` 의 "최신 스냅샷" 표를 다시 작성. 각 행:

```
| [AAPL](AAPL.md) | 2026-05-16 | +0.15 | iPhone 17 EU 출시, App Store 수수료 EU 조정안 | 3 |
```

(open claims 컬럼 = [미해결 가설] 의 pending 항목 수)

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
  message="[routine-news] daily watchlist update YYYY-MM-DD"
)
```

- 커밋 메시지 prefix `[routine-news]` 로 사람 작업과 구분.
- PR 만들지 않는다 — 개인 위키, 직접 main 푸시가 정책.
- 변경 없는 파일은 보내지 않는다.

### 10.2 indicator_dashboard 커밋 & 푸시 (`claude/news-daily` 브랜치)

```bash
git add data/news/ data/stocks/*.json
git commit -m "chore(news): daily qualitative analysis ($(date -u +%Y-%m-%d))"
git push origin claude/news-daily
```

변경된 파일이 없으면 (모든 ticker 빈 뉴스) 커밋하지 않는다.

### 10.3 PR 생성 또는 스킵 (indicator_dashboard 만)

`mcp__github__list_pull_requests` 로 `claude/news-daily` → `main` 열린 PR 확인.

- 이미 열려 있으면 그대로 둠.
- 없으면 `mcp__github__create_pull_request` 로 생성:
  - **repo**: `lukeeee73/indicator_dashboard`
  - **title**: `chore(news): daily qualitative analysis (YYYY-MM-DD ~)`
  - **head**: `claude/news-daily`
  - **base**: `main`
  - **body**: 아래 형식

```
## Daily Market Analysis

### 처리된 종목

| Ticker | 뉴스 건수 | narrative_score | 위키 |
|--------|-----------|-----------------|------|
| AAPL   | 3         | +0.10           | [AAPL.md](https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/AAPL.md) |
| ...    | ...       | ...             | ... |

### 오늘의 시그널 (위키 _dashboard.md 동기)
- ...

### 변경 파일
- data/news/{TICKER}/YYYY-MM-DD.json (9개)
- data/stocks/*.json (qualitative 블록 갱신)
- (위키 변경은 별도 레포 main 으로 직접 푸시됨 — 본 PR 에 포함되지 않음)

> 이 PR 은 머지 전까지 매일 자동으로 커밋이 추가됩니다.
```

---

## 안전 가이드라인

- **하루에 한 번만 실행한다.** 같은 날짜의 JSON 파일이 이미 있고 위키 [일자별 기록] 맨 위 헤더가 오늘이면 중복 실행으로 보고 종료.
- **유료 사이트(Bloomberg Terminal 등)는 시도하지 않는다.** 페이월 만나면 다음 소스로 넘어간다.
- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 해당 항목 제외.
- **개인 투자 조언 금지.** 점수와 요약만, "buy/sell" 권유 표현 금지.
- **fair use.** Tier-1 매체 헤드라인 요약은 OK, 본문 통째 복제 금지.
- **위키 사람 영역 건드리지 않는다.** `wiki/news/` 외 폴더는 절대 수정하지 않는다 (CLAUDE.md, index.md, domains/ 포함 — 인덱스는 사람이 promote 시 직접 갱신).
- **HTML 마커 보존.** `<!-- OPEN_CLAIMS_START -->` 등의 마커 라인은 절대 지우지 말 것 (다음 실행이 그 마커로 파싱한다).

## 실패 처리

- 특정 ticker 가 실패해도 나머지 처리는 계속 진행.
- 9 개 모두 실패 시 커밋·푸시 모두 스킵하고 종료.
- 위키 푸시 만 실패하면 JSON 은 그대로 푸시하고 위키 푸시는 다음날 재시도 (위키 파일은 멱등적으로 다시 작성되므로 안전).
- 어떤 단계에서 실패했는지 마지막에 콘솔에 요약 출력.

## 검증

저장 직전:

- JSON: `narrative_score` 가 -1.0 ~ +1.0 범위인지, `news[].url` 이 http(s):// 로 시작하는지, `news[].published` 가 ISO 8601 인지.
- 위키 마크다운: HTML 마커 4 개(`OPEN_CLAIMS_START/END`, `FACTS_START/END`, `DAILY_START/END`) 가 모두 보존되어 있는지. frontmatter `updated` 가 오늘 날짜인지.

위반 시 해당 항목 제외 후 재시도 또는 스킵.

---

## 첫 실행 시 (one-time bootstrap)

각 `wiki/news/{TICKER}.md` 의 [미해결 가설] / [사실 누적] / [일자별 기록] 섹션은 stub 상태(비어 있음). 첫 실행은 단순히 오늘 데이터로 [일자별 기록] 첫 항목을 만들고, 4.2 규칙으로 신규 가설들을 등록한다. 4.1 의 verified/refuted 처리는 둘째 실행부터 의미를 갖는다.
