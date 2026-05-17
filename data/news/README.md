# data/news/ — 대시보드용 정성(qualitative) 사이드카

Claude Code Routines (`.claude/routines/daily-market-analysis.md`) 가 매일 한 번
실행되어 watchlist 9 종목의 뉴스·공시·경쟁사 동향을 수집·요약한다.

**산출물은 두 곳으로 나간다 (dual-output)**:

1. **풍부한 마크다운 → `lukeeee73/luke_wiki` 의 `wiki/news/`**
   - 사실 추적이 가능한 누적 로그, 옵시디언에서 읽는 1차 산출물.
   - 자세한 규칙: <https://github.com/lukeeee73/luke_wiki/blob/main/wiki/news/README.md>
2. **최소 JSON → 이 폴더 (`data/news/`)**
   - 대시보드 표시용 score + 한 줄 요약.
   - `scripts/merge_qualitative.py` 가 `data/stocks/{TICKER}.json` 의
     `valuation.qualitative` 블록에 주입.
   - 프론트엔드는 stocks JSON 만 읽으면 정성 점수까지 함께 표시된다.

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

## 한 파일 스키마 (요약)

핵심 필드:

- `narrative_score`: -1.0 ~ +1.0 (음수=악화, 양수=개선)
- `news[]`: 최근 24 시간 뉴스 요약
- `competitor_context[]`: 경쟁사 동향
- `summary_kr`: 한 줄 한국어 요약
- `wiki_url`: 같은 날짜의 위키 누적 로그 링크 (NEW)

자세한 스키마와 출력 규칙은 `.claude/routines/daily-market-analysis.md` 의
§7 (JSON 저장) 참고.

## 보존 정책

- 일별 JSON: 워킹 디렉토리에서는 최근 90 일치만 유지. 이전 것은 git 히스토리에 남는다.
- `data/stocks/{TICKER}.json` 의 `qualitative.history` 배열: narrative_score 만
  최근 30 포인트로 압축 보관 (장기 추세용).
- **풍부한 본문(뉴스 헤드라인 요약, 검증/반증 노트) 의 장기 보존은 위키 쪽에서 담당**
  (`wiki/news/{TICKER}.md` 최근 60 일분 유지).

## 왜 마크다운으로 옮겼나

이전에는 JSON 만 매일 누적했지만 다음 한계가 있었다:

- 자유 텍스트 narrative 가 JSON 필드에 갇혀 사실 추적이 어려움.
- 같은 사실의 검증/반증을 시간순으로 연결할 구조가 없음.
- 옵시디언에서 직접 읽을 수 없음 (사용자가 폰에서 정성 정보를 보고 싶을 때 불편).

위키 마크다운으로 옮기면:

- `[!claim]` / `[!fact]` / `[~] refuted` 같은 callout/체크박스로 인식론적 상태 명시.
- "미해결 가설 → 검증/반증" 흐름을 매 실행마다 추적 가능.
- 옵시디언 git 플러그인이 main 을 pull 하면 폰에서 그대로 열림.
