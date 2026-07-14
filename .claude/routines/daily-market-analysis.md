# Daily Market Analysis Routine

이 문서는 Claude Code Routine 이 매일 한 번 실행할 때 따라야 할 작업 절차다.
**섹터별 watchlist 종목**의 뉴스를 수집·요약하고, 같은 섹터 경쟁사 동향과 함께
정성(qualitative) 평가를 산출해 두 레포 (`indicator_dashboard`, `Luke_wiki`) 에
누적한다.

> 📌 **시장 중심 시각화와의 관계:** 이 루틴(티커별)이 채우는 `narrative_score`
> 는 웹의 **'시장 지도'**(주식 탭 → 시장 지도, `data/markets/*.json`)에서 각
> 시장 노드별로 **자동 집계**된다. 시장 구조·규모·병목 상태와 *시장 단위*
> 헤드라인은 별도 루틴 `market-research/`(예: `ai-semiconductor.md`)가 관리한다.
> 이 두 파이프라인은 독립적이다 — 이 daily 루틴은 **그대로** 둔다.

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

watchlist 가 155 종목(18 섹터)으로 커졌으므로, 한 번에 전부 처리하지 않고
**요일별로 배정된 섹터만** 처리한다. 매핑은 `scripts/watchlist_data.py` 의
`DAY_OF_WEEK_SECTORS` 에 정의되어 있다 (월=0, ..., 일=6):

| 요일 | 처리 섹터 | 종목 수 |
|---|---|---|
| 월요일 | 빅테크 / 소프트웨어, AI 인프라 — 네트워킹 · 광 · 네오클라우드 | 10 + 5 |
| 화요일 | 반도체 — AI 칩 · 설계, 메모리 (HBM·DRAM), 파운드리 · 패키징 · 기판, 장비 · 소재 | 11 + 3 + 3 + 10 |
| 수요일 | 로보틱스 / 피지컬 AI, 자동차 / 모빌리티, 조선 (한국) | 5 + 10 + 4 |
| 목요일 | 바이오 / 제약 / 헬스케어 | 10 |
| 금요일 | 에너지 / 원자재, 유틸리티 / 전력, 전력 인프라 (AI) | 10 + 10 + 10 |
| 토요일 | 금융, 부동산 (REITs) | 10 + 10 |
| 일요일 | 소비재, 산업재 / 방산, 통신 / 미디어 | 10 + 14 + 10 |

> **이 표는 `scripts/watchlist_data.py` 의 `DAY_OF_WEEK_SECTORS` 와 항상
> 일치해야 한다.** 둘이 어긋나면 코드(watchlist_data.py)를 진실로 본다.

**18개 섹터 그룹** (`GROUPS`): 빅테크 / 소프트웨어, 반도체 — AI 칩 · 설계,
반도체 — 메모리 (HBM·DRAM), 반도체 — 파운드리 · 패키징 · 기판, 반도체 — 장비 · 소재,
AI 인프라 — 네트워킹 · 광 · 네오클라우드, 로보틱스 / 피지컬 AI, 자동차 / 모빌리티,
바이오 / 제약 / 헬스케어, 에너지 / 원자재, 금융, 소비재, 산업재 / 방산,
부동산 (REITs), 통신 / 미디어, 유틸리티 / 전력, 전력 인프라 (AI), 조선 (한국).

> 반도체 4개 그룹 + AI 인프라 그룹의 종목 구성은 **AI·반도체 시장지도**
> (`data/markets/ai-semiconductor.json`)의 시장 노드 플레이어와 1:1 로 동기화한다.
> 시장지도에 새 플레이어가 추가되면 watchlist 에도 추가하고 `in_watchlist` 를 켠다.

> ⏰ **루틴 스케줄 시간 주의**: 웹 루틴의 스케줄 시간은 사용자 로컬 시간대
> (KST)로 입력되지만, 이 표의 요일은 **UTC 요일** 기준이다. 루틴은 반드시
> **KST 09:00 이후** 시간에 스케줄해야 KST 요일 = UTC 요일이 일치한다
> (KST 00:00~08:59 는 UTC 로 전날 → 전날 섹터가 돌아간다).
> 루틴 등록 폼 입력값 전체는 [`SETUP.md`](SETUP.md) 참고.

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

