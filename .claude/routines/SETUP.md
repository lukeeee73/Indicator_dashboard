# Claude Code 웹 루틴 등록 가이드 (claude.ai/code/routines)

루틴(Routine)은 **레포가 아니라 개인 claude.ai 계정에 저장**된다. 그래서 루틴을
삭제하면 프롬프트·스케줄 설정이 함께 사라진다. 이 문서는 루틴을 처음
등록하거나 삭제 후 복원할 때 웹 폼에 **정확히 무엇을 넣어야 하는지**의 단일
기준이다. (루틴이 실제로 *무엇을 하는지*는 각 루틴 md 가 기준 —
`daily-market-analysis.md`, `market-research/*.md`.)

> 공식 문서: <https://code.claude.com/docs/en/routines>
> 관리 화면: <https://claude.ai/code/routines> (CLI 에서는 `/schedule`)

---

## 등록할 루틴 — 2개

| # | Name | 스케줄 | 하는 일 | 절차 문서 |
|---|---|---|---|---|
| 1 | `daily-market-analysis` | 매일 · KST 21:00 권장 | 오늘 요일 섹터의 종목 뉴스 수집 → narrative_score → 대시보드·위키 반영 | `daily-market-analysis.md` |
| 2 | `weekly-market-research` | 매주 토요일 · KST 10:00 권장 | 3개 산업 시장 지도(AI·반도체 / 전력·AI / 제약·바이오) 구조·병목·시장 뉴스 갱신 | `market-research/README.md` + 산업별 md 3개 |

이 둘로 레포의 Claude 담당 파이프라인이 전부 커버된다. 나머지 자동화는
GitHub Actions 몫이라 루틴이 필요 없다:
`update.yml`(주간 FRED/시세) · `value-screen.yml`(월간 가치 스크리닝) ·
`wiki-sync.yml`(시간별 위키 그래프 동기화).

---

## 웹 폼 입력값 — 루틴 1: `daily-market-analysis`

claude.ai/code/routines → **New routine** 후 순서대로:

**① Name**: `daily-market-analysis`

**② Instructions (프롬프트 — 아래 전문을 그대로 붙여넣기)**:

```text
너는 lukeeee73/Indicator_dashboard 와 lukeeee73/luke_wiki 두 레포가 클론된
클라우드 세션에서 자율 실행되는 "일일 시장 분석" 루틴이다.

Indicator_dashboard 레포의 `.claude/routines/daily-market-analysis.md` 를 열어
그 절차를 0번부터 9번까지 순서대로, 생략 없이 따르라. 핵심 요약:

1. 오늘 **UTC 요일**에 배정된 섹터만 처리한다
   (`scripts/watchlist_data.py` 의 DAY_OF_WEEK_SECTORS 기준).
2. 해당 섹터 종목의 최근 24시간 뉴스를 수집하고 경쟁사 동향과 함께
   narrative_score 를 산출해 `data/news/{TICKER}/{오늘날짜}.json` 에 저장한다.
3. 저장 후 **반드시 `python scripts/merge_qualitative.py` 를 실행**한다.
   이걸 건너뛰면 뉴스가 대시보드에 반영되지 않는다.
4. luke_wiki 의 티커 로그(`wiki/news/tickers/`)·`_dashboard.md`·시장 종합
   파일을 갱신한다. 글쓰기 형식은 `Luke_wiki/wiki/news/FORMAT.md` (투자
   브리핑 v2)를 따른다.
5. 두 레포 모두: 현재 체크아웃된 세션 브랜치(브랜치명 하드코딩 금지)에
   커밋·푸시한 뒤, **기본 브랜치로 PR 을 만들어 즉시 squash 병합**한다.
   기본 브랜치 — Indicator_dashboard: `claude/build-indicators-pipeline-QFtLk`,
   luke_wiki: `claude/create-knowledge-repo-2LeNp`.
6. md 의 "완료 보고" 형식대로 처리 섹터·종목 수·병합 SHA·score 요약을 출력한다.

오늘 날짜의 뉴스 JSON 이 이미 있으면 덮어쓰지 말고 종료하라.
이 프롬프트와 md 파일이 다르게 말하면 **md 파일을 따른다**.
```

