# Market Research Routine — 제약 · 바이오

이 루틴은 **제약·바이오 산업을 '시장(돈의 흐름)' 단위로** 추적해 두 파일을 최신으로 유지한다:

| 파일 | 내용 |
|---|---|
| `data/markets/pharma-bio.json` | 시장 구조 — 노드·층·링크·병목·플레이어·weekly_note |
| `data/markets/news/pharma-bio.json` | **시장 단위 뉴스 스토어** — 시장 id 별 뉴스 배열(최신순, 시장당 최대 20개 보관) |

웹 대시보드 **주식 탭 → '시장 지도' → '제약·바이오' 탭** 이 두 파일을 읽어, 뉴스를 세 곳에 꽂아 보여준다:
노드 배지(건수·최신일) · 노드 클릭 상세(최신 6개+더보기) · 보드 하단 통합 뉴스 피드(클릭 → 해당 시장 선택).

> 먼저 `./README.md`(데이터 모델·두 파이프라인 관계)와 `./ai-semiconductor.md`(자매 루틴)를 읽어라.
> 티커별 일일 뉴스는 `../daily-market-analysis.md` 가 따로 처리한다 — **건드리지 않는다.**

---

## 0. 이 맵의 철학과 구조 (돈의 흐름, 6개 층)

이 지도의 출발점은 **"어디에 가장 큰 돈이 모여있고, 가장 큰 플레이어가 어디에
무엇을 기대하고 돈을 지불하는가"** 다. 그래서 반도체 맵의 '수요→공급' 캐스케이드를
제약에 맞게 **'지불자→신약→자본→서비스→제조→도구'** 로 재정의했다. 산업을
왜곡하지 않으면서 *돈의 무게*가 큰 노드를 중심에 둔다.

| 층 | id | 무엇 | 돈의 관점 |
|---|---|---|---|
| ① 지불자·유통 | `payer` | 보험·정부 약가, 도매·PBM | **모든 돈의 원천** — 미국 약가가 산업 매출 함수 |
| ② 신약 시장 | `products` | 항암(ADC·IO)·면역·비만대사(GLP-1)·신경/희귀/백신 | 돈이 실제로 모이는 블록버스터 |
| ③ R&D 자본 엔진 | `capital` | 빅파마 R&D·M&A·바이오텍 VC·중국 라이선싱 | 현금흐름이 파이프라인을 사들이는 곳 |
| ④ R&D 서비스·AI | `services` | 임상 CRO·AI 신약·빅테크 AI 플랫폼·헬스 데이터 | 신약을 개발해주는 곳(+AI 침투 접점) |
| ⑤ 제조 기반 | `manufacturing` | 바이오 CDMO·GLP-1 펩타이드 CAPEX·제네릭/API | 약을 실제로 만드는 곳 |
| ⑥ 장비·소재·도구 | `foundation` | 바이오프로세싱 장비·연구도구/시퀀싱 | picks & shovels |

> **메인 체인의 흐름 방향에 주의.** 반도체는 좌(공급)→우(수요)로 *물건*이 흐른다.
> 제약 맵도 같은 좌→우 배치지만, 오른쪽 끝이 **지불자(돈의 원천)** 이고 돈은
> 오른쪽에서 왼쪽으로 흐른다(약·서비스는 왼→오). `diagram.axis` 가 이를 설명한다.

