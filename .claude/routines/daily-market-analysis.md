# Daily Market Analysis Routine

이 문서는 Claude Code Routine 이 매일 한 번 실행할 때 따라야 할 작업 절차다.
**섹터별 watchlist 종목**의 뉴스를 수집·요약하고, 같은 섹터 경쟁사 동향과 함께
정성(qualitative) 평가를 산출해 두 레포 (`indicator_dashboard`, `Luke_wiki`) 에
누적한다.

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

## 0. 요일별 섹터 라운드로빈 (NEW)

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

## 작업 순서

### 1. 각 종목의 최근 뉴스 수집

각 ticker 에 대해 다음 소스에서 **최근 24시간 뉴스 3~5건**을 수집한다.

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
- 헤드라인이 광고·추천형이면 (예: "10 stocks to buy") 제외
- 동일 사건의 중복 기사면 가장 신뢰도 높은 한 건만 채택
  - Tier-1: Reuters / Bloomberg / WSJ / FT / NYT / 회사 IR
  - Tier-2: CNBC / Barron's / Forbes / Yahoo Finance / 연합뉴스 / 한국경제 / 매일경제
- 24시간 내 새 뉴스가 없으면 빈 배열로 두고 `note` 필드에 명시
- **섹터 헤드라인** (예: 반도체 업황, 비만치료제 임상 데이터, 유가) 도 해당
  섹터의 모든 종목에 영향을 주므로 적극적으로 채택한다.

### 2. 경쟁사 동향 비교

각 ticker 의 경쟁사 목록 (`competitors_in_watchlist` 또는
`scripts/competitors.py` 의 `COMPETITORS[ticker]`) 에 따라, 같은 24시간 내
경쟁사의 주요 뉴스 1~2건을 요약하라. 비교 관점은 섹터별로 다음 중 가장 관련
있는 것을 채택한다:

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

watchlist 외부 경쟁사 (예: NVDA 입장의 `INTC`, JNJ 입장의 `PFE`) 도
`COMPETITORS` 매핑에 있으면 적극적으로 활용해 비교 맥락을 풍부하게 한다.

### 3. Narrative score 산출

다음 4개 축으로 -1.0 ~ +1.0 점수를 매기고, 단순 평균으로 종합 점수 도출:

| 축 | 음수(-) | 양수(+) |
|---|---|---|
| **earnings_outlook** | 가이던스 하향, 컨센서스 하회 | 가이던스 상향, 어닝 서프라이즈 |
| **competitive_position** | 점유율 하락, 경쟁사 약진 | 점유율 상승, 해자 강화 |
| **regulatory_risk** | 규제·소송 악재 | 규제 완화, 소송 승소 |
| **macro_sensitivity** | 금리·환율·관세·유가 악영향 | 매크로 우호 환경 |

종합 `narrative_score` = `round((earnings + competitive + regulatory + macro) / 4, 2)`

뉴스가 전혀 없는 종목은 `narrative_score = 0.0` 으로 두고 `note` 에 사유 명시.

### 4. JSON 파일 저장 (indicator_dashboard 레포)

각 ticker 마다 다음 경로에 JSON 한 건 작성:
`data/news/{TICKER}/{YYYY-MM-DD}.json`

> **티커에 점이 포함된 한국 종목** (예: `329180.KS`) 도 디렉토리명에
> 그대로 사용한다: `data/news/329180.KS/2026-05-16.json`. 파일 시스템과
> `merge_qualitative.py` 모두 점을 정상 처리한다.

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

각 ticker 마다 `data/stocks/{TICKER}.json` 의 `valuation` 블록에 `qualitative`
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

> 자동화 가능: `scripts/merge_qualitative.py` 가 `data/news/` 의 모든
> `{TICKER}/{YYYY-MM-DD}.json` 을 읽어 `data/stocks/{TICKER}.json` 의
> qualitative 블록을 자동으로 채운다. 루틴은 JSON 만 정확히 쓰면 된다.

### 6. Luke_wiki 갱신

`Luke_wiki/wiki/news/{TICKER}.md` 의 다음 섹션을 갱신:

- **미해결 가설 (Open Claims)**: 어제까지의 `[ ]` 항목을 오늘 뉴스로
  verified / refuted / aged-out 판정. 새 가설(7일 검증 대기)을 추가.
