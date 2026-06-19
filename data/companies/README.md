# data/companies/ — 기업 구조도 큐레이션 데이터

개별 종목을 클릭하면 뜨는 **기업 구조도**(company structure diagram)의
큐레이션 오버레이. 시장 지도(`data/markets/<id>.json`)와 같은 시각 언어로,
한 기업을 **좌(공급/상류) → 자사(사업 구조) → 우(수요/하류)** 흐름으로 그린다.

## 데이터는 두 겹으로 합쳐진다

1. **파생(자동 · 모든 종목)** — 코드가 시장 지도 전체의 `players[]`를 ticker로
   뒤져서 다음을 자동으로 끌어온다. **파일이 없어도 작동한다.**
   - 이 기업이 플레이어로 들어간 **참여 시장**(역할·점유율 포함)
   - 그 시장들의 **상류(공급) 시장 / 하류(수요) 시장**
   - 같은 시장의 **경쟁사**(co-players)
2. **큐레이션(이 폴더 · 선택)** — 파생으로는 알 수 없는 기업 내부 구조를 더한다.
   - **사업 구조의 기술적 분해**: 세그먼트 → 제품군 → 개별 제품/기술
     (유형 product·tech·platform 으로 시각 구분, 각 제품이 경쟁하는 시장 연결)
   - 이름이 붙은 **핵심 공급사 / 핵심 고객**
   - **투자 논지 / 한 줄 포지셔닝 / 경쟁사 코멘트**

> 가격·재무·valuation·정성(뉴스) 점수는 `data/stocks/<ticker>.json`에서
> **실시간으로** 읽어 온다. 이 파일에는 **구조 정보만** 담아 중복을 피한다.

## 새 기업 추가하는 법

`data/companies/<TICKER>.json` 한 개만 만들면 그 종목 카드의 "기업 구조도"가
큐레이션 버전으로 바뀐다. 시장 id 는 반드시 `data/markets/*.json` 의 실제
`markets[].id` 와 일치해야 노드 클릭 → 시장 지도 점프가 작동한다.

## 스키마 (AVGO.json 이 레퍼런스)

```jsonc
{
  "ticker": "AVGO",
  "name_kr": "브로드컴",
  "name_en": "Broadcom Inc.",
  "as_of": "2026-06",
  "one_liner": "한 줄 포지셔닝 (자사 노드에 표시)",
  "thesis": "투자 논지 · 구조 설명 (우측 상세 패널)",

  // 사업 구조 — 세그먼트 → 제품군(family) → 개별 제품/기술 의 3단 분해.
  // 자사 패널 중앙에 색으로 구분되어 그려진다.
  "segments": [
    {
      "id": "semi",
      "name_kr": "반도체 솔루션",
      "name_en": "Semiconductor Solutions",
      "share": 56,                    // 매출 비중(%) — 세그먼트 막대
      "color": "#e60024",             // 세그먼트 구분 색 (상단 보더·막대)
      "desc": "세그먼트 한 줄 설명",
      "families": [                   // 제품군
        {
          "name_kr": "AI 네트워킹 · 인터커넥트",
          "tag": "성장 핵심",          // 선택 — 제품군 옆 작은 뱃지
          "growth": true,
          "products": [               // 개별 제품/기술 (시각적으로 구분되는 잎)
            {
              "name": "Tomahawk 5/6",
              "kind": "product",      // product=제품 · tech=기술 · platform=플랫폼 (유형별 색)
              "tech": "이더넷 스케일아웃 스위치 ASIC (51.2T→102.4T)",
              "growth": true,         // true 면 ▲ 성장 표시 + 강조 테두리
              "markets": ["dc-networking"]   // 이 제품이 경쟁하는 시장 id (클릭 → 시장 지도)
            }
          ]
        }
      ]
    }
  ],
  // (간단 버전) families 대신 lines 도 지원 — { name, note, growth, markets } 배열.
  //   이 경우 제품군 없이 제품 카드만 그려진다 (kind 미지정).

  "suppliers": [                      // 핵심 공급사 (좌측 상류). market 은 선택
    { "name": "TSMC", "ticker": "TSM", "market": "foundry", "role": "≤3nm 위탁생산" }
  ],
  "customers": [                      // 핵심 고객 (우측 하류)
    { "name": "Google", "ticker": "GOOGL", "market": "hyperscaler-capex", "role": "TPU 코디자인 최대 고객" }
  ],

  "competitors": [                    // 선택 — 없으면 PEER_COMPETITORS + 같은 시장 co-players 로 자동
    { "ticker": "NVDA", "name": "NVIDIA", "role": "범용 AI GPU 경쟁" }
  ],

  "sources": ["출처 메모"]
}
```

### 필드 규칙

- `ticker` 가 watchlist(`STOCK_META`)에 있으면 공급사/고객/경쟁사 노드가
  **클릭 가능**해져 그 기업의 구조도로 이동한다. 비상장이면 `"ticker": null`.
- `market` / `markets` 의 값은 시장 지도의 노드 id. 여러 지도(AI·반도체,
  제약·바이오 …)에 걸쳐 자동 탐색하므로 지도 id 는 적지 않아도 된다.
- 모든 필드는 선택. 최소한 `segments` 만 있어도 자사 사업 구조가 그려진다.