권장 소스 (WebFetch / WebSearch 로 접근 가능):

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
| 빅테크 / 소프트웨어 | 시장 점유율, AI 제품/서비스 출시, 클라우드 가격 정책, 규제·소송 |
| 반도체 | 점유율 변화 (NVDA vs AMD), 신제품 출시, 공정 로드맵, 공급 부족·과잉 |
| 자동차 / 모빌리티 | EV 인도량, 가격 인하 경쟁, 자율주행 진척, 보조금·관세 |
| 바이오 / 제약 / 헬스케어 | 임상 데이터, FDA 승인·거절, 특허 만료, 가격 정책, M&A |
| 에너지 / 원자재 | 유가·구리·금 가격, OPEC+ 결정, 생산 가이던스, 인수합병 |
| 금융 | 금리 환경, 신용 손실 충당금, 대출 성장, M&A·자사주매입 |
| 소비재 | 동일 점포 매출, 마진 압박 (인플레이션), 가격 전가력 |
| 산업재 / 방산 | 수주 잔고, 국방예산 변화, 항공기 인도, 글로벌 인프라 투자 |
| 부동산 (REITs) | FFO 가이던스, 임대료·공실률, 금리 환경, 신규 공급 |
| 통신 / 미디어 | 가입자 순증, 구독 가격, 콘텐츠 투자, 광고 시장, 망 투자 |
| 유틸리티 / 전력 | 요금 결정, 신재생·원자력 비중, AI 데이터센터 전력수요, 금리 |
| 조선 (한국) | 신규 수주, LNG·암모니아 친환경 선박 점유율, 환율, 후판 가격 |

watchlist 외부 경쟁사 (예: NVDA 입장의 `INTC`, JNJ 입장의 `PFE`) 도
`COMPETITORS` 매핑에 있으면 적극적으로 활용해 비교 맥락을 풍부하게 한다.

### 3. Narrative score 산출

다음 4개 축으로 -1.0 ~ +1.0 점수를 매기고, **가중 평균**으로 종합 점수 도출:

| 축 | 가중치 | 음수(-) | 양수(+) |
|---|---|---|---|
| **earnings_outlook** | 0.40 | 가이던스 하향, 컨센서스 하회 | 가이던스 상향, 어닝 서프라이즈 |
| **competitive_position** | 0.25 | 점유율 하락, 경쟁사 약진 | 점유율 상승, 해자 강화 |
| **regulatory_risk** | 0.20 | 규제·소송 악재 | 규제 완화, 소송 승소 |
| **macro_sensitivity** | 0.15 | 금리·환율·관세·유가 악영향 | 매크로 우호 환경 |

종합 `narrative_score` =
`round(earnings*0.40 + competitive*0.25 + regulatory*0.20 + macro*0.15, 2)`

뉴스가 전혀 없는 종목은 `narrative_score = 0.0` 으로 두고 `note` 에 사유 명시.

**narrative_score 해석:**

| 범위 | 의미 |
|---|---|
| +0.20 ~ +1.0 | 강한 긍정 모멘텀 |
| +0.05 ~ +0.19 | 약한 긍정 |
| -0.04 ~ +0.04 | 중립 |
| -0.05 ~ -0.19 | 약한 부정 |
| -0.20 ~ -1.0 | 강한 부정 모멘텀 |

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
  "risks":      ["EU 규제 대응 지연 시 매출 둔화"],
  "wiki_url": "https://github.com/lukeeee73/luke_wiki/blob/{기본브랜치}/wiki/news/{TICKER}%20-%20{Company}.md"
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

> **이 블록은 직접 손으로 쓰지 않는다.** `scripts/merge_qualitative.py` 가
> `data/news/` 의 모든 `{TICKER}/{YYYY-MM-DD}.json` 을 읽어
> `data/stocks/{TICKER}.json` 의 qualitative 블록을 자동으로 채운다.
> 루틴은 4번에서 뉴스 JSON 만 정확히 쓰고, **반드시 아래 5.5 단계를 실행**하면 된다.

### 5.5 ⚠️ 뉴스를 stocks JSON 으로 병합 (대시보드 반영의 핵심 단계)

> **이 단계를 건너뛰면 뉴스가 대시보드에 절대 보이지 않는다.** 대시보드
> (`app.js`) 는 `data/stocks/{TICKER}.json` 의 `valuation.qualitative` 블록만
> 읽는다. `data/news/` 에 JSON 을 쓰는 것만으로는 대시보드가 갱신되지 않는다.
> (과거에 이 병합이 주간 GitHub Actions (`update.yml`, 월요일 1회) 에서만
> 돌아서, 화~일요일에 수집한 뉴스가 다음 월요일까지 대시보드에 반영되지 않는
> 버그가 있었다. 그래서 **매일 도는 이 루틴이 직접 병합을 실행해야 한다.**)