**③ 모델 선택** (Instructions 입력창의 모델 셀렉터): 가장 성능 좋은 모델 권장 —
뉴스 선별·점수 판정·한국어 요약 품질이 곧 산출물 품질이다.

**④ Repositories**: 두 개 모두 추가 — 하나라도 빠지면 실패한다.
- `lukeeee73/Indicator_dashboard`
- `lukeeee73/luke_wiki`

**⑤ Environment**: 아래 "공통 확인 설정" 참고 — **Network access 를 Full 로**.

**⑥ Select a trigger**: **Schedule → Daily**, 시간은 **KST 21:00** 권장.
- ⚠️ 시간은 브라우저 로컬 시간대(KST)로 입력된다. 루틴의 요일별 섹터는
  **UTC 요일** 기준이므로 반드시 **KST 09:00 이후** 시간으로 잡아야
  KST 요일 = UTC 요일이 일치한다 (KST 00:00~08:59 는 UTC 로는 전날).
- 스태거 때문에 실제 시작은 몇 분 늦을 수 있다 (루틴별 오프셋은 일정).

**⑦ Connectors / Permissions 탭** (폼 하단): 아래 "공통 확인 설정" 참고.

---

## 웹 폼 입력값 — 루틴 2: `weekly-market-research`

**① Name**: `weekly-market-research`

**② Instructions (전문 붙여넣기)**:

```text
너는 lukeeee73/Indicator_dashboard 와 lukeeee73/luke_wiki 두 레포가 클론된
클라우드 세션에서 자율 실행되는 "주간 시장 리서치" 루틴이다. 기업(티커)이
아니라 시장(수요) 단위로 산업 지도를 갱신한다.

먼저 Indicator_dashboard 의 `.claude/routines/market-research/README.md` 를
읽어 데이터 모델과 두 파이프라인의 관계를 파악한 뒤, 같은 디렉토리의 세
산업 루틴을 순서대로 실행하라:

1. `market-research/ai-semiconductor.md` (30개 시장)
2. `market-research/power-ai.md` (14개 시장)
3. `market-research/pharma-bio.md` (18개 시장)

각 md 의 절차를 그대로 따른다: 맵 로드 → (해당 산업에 criteria 가 있으면)
`python scripts/market_pulse.py --industry {id}` 로 자동 신호 확인 → 웹
리서치 → 시장 구조 JSON(`data/markets/{id}.json`)과 시장 뉴스 스토어
(`data/markets/news/{id}.json`, signals 태그 필수) 갱신 → luke_wiki 의 시장
종합 파일(`wiki/news/markets/{id}/`) 동기화 → 검증 → 커밋.

핵심 원칙:
- 가장 중요한 산출물은 bottleneck(병목) 상태 변화와 weekly_note 다.
- market_pulse 의 severity 전이 "제안"은 교차 검증 후에만 지도에 반영한다.
- 출처 URL 없는 수치·문장은 쓰지 않는다. 확신 없으면 비워둔다.
- 티커별 일일 뉴스(data/news/)는 daily 루틴 몫이다 — 건드리지 않는다.

마지막에 두 레포 모두: 세션 브랜치(하드코딩 금지)에 커밋·푸시 → 기본
브랜치로 PR 생성 후 즉시 squash 병합.
기본 브랜치 — Indicator_dashboard: `claude/build-indicators-pipeline-QFtLk`,
luke_wiki: `claude/create-knowledge-repo-2LeNp`.
완료 후 산업별 갱신 시장 수·병목 변화·병합 SHA 를 요약 출력하라.
이 프롬프트와 md 파일이 다르게 말하면 md 파일을 따른다.
```

**③~⑦**: 루틴 1과 동일 (두 레포 모두 추가 · Network Full · 모델 셀렉터 ·
커넥터 정리). **트리거만 다름**: **Schedule → Weekly → 토요일 KST 10:00** 권장
(같은 토요일에 daily 루틴도 돌지만 별도 세션이라 충돌 없음).

---

## 공통 확인 설정 (체크리스트)

