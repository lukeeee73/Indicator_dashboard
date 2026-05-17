# Dalio Dashboard

레이 달리오의 All Weather Portfolio 프레임워크를 참고해, **현재 경제 상황이 4분면(성장 ↑↓ × 인플레이션 ↑↓) 중 어디에 속하는지** 판단하기 위한 개인용 지표 모니터링 대시보드입니다.
자동화의 목표는 데이터 수집과 시각화까지이며, **해석과 판단은 수동**으로 진행합니다. 주간 판단 노트는 이 리포지토리가 아니라 별도 Obsidian vault(`luke-wiki`)에 수기로 작성합니다.

---

## 4분면 프레임워크

| 분면 | 성장 | 인플레이션 | 유리한 자산 (참고) |
|---|---|---|---|
| 1 | ↑ | ↑ | 원자재, 신흥국 주식, 인플레 연동채 |
| 2 | ↑ | ↓ | 선진국 주식, 회사채 |
| 3 | ↓ | ↑ | 금, 인플레 연동채, 원자재 |
| 4 | ↓ | ↓ | 국채(장기), 현금 |

## 수집 지표

| 지표 | FRED 코드 | 분면 | 변환 | 비고 |
|---|---|---|---|---|
| 10Y-2Y 금리차 | `T10Y2Y` | 성장 | — | 역전 시 침체 경고 (선행) |
| 산업생산 YoY | `INDPRO` | 성장 | YoY% | 성장 현재 상태 |
| 비농업 고용 YoY | `PAYEMS` | 성장 | YoY% | 성장 확산 지표 |
| 주 단위 선행지수 | `USSLIND` | 성장 | — | Philly Fed, 6개월 성장 전망 |
| CPI YoY | `CPIAUCSL` | 인플레 | YoY% | 표면 인플레 |
| Core CPI YoY | `CPILFESL` | 인플레 | YoY% | 끈적한(sticky) 인플레 |
| PCE YoY | `PCEPI` | 인플레 | YoY% | Fed 통화정책 준거 |
| 10Y BEI | `T10YIE` | 인플레 | — | 시장 기대 인플레 |
| WTI YoY | `DCOILWTICO` | 인플레 | YoY% (일간→월말) | 공급측 압력 |

지표를 추가/수정하려면 `scripts/fetch_fred.py` 상단의 `INDICATORS` 딕셔너리만 편집하면 됩니다.

---

## 자동 판정 (Assessment)

수집 이후 `scripts/analyze.py` 가 각 지표의 현재값을 두 개의 참조 창에 대한
**백분위(percentile)** 로 환산하고, 성장/인플레 축별 평균 점수와 4분면 판정을
`indicators.json` 의 `assessment` 블록에 저장합니다.

- **장기 기준 (Full)**: 1945-09-02(2차 세계대전 종전) 이후 전체 분포
- **단기 기준 (Rolling 10y)**: 최근 10년 분포 — 단기부채 사이클(~5~8년) 을 감쌈
- 백분위 ≥ 60 → `high`, ≤ 40 → `low`, 그 사이 → `neutral`
- 두 창의 판정이 엇갈리면 대시보드 상단에 "레짐 전환 가능성" 문구가 자동 생성됨
- 24개월 궤적이 2D 산점도(X: 인플레 · Y: 성장) 위에 표시됨

기존 JSON 에 `assessment` 를 재계산만 하고 싶을 때는 네트워크 없이 이렇게:

```bash
python scripts/analyze.py
```

---

## 디렉토리 구조

```
dalio-dashboard/
├── README.md
├── .gitignore
├── index.html               # 대시보드 진입점 (Chart.js CDN 로드)
├── style.css                # 다크 테마 + 반응형 카드 레이아웃
├── app.js                   # data/ fetch & 차트 렌더링 (국가 탭 + 섹터 서브탭)
├── vercel.json              # Vercel 배포 설정 (JSON 캐시 정책)
├── data/
│   ├── index.json           # 메타데이터 + assessment (4분면 판정) 요약
│   ├── indicators/
│   │   └── <CODE>.json      # 지표별 전체 payload — 개별 편집 가능
│   └── assets/
│       └── <CODE>.json      # 비교 자산별 전체 payload
├── scripts/
│   ├── fetch_fred.py        # FRED API → data/ 분할 저장
│   ├── analyze.py           # percentile/label/quadrant 재계산 (CLI)
│   └── requirements.txt
└── .github/workflows/
    └── update.yml           # 주 1회 자동 수집 + 커밋
```