4번에서 오늘 뉴스 JSON 을 모두 쓴 직후, 커밋(7번) 전에 **반드시** 실행한다:

```bash
python scripts/merge_qualitative.py
```

이 명령이 `data/news/` 전체를 읽어 모든 `data/stocks/{TICKER}.json` 의
`valuation.qualitative` (as_of / narrative_score / summary_kr / key_events /
risks / news_count / competitor_context / history) 를 최신 뉴스로 갱신한다.

**검증:** 실행 후 오늘 처리한 섹터의 종목 몇 개를 골라
`valuation.qualitative.as_of` 가 오늘 날짜(또는 그 종목의 최신 뉴스 날짜)와
일치하는지 확인한다. 일치하지 않으면 4번 JSON 작성이나 병합이 실패한 것이므로
커밋하지 말고 원인을 찾는다.

### 6. Luke_wiki 갱신 — ✍️ 투자 브리핑 v2 형식 (2026-07-07~)

> **글쓰기 형식의 단일 기준은 `Luke_wiki/wiki/news/FORMAT.md` ("투자 브리핑 v2")다.**
> 위키에 쓰기 전에 반드시 그 파일을 읽고 따른다. 핵심 3원칙:
> ① **쉬운 한국어** — 영문 헤드라인은 번역해서 쓰고, 전문용어는 첫 등장에 괄호
> 한 줄 풀이(`HBM(AI 칩 옆에 붙는 초고속 메모리)`). 새 용어를 쓰면
> `Luke_wiki/wiki/news/glossary.md` 에도 한 줄 추가한다.
> ② **So-What 3단** — 모든 뉴스는 "무슨 일 → 왜 중요 → 주가에 의미"로 쓴다.
> ③ **다음 행동 연결** — 엔트리는 "앞으로 지켜볼 것"(날짜 있는 이벤트 + 확인할 것)으로 끝낸다.
> `impact: +`, `category: product` 같은 **기계용 태그는 위키 본문에 쓰지 않는다**
> (4번의 JSON 에만 남긴다). 2026-07-06 이전의 옛 형식 항목은 재작성하지 않는다.

`Luke_wiki/wiki/news/tickers/{TICKER} - {Company}.md` 의 다음 섹션을 갱신
(파일명은 티커 + 공백·하이픈·공백 + 정식 회사명, 예:
`XOM - Exxon Mobil Corporation.md`, `000270.KS - Kia Corporation.md`):

- **미해결 가설 (Open Claims)**: 어제까지의 `[ ]` 항목을 오늘 뉴스로
  verified / refuted / aged-out 판정. 새 가설(7일 검증 대기)을 추가.
  v2 문체: 쉬운 질문형 + 판정 기준 명시 —
  `- [ ] **날짜**: (질문) — 이렇게 확인된다: ... (시한 M/D)`
- **사실 누적 (Verified Facts)**: Tier-1 매체 2 곳 이상 또는 회사 IR/공시로
  확정된 사실을 `[!fact]` 블록으로 추가. v2 문체: 쉬운 문장 + "왜 중요:" 한 줄 —
  `> [!fact] (제목) — 확인일 · 출처들` / `> (내용). 왜 중요: (의미).`
