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

수집 이후 `scripts/analyze.py` 가 두 층의 판정을 `assessment` 블록에 저장합니다.

### 종합 판정 (Primary — 백테스트 검증 모델)

대시보드 헤드라인. 1980–2026 워크포워드 백테스트(발표 지연 시뮬레이션 포함)에서
8개 후보 모델 중 가장 좋았던 **모델 H** 의 판정입니다.

- **성장 축**: 지표별 사이클-상대 백분위
  = 8년 사이클 창 백분위 50% + 6개월 변화 백분위 30% + 10년 창 백분위 20%
  — "역사 전체에서 어디인가" 가 아니라 "지금 사이클에서 어디이고, 어디로 가는가"
- **인플레 축**: 지표별 1945 이후 전체 분포 백분위 (레벨)
- 두 축 모두 **선행/동행/후행 가중**(선행 2.0 · 동행 1.0~1.5 · 후행/공급측 0.5)
- 축 점수를 월 단위로 산출한 뒤 **EWMA(span=3) 평활** → 60/40 임계로 라벨

| 신호 | 적중 | 중위 선행 | FPR | flips/yr |
|---|---|---|---|---|
| 성장 low → NBER 침체 | 4/4 | **+16개월** | **7.7%** | 0.54 |
| 인플레 high → 고인플레 국면 | 3/3 | +0개월 | **5.9%** | 0.52 |

(베이스라인 단순 백분위 평균 대비 FPR 을 1/3~1/2 로 줄이면서 선행성 유지.
전체 비교는 `data/eval/comparison.json`, 재현은 `python scripts/compare_models.py`)

### 참조용 백분위 뷰 (Full / Rolling 10y)

각 지표의 현재값을 두 개의 참조 창에 대한 **백분위(percentile)** 로 환산한
단순 평균 — 종합 판정과 엇갈리는지 비교하는 보조 뷰로 유지합니다.

- **장기 기준 (Full)**: 1945-09-02(2차 세계대전 종전) 이후 전체 분포
- **단기 기준 (Rolling 10y)**: 최근 10년 분포 — 단기부채 사이클(~5~8년) 을 감쌈
- 백분위 ≥ 60 → `high`, ≤ 40 → `low`, 그 사이 → `neutral`
- 두 창의 판정이 엇갈리면 대시보드 상단에 "레짐 전환 가능성" 문구가 자동 생성됨
- 24개월 궤적이 2D 산점도(X: 인플레 · Y: 성장) 위에 표시됨 (종합 판정 기준)

한국 탭은 백테스트 정답지(침체/인플레 episode)가 미국 기준이라 아직 종합 판정
없이 참조용 백분위 뷰만 제공합니다.

기존 JSON 에 `assessment` 를 재계산만 하고 싶을 때는 네트워크 없이 이렇게:

```bash
python scripts/analyze.py
```

### 모델 검증 (backtest)

`data/labels/` 의 정답지(NBER 침체 + 사전 등록 규칙 기반 인플레 episode)에 대해
각 월말 시점에 "그때 알 수 있었던 데이터"(발표 지연 시뮬레이션)만으로 판정을
재실행해 채점합니다. 하이퍼파라미터는 모두 사전 등록 — 결과를 보고 조정하지
않습니다 (과적합 방지).

