# 시장 리서치 루틴 (산업별 · 시장 중심)

이 디렉토리는 **'기업'이 아니라 '시장(수요)' 단위**로 산업을 보는 루틴 모음이다.
기존 `../daily-market-analysis.md`(티커별 일일 뉴스)는 **그대로 유지**되고,
이 디렉토리의 루틴들은 그 위에 **시장 층(market layer)** 을 얹는다.

---

## 두 파이프라인의 관계

```
[티커별 daily 루틴]  data/news/{TICKER}/{날짜}.json
   (../daily-market-analysis.md)        │  merge_qualitative.py
                                        ▼
                            data/stocks/{TICKER}.json
                              valuation.qualitative.narrative_score
                                        │
                                        │  ← 웹이 시장 노드별로 "자동 집계"
                                        ▼
[시장 리서치 루틴]  ───────►  data/markets/{industry}.json          (시장 구조)
   (이 디렉토리)              data/markets/news/{industry}.json     (시장 뉴스 스토어 + signals 태그)
                                    · 시장 규모/성장/병목 상태 갱신 (구조 파일)
                                    · 시장 단위 헤드라인 누적 (뉴스 스토어, 시장당 ≤20)
                                        │
                                        │  scripts/market_pulse.py  ← criteria/{industry}.json (시장별 병목 기준)
                                        ▼
                              data/markets/analysis/{industry}.json (자동 병목 신호)
                                    · 병목 압력·수요 모멘텀 (신호 감쇠 집계)
                                    · severity 전이 '제안' + 병목 이동 경보
                                    · 루틴이 다음 주기에 검증 후 구조 파일에 반영 (자동 반영 아님)
                                        │
                                        ▼
              웹 대시보드  주식 탭 → '시장 지도' (app.js renderMarketCascade)
              뉴스는 ① 노드 배지 ② 클릭 상세 ③ 하단 통합 피드 세 곳에 표시
              자동 신호는 ① 노드 ▲▼ ② 보드 상단 스트립 ③ 상세 게이지에 표시
```

- **티커 뉴스**는 daily 루틴이 채우고, 시장 노드는 소속 watchlist 기업의
  `narrative_score` 를 **자동 평균**해 "시장 뉴스 시그널"로 보여준다.
  → 시장 리서치 루틴이 이걸 다시 쓸 필요는 없다.
- **시장 단위 뉴스**(특정 티커에 안 붙는 업황 — "HBM 매진", "전력망 병목",
  "CoWoS 증설" 등)는 이 루틴이 **`data/markets/news/{industry}.json`** 의
  `markets.<시장id>[]` 에 누적한다(최신순, 시장당 최대 20개 보관).
  맵 JSON 안의 구 `recent_news` 필드는 폐지됐다.
- **시장 구조·규모·병목 상태**(노드/링크/severity)도 이 루틴이 갱신한다.
  이게 시각화의 핵심 — 뉴스가 "적소에" 꽂히는 곳이다.

---

## 데이터 모델 — `data/markets/{industry}.json`

웹(`app.js`)이 읽는 **단일 진실 공급원(SSOT)**. 이 파일만 고치면 시각화가 바뀐다.