- **일자별 기록 (역순)**: 오늘 날짜 섹션을 맨 위에 prepend. **v2 엔트리 템플릿:**

  ```markdown
  ### YYYY-MM-DD (요일) — 신호등: 🟢 순풍 (+0.XX)

  **세 줄 요약**
  1. (무슨 일이 있었는지 — 전문용어 없이)
  2. (그게 왜 중요한지)
  3. (그래서 지금 어떤 상태인지)

  **뉴스 브리핑**

  **① 한국어로 번역한 제목** 🟢
  - **무슨 일**: 사건 한두 문장, 쉬운 말로.
  - **왜 중요**: 이 회사의 돈 버는 능력·경쟁력·리스크에 갖는 의미.
  - **주가에 의미**: 단기/장기 호재·악재·중립 + 이유 한 줄.
  - 출처: [매체명](URL) · YYYY-MM-DD

  **경쟁 구도 한눈에**  ← 경쟁사 뉴스가 있을 때만
  - (경쟁사 사건) → (이 회사에 유리/불리한 이유 한 문장).

  **앞으로 지켜볼 것**
  - [ ] M/D (이벤트) — 확인할 것: (그날 무엇을 보면 되는지)
  ```

  - 머리글 신호등 매핑: |score| ≥ 0.20 → 🟢🟢 강한 순풍 / 🔴🔴 강한 역풍,
    0.05~0.19 → 🟢 순풍 / 🔴 역풍, -0.04~+0.04 → ⚪ 잔잔함. 점수는 괄호 안에만.
  - 뉴스는 **하루 최대 4건** — 넘으면 덜 중요한 것을 버린다 (선별이 곧 정보다).
    뉴스별 개별 신호등(🟢/⚪/🔴)을 제목 뒤에 붙인다.
  - "앞으로 지켜볼 것"의 지난 항목이 오늘 확인됐으면 결과를 한 줄 덧붙인다.
  - callout 문법은 Obsidian 호환: `> [!claim]`, `> [!fact]`, `> [!info]`.

마커 (`<!-- DAILY_START -->`, `<!-- OPEN_CLAIMS_START -->`,
`<!-- FACTS_START -->` 등) **사이에만** 쓰고, 마커 자체와 기존 항목은 보존.
frontmatter 의 `updated` 를 오늘 날짜로 갱신한다.

`Luke_wiki/wiki/news/_dashboard.md` 의 표를 갱신:
- 각 ticker 행에 오늘의 `as_of`, score, 핵심 한 줄, open claims 수 채움.
- **score 칸은 신호등을 붙여 쓴다**: `🟢 +0.24`, `🔴🔴 -0.31` (수집 전이면 `—`).
- **핵심 한 줄은 전문용어 없는 완성 문장**으로 — 태그 나열("A·B·C, D 리스크")이
  아니라 "무슨 일이 있었고 그래서 어떤 상태다"가 읽히게.
- 표는 **섹터 그룹별 헤더**로 나뉘어 있다 (예: `### 반도체`,
  `### 에너지 / 원자재`). 헤더는 보존하고 **오늘 처리한 섹터 행만** 갱신.
- watchlist 가 늘었는데 dashboard 에 행이 없다면 해당 섹터 그룹 헤더 아래에
  새 행을 추가.

> 종목 파일이 없으면 (`wiki/news/tickers/{TICKER} - {Company}.md` 미생성) 기존
> 파일(예: `AAPL - Apple Inc.md`) 의 구조를 복사해서 새로 만든다.
> frontmatter 의 `tags` 에 `[routine-news, watchlist, {TICKER}]`,
> `type: claim`, `confidence: low` 를 포함한다 (사람-작성 영역과 구분).
> **같은 티커의 파일을 두 개 만들지 않는다** — 회사명 표기가 달라도 기존
> 티커 파일 하나를 갱신한다.

### 6.5 시장 노드 종합 파일 갱신 (`wiki/news/markets/`) — 정확성 중심

오늘 처리한 종목이 속한 **시장지도 노드의 종합 페이지**를 갱신한다.
파일 경로 계약: `Luke_wiki/wiki/news/markets/{map_id}/{market_id}.md`
(현재 운영: `ai-semiconductor/` — 대시보드에서 시장 노드를 클릭하면 이 파일이 지도 아래에 표시된다).

1. `data/markets/ai-semiconductor.json` 의 `markets[].players[]` 에서
   **오늘 처리한 티커가 플레이어로 등장하는 시장 노드**를 모두 찾는다
   (한 종목이 여러 노드에 속할 수 있다 — 예: 삼성전자는 hbm·dram-nand·foundry·edge-smartphone).
2. 각 해당 파일의 `<!-- PLAYERS_START/END -->` 사이 [소속 기업 동향] 표에서
   그 티커 행의 **최근 시그널 (score, as_of)** 과 **핵심 한 줄**을 갱신한다.
   - 값은 방금 갱신한 티커 로그·`_dashboard.md` 와 **정확히 일치**해야 한다
     (여기서 새로 요약을 창작하지 않는다 — 티커 로그가 원본).
3. 오늘 뉴스 중 **시장 전체 구조에 관한 사실**이 Tier-1 2곳 이상으로 확정되면
   `<!-- FACTS_START/END -->` 의 [사실 누적]에 `[!fact]` 로 추가한다 (출처 명시).
4. frontmatter `updated` 를 오늘 날짜로 갱신한다.