> 각 지표/자산의 시계열은 **개별 JSON 파일**로 분리 저장됩니다. 개별 파일을 직접 열어서 편집·가공한 뒤 `python scripts/analyze.py` 를 돌리면 `current`(백분위·레이블) 와 `assessment` 를 재계산해 반영합니다.

---

## 로컬 실행

```bash
# 1. FRED API 키 발급: https://fred.stlouisfed.org/docs/api/api_key.html
export FRED_API_KEY="your_api_key_here"

# 2. 의존성 설치
pip install -r scripts/requirements.txt

# 3. 수집 실행
python scripts/fetch_fred.py
```

실행이 끝나면 `data/indicators.json` 이 갱신되고, 각 지표별로 `Fetching T10Y2Y... OK (520 points)` 형태의 로그가 찍힙니다.

### 대시보드 미리보기 (로컬)

정적 파일이라 어떤 HTTP 서버로도 띄울 수 있습니다. 파이썬 내장 서버가 가장 간편합니다.

```bash
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

> ⚠️ `file://` 로 직접 `index.html` 을 열면 `fetch("data/indicators.json")` 이 CORS 정책에 막혀 데이터가 안 보입니다. 반드시 HTTP 서버로 띄우세요.

---

## GitHub Secrets 설정

자동 수집을 위해 리포지토리에 FRED API 키를 Secret 으로 등록해야 합니다.

1. GitHub 리포지토리 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 클릭
3. Name: `FRED_API_KEY`, Value: 발급받은 API 키
4. **Add secret** 저장

이후 `.github/workflows/update.yml` 이 매주 월요일 09:00 UTC (한국시간 월요일 18:00) 에 자동 실행되며, 데이터가 바뀌었을 때만 `chore: update indicators (YYYY-MM-DD)` 커밋을 생성합니다.
Actions 탭의 **"Update FRED Indicators"** → **Run workflow** 버튼으로 수동 실행도 가능합니다.

---

## Vercel 배포

정적 사이트라 **빌드 단계가 없고**, Vercel 이 자동으로 감지해 루트를 그대로 서빙합니다.

### 최초 배포

1. https://vercel.com 로그인 (GitHub 계정으로 가입 권장)
2. **Add New... → Project** 클릭
3. **Import Git Repository** 에서 `lukeeee73/Indicator_dashboard` 선택 → **Import**
4. 설정 화면에서:
   - **Framework Preset**: `Other` (자동으로 잡힐 것)
   - **Build Command**: 비워두기
   - **Output Directory**: 비워두기 (루트 그대로)
   - **Install Command**: 비워두기
5. **Deploy** 클릭 → 30초 내외로 `https://<프로젝트명>.vercel.app` URL 발급

### 이후 자동 배포

Vercel 이 GitHub 의 default branch 를 감시하므로,
- 내가 코드를 푸시하거나
- GitHub Actions 가 `data/indicators.json` 을 자동 커밋하면

**자동으로 재배포**됩니다. 별도 동작 필요 없음.

### 캐시 정책 (`vercel.json`)

`data/indicators.json` 은 Vercel Edge CDN 에서 최대 5분만 캐시되도록 설정되어 있어, 주간 갱신이 곧바로 반영됩니다. 나머지 정적 파일은 기본 캐시 정책을 따릅니다.

---

## 설계 원칙

- **의존성 최소화**: 표준 라이브러리 + `requests` 만 사용. 학습과 유지보수 부담을 낮추기 위함.
- **안전 모드**: 한 지표가 실패해도 나머지는 계속 수집. 전부 실패하면 기존 JSON을 덮어쓰지 않음.
- **시간대 일관성**: 모든 타임스탬프는 UTC, ISO 8601 포맷.
- **수집과 판단의 분리**: 이 리포는 파이프라인/대시보드까지만. 주간 판단 노트는 별도 Obsidian vault 에서 관리.

---

## 로드맵

- [x] **1단계 — 데이터 파이프라인**
  FRED 호출 스크립트 + GitHub Actions 주간 자동 수집
- [x] **2단계 — 시각화** (현재)
  `index.html` + `app.js` + `style.css` + Chart.js 기반 카드형 대시보드
- [x] **3단계 — 배포** (현재)
  Vercel 연동 (GitHub 푸시 시 자동 재배포). 개인 도메인 연결은 선택.
