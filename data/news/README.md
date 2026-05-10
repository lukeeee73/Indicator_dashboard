# data/news/ — 정성(qualitative) 평가 누적 폴더

Claude Code Routines가 매일 한 번 실행되어 watchlist 종목의 뉴스·공시·경쟁사
동향을 수집·요약해 이 폴더에 누적한다.

## 디렉토리 구조

```
data/news/
├── README.md            (이 파일)
├── AAPL/
│   ├── 2026-05-10.json
│   ├── 2026-05-11.json
│   └── ...
├── MSFT/
│   └── ...
└── ...
```

## 한 파일 스키마

자세한 스키마는 `.claude/routines/daily-market-analysis.md` 참고.

핵심 필드:
- `narrative_score`: -1.0 ~ +1.0 (음수=악화, 양수=개선)
- `news[]`: 최근 24시간 뉴스 요약
- `competitor_context[]`: 경쟁사 동향
- `summary_kr`: 한 줄 한국어 요약

## 어떻게 쓰이나

`scripts/merge_qualitative.py` 가 매번 fetch_fred 실행 시 이 폴더의 가장
최근 파일들을 읽어 `data/stocks/{TICKER}.json` 의 `valuation.qualitative`
블록에 주입한다. 프론트엔드는 stocks JSON만 읽으면 정성 점수까지 함께
표시할 수 있다.

## 보존 정책

오래된 일별 파일은 git 히스토리에 남으니 워킹 디렉토리에서는 **최근 90일치만**
유지한다 (정리 책임은 Routine 측). 장기 추세는 stocks JSON 의
`qualitative.history` 배열에 narrative_score만 30포인트로 압축 보관.
