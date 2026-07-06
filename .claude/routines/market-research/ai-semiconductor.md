# Market Research Routine — AI · 반도체

이 루틴은 **AI·반도체 산업을 '시장(수요)' 단위로** 추적해 두 파일을 최신으로 유지한다:

| 파일 | 내용 |
|---|---|
| `data/markets/ai-semiconductor.json` | 시장 구조 — 노드·층·링크·병목·플레이어·weekly_note |
| `data/markets/news/ai-semiconductor.json` | **시장 단위 뉴스 스토어** — 시장 id 별 뉴스 배열(최신순, 시장당 최대 20개 보관) + **signals 방향성 태그** |
| `data/markets/criteria/ai-semiconductor.json` | **시장별 병목 판정 기준** — 핵심 지표·승급/완화 조건·키워드 (병목 기준은 시장마다 다르다) |
| `data/markets/analysis/ai-semiconductor.json` | `scripts/market_pulse.py` 산출물 — 병목 압력·수요 모멘텀·전이 **제안**·병목 이동 경보 (직접 편집 금지, 스크립트가 생성) |

웹 대시보드 **주식 탭 → '시장 지도'** 가 두 파일을 읽어, 뉴스를 세 곳에 꽂아 보여준다:
노드 배지(건수·최신일) · 노드 클릭 상세(최신 6개+더보기) · 보드 하단 통합 뉴스 피드(클릭 → 해당 시장 선택).

> 먼저 `./README.md`(데이터 모델·두 파이프라인 관계)를 읽어라.
> 티커별 일일 뉴스는 `../daily-market-analysis.md` 가 따로 처리한다 — **건드리지 않는다.**

---

## 0. 이 맵의 구조 (수요 → 공급, 6개 층)

| 층 | id | 무엇 |
|---|---|---|
| ① 최종 수요 | `demand` | AI 모델·스마트폰·PC·차량·산업로봇·휴머노이드·군용드론·국방 AI(C2)·소버린 AI |
| ② 자본 엔진 | `capital` | 하이퍼스케일러 CAPEX·네오클라우드(GPU 클라우드) |
| ③ AI 컴퓨팅 | `compute` | AI 가속기(GPU)·맞춤형 ASIC·네트워킹 |
| ④ 핵심 부품(병목) | `components` | HBM·첨단 패키징·범용 DRAM/NAND·광·전력공급/냉각·로봇 구동부품·로봇 센서 |
| ⑤ 제조 기반 | `manufacturing` | 첨단 파운드리·ABF 기판 |
| ⑥ 장비·소재·전력 | `foundation` | EUV·식각/증착·계측·소재·전력 생산/전력망·DC 인프라/코로케이션 |

**가장 중요한 산출물은 `bottleneck` 상태와 시장 뉴스 스토어다.** 규모 수치는
분기마다 갱신하면 충분하지만, **병목은 빠르게 변한다**(예: 2024 CoWoS 급성 →
2026 완화, HBM·전력으로 이동). 병목의 이동을 잡아내는 게 이 루틴의 핵심 가치다.

---

## 1. 실행 카데런스

- **권장: 주 1회** (예: 매주 토요일) 전체 30개 시장 점검.
- 또는 사용자가 "AI·반도체 시장 지도 업데이트" 라고 지시할 때 on-demand.
- 큰 이벤트(엔비디아 실적, 메모리 가격 급변, 신규 수출통제) 직후엔 즉시.

> 같은 날 이미 갱신된 시장은 덮어쓰지 말고, **변화가 있을 때만** 수정한다.

---

## 2. 작업 순서

### 2.1 현재 맵 로드 + 자동 신호 확인
`data/markets/ai-semiconductor.json` 과 `data/markets/news/ai-semiconductor.json` 을
읽어 각 시장의 현재 `size_label / growth / bottleneck / players / weekly_note / as_of`
와 누적 뉴스를 파악한다. 그리고 **자동 병목 신호를 먼저 돌려 리서치 우선순위를 잡는다**:

```bash
python scripts/market_pulse.py --industry ai-semiconductor
```

`data/markets/analysis/ai-semiconductor.json` 의 다음 항목이 이번 주 점검 우선순위다:
- `alerts[]` 의 `severity_change_proposed` — 뉴스 신호가 임계를 넘은 시장. **이번 리서치에서 반드시 교차 검증한다.**
- `alerts[]` 의 `bottleneck_migration` — 완화 중 시장의 인접 시장이 조여옴 (병목 이동 후보. 예: 2024 CoWoS → 2026 HBM·전력).
- `top_focus[]` — 병목 압력 + 성장 전망 복합 상위 시장.
- `markets.<id>.status == "no_signals"` 가 오래 지속되는 시장 — 뉴스 스토어가 굶고 있다는 뜻. 이번 주 리서치 대상에 포함.

