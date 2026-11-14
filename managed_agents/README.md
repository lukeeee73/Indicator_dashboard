# Claude Managed Agents

대시보드에 연결된 Claude Managed Agent 정의. 파일이 원본이고 `ant apply` 로 동기화한다.
`claude-lock.json`(ant apply 가 생성)이 리소스 ID 를 들고 있으니 커밋한다 — 없으면 다음 apply 가 중복 생성한다.

## rate-watch — 미국 기준금리 변동 리포트

| 파일 | 역할 |
|---|---|
| `agents/rate-watch.md` | 에이전트 (Claude Opus 5.5, 웹 검색·읽기는 연준·FRED·CNBC·Bloomberg·Yahoo Finance만) |
| `environments/rate-watch.yaml` | 클라우드 샌드박스, `limited` 네트워킹 |
| `../scripts/rate_watch.py` | FRED 로 변동 감지 → 세션 실행 → `data/reports/rates/` 저장 |
| `../.github/workflows/rate-watch.yml` | 화~토 13:30 UTC 실행 |
| `../js/rate-reports.js` | 미국 탭 "금리 변동 리포트" 패널 |

비용: 변동 확인은 LLM 을 쓰지 않는다. 세션은 목표 범위가 바뀐 날(연 8회 FOMC 중 변경된 회차)에만 열리고,
세션마다 `RATE_WATCH_BUDGET_CENTS`(기본 500 = $5) 상한이 걸린다.

### 최초 설정

```sh
# 1. ant CLI 설치(1.30.0+) 후 로그인
ant auth login

# 2. 에이전트·환경 생성 — 계획 확인 후 적용
cd managed_agents
ant apply --dry-run -v agents/rate-watch.md environments/rate-watch.yaml
ant apply agents/rate-watch.md environments/rate-watch.yaml

# 3. ID 확인
jq -r '.resources["./agents/rate-watch.md"].id, .resources["./environments/rate-watch.yaml"].id' claude-lock.json
```

GitHub 저장소 설정:
- Secrets: `ANTHROPIC_API_KEY` (기존 `FRED_API_KEY` 그대로 사용)
- Variables: `RATE_WATCH_AGENT_ID`, `RATE_WATCH_ENVIRONMENT_ID`, (선택) `RATE_WATCH_BUDGET_CENTS`

### 실행

```sh
FRED_API_KEY=... python scripts/rate_watch.py --check-only   # 변동 여부만
FRED_API_KEY=... python scripts/rate_watch.py --dry-run      # 킥오프 메시지 미리보기
python scripts/rate_watch.py --force                         # 최신 변경으로 리포트 강제 생성
```

첫 실행은 가장 최근 변경을 기준선으로만 기록하고 리포트를 만들지 않는다. 바로 리포트를 보고 싶으면
Actions 에서 `force` 를 켜고 수동 실행한다. 세션 진행은 스크립트가 출력하는 Console 링크에서 실시간으로 볼 수 있다.

에이전트 지시문이나 허용 사이트를 바꾸면 `ant apply` 를 다시 실행한다(새 버전이 생기고, 다음 세션부터 적용).