등록 전·후 반드시 확인:

- [ ] **Repositories 에 두 레포 모두** — `Indicator_dashboard` + `luke_wiki`.
      두 루틴 다 위키에도 쓴다.
- [ ] **Environment → Network access = Full**. 기본(Default) 환경은
      **Trusted** 수준이라 패키지 저장소 등 기본 허용 목록 외의 도메인은
      전부 403 (`x-deny-reason: host_not_allowed`) 으로 막힌다. 이 루틴들은
      Yahoo Finance · Google News · Reuters · Naver 금융 · TrendForce 등
      **예측 불가능한 뉴스 도메인**을 돌아다니므로 Custom allowlist 로는
      감당이 안 된다 → Full 필수. (환경 설정: 루틴 편집 → Instructions 아래
      구름 아이콘 → 환경 hover → 설정 아이콘 → Network access 변경)
- [ ] **환경변수·setup script 불필요** — 루틴이 실행하는
      `merge_qualitative.py` / `market_pulse.py` 는 표준 라이브러리만 쓴다.
      (FRED API 키가 필요한 `fetch_fred.py` 는 GitHub Actions 몫.)
- [ ] **Connectors**: 계정에 연결된 커넥터가 기본으로 전부 포함된다 —
      이 루틴에 불필요한 것(Slack, Drive 등)은 제거. 커넥터의 모든 도구를
      루틴이 확인 없이 쓸 수 있으므로 최소화가 안전. GitHub 클론·PR 은
      커넥터가 아니라 기본 제공이라 제거 대상이 아니다.
- [ ] **Permissions → "Allow unrestricted branch pushes" = 끔(기본값) 유지**.
      루틴은 `claude/` 세션 브랜치에만 push 하고, 기본 브랜치 갱신은 GitHub
      API 의 PR 병합(서버측)으로 하므로 이 권한이 필요 없다. 켜면 보호
      장치만 사라진다.
- [ ] **스케줄 시간 = KST 09:00 이후** (요일별 섹터가 UTC 요일 기준이라
      KST 새벽 실행 시 전날 섹터가 돌아간다).
- [ ] **사용량**: 루틴은 구독 사용량을 차감하고 계정별 **일일 실행 횟수
      상한**이 있다. 잔여량은 claude.ai/code/routines 또는
      claude.ai/settings/usage 에서 확인.
- [ ] 커밋·PR 은 **내 GitHub 계정 명의**로 올라간다 (루틴은 개인 계정 소속).

## 등록 후 검증

1. 루틴 상세 페이지에서 **Run now** 로 즉시 1회 실행.
2. run 목록의 **초록 표시는 "세션이 에러 없이 종료됨"만 의미**한다 — 작업
   성공이 아니다. 세션을 열어 트랜스크립트에서 확인할 것:
   - 오늘 요일 섹터가 처리됐는지 (daily)
   - `merge_qualitative.py` 실행 로그가 있는지 (daily)
   - **두 레포 모두 PR 병합 SHA** 가 보고됐는지
3. 기본 브랜치에 오늘 날짜 파일이 실제로 들어왔는지 확인
   (`data/news/{티커}/{오늘}.json`, 위키 `_dashboard.md` 등).
4. 하루 이틀 뒤 대시보드에서 해당 섹터 종목 카드의 정성 분석 날짜가
   갱신됐는지 확인.

## 기타

- **일시정지/재개**: 루틴 상세 페이지의 Repeats 토글. 삭제하지 말고 토글로
  끄면 설정이 보존된다. (이번처럼 삭제하면 이 문서 보고 재등록.)
- **커스텀 주기** (예: 격주): 웹 폼은 프리셋만 지원 → 가까운 프리셋으로
  만든 뒤 CLI 에서 `/schedule update` 로 cron 표현식 지정 (최소 1시간 간격).
- **수동 보충 실행**: 며칠 빠졌으면 Run now 를 누르되, 루틴은 "오늘 요일"
  섹터만 돌므로 지난 요일 보충은 일반 세션에서
  "daily-market-analysis.md 를 X요일 섹터로 실행해줘" 라고 시키는 게 낫다.