### 2.2 시장별 리서치 (web)
각 시장(또는 이번에 점검할 부분집합)에 대해 **최근 1~4주** 변화를 조사한다.
무료로 접근 가능한 신뢰 소스 우선:

- 업계 트래커: TrendForce, Counterpoint, Yole, SemiAnalysis, Epoch AI,
  Dell'Oro, LightCounting, SEMI, IEA
- 1차: 기업 IR/실적, 보도자료, Reuters/Bloomberg
- 페이월·유료는 건너뛰고 다음 소스로.

각 시장에서 다음을 갱신 후보로 본다:
- **병목 상태 변화** (severity 승급/완화, limit 문구) ← 최우선
- **이번 주 시장 흐름** (`weekly_note`) — 그 주의 분위기·변화를 1~2문장으로 ← 매주
- 시장 규모/성장 (`size_label`, `growth`, 필요시 `size_usd_b`, `size_confidence`)
- 플레이어 점유율 (`players[].share`, %) · 신제품·수율·할당 변화 (`players[].role`)
- 시장 단위 헤드라인 (뉴스 스토어 `markets.<id>[]`)

### 2.3 JSON 갱신
**검증된, 출처 있는 변화만** 반영한다.

- 병목: `bottleneck.severity` 는 `severity_legend` 키 중 하나
  (`structural|acute|easing|emerging|demand_limited`). `limit` 은 *왜* 병목인지
  기술적/물리적 근거를 한 문장으로.
  - **severity 변경 절차 (탐지↔판단 분리)**: market_pulse 의
    `severity_change_proposed` 제안은 **웹 리서치로 교차 검증된 경우에만** 지도에
    반영한다 (제안의 evidence + 독립 소스 1개 이상). 제안 없이 직접 바꾸는 것도
    가능하지만, 그 경우 근거 뉴스를 뉴스 스토어에 signals 와 함께 먼저 넣는다 —
    지도와 신호가 따로 놀지 않게.
  - `structural`(구조적 독점) 승급/해제는 자동 제안 대상이 아니다 — 대체 공급원
    등장 같은 구조 변화를 직접 판단한다 (analysis 의 `structural_watch` 노트 참고).
  - 반영/기각 여부와 무관하게 제안이 있었던 시장은 `weekly_note` 에 판단 근거를
    한 줄 남긴다 (예: "펄스 승급 제안 기각 — 단일 벤더 발 소스, 교차 확인 실패").
- 규모: 출처가 갈리면 범위로 적고 `size_confidence` 를 낮춘다. 추측 금지.
- 점유율: `players[].share` (%) 는 출처 기준으로. 한 시장 안에서 합이 100 이하가
  되게(나머지는 웹이 '기타'로 표시). 점유율이 무의미한 시장은 생략.
- 주간 흐름: `weekly_note` 는 그 주의 수급·가격·병목·정책 변화를 종합한 1~2문장.
  "분위기"가 드러나게 — 웹 상세의 '이번 주 시장 흐름'에 그대로 노출된다.
- 시장 뉴스: **`data/markets/news/ai-semiconductor.json`** 의 `markets.<시장id>[]`
  배열에 **추가**한다(맵 JSON 에 넣지 않는다 — 구 `recent_news` 필드는 폐지됨). 스키마:
  ```json
  { "date": "2026-06-08", "title": "한국어 헤드라인",
    "source": "Reuters", "url": "https://...",
    "impact": "+ | - | neutral", "summary": "한 줄 한국어 요약 (50자 내외)",
    "signals": [ { "type": "supply_tightening", "strength": 3 } ] }
  ```
  - **`signals[]` 는 필수 태깅** — market_pulse 가 병목 압력을 계산하는 원료다.
    `type` 은 `supply_tightening`(공급 긴축) | `supply_easing`(공급 완화) |
    `demand_up`(수요 확대) | `demand_down`(수요 축소), `strength` 는 1(약)~3(강).
    한 뉴스에 복수 신호 가능(예: "매진인데 증설 발표" = 긴축+완화). 방향성이
    없는 뉴스(지배구조·M&A 등)는 빈 배열 `[]`. 태깅 기준은
    `data/markets/criteria/ai-semiconductor.json` 의 시장별 `key_metrics` /
    `escalate_when` / `deescalate_when` 을 따른다.
  - `date` 는 가능하면 `YYYY-MM-DD`(일자 불명이면 `YYYY-MM`). **배열은 최신순 유지.**
  - **특정 티커에 직접 붙는 단일 기업 뉴스는 넣지 않는다** (그건 daily 루틴 몫).
    여기엔 *업황·수급·병목·정책* 같은 **시장 전체** 헤드라인만.
  - 시장당 **최대 20개 보관** — 초과 시 가장 오래된 것부터 제거. 같은 사건 중복 금지.
    웹은 최신 6개 + '더 보기'로 표시하므로 과거 뉴스도 지우지 말고 누적한다.
  - 새 시장 노드를 만들면 같은 id 키를 뉴스 스토어에도 만든다.
  - 파일 최상위 `updated` 를 갱신 날짜로 바꾼다.