- [x] **4단계 — 개별 종목 섹터별 확장** (현재)
  AI 편향을 줄이고 12개 섹터 그룹·**114 종목**으로 폭넓게 확장. 통신/미디어·유틸리티/전력 섹터 신설. 한국 조선·자동차 6종 포함 (KRW 통화 지원).

---

## 개별 종목 watchlist (12 섹터 그룹 · 114 종목)

대시보드의 **주식 탭 → 개별 종목** 에서 섹터별로 묶인 모든 종목 카드를 확인할 수 있다.
종목 정의는 `scripts/watchlist_data.py` 한 파일에 모여 있으며, 변경 후
`python scripts/gen_watchlist.py` 한 줄로 `fetch_fred.py` / `competitors.py` /
`app.js` 가 일관되게 재생성된다. 자세한 절차는
[.claude/routines/daily-market-analysis.md](.claude/routines/daily-market-analysis.md)
"종목·섹터 추가 가이드" 참고.

| 섹터 그룹 | 종목 수 | 대표 종목 |
|---|---|---|
| 빅테크 / 소프트웨어         | 10 | AAPL · MSFT · GOOGL · AMZN · META · ORCL · CRM · ADBE · IBM · PLTR |
| 반도체                        | 10 | NVDA · AMD · INTC · QCOM · TSM · ASML · AMAT · LRCX · AVGO · MU |
| 자동차 / 모빌리티            | 10 | TSLA · TM · F · GM · STLA · HMC · RIVN · NIO · 현대차 · 기아 |
| 바이오 / 제약 / 헬스케어     | 10 | LLY · NVO · JNJ · PFE · MRK · ABBV · AZN · UNH · TMO · ABT |
| 에너지 / 원자재              | 10 | XOM · CVX · COP · SHEL · OXY · SLB · FCX · NEM · LIN · APD |
| 금융                          | 10 | JPM · BAC · WFC · C · GS · MS · V · MA · AXP · BRK-B |
| 소비재                        | 10 | WMT · COST · KO · PEP · PG · MO · MCD · HD · NKE · SBUX |
| 산업재 / 방산                 | 10 | CAT · DE · BA · LMT · RTX · NOC · HON · GE · UPS · FDX |
| 부동산 (REITs)                | 10 | AMT · CCI · PLD · EQIX · DLR · O · SPG · WELL · PSA · VICI |
| 통신 / 미디어                 | 10 | VZ · T · TMUS · CMCSA · CHTR · NFLX · DIS · SPOT · EA · TTWO |
| 유틸리티 / 전력               | 10 | NEE · SO · DUK · AEP · EXC · CEG · VST · SRE · ED · D |
| 조선 (한국, KRW)              |  4 | HD현대중공업 · 한화오션 · 삼성중공업 · HD현대미포 |

각 카드에는 사업 모델 한 줄 설명, 1년 가격 추이, 4가지 핵심 재무 지표
(P/E·영업이익률·ROE·배당수익률), 분기 매출/이익 추세, 자체 산출 fair value 와
valuation gap, watchlist 내 경쟁사 비교, daily-market-analysis 루틴이 누적하는
정성 분석(narrative_score) 이 표시된다.

### 요일별 라운드로빈 (daily routine)

watchlist 가 114 종목으로 늘어 하루에 다 처리하면 부담이 크므로, daily routine 은
요일별로 섹터를 나눠서 처리한다. 매핑은 `scripts/watchlist_data.py` 의
`DAY_OF_WEEK_SECTORS` 에 정의되어 있다:

| 요일 | 처리 섹터 | 종목 수 |
|---|---|---|
| 월요일 | 빅테크 / 소프트웨어 | 10 |
| 화요일 | 반도체 | 10 |
| 수요일 | 자동차 / 모빌리티 + 조선 (한국) | 14 |
| 목요일 | 바이오 / 제약 / 헬스케어 | 10 |
| 금요일 | 에너지 / 원자재 + 유틸리티 / 전력 | 20 |
| 토요일 | 금융 + 부동산 (REITs) | 20 |
| 일요일 | 소비재 + 산업재 / 방산 + 통신 / 미디어 | 30 |

7일에 한 번 모든 종목이 한 바퀴 도는 구조다. 가격·재무 데이터(`update.yml`)
는 여전히 주 1회 일괄 수집한다 — 가벼우므로.