**이 산업의 3대 동력 (조사 시 항상 염두):**
1. **$400B 특허절벽('26–30)** — 키트루다·엘리퀴스·다잘렉스 만료가 M&A·중국
   라이선싱·제네릭을 강제. `pharma-rd-capital`·`china-licensing`·`oncology` 의 핵심.
2. **GLP-1 비만약 슈퍼사이클** — 공급부족→해소→가격경쟁으로 국면 이동.
   `obesity-glp1`·`glp1-manufacturing`.
3. **빅테크 AI의 제약 침투** — NVIDIA·Anthropic·OpenAI·Google(Isomorphic)이
   '도구 판매'에서 '신약 가치사슬 참여'로. `ai-drug-discovery`·`ai-pharma-infra`·`health-data`
   밴드(AI×바이오 체인). 사용자가 특히 관심 갖는 영역 — 딜·제휴를 꼼꼼히 추적.

**가장 중요한 산출물은 `bottleneck` 상태와 시장 뉴스 스토어다.** 이 산업의 병목은
물리적 캐파(CDMO·펩타이드 충전)뿐 아니라 **정책(약가·관세)·자산 희소성(살 만한
파이프라인 부족)·데이터(AI 학습용)** 처럼 무형인 경우가 많다 — 그 점이 반도체와
다르다. limit 문구에 *왜 그것이 지금 돈을 막거나 끌어당기는지*를 적는다.

---

## 1. 실행 카데런스

- **권장: 주 1회** 전체 18개 시장 점검 (반도체 맵과 같은 날 묶어도 됨).
- 또는 사용자가 "제약·바이오 시장 지도 업데이트" 라고 지시할 때 on-demand.
- 큰 이벤트(릴리/노보 실적, 대형 M&A·중국 라이선싱 딜, IRA 약가 발표, 빅테크
  ×제약 AI 제휴, FDA 주요 승인) 직후엔 즉시.

> 같은 날 이미 갱신된 시장은 덮어쓰지 말고, **변화가 있을 때만** 수정한다.

---

## 2. 작업 순서

### 2.1 현재 맵 로드
`data/markets/pharma-bio.json` 과 `data/markets/news/pharma-bio.json` 을 읽어 각
시장의 현재 `size_label / growth / bottleneck / players / weekly_note / as_of` 와
누적 뉴스를 파악한다.

### 2.2 시장별 리서치 (web)
각 시장(또는 이번에 점검할 부분집합)에 대해 **최근 1~4주** 변화를 조사한다.
무료로 접근 가능한 신뢰 소스 우선:

- 업계 트래커·분석: IQVIA Institute, Evaluate(Vantage), Drug Channels Institute,
  PharmaSource, DealForma, Mordor/Grand View(규모), Roots/Towards(모달리티별 TAM)
- 1차/뉴스: 기업 IR·실적·보도자료, Reuters, BioPharma Dive, Fierce Pharma/Biotech,
  Endpoints, STAT, CNBC, PharmaVoice, BioSpace
- 정책: CMS·White House(약가), FDA(승인), 의회(PBM 개혁·Biosecure)
- 페이월·유료는 건너뛰고 다음 소스로.

각 시장에서 다음을 갱신 후보로 본다:
- **병목 상태 변화** (severity 승급/완화, limit 문구) ← 최우선
- **이번 주 시장 흐름** (`weekly_note`) — 그 주의 분위기·변화를 1~2문장으로 ← 매주
- 시장 규모/성장 (`size_label`, `growth`, 필요시 `size_usd_b`, `size_confidence`)
- 플레이어 점유율·지위 (`players[].share`, `role`) — 신약 승인·매출·딜·LOE 변화
- 시장 단위 헤드라인 (뉴스 스토어 `markets.<id>[]`)

### 2.3 JSON 갱신
**검증된, 출처 있는 변화만** 반영한다. 규칙은 `./README.md` 데이터 모델과 동일.

- 병목: `bottleneck.severity` 는 `severity_legend` 키 중 하나
  (`structural|acute|easing|emerging|demand_limited`). 이 맵에서 라벨은 반도체와
  살짝 다르게 '압박'으로 읽히도록 정의돼 있다(structural=구조적 독점·의존,
  acute=급성 압박 등). `limit` 은 *왜* 지금 병목/압박인지 한 문장으로.
- 규모: 출처가 갈리면 범위로 적고 `size_confidence` 를 낮춘다. 추측 금지.
  특히 GLP-1·AI 신약·RWD 는 트래커 간 편차가 크니 범위+low.
- 점유율: `players[].share` (%) 는 출처 기준. 한 시장 안 합이 100 이하(나머지는
  웹이 '기타'). 점유율이 무의미한 시장(지불자·자본·데이터 등)은 생략.
- 주간 흐름: `weekly_note` 는 그 주의 딜·정책·실적·승인 변화를 종합한 1~2문장.
- 시장 뉴스: **`data/markets/news/pharma-bio.json`** 의 `markets.<시장id>[]` 에
  **추가**. 스키마:
  ```json
  { "date": "2026-06-08", "title": "한국어 헤드라인",
    "source": "Reuters", "url": "https://...",
    "impact": "+ | - | neutral", "summary": "한 줄 한국어 요약 (50자 내외)" }
  ```
  - `date` 는 가능하면 `YYYY-MM-DD`(불명이면 `YYYY-MM`). **배열은 최신순 유지.**
  - **특정 티커에 직접 붙는 단일 기업 뉴스는 넣지 않는다** (daily 루틴 몫).
    여기엔 *업황·딜·정책·승인·병목* 같은 **시장 전체** 헤드라인만.
  - 시장당 **최대 20개 보관** — 초과 시 가장 오래된 것부터 제거. 중복 금지.
  - 새 시장 노드를 만들면 같은 id 키를 뉴스 스토어에도 만든다.
  - 파일 최상위 `updated` 를 갱신 날짜로 바꾼다.
- 새 플레이어/시장/링크가 생기면 추가하되, `links.from/to` 는 존재하는 `id` 만.
  (방향: from=상류/돈을 받는 쪽 흐름의 출발, to=하류 공급. 이 맵에선 지불자→신약→
  자본→서비스→제조→도구 순으로 from→to 가 흐르고, 화살표는 to→from 으로 그려져
  '돈이 어디서 와서 무엇을 사는가'를 보여준다. 기존 링크 패턴을 참고해 일관되게.)
- **새 시장을 추가하면 맵 JSON 의 `diagram` 블록에도 배치한다** — `flow`(메인 체인)
  또는 `bands`(하단 밴드: AI×바이오 체인)의 적절한 클러스터 `markets` 에 id 를 넣는다.
- 맵 전체의 최상위 `as_of` 와, 손댄 시장은 의미가 있으면 갱신 날짜를 반영한다.

### 2.4 검증 (커밋 전 필수)
```bash
python - <<'PY'
import json
d=json.load(open("data/markets/pharma-bio.json"))
ns=json.load(open("data/markets/news/pharma-bio.json"))
mids={m["id"] for m in d["markets"]}; lids={l["id"] for l in d["layers"]}
sev=set(d["severity_legend"])
clusters={c["id"] for c in d["diagram"]["flow"]+d["diagram"]["bands"]}
placed=[mid for c in d["diagram"]["flow"]+d["diagram"]["bands"] for mid in c["markets"]]
assert all(m["layer"] in lids for m in d["markets"]), "bad layer ref"
assert all(l["from"] in mids and l["to"] in mids for l in d["links"]), "bad link ref"
assert all(p in mids for p in placed), "diagram has unknown market id"
assert len(placed)==len(set(placed)), "market placed twice in diagram"
assert mids.issubset(set(placed)), f"unplaced markets: {mids-set(placed)}"
for m in d["markets"]:
    b=m.get("bottleneck")
    assert b is None or b["severity"] in sev, f"bad severity in {m['id']}"
    assert not m.get("recent_news"), f"deprecated recent_news in {m['id']}"
for mid, items in ns["markets"].items():
    assert mid in mids, f"news for unknown market {mid}"
    assert len(items) <= 20, f"too many news in {mid}"
    assert items == sorted(items, key=lambda n: n.get("date",""), reverse=True), f"{mid} not newest-first"
    for n in items:
        assert n.get("url","").startswith("http"), f"bad news url in {mid}"
        assert n.get("impact") in ("+","-","neutral"), f"bad impact in {mid}"
print("OK", len(d["markets"]), "markets /", sum(len(v) for v in ns["markets"].values()), "news")
PY
```
실패하면 커밋하지 말고 원인을 고친다.

### 2.5 (선택) 렌더 스모크 테스트
`python -m http.server` 로 띄워 '시장 지도' 탭에서 '제약·바이오' 탭을 눌러
정상 렌더되는지 본다 (노드·뉴스 배지, 병목 노드 강조, 클릭 시 상세, 하단 피드).

---

## 3. Git commit & push — **세션 브랜치 → PR 병합**

`../daily-market-analysis.md` 와 동일한 방식. 하드코딩 브랜치 금지.

```bash
SESSION_BRANCH=$(git branch --show-current)
git add data/markets/pharma-bio.json data/markets/news/pharma-bio.json .claude/routines/market-research/
git commit -m "chore(markets): 제약·바이오 시장 지도 갱신 ($(date -u +%Y-%m-%d))"
git push -u origin "$SESSION_BRANCH"
```
그 뒤 PR 생성 → squash 병합. 기본 브랜치는 daily 루틴 표를 따른다.

---

## 4. 안전 가이드라인

- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 그 항목은 넣지 않는다.
- **개인 투자 조언 금지.** 시장 구조·규모·병목만 기술. "사라/팔아라" 금지.
- **산업을 왜곡하지 않는다.** 돈의 무게로 노드 크기를 정하되, 실제 산업 구조와
  어긋나게 과장/축소하지 않는다. 임상 단계·승인 여부를 사실대로.
- **출처가 갈리는 수치**는 범위 + 낮은 `size_confidence` 로 (GLP-1 TAM, AI 신약
  시장, RWD 규모, ADC 규모 등 편차 큼).
- **시장 단위만.** 단일 기업 실적/뉴스는 daily 루틴이 티커에 붙인다.
- watchlist 밖 기업(삼성바이오·Lonza·WuXi·Isomorphic·Bachem 등)도 구조 파악에
  필요하면 `ticker` 와 함께 넣되 `in_watchlist` 는 false/생략.
- **AI×바이오는 빠르게 움직인다.** 빅테크×제약 제휴·AI 신약 임상 결과는 분기마다
  판이 바뀌니 우선 추적 — 단, 하이프와 검증된 사실을 구분해 limit 에 명시한다.

---

## 5. watchlist 연동 메모

이 맵의 `in_watchlist: true` 플레이어는 `data/index.json` 의 `stocks[]` 에 그
티커가 있을 때만 narrative_score 자동 집계가 된다. 현재 watchlist 에 있는 제약·
헬스케어 관련 티커: `LLY, NVO, MRK, JNJ, ABBV, PFE, AZN, UNH, TMO, NVDA, GOOGL,
MSFT, AMGN(추가 시)` 등. watchlist 에 없으면 노드엔 기업이 보이되 시그널 집계엔
빠진다 — 필요하면 `gen_watchlist.py` 에 티커 추가를 사용자에게 제안한다.