```jsonc
{
  "id": "ai-semiconductor",
  "title": "...", "subtitle": "...", "as_of": "2026-06",
  "severity_legend": { "structural": {...}, "acute": {...}, "easing": {...},
                       "emerging": {...}, "demand_limited": {...} },
  "layers":  [ { "id": "demand", "label": "① 최종 수요", "desc": "..." }, ... ],
  "markets": [ {
      "id": "hbm", "layer": "components",
      "name_kr": "HBM (고대역폭 메모리)", "name_en": "High Bandwidth Memory",
      "definition": "한 줄 정의 — 무슨 수요를 충족하는가",
      "size_usd_b": 35,                 // 노드 크기 시각화용 대표값 ($B)
      "size_label": "$34–35B(’25)→$100B(’28)",  // 사람이 읽는 규모 표기
      "growth": "~40% CAGR",
      "size_confidence": "low|med|high|very_low",  // 출처가 갈리면 낮게
      "demand_driver": "무엇이 이 수요를 끌어당기는가",
      "bottleneck": { "severity": "acute", "limit": "기술적/물리적 한계 설명" },
      //  또는  "bottleneck": null  (병목 아님)
      "weekly_note": "이번 주 시장 흐름·변화 1~2문장 (이 루틴이 매주 갱신)",
      "players": [
        // share = 이 시장에서의 점유율(%) — 노드의 막대 그래프로 시각화됨
        { "name": "SK Hynix", "ticker": "000660.KS", "role": "~62%", "share": 62 },
        { "name": "Micron",   "ticker": "MU", "role": "~21%", "share": 21, "in_watchlist": true }
      ],
      "sources": [ "https://...", "https://..." ]
  } ],
  "links": [ { "from": "ai-gpu", "to": "hbm", "label": "HBM 동봉 (필수)" } ]
  //  from = 수요(상류) · to = 공급(하류).  시각화는 위(수요)→아래(공급).
}
```

규칙:
- `players[].in_watchlist: true` 는 `data/index.json` 의 `stocks[]` 에 그 티커가
  있을 때만. 그래야 웹이 narrative_score 를 자동 집계한다.
- watchlist 밖 핵심 기업(SK하이닉스·삼성·Marvell·Vertiv 등)도 `ticker` 와 함께
  넣되 `in_watchlist` 는 생략/false → 웹에 "데이터 예정"으로 표시된다.
- `players[].share` 는 그 시장에서의 점유율(%, 숫자). 웹이 노드에 막대 그래프로
  그리고, 합이 100 미만이면 '기타'로 채운다. 점유율이 무의미한 시장(전력망·소재
  등)은 생략한다.
- `weekly_note` 는 **매주 갱신**하는 시장 흐름·변화 1~2문장. 웹 상세 패널의
  '이번 주 시장 흐름'에 표시된다 (시장의 '분위기'를 서술).
- `bottleneck.severity` 는 `severity_legend` 의 키 중 하나여야 한다.
  웹은 **`structural`(독점)·`acute`·`easing`·`emerging`(병목)만 색으로 강조**하고
  `demand_limited`·비병목은 중립 톤으로 둔다.
- `links` 의 `from`/`to` 는 반드시 존재하는 market `id`.
- `diagram` 블록이 웹 다이어그램의 배치를 정한다: `flow[]` = 좌(장비·소재)→우(수요)
  메인 체인 클러스터(제목·색·소속 시장 id), `bands[]` = 하단 가로 밴드. 새 시장은
  여기에도 배치한다(누락 시 `layer_default` 로 자동 배치). 화살표는 공급→수요
  방향(`links` 의 to→from)으로 그려진다.

---

## 데이터 모델 — `data/markets/news/{industry}.json` (시장 뉴스 스토어)

시장 단위 뉴스의 SSOT. 맵(구조)과 분리되어 있어 뉴스만 자주 갱신해도 diff 가 깨끗하다.

```jsonc
{
  "industry": "ai-semiconductor",
  "updated": "2026-06-10",            // 마지막 갱신일 — 손댈 때마다 갱신
  "markets": {
    "hbm": [                           // key = 맵의 market id (반드시 존재해야 함)
      { "date": "2026-01-15",          // YYYY-MM-DD (일자 불명이면 YYYY-MM)
        "title": "한국어 헤드라인", "source": "SemiEngineering",
        "url": "https://...", "impact": "+|-|neutral",
        "summary": "한 줄 한국어 요약 (~50자)" }
    ]                                  // 배열은 최신순 · 시장당 최대 20개 보관
  }
}
```

