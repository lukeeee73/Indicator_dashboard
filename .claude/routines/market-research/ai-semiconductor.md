# Market Research Routine — AI · 반도체

이 루틴은 **AI·반도체 산업을 '시장(수요)' 단위로** 추적해 두 파일을 최신으로 유지한다:

| 파일 | 내용 |
|---|---|
| `data/markets/ai-semiconductor.json` | 시장 구조 — 노드·층·링크·병목·플레이어·weekly_note |
| `data/markets/news/ai-semiconductor.json` | **시장 단위 뉴스 스토어** — 시장 id 별 뉴스 배열(최신순, 시장당 최대 20개 보관) |

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

### 2.1 현재 맵 로드
`data/markets/ai-semiconductor.json` 과 `data/markets/news/ai-semiconductor.json` 을
읽어 각 시장의 현재 `size_label / growth / bottleneck / players / weekly_note / as_of`
와 누적 뉴스를 파악한다.

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
    "impact": "+ | - | neutral", "summary": "한 줄 한국어 요약 (50자 내외)" }
  ```
  - `date` 는 가능하면 `YYYY-MM-DD`(일자 불명이면 `YYYY-MM`). **배열은 최신순 유지.**
  - **특정 티커에 직접 붙는 단일 기업 뉴스는 넣지 않는다** (그건 daily 루틴 몫).
    여기엔 *업황·수급·병목·정책* 같은 **시장 전체** 헤드라인만.
  - 시장당 **최대 20개 보관** — 초과 시 가장 오래된 것부터 제거. 같은 사건 중복 금지.
    웹은 최신 6개 + '더 보기'로 표시하므로 과거 뉴스도 지우지 말고 누적한다.
  - 새 시장 노드를 만들면 같은 id 키를 뉴스 스토어에도 만든다.
  - 파일 최상위 `updated` 를 갱신 날짜로 바꾼다.
- 새 플레이어/시장/링크가 생기면 추가하되, `links.from/to` 는 존재하는 `id` 만.
- **새 시장을 추가하면 맵 JSON 의 `diagram` 블록에도 배치한다** — `flow`(좌 공급의
  뿌리 → 우 최종 수요 메인 체인) 또는 `bands`(하단 가로 밴드: 피지컬 AI·전력/DC)의
  적절한 클러스터 `markets` 에 id 를 넣는다. 빠뜨리면 `layer_default` 기준으로
  자동 배치되지만, 이야기 흐름에 맞는 위치는 사람이 정하는 게 낫다.
- 맵 전체의 최상위 `as_of` 와, 손댄 시장은 의미가 있으면 갱신 날짜를 반영한다.

### 2.4 검증 (커밋 전 필수)
```bash
python - <<'PY'
import json
d=json.load(open("data/markets/ai-semiconductor.json"))
ns=json.load(open("data/markets/news/ai-semiconductor.json"))
mids={m["id"] for m in d["markets"]}; lids={l["id"] for l in d["layers"]}
sev=set(d["severity_legend"])
assert all(m["layer"] in lids for m in d["markets"]), "bad layer ref"
assert all(l["from"] in mids and l["to"] in mids for l in d["links"]), "bad link ref"
for m in d["markets"]:
    b=m.get("bottleneck")
    assert b is None or b["severity"] in sev, f"bad severity in {m['id']}"
    assert not m.get("recent_news"), f"deprecated recent_news in {m['id']} - use news store"
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
가능하면 `python -m http.server` 로 띄워 '시장 지도' 탭이 정상 렌더되는지 본다.
(노드 30개·뉴스 배지, 병목 노드 펄스, 클릭 시 상세에 뉴스, 보드 하단에 뉴스 피드)

---

## 3. Git commit & push — **세션 브랜치 → PR 병합**

`../daily-market-analysis.md` 7~8번과 동일한 방식. 하드코딩 브랜치 금지.

```bash
SESSION_BRANCH=$(git branch --show-current)
git add data/markets/ai-semiconductor.json data/markets/news/ .claude/routines/market-research/
git commit -m "chore(markets): AI·반도체 시장 지도 갱신 ($(date -u +%Y-%m-%d))"
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