**건드리지 않는 것** (market-research 루틴 몫): [시장 정의], [병목 상태],
[시장 상황 종합](`SYNTHESIS`), [시장 뉴스 로그](`MARKET_NEWS`).

> **정확성 규칙**: 이 파일은 판단이 아니라 **종합**이다. 출처 URL 없는 문장을
> 쓰지 않고, 티커 로그·지도 JSON 과 어긋나는 수치를 만들지 않는다. 확신이
> 없으면 비워두는 쪽을 택한다.

---

## 7. Git commit & push — **세션 브랜치에 그대로 push**

> ⚠️ **여기를 함부로 "고정 브랜치 이름"으로 바꾸지 말 것.** (과거에 이걸
> 반복적으로 잘못 고쳐서 매번 결과물이 사라졌다.)
>
> Claude Code 가 **웹/클라우드 세션**으로 실행되면, 하니스가 **세션 시작 시
> 자동으로 일회용 세션 브랜치** (`claude/<랜덤>-<id>`) 를 만들어 거기에
> 체크아웃해 둔다. 그리고 "지정된 세션 브랜치 외 다른 브랜치에 push 하지
> 말라"는 규칙이 루틴보다 우선한다. 따라서 루틴에 어떤 브랜치 이름을
> 적어두든 **그 이름은 무시되고** 커밋은 세션 브랜치에 쌓인다.
>
> → 해결책은 브랜치 이름을 바꾸는 게 **아니라**, push 후 그 세션 브랜치를
> **기본 브랜치로 PR 병합**하는 단계(8번)를 두는 것이다.

각 레포에서 **현재 체크아웃된 세션 브랜치를 런타임에 감지**해서 거기에 push 한다.
브랜치 이름을 하드코딩하지 않는다.

```bash
# 현재 세션 브랜치 감지 (하드코딩 금지)
SESSION_BRANCH=$(git branch --show-current)

# ⚠️ 5.5 단계(merge_qualitative.py)를 먼저 실행했는지 반드시 확인할 것.
# 안 했으면 data/stocks/*.json 이 갱신되지 않아 대시보드에 뉴스가 안 보인다.
# indicator_dashboard
git add data/news/ data/stocks/*.json .claude/routines/daily-market-analysis.md
git commit -m "chore(news): daily qualitative analysis ($(date -u +%Y-%m-%d), {오늘섹터})"
git push -u origin "$SESSION_BRANCH"

# Luke_wiki (해당 레포 디렉토리에서 동일하게)
SESSION_BRANCH=$(git branch --show-current)
git add wiki/news/
git commit -m "[routine-news] daily watchlist update $(date -u +%Y-%m-%d) ({오늘섹터})"
git push -u origin "$SESSION_BRANCH"
```

변경된 파일이 없으면 (모든 ticker 가 빈 뉴스) 해당 레포는 커밋·푸시하지 않는다.

## 8. PR 생성 → 기본 브랜치로 병합 (auto-merge)

> 이 단계가 핵심이다. 세션 브랜치는 일회용이라 사용자가 보지 않는다.
> **결과물을 사용자가 보는 "기본 브랜치"에 모으려면 매 실행마다 PR 로 병합**한다.
> (사용자가 이 PR-병합 방식을 명시적으로 승인했다.)

각 레포의 **기본(default) 브랜치** = 대시보드·위키가 실제로 읽어가는 곳:

| 레포 | 기본 브랜치 (병합 도착지 `base`) |
|---|---|
| `lukeeee73/Indicator_dashboard` | `claude/build-indicators-pipeline-QFtLk` |
| `lukeeee73/luke_wiki` | `claude/create-knowledge-repo-2LeNp` |

> ⚠️ 이 레포들에는 `main` 브랜치가 **존재하지 않는다.** 위 `claude/*` 브랜치가
> 각 레포의 실제 default 브랜치다. 확실치 않으면
> `git remote show origin | grep "HEAD branch"` 로 확인한 뒤 그 값을 `base` 로 쓴다.

커밋 & 푸시가 성공한 레포에 대해서만, 다음을 수행한다:

1. **PR 생성** — `mcp__github__create_pull_request`
   - `head` = 7번에서 push 한 **세션 브랜치**
   - `base` = 위 표의 **기본 브랜치**
   - `title` = 7번 커밋 메시지와 동일
   - `body` = 아래 형식 (오늘 처리한 섹터만)