- **사실 누적 (Verified Facts)**: Tier-1 매체 2 곳 이상 또는 회사 IR/공시로
  확정된 사실을 `[!fact]` 블록으로 추가.
- **일자별 기록 (역순)**: 오늘 날짜 섹션을 맨 위에 prepend.
  - `narrative_score`, `key_events`, `risks` 헤더 + `[!claim]` 인용 블록 모음.

마커 (`<!-- DAILY_START -->` 등) 사이에만 쓰고, 마커 자체는 보존.

`Luke_wiki/wiki/news/_dashboard.md` 의 표를 갱신:
- 각 ticker 행에 오늘의 `as_of`, `narrative_score`, 핵심 한 줄, open claims 수 채움.
- 표는 **섹터 그룹별 헤더**로 나뉘어 있을 수도 있다 (예: `### 반도체`,
  `### 바이오 / 제약`). 헤더는 보존하고 행만 갱신.
- watchlist 가 늘었는데 dashboard 에 행이 없다면 해당 섹터 그룹 헤더 아래에
  새 행을 추가.

> 종목 파일이 없으면 (`wiki/news/{TICKER}.md` 미생성) `wiki/news/_TEMPLATE.md`
> 또는 기존 `AAPL.md` 의 구조를 복사해서 새로 만든다. frontmatter 의
> `tags` 에 `[routine-news, watchlist, {TICKER}]` 를 포함한다.

### 7. Git commit & push

각 레포에서 고정 브랜치 하나만 사용한다. 브랜치가 없으면 자동 생성된다.

- `indicator_dashboard`: `claude/news-daily`
- `Luke_wiki`: `claude/news-daily`

```bash
# indicator_dashboard
git add data/news/ data/stocks/*.json
git commit -m "chore(news): daily qualitative analysis ($(date -u +%Y-%m-%d))"
git push origin claude/news-daily

# Luke_wiki
git add wiki/news/
git commit -m "chore(news): daily watchlist news ($(date -u +%Y-%m-%d))"
git push origin claude/news-daily
```

변경된 파일이 없으면 (모든 ticker 가 빈 뉴스) 해당 레포는 커밋하지 않는다.

### 8. Pull Request 생성 또는 스킵

커밋 & 푸시가 성공한 경우에만 실행한다.

**먼저** `mcp__github__list_pull_requests` 로 각 레포의 `claude/news-daily` →
`main` 방향 열린 PR 이 있는지 확인.

- **PR 이 이미 열려 있으면**: 아무것도 하지 않는다 (푸시한 커밋이 자동 반영).
- **PR 이 없으면**: `mcp__github__create_pull_request` 로 새 PR 을 생성한다.
  - **title**: `chore(news): daily qualitative analysis (YYYY-MM-DD ~)`
  - **head**: `claude/news-daily`
  - **base**: `main`
  - **body**: 다음 형식으로 작성. 오늘 처리한 섹터만 포함한다 (요일 라운드로빈):

```markdown
## Daily Market Analysis — {요일} ({처리한 섹터들})

### 처리된 종목

#### {오늘의 섹터 1}
| Ticker | 뉴스 건수 | narrative_score |
|--------|-----------|-----------------|
| AAPL   | 3         | +0.10           |
| ...    | ...       | ...             |

#### {오늘의 섹터 2}  (해당 요일에 2개 섹터가 배정된 경우만)
...

> 다른 섹터는 다른 요일에 처리됨 — `.claude/routines/daily-market-analysis.md`
> 의 요일별 라운드로빈 표 참고.

### 주요 이슈
오늘 가장 큰 이슈 2~3개를 bullet point 로 요약 (한국어). 가능하면 섹터
연쇄 효과 (예: "NVDA 가이던스 상향 → 반도체 섹터 동조 상승") 도 표기.

### 변경 파일
- data/news/{TICKER}/YYYY-MM-DD.json (N 개, 오늘 섹터만)
- data/stocks/*.json (해당 섹터 종목의 qualitative 블록 갱신)

> 이 PR 은 머지 전까지 매일 자동으로 커밋이 추가됩니다.
> 7일에 한 번 모든 섹터가 한 바퀴 돕니다.
```

---

## 안전 가이드라인

