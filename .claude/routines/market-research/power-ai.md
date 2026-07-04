# Market Research Routine — 전력 · AI 인프라

이 루틴은 **AI 데이터센터발 전력 수요를 '시장(조달 경로)' 단위로** 추적해 네 파일을 최신으로 유지한다:

| 파일 | 내용 |
|---|---|
| `data/markets/power-ai.json` | 시장 구조 — 노드·층·링크·병목·플레이어·weekly_note |
| `data/markets/news/power-ai.json` | **시장 단위 뉴스 스토어** — 시장 id 별 뉴스 배열(최신순, 시장당 최대 20개) + **signals 방향성 태그** |
| `data/markets/criteria/power-ai.json` | **시장별 병목 판정 기준** — 리드타임·대기열·정책 지표와 승급/완화 조건 |
| `data/markets/analysis/power-ai.json` | `scripts/market_pulse.py` 산출물 — 병목 압력·전이 제안·병목 이동 경보 (직접 편집 금지) |

웹 대시보드 **주식 탭 → '시장 지도' → '전력 · AI 인프라'** 가 이 파일들을 읽는다.

> 먼저 `./README.md`(데이터 모델·자동 병목 신호)를 읽어라.
> 티커별 일일 뉴스는 `../daily-market-analysis.md` 가 따로 처리한다 — **건드리지 않는다.**
> (전력 관련 개별 종목은 watchlist 의 "유틸리티 / 전력" + "전력 인프라 (AI)" 그룹, 금요일 처리.)

---

## 0. 이 맵의 구조 (수요 → 연료, 6개 층)

| 층 | id | 무엇 |
|---|---|---|
| ① 최종 수요 | `demand` | AI 데이터센터 전력 수요 (GW·TWh) |
| ② 조달 경로 | `procurement` | **BTM(구내 발전) vs 그리드/FTM(계통 접속·PPA)** — 이 지도의 핵심 질문 |
| ③ 발전원 | `generation` | 가스 발전·기존 원전·SMR·재생+ESS·연료전지 |
| ④ 계통·전송 | `delivery` | 송전망·변전 건설 (T&D EPC) |
| ⑤ 발전·전력 장비 | `equipment` | 가스터빈·변압기/스위치기어·배터리 ESS |
| ⑥ 연료·자원 | `fuel` | 천연가스·우라늄/농축(HALEU) |

**가장 중요한 산출물은 ② 조달 경로의 무게추 이동이다** — 이해당사자들이 BTM 으로
몰리는가, 그리드에 줄을 서는가. 이 비율(현재: ’28+ 신규의 절반± BTM 전망, 기관별
25%~50%+ 편차)과 그 원인(계통접속 대기 vs 터빈 리드타임)의 변화를 추적하는 것이
이 루틴의 핵심 가치다. BTM·그리드 어느 쪽이든 **터빈·변압기라는 공통 장비 관문**을
지나므로, 장비층 병목이 조달 경로 선택을 역으로 규정한다는 점을 잊지 말 것.

---

## 1. 실행 카데런스

- **권장: 주 1회** (예: 매주 토요일, ai-semiconductor 루틴과 같은 날) 전체 14개 시장 점검.
- 또는 사용자가 "전력 시장 지도 업데이트" 라고 지시할 때 on-demand.
- 큰 이벤트(GEV·Siemens 실적, 대형 원자력/SMR 딜, FERC·PJM 규칙 확정, OBBBA 급
  정책 변화, 대형 BTM 프로젝트 발표) 직후엔 즉시.

---

## 2. 작업 순서

### 2.1 현재 맵 로드 + 자동 신호 확인
`data/markets/power-ai.json` 과 `data/markets/news/power-ai.json` 을 읽고,
**자동 병목 신호를 먼저 돌려 리서치 우선순위를 잡는다**:

```bash
python scripts/market_pulse.py --industry power-ai
```

`data/markets/analysis/power-ai.json` 에서 확인할 것:
- `alerts[]` 의 `severity_change_proposed` — 이번 리서치에서 반드시 교차 검증.
- `alerts[]` 의 `bottleneck_migration` — 예: "BTM → 변압기·가스발전" 은 조달 경로의
  수요가 장비 병목으로 전이되고 있다는 신호.
- `markets.btm` vs `markets.grid-ftm` 의 `demand_momentum` 격차 — **BTM 쏠림의 정량 지표.**
- `status == "no_signals"` 가 지속되는 시장 — 이번 주 뉴스 수집 대상에 포함.

### 2.2 시장별 리서치 (web)
각 시장의 **최근 1~4주** 변화를 조사한다. 이 산업의 핵심 관찰 지표:

| 시장 | 매주 볼 것 |
|---|---|
| `btm` / `grid-ftm` | BTM 신규 발표(GW)·계통접속 대기 통계·large-load tariff / colocation 규칙 진행 |
| `turbines` | 3사(GEV·Siemens Energy·MHI) 백로그·매진 시한·두산 등 2군 수주 |
| `transformers` | 리드타임(년)·K-빅3 수주/실적·미국 현지 증설 |
| `nuclear-existing` / `smr` | 신규 PPA·재가동/업레이트·NRC 인허가·HALEU 계약 |
| `gas-power` / `natgas` | CCGT 신설 발주·IPP 실적·미드스트림 DC 딜·가스 가격 |
| `renewables-storage` / `bess` | 분기 설치량·세액공제/FEOC 정책·비중국 셀 |
| `transmission` | Quanta 등 EPC 백로그·유틸리티 grid capex |
| `uranium` | U3O8/SWU 가격·서방 농축 증설·러 금수 이행 |

무료 신뢰 소스 우선: Utility Dive, Latitude Media, Heatmap, Data Center Frontier/DCD,
NGI, POWER Magazine, Energy-Storage.News, EIA/IEA/FERC/ERCOT/PJM 공식 자료,
기업 IR(GEV·PWR·BE·CEG·VST·K-전력기기 3사), 국내 언론(전력기기·두산에너빌리티).
페이월은 건너뛰고 다음 소스로.

### 2.3 JSON 갱신
**검증된, 출처 있는 변화만** 반영한다. `../market-research/ai-semiconductor.md` 2.3 절의
규칙(병목 severity 변경 절차·signals 필수 태깅·뉴스 스토어 스키마·최신순·시장당 ≤20)을
그대로 따른다. 이 산업 고유의 유의점:

- **BTM 비중 수치는 기관별 편차가 크다** (SemiAnalysis 50%+ vs McKinsey 25–33%).
  단일 수치로 적지 말고 범위 + `size_confidence: "low"` 를 유지한다.
- `structural` 노드(기존 원전·우라늄 농축)는 자동 전이 금지 — 대형 신설 원전 재개,
  서방 농축 캐파 실질 가동 같은 구조 변화만 수동으로 낮춘다.
- 정책 신호(OBBBA·FEOC·FERC 규칙·러 금수)는 방향이 시장마다 다르다 — 예: FEOC 는
  중국 셀엔 tightening, K-배터리엔 demand_up. **시장별로 따로 태깅**한다.
- 두 조달 경로의 `weekly_note` 는 반드시 매주 갱신 — "이번 주 무게추가 어느 쪽으로
  움직였나"가 이 지도의 헤드라인이다.

### 2.4 펄스 재실행 + 검증 (커밋 전 필수)
```bash
python scripts/market_pulse.py --industry power-ai   # 검증 + analysis 재생성
```
실패하면 커밋하지 말고 고친다. 갱신된 `data/markets/analysis/power-ai.json` 도 함께 커밋.
새 시장 노드를 추가하면 `criteria/power-ai.json` 에 판정 기준을, 맵의 `diagram` 블록에
배치를 함께 추가한다.

### 2.5 (선택) 렌더 스모크 테스트
`python -m http.server` → 주식 탭 → 시장 지도 → '전력 · AI 인프라' 탭이 정상 렌더되는지
(노드 14개·BTM/그리드 나란히·병목 펄스·자동 신호 스트립) 확인.

---

## 3. Git commit & push — **세션 브랜치 → PR 병합**

`../daily-market-analysis.md` 7~8번과 동일. 하드코딩 브랜치 금지.

```bash
SESSION_BRANCH=$(git branch --show-current)
git add data/markets/power-ai.json data/markets/news/ data/markets/criteria/ data/markets/analysis/ .claude/routines/market-research/
git commit -m "chore(markets): 전력·AI 시장 지도 갱신 ($(date -u +%Y-%m-%d))"
git push -u origin "$SESSION_BRANCH"
```
그 뒤 `mcp__github__create_pull_request` (head=세션 브랜치, base=기본 브랜치)
→ `merge_pull_request` (squash).

---

## 4. 안전 가이드라인

- **추측·창작 금지.** 출처 URL 이 확인되지 않으면 넣지 않는다.
- **개인 투자 조언 금지.** 시장 구조·수급·병목만 기술 — "사라/팔아라" 금지.
- **BTM vs 그리드 비중** 같은 전망 수치는 반드시 기관명과 함께, 범위로.
- **시장 단위만.** 단일 기업 실적/뉴스는 daily 루틴이 티커에 붙인다
  (전력주는 금요일: 유틸리티/전력 + 전력 인프라(AI) 그룹).
- watchlist 밖 기업(Siemens Energy·MHI·Hitachi Energy·Holtec·Urenco 등)도 구조
  파악에 필요하면 `ticker` 와 함께 넣되 `in_watchlist` 는 생략.