- 새 플레이어/시장/링크가 생기면 추가하되, `links.from/to` 는 존재하는 `id` 만.
  - **새 플레이어를 추가할 때 그 시장에서 '봐야 하는' 상장사라면 watchlist 에도
    편입한다** (`scripts/watchlist_data.py` 수정 → `gen_watchlist.py` 실행 →
    `in_watchlist: true`). 시장지도 노드 플레이어 ↔ 개별 종목 탭은 1:1 이 원칙.
- **`links` 는 고정된 그림이 아니다 — 시장 상황을 반영해 갱신한다.** 대형
  공급계약·오프테이크·수직통합이 확인되면 링크를 추가/수정하고 `label` 에
  계약 내용을 반영한다 (예: "MS→IREN $9.7B 오프테이크", "SK하이닉스 HBM4
  베이스다이 TSMC 위탁"). 계약이 종료/축소되면 label 을 되돌리거나 링크를
  제거한다. 근거 뉴스를 뉴스 스토어에 먼저 넣는 것은 severity 변경과 동일.
- **새 시장을 추가하면 맵 JSON 의 `diagram` 블록에도 배치한다** — `flow`(좌 공급의
  뿌리 → 우 최종 수요 메인 체인) 또는 `bands`(하단 가로 밴드: 피지컬 AI·전력/DC)의
  적절한 클러스터 `markets` 에 id 를 넣는다. 빠뜨리면 `layer_default` 기준으로
  자동 배치되지만, 이야기 흐름에 맞는 위치는 사람이 정하는 게 낫다.
- 맵 전체의 최상위 `as_of` 와, 손댄 시장은 의미가 있으면 갱신 날짜를 반영한다.

### 2.35 옵시디언 시장 종합 파일 동기화 (`Luke_wiki/wiki/news/markets/ai-semiconductor/`)

2.3 에서 갱신한 내용을 **시장 노드별 옵시디언 종합 페이지**에 반영한다.
경로 계약: `Luke_wiki/wiki/news/markets/ai-semiconductor/{market_id}.md`
(대시보드가 시장 노드 클릭 시 이 파일을 지도 아래에 표시한다. 섹션 앵커 규칙은
`Luke_wiki/wiki/news/markets/README.md`).

이번에 변화가 있었던 시장만 갱신한다:

- **[시장 정의] / [병목 상태]**: 지도 JSON 의 `definition`·`demand_driver`·
  `bottleneck` 과 동기화. severity 를 바꿨으면 여기도 반영.
- **[시장 상황 종합]** (`SYNTHESIS_START/END`): `weekly_note` 를 기반으로
  1~3문장. 이번 주 수급·가격·병목·정책 변화의 **출처 있는 종합**만 —
  weekly_note 보다 자세히 쓸 수 있지만 새 주장을 창작하지 않는다.
- **[시장 뉴스 로그]** (`MARKET_NEWS_START/END`): 뉴스 스토어에 추가한 항목을
  같은 형식(`- **날짜** ± **제목** — 요약 (출처) [↗](url)`)으로 prepend (최신순).
- **[사실 누적]**: Tier-1 2곳 이상으로 확정된 시장 구조 사실만 `[!fact]` 추가.
- frontmatter `updated` 갱신. [소속 기업 동향] 표는 daily 루틴 몫 — 건드리지 않는다.
- **새 시장 노드를 만들었으면 같은 id 의 옵시디언 파일도 생성한다**
  (기존 파일 구조 복사, frontmatter 에 `map: ai-semiconductor`, `market_id: {id}`,
  `tags: [routine-news, market-summary, ai-semiconductor, {id}]`).

> 정확성 규칙: 이 파일은 지도 JSON·뉴스 스토어의 **거울**이다. 두 SSOT 와
> 어긋나는 수치·주장을 쓰지 않는다. 갱신 후 `Luke_wiki` 에서
> `python scripts/validate_vault.py` 로 격리 규칙을 확인한다.

### 2.4 펄스 재실행 + 검증 (커밋 전 필수)
뉴스·지도를 고친 뒤 **market_pulse 를 다시 돌려** 분석 파일을 갱신하고 검증한다
(맵/뉴스/criteria 교차 참조·signals 스키마 검증이 내장되어 있다):

```bash
python scripts/market_pulse.py --industry ai-semiconductor   # 검증 + analysis 재생성
```

실패하면 커밋하지 말고 원인을 고친다. 갱신된
`data/markets/analysis/ai-semiconductor.json` 도 **함께 커밋**한다 — 웹이 이
파일로 자동 신호(노드 ▲▼·상단 스트립·상세 게이지)를 그린다.

새 시장 노드를 추가했으면 `data/markets/criteria/ai-semiconductor.json` 에도
그 시장의 판정 기준(`bottleneck_type`·`key_metrics`·`escalate_when`·
`deescalate_when`·`keywords`)을 함께 추가한다 — 기준 없는 시장은 글로벌
키워드 폴백으로만 분류돼 신호 품질이 떨어진다.

### 2.5 (선택) 렌더 스모크 테스트
가능하면 `python -m http.server` 로 띄워 '시장 지도' 탭이 정상 렌더되는지 본다.
(노드 30개·뉴스 배지, 병목 노드 펄스, 클릭 시 상세에 뉴스, 보드 하단에 뉴스 피드)

---

## 3. Git commit & push — **세션 브랜치 → PR 병합**

`../daily-market-analysis.md` 7~8번과 동일한 방식. 하드코딩 브랜치 금지.

```bash
SESSION_BRANCH=$(git branch --show-current)
git add data/markets/ai-semiconductor.json data/markets/news/ data/markets/criteria/ data/markets/analysis/ .claude/routines/market-research/
git commit -m "chore(markets): AI·반도체 시장 지도 갱신 ($(date -u +%Y-%m-%d))"
git push -u origin "$SESSION_BRANCH"

# Luke_wiki (시장 종합 파일을 갱신했으면 — 해당 레포 디렉토리에서)
SESSION_BRANCH=$(git branch --show-current)
git add wiki/news/markets/
git commit -m "[routine-news] market summary sync $(date -u +%Y-%m-%d) (ai-semiconductor)"
git push -u origin "$SESSION_BRANCH"
```
그 뒤 `mcp__github__create_pull_request` (head=세션 브랜치, base=레포 기본 브랜치)
→ `merge_pull_request` (squash). 기본 브랜치는 daily 루틴 8번 표를 따른다.

---

## 4. 안전 가이드라인

- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 그 항목은 넣지 않는다.
- **개인 투자 조언 금지.** 시장 구조·규모·병목만 기술. "사라/팔아라" 표현 금지.
- **출처가 갈리는 수치**는 범위 + 낮은 `size_confidence` 로. (예: 로보틱스 TAM,
  소버린 AI 규모, HBM 시장규모의 트래커 간 편차)
- **시장 단위만.** 단일 기업 실적/뉴스는 daily 루틴이 티커에 붙인다.
- watchlist 밖 기업(SK하이닉스·삼성·Vertiv·ASE 등)도 구조 파악에 필요하면
  `ticker` 와 함께 넣되 `in_watchlist` 는 false/생략.

---

## 5. 새 산업 맵 만들기 (예: 바이오, 에너지)

1. `data/markets/{industry}.json` 을 이 파일과 같은 스키마로 생성
   (`./README.md` 데이터 모델 참고). 6개 층은 산업에 맞게 재정의 가능.
2. `app.js` 의 `MARKET_MAPS` 레지스트리에 `{ id, label }` 한 줄을 추가하면
   '시장 지도' 상단에 산업 전환 탭이 자동으로 생긴다(렌더 로직은 공유). 메인
   체인 좌/우 축 라벨은 맵 JSON 의 `diagram.axis` (left/mid/right)로 산업에
   맞게 바꿀 수 있다.
3. `.claude/routines/market-research/{industry}.md` 를 이 파일을 복사해 만들고
   층/시장/병목을 그 산업에 맞게 조사·기술한다.
4. `./README.md` 의 "현재 산업 맵" 표에 한 줄 추가.

> 사용자 지침: 섹터 구분은 **객관적 시장 관점**으로 유연하게 조정한다.
> 기존 12개 섹터(watchlist)에 얽매이지 말고, "어떤 수요가 있고 그 수요를
> 중심으로 어떤 시장·병목이 있는가" 를 기준으로 층과 노드를 설계한다.