- **하루에 한 번만 실행한다.** 같은 날짜 파일이 이미 있으면 덮어쓰지 않고 종료.
- **유료 사이트는 시도하지 않는다.** 무료로 접근 가능한 소스만 사용. 페이월
  만나면 다음 소스로 넘어간다.
- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 해당 뉴스 항목은 제외.
- **개인 투자 조언 금지.** 점수와 요약만 제공하고 "buy/sell" 같은 권유 표현은
  쓰지 않는다.
- **민감 정보 주의.** Tier-1 매체의 헤드라인 요약 정도는 fair use 에 해당하지만
  본문 통째로 복제하지 않는다.
- **종목 가산점·차별 금지.** 모든 watchlist 종목에 동일한 기준 적용. 특정
  섹터·종목에 점수 보너스를 주지 않는다.

---

## 실패 처리

- 특정 ticker 가 실패해도 나머지 처리는 계속 진행한다.
- watchlist 전부 실패 시 커밋하지 않고 종료한다.
- 어떤 단계에서 실패했는지 마지막에 콘솔에 요약 출력한다.
- 새로 추가된 종목의 뉴스 소스가 정상 응답하지 않으면 (예: 신규 상장이라
  뉴스 누적 부족) 빈 뉴스 데이로 기록하고 계속 진행한다.

## 검증

저장 직전 각 JSON 에 대해:

- `narrative_score` 가 -1.0 ~ +1.0 범위인지
- `news[].url` 이 http(s):// 로 시작하는지
- `news[].published` 가 ISO 8601 형식인지
- `ticker` 필드가 `data/index.json` 의 stocks[] 코드 중 하나인지

위반 시 해당 항목 제외 후 재시도 또는 스킵.

---

## 종목·섹터 추가 가이드 (사람용)

새 종목·섹터를 watchlist 에 추가하고 싶다면, **`scripts/watchlist_data.py`
단 한 파일만** 편집한다:

1. **`scripts/watchlist_data.py` 의 `STOCKS` 리스트에 한 줄 추가**
   ```python
   ("TICKER", "Full Name", "GICS Sector EN", "한국어 그룹",
    "한국어 섹터 부제", "#color", decimals, "USD"|"KRW",
    "초보자도 이해 가능한 사업 모델 한 줄 설명"),
   ```
   - `GICS Sector EN` 은 `scripts/valuation.py` 의 `SECTOR_PE_BENCHMARK`
     키 중 하나 (Technology / Healthcare / Energy / Materials / ...).
   - `한국어 그룹` 은 `GROUPS` 리스트에 정의된 그룹명과 일치해야 함.
     새 그룹을 만들고 싶으면 `GROUPS` 에 한 줄 추가 + `DAY_OF_WEEK_SECTORS`
     에서 어떤 요일에 처리할지 배정.

2. **`scripts/watchlist_data.py` 의 `COMPETITORS` 에 경쟁사 목록 추가**
   (watchlist 내 종목 + 일부 외부 peer 모두 OK)

3. **재생성 명령 실행**
   ```bash
   python scripts/gen_watchlist.py
   ```
   이 한 줄이 다음을 모두 갱신한다:
   - `scripts/fetch_fred.py` 의 `STOCKS`
   - `scripts/competitors.py` 의 `COMPETITORS`
   - `app.js` 의 `STOCK_META` / `STOCK_GROUPS` / `PEER_COMPETITORS`

4. **Luke_wiki 의 `wiki/news/{TICKER}.md` 신규 생성**
   루틴이 다음 실행에서 자동으로 만들어주지만, 미리 만들어두고 싶다면
   기존 파일(예: `wiki/news/AAPL.md`) 을 복사해 frontmatter 의 ticker /
   subtitle 만 바꾼다. `_dashboard.md` 표 행도 해당 섹터 헤더 아래에
   추가한다 (없으면 루틴이 자동 추가).

5. 다음 주간 GitHub Actions 실행 (`update.yml`) 이 자동으로 종목 데이터를
   채워준다. 그 이후 첫 daily routine 실행이 (해당 종목의 요일 차례에)
   뉴스를 누적하기 시작한다.

루틴 자체는 이 모든 단계를 마치고 나면 코드 수정 없이 새 종목을 인식한다.