```bash
python scripts/backtest.py         # 베이스라인 채점 → data/eval/baseline.json
python scripts/compare_models.py   # 모델 A~H 비교 → data/eval/comparison.json
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
│   ├── assets/
│   │   └── <CODE>.json      # 비교 자산별 전체 payload
│   └── principles/
│       └── timeline.json    # 원칙 탭 시나리오 데이터 (scripts/build_principles.py)
├── scripts/
│   ├── fetch_fred.py        # FRED API → data/ 분할 저장
│   ├── analyze.py           # percentile/label/quadrant 재계산 (CLI)
│   ├── build_principles.py  # 원칙 탭용 국면·자산수익률 타임라인 생성
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

## 원칙 (Principles) 탭 — 레이 달리오식 시나리오 타임머신

대시보드 상단의 **🧭 원칙** 탭은 "과거 특정 시점으로 돌아가 그 때 알 수 있었던
정보만으로 투자 결정을 내렸다면 수익률이 어땠을까"를 시뮬레이션하는 개인용
백테스트 실험실이다. 레이 달리오의 성장×인플레이션 4분면 프레임워크에서
아이디어를 가져왔다.

- **국면 판정**: 진입 시점의 4분면은 `scripts/backtest.py` / `compare_models.py`
  가 이미 구현한 **발표 지연(release lag) 시뮬레이션 + 모델 H(백테스트 승자)**
  워크포워드를 그대로 재사용한다 — 그 시점 이후 데이터는 전혀 보지 않는다.
- **자산 수익률**: 레포에 이미 있는 시계열만 사용해 자산별 수익률 지수를
  근사한다 (외부 API 재호출 없음).
  - 미국 10년 국채 — FRED `DGS10` 금리에서 duration 근사로 총수익 지수 역산
  - 미국 주식 — `data/indices/GSPC.json` (S&P500, 가격지수, 배당 미반영)
  - 한국 주식 — `data/assets/KOSPI.json` (가격지수, KRW)
  - 금 — `data/assets/GOLD.json` (XAU/USD 현물, 수집된 뒤부터 자동으로 나타남)
  - 현금 — 단기금리 데이터가 없어 무이자 보유(명목가치 고정)로 근사
  - 각 근사의 한계는 결과 화면과 `data/principles/timeline.json` 의 `note`
    필드에 그대로 노출된다.
- **시장 지표 스냅샷**: 진입 시점 국면 카드와 결과 화면에 그 시점의
  **미국 기준금리(FEDFUNDS)·10년물 국채 금리(DGS10)·금 시세·CPI YoY** 를 함께
  보여준다. 결과 화면에는 진입 vs 청산 시점의 지표 비교표(금리는 %p 변화, 금은
  % 변화)가 표시된다. 아직 수집 전인 지표(기준금리·금)는 "—" 로 표시되고 다음
  주간 갱신 때 채워진다.
- **시뮬레이션**: 진입/청산 시점(월 단위)과 자산 배분(%)을 정하면 buy & hold
  기준 총수익률·연환산·물가반영 실질수익률을 계산하고, 보유 기간의 국면 경로
  (NBER 침체·고인플레 episode 오버레이 포함)와 국면 기반 참고용 배분 대비 비교,
  자동 생성된 "원칙 초안" 텍스트를 보여준다.
- **비슷한 과거 국면 찾기 (4분면 필터)**: Q1~Q4 필터를 고르면 같은 분면이
  연속됐던 과거 구간(episode)을 모두 찾아 최신순으로 나열한다. 각 구간 카드에는
  그 때의 기준금리·10년물·금·CPI 변화, 국면 중 자산별 성과(S&P500·코스피·금·채권
  근사), 국면 종료 후 12개월의 자산 성과, NBER 침체 겹침 여부가 표시된다.
  "내가 지금 Q1이라면 과거의 Q1들은 어떻게 흘러갔나"를 비교하는 용도다.
- **원칙 저널**: 계산 결과를 저장하면 브라우저 `localStorage` 에 쌓이며, 반복해서
  시나리오를 시험하며 나만의 투자 원칙을 만들어가는 것이 목적이다. JSON 내보내기로
  백업할 수 있다.

데이터 갱신:

```bash
python scripts/build_principles.py   # data/principles/timeline.json 재생성
```

새 지표를 수집하지 않고 기존 `data/` 를 재조합만 하므로 네트워크 호출이 없다.
국면/지표 데이터가 갱신되면(주간 자동 수집) 다시 실행해 최신 상태로 맞춘다.

> ⚠️ 국면 판정과 자산 수익률 모두 이 레포 데이터로 만든 교육용 근사치이며,
> 투자 조언이 아니다.

---

## 설계 원칙

- **의존성 최소화**: 표준 라이브러리 + `requests` 만 사용. 학습과 유지보수 부담을 낮추기 위함.
- **안전 모드**: 한 지표가 실패해도 나머지는 계속 수집. 전부 실패하면 기존 JSON을 덮어쓰지 않음.
- **시간대 일관성**: 모든 타임스탬프는 UTC, ISO 8601 포맷.
- **수집과 판단의 분리**: 이 리포는 파이프라인/대시보드까지만. 주간 판단 노트는 별도 Obsidian vault 에서 관리.

---

## 위키 탭 — luke_wiki 지식 그래프

대시보드 왼쪽 사이드바의 **위키** 탭은 Obsidian vault(`lukeeee73/luke_wiki`)의
노트와 `[[위키링크]]` 구조를 force-directed 그래프로 시각화한다
(노드 크기 = 연결 수, 색 = 폴더, 노드 클릭 → 상세 패널 + GitHub 원문 링크).

데이터(`data/wiki/graph.json`)는 `scripts/build_wiki_graph.py` 가 생성한다:

1. 이 저장소 **Settings → Secrets and variables → Actions** 에
   `WIKI_REPO_TOKEN` 시크릿 추가 — luke_wiki 저장소 *Contents: Read* 권한의
   fine-grained Personal Access Token.
2. 주간 갱신 워크플로(`update.yml`)가 luke_wiki 를 체크아웃해 그래프를 자동 재생성한다.
   Actions 에서 **Update FRED Indicators** 를 수동 실행하면 즉시 만들어진다.
3. 로컬 생성: `python scripts/build_wiki_graph.py --vault ../luke_wiki --out data/wiki/graph.json`

토큰이 없으면 워크플로는 이 단계를 건너뛰고, 위키 탭에는 설정 안내가 표시된다.

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
- [x] **5단계 — 시장(수요) 중심 시각화** (현재)
  기업이 아니라 **'시장'** 단위로 보는 **AI·반도체 시장 지도** (주식 탭 → 시장 지도).
  **왼쪽(최종 수요) → 오른쪽(공급·병목)** 가로 6개 층의 23개 시장을 그리고,
  **독점·병목(HBM·전력·CoWoS·EUV 등)만 색으로 강조**(나머지는 기본 톤)한다.
  각 시장 노드는 참여 기업의 **점유율**을 막대로 보여주고, 클릭 시 **시장 분위기·
  이번 주 흐름·기술적 한계·플레이어 점유율·뉴스 시그널**을 표시한다. 데이터는
  `data/markets/ai-semiconductor.json` 하나에 모이며, 티커별 `narrative_score` 가
  시장별로 자동 집계된다. 조사·갱신은 `.claude/routines/market-research/` 루틴 담당.
- [x] **6단계 — 뉴스 기반 자동 병목 신호 (market pulse)** (현재)
  시장 지도가 "한번 만들면 안 바뀌는" 문제를 해결. 루틴이 누적하는 시장 뉴스에
  **방향성 신호 태그**(`signals`: 공급 긴축/완화·수요 확대/축소, 강도 1~3)를 달고,
  `scripts/market_pulse.py` 가 **시장별 병목 판정 기준**
  (`data/markets/criteria/`)에 따라 시간 감쇠·다중 소스 hysteresis 로 집계해
  시장별 **병목 압력·수요 모멘텀·severity 전이 제안·병목 이동 경보**
  (`data/markets/analysis/`)를 산출한다 (예: 2024 CoWoS → 2026 HBM·전력 이동 패턴).
  스크립트는 지도를 직접 고치지 않는다 — **탐지(스크립트)와 판단(루틴) 분리**:
  주간 market-research 루틴이 제안을 교차 검증한 뒤 지도에 반영한다. 웹 시장
  지도에는 노드 ▲▼ 압력 화살표·보드 상단 자동 신호 스트립·상세 패널 게이지로 표시.
- [x] **7단계 — 전력 · AI 인프라 시장 지도** (현재)
  AI 데이터센터발 전력 수요를 **조달 경로 중심**으로 그린 두 번째 시장 지도
  (`data/markets/power-ai.json`, 14개 시장). 핵심 질문은 "**BTM(구내 전용 발전)에
  얼마나 몰리는가 vs 그리드(계통 접속·PPA)에 얼마나 몰리는가**" — 전기가 만들어지는
  구조([연료 → 발전(터빈·원자로·PV) → 승압 → 송전 → 부하])를 따라
  연료(가스·우라늄) → 장비(가스터빈·변압기·ESS) → 발전원(가스·기존 원전·SMR·
  재생+ESS·연료전지) → 조달 경로(BTM vs FTM·송전망) → AI DC 수요의 5단 캐스케이드로
  배치했다. 어떤 경로든 **터빈·변압기라는 공통 장비 관문**을 지나는 것이 구조의 핵심.
  watchlist 에 "전력 인프라 (AI)" 그룹 10종(GEV·ETN·VRT·PWR·BE·OKLO + K-전력기기
  4종) 신설, market pulse 자동 신호·criteria·주간 루틴(`power-ai.md`) 동일 적용.

---

## 개별 종목 watchlist (14 섹터 그룹 · 131 종목)

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
| 전력 인프라 (AI)              | 10 | GEV · ETN · VRT · PWR · BE · OKLO · 두산에너빌리티 · HD현대일렉트릭 · 효성중공업 · LS일렉트릭 |
| 조선 (한국, KRW)              |  4 | HD현대중공업 · 한화오션 · 삼성중공업 · HD현대미포 |

각 카드에는 사업 모델 한 줄 설명, 1년 가격 추이, 4가지 핵심 재무 지표
(P/E·영업이익률·ROE·배당수익률), 분기 매출/이익 추세, 자체 산출 fair value 와
valuation gap, watchlist 내 경쟁사 비교, daily-market-analysis 루틴이 누적하는
정성 분석(narrative_score) 이 표시된다.

### 요일별 라운드로빈 (daily routine)

watchlist 가 131 종목으로 늘어 하루에 다 처리하면 부담이 크므로, daily routine 은
요일별로 섹터를 나눠서 처리한다. 매핑은 `scripts/watchlist_data.py` 의
`DAY_OF_WEEK_SECTORS` 에 정의되어 있다:

| 요일 | 처리 섹터 | 종목 수 |
|---|---|---|
| 월요일 | 빅테크 / 소프트웨어 | 10 |
| 화요일 | 반도체 | 10 |
| 수요일 | 자동차 / 모빌리티 + 조선 (한국) | 14 |
| 목요일 | 바이오 / 제약 / 헬스케어 | 10 |
| 금요일 | 에너지 / 원자재 + 유틸리티 / 전력 + 전력 인프라 (AI) | 30 |
| 토요일 | 금융 + 부동산 (REITs) | 20 |
| 일요일 | 소비재 + 산업재 / 방산 + 통신 / 미디어 | 30 |

7일에 한 번 모든 종목이 한 바퀴 도는 구조다. 가격·재무 데이터(`update.yml`)
는 여전히 주 1회 일괄 수집한다 — 가벼우므로.