웹은 이 파일로 노드 뉴스 배지(건수·최신일·14일 내 신규 강조), 클릭 상세(최신 6개
+ 더보기), 보드 하단 통합 뉴스 피드(시장 칩 클릭 → 지도에서 해당 노드 선택)를 그린다.

각 뉴스에는 **`signals[]` 방향성 태그가 필수**다 (없으면 키워드 폴백으로만 분류됨):

```jsonc
"signals": [ { "type": "supply_tightening", "strength": 3 } ]
// type: supply_tightening(공급 긴축) | supply_easing(공급 완화)
//     | demand_up(수요 확대) | demand_down(수요 축소)
// strength: 1(약) ~ 3(강) · 복수 신호 가능 · 방향성 없으면 []
```

---

## 데이터 모델 — 자동 병목 신호 (market pulse)

"뉴스가 쌓이기만 하고 지도는 손대야만 바뀐다"를 해결하는 층. 병목의 기준은
시장마다 다르므로(HBM=적층 수율·매진 시한, 전력망=계통접속 대기·터빈 리드타임,
로봇부품=희토류 통제…) 기준을 시장별로 명시하고, 스크립트가 뉴스 신호를
결정적으로 집계한다. **탐지(스크립트)와 판단(루틴)은 분리** — 스크립트는 지도를
직접 고치지 않고 '제안'만 쓴다.

| 파일 | 역할 | 편집 주체 |
|---|---|---|
| `data/markets/criteria/{industry}.json` | 시장별 병목 판정 기준 — `bottleneck_type`(capacity/monopoly/demand/policy/finance), `key_metrics`, `escalate_when`/`deescalate_when`, 폴백 `keywords`, 임계값(`defaults`) | 루틴/사람 |
| `data/markets/analysis/{industry}.json` | `scripts/market_pulse.py` 산출물 — 시장별 병목 압력(-1~+1)·수요 모멘텀·성장 전망·`severity_change_proposed` 제안·`bottleneck_migration` 경보·근거 뉴스 | 스크립트 전용 |

집계 규칙 (criteria `defaults` 로 조정):
- **시간 감쇠**: 반감기 60일 — 오래된 헤드라인은 저절로 힘이 빠진다 (윈도 150일).
- **Hysteresis**: 승급 제안은 압력 ≥ +0.45 **이면서** 긴축 신호 ≥2건·독립 소스 ≥2곳일 때만.
  완화는 ≤ −0.35 + 완화 신호 2건/2소스. 단발 헤드라인 하나로 지도가 안 바뀌게.
- **structural(구조적 독점)은 자동 전이 금지** — 대체 공급원 등장은 사람이 판단.
- **병목 이동 감지**: 완화 중인 시장의 `links` 인접 시장이 조여오면 경보
  (예: CoWoS 완화 → HBM·전력 긴축 = 2024→2026 병목 이동 패턴).
- **수혜 경로**: 압력 높음 + 수요 양(+) 시장은 점유율 상위 공급사에 가격결정력
  신호를 표시 (투자 조언 아님 — 구조 기술만).

---

## 현재 산업 맵

| 파일 | 산업 | 시장 수 |
|---|---|---|
| `ai-semiconductor.md` → `data/markets/ai-semiconductor.json` (+ `data/markets/news/ai-semiconductor.json`) | AI · 반도체 · 피지컬 AI | 30 |
| `pharma-bio.md` → `data/markets/pharma-bio.json` (+ `data/markets/news/pharma-bio.json`) | 제약 · 바이오 | 18 |

웹의 '시장 지도' 탭은 `app.js` 의 `MARKET_MAPS` 레지스트리(`{ id, label }`)로
산업을 전환한다. 새 산업 맵을 추가하면 여기에 한 줄, `MARKET_MAPS` 에 한 줄을 넣는다.

새 산업 추가 절차는 각 산업 md 의 "새 산업 맵 만들기" 절을 따른다.