2. **즉시 병합** — `mcp__github__merge_pull_request`
   - `merge_method` = `squash` (기본 브랜치 히스토리를 하루 한 커밋으로 깔끔하게)
   - 병합 충돌이 나면 (드묾) `mcp__github__update_pull_request_branch` 로 base 를
     세션 브랜치에 먼저 머지한 뒤 재시도.
3. **확인** — 병합 후 기본 브랜치에 오늘 파일이 들어갔는지 확인하고 6번 보고에 SHA 기록.

> 세션 브랜치를 base 로 직접 `git push` 하려 하지 말 것 — 하니스가 막는다.
> 반드시 위 **PR 생성 → 병합** 경로(서버 측 병합)로만 기본 브랜치를 갱신한다.

**PR body 형식:**

```markdown
## Daily Market Analysis — {요일} ({처리한 섹터들})

### 처리된 종목

#### {오늘의 섹터 1}
| Ticker | 뉴스 건수 | narrative_score |
|--------|-----------|-----------------|
| AAPL   | 3         | +0.10           |
| ...    | ...       | ...             |

#### {오늘의 섹터 2}  (해당 요일에 2개 이상 섹터가 배정된 경우만)
...

> 다른 섹터는 다른 요일에 처리됨 — `.claude/routines/daily-market-analysis.md`
> 의 요일별 라운드로빈 표 참고. 7일에 한 번 모든 섹터가 한 바퀴 돈다.

### 주요 이슈
오늘 가장 큰 이슈 2~3개를 bullet point 로 요약 (한국어). 가능하면 섹터
연쇄 효과 (예: "NVDA 가이던스 상향 → 반도체 섹터 동조 상승") 도 표기.

### 변경 파일
- data/news/{TICKER}/YYYY-MM-DD.json (N 개, 오늘 섹터만)
- data/stocks/*.json (해당 섹터 종목의 qualitative 블록 갱신)
```

## 9. 완료 보고

두 레포 병합이 끝나면 콘솔에 다음을 출력한다:

```
## Daily Market Analysis Complete
날짜: <analysis_date> (<요일>)
처리 섹터: <오늘의 섹터들>
처리 종목: <N>

### Push & Merge 결과
| 레포 | 세션 브랜치 | 병합 도착(기본) | 파일 수 | 병합 SHA |
|------|------------|----------------|---------|----------|
| Indicator_dashboard | claude/...-xxxx | build-indicators-pipeline-QFtLk | N | <sha> |
| luke_wiki           | claude/...-yyyy | create-knowledge-repo-2LeNp     | N | <sha> |

### Score 요약
| Ticker | Score | 핵심 시그널 |
|--------|-------|-------------|
...
```

---

## 안전 가이드라인

- **하루에 한 번, 오늘 요일에 배정된 섹터만 실행한다.** 같은 날짜 파일이 이미
  있으면 덮어쓰지 않고 종료.
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
- 오늘 섹터 전부 실패 시 커밋하지 않고 종료한다.
- 어떤 단계에서 실패했는지 마지막에 콘솔에 요약 출력한다.
- 새로 추가된 종목의 뉴스 소스가 정상 응답하지 않으면 (예: 신규 상장이라
  뉴스 누적 부족) 빈 뉴스 데이로 기록하고 계속 진행한다.
- PR 병합이 실패하면 (충돌·권한) 세션 브랜치 push 까지는 보존되므로,
  실패 사유를 보고하고 사람이 수동 병합할 수 있게 PR URL 을 남긴다.

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
     에서 어떤 요일에 처리할지 배정 (+ 위 0번 표도 같이 갱신).

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

4. **Luke_wiki 의 `wiki/news/{TICKER} - {Company}.md` 신규 생성**
   루틴이 다음 실행에서 자동으로 만들어주지만, 미리 만들어두고 싶다면
   기존 파일(예: `wiki/news/AAPL - Apple Inc..md`) 을 복사해 frontmatter 의
   ticker / subtitle 만 바꾼다. `_dashboard.md` 표 행도 해당 섹터 헤더 아래에
   추가한다 (없으면 루틴이 자동 추가).

5. 다음 주간 GitHub Actions 실행 (`update.yml`) 이 자동으로 종목 데이터를
   채워준다. 그 이후 첫 daily routine 실행이 (해당 종목의 요일 차례에)
   뉴스를 누적하기 시작한다.

루틴 자체는 이 모든 단계를 마치고 나면 코드 수정 없이 새 종목을 인식한다.
