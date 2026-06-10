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
   (이 디렉토리)              data/markets/news/{industry}.json     (시장 뉴스 스토어)
                                    · 시장 규모/성장/병목 상태 갱신 (구조 파일)
                                    · 시장 단위 헤드라인 누적 (뉴스 스토어, 시장당 ≤20)
                                        │
                                        ▼
              웹 대시보드  주식 탭 → '시장 지도' (app.js renderMarketCascade)
              뉴스는 ① 노드 배지 ② 클릭 상세 ③ 하단 통합 피드 세 곳에 표시
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

---

## 현재 산업 맵

| 파일 | 산업 | 시장 수 |
|---|---|---|
| `ai-semiconductor.md` → `data/markets/ai-semiconductor.json` (+ `data/markets/news/ai-semiconductor.json`) | AI · 반도체 · 피지컬 AI | 27 |

새 산업 추가 절차는 각 산업 md 의 "새 산업 맵 만들기" 절을 따른다.
