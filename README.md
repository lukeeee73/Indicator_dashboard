# Luke Dashboard — 통화 가치·환율·인플레이션

한국과 미국의 **통화 가치, 환율, 인플레이션**을 살펴보는 개인용 지표 대시보드입니다.
첫 화면은 한국이며, 사이드바에서 **한국 → 미국 → 주식**으로 이동합니다.
국가별 화면 상단에는 **현재 국면과 성장 × 인플레이션 4분면 차트**를 표시하고,
지표는 **통화 가치·환율**과 **인플레이션** 두 영역으로 구성합니다.

- 한국: 원/달러 환율과 국채금리·통화량·정부부채, 소비자물가를 확인합니다.
- 미국: 무역가중 달러 지수와 국채금리·통화량·재정·국채 수요, 물가 지표를 확인합니다.
- 주식: 시장 지수, 개별 종목, 가치 발굴, 시장·기업 지도와 연결된 연구 노트를 유지합니다.

위키와 원칙 탭, 원칙 시뮬레이터·생성 파이프라인, 성장 지표 섹터는 제거했습니다.
기존 지표의 해석 방식은 이후 별도로 검토합니다. 수집된 원본 자료와 과거 분석 도구는 보존합니다.

## 현재 국면과 4분면 차트

한국·미국 화면의 **현재 국면 (자동 판정)** 패널은 기존 `assessment_kr`·`assessment`를
사용합니다. 장기 기준과 최근 10년 기준의 성장·인플레이션 점수와 국면을 표시하며,
미국은 기존 종합 판정 자료가 있으면 해당 카드도 표시합니다.

차트의 X축은 인플레이션, Y축은 성장이며 경계는 기존 40/60입니다. 최근 24개월
궤적과 **현재 위치를 나타내는 붉은 점**을 함께 표시합니다. 한국·미국의 **4분면 프레임워크**
참고 카드도 기존 문구 그대로 유지합니다. 4분면 점수에는 growth/inflation 지표만 쓰이며, 생활·실물 섹터 지표는 포함되지 않습니다.

## 데이터와 지표

| 화면 | 주요 기존 자료 | 코드 예시 |
|---|---|---|
| 한국 통화 가치·환율 | 원/달러 환율, 10년 국채금리, M2, GDP 대비 정부부채, 실질실효환율 | `DEXKOUS`, `IRLTLT01KRM156N`, `MYAGM2KRM189S`, `GGGDTAKRA188N`, `RBKRBIS` |
| 한국 인플레이션 | CPI 전년 대비 변화율 | `KORCPIALLMINMEI` |
| 한국 고용·주거·신용·무역 | 실업률, BIS 실질 주택가격, 가계부채 %GDP, 수출·수입 YoY | `LRHUTTTTKRM156S`, `QKRR628BIS`, `QKRHAM770A`, `XTEXVA01KRM667S` |
| 미국 통화 가치·환율 | 광의 무역가중 달러 지수, 국채금리, M2, 부채·국채 수요 | `DTWEXBGS`, `DGS10`, `M2SL`, `GFDEBTN`, `TREAST` |
| 미국 인플레이션 | CPI·Core CPI·PCE, 기대 인플레이션, 생산자물가·원유 | `CPIAUCSL`, `CPILFESL`, `PCEPI`, `T10YIE`, `T5YIFR`, `DCOILWTICO` |
| 미국 에너지·연료 | 휘발유·경유 소매가, 천연가스, 가정용 전기요금 | `GASREGW`, `GASDESW`, `DHHNGSP`, `APU000072610` |
| 미국 고용·소비·주거·신용·무역 | 실업률·핵심연령 고용률·구인·임금, 소매판매·실질소득·저축률, 집값·모기지·착공, 연체율·금융여건, 무역수지·수입물가 | `UNRATE`, `JTSJOL`, `RSAFS`, `CSUSHPINSA`, `MORTGAGE30US`, `NFCI`, `BOPGSTB` |

### 한국은행 ECOS

한국 지표는 `scripts/fetch_ecos.py`가 한국은행 ECOS Open API에서 받습니다. FRED에 있는
OECD MEI 한국 계열(CPI·M2·산업생산·심리 등)은 2023~2024년에 갱신이 멈췄기 때문입니다.
`fetch_fred.py`가 실행될 때 `ECOS_API_KEY` 환경변수가 있으면 함께 수집하고, 없으면 ECOS만
건너뛰어 기존 값을 유지합니다. 키는 https://ecos.bok.or.kr/api/ 에서 무료로 발급되며 GitHub
secret `ECOS_API_KEY`로 등록합니다(`update.yml`이 전달). ECOS 계열이 확보되면 `replaces`에
적힌 낡은 FRED 계열(`KORCPIALLMINMEI`, `MYAGM2KRM189S`, `KORPROINDMISMEI`)은 출력에서 빠집니다.
`category`가 `growth`/`inflation`인 ECOS 계열(산업생산·선행지수 순환변동치·BSI, CPI·근원물가·PPI)은
한국 4분면 점수에 들어갑니다.

국가 탭 안의 섹터 서브탭은 `js/metadata.js`의 `SECTOR_META` 순서를 따릅니다. 통화·물가
두 섹터는 `index.html`에 고정돼 있고, 나머지(에너지·고용·소비·주거·신용·무역)는 그 국가에
데이터가 있을 때만 화면이 자동으로 만듭니다. 지표의 섹터는 수집 시의 `category`이며,
`INDICATOR_META[code].sector`로 덮어쓸 수 있습니다. 새 국가 탭(예: 중국·일본)은
`panel-<CODE>`와 `.sector-nav`만 추가하고 지표에 `region: "<CODE>"`를 붙이면 같은 구성을 씁니다.
카드에는 마지막 관측일이 표시되며, 540일(약 18개월)보다 오래되면 갱신 중단 경고(⚠)가 붙습니다.

환율과 달러 지수는 이미 수집하는 `assets` 시계열을 사용합니다. 기존 지표의 기간 선택,
비교 차트, 주요 이벤트 표시는 유지합니다. 종목 데이터는 주식 탭을 처음 열 때 불러옵니다.

지표 정의는 `scripts/fetch_fred.py`의 `INDICATORS`와 `ASSETS`에 있습니다.
성장 지표는 기존 수집·분석 자료로 보관하고, `assessment`·`assessment_kr`는
국가별 현재 국면 패널과 4분면 차트에서 사용합니다. 개별 성장 지표 섹터는 표시하지 않습니다.
`scripts/analyze.py`, `scripts/backtest.py`, `scripts/compare_models.py`는 기존 자료를
재검토할 때 사용할 수 있는 오프라인 분석 도구로 남겨 둡니다.

---

## 디렉토리 구조

```
Indicator_dashboard/
├── README.md
├── .gitignore
├── index.html               # vendor + js/ 스크립트를 의존 순서대로 로드
├── style.css                # 다크 테마 + 반응형 카드 레이아웃
├── app.js                   # DOMContentLoaded 시작 코드
├── js/                      # 데이터 클라이언트·공통 함수·기능별 화면 코드
├── vercel.json              # Vercel 배포 설정 (JSON 캐시 정책)
├── data/
│   ├── index.json           # 메타데이터 + assessment (4분면 판정) 요약
│   ├── indicators/
│   │   └── <CODE>.json      # 지표별 전체 payload — 개별 편집 가능
│   ├── assets/
│   │   └── <CODE>.json      # 비교 자산별 전체 payload
│   ├── stocks/             # 주식 가격·재무 자료
│   └── wiki/               # 주식 시장 지도에서 사용하는 노트 색인·본문
├── scripts/
│   ├── fetch_fred.py        # FRED API → data/ 분할 저장
│   ├── analyze.py           # percentile/label/quadrant 재계산 (CLI)
│   ├── analytics_series.py  # 시계열 변환·월말 집계·백분위·EWMA 공통 함수
│   ├── data_io.py           # 수집 스크립트의 JSON 입출력 공통 함수
│   ├── build_static.js      # 배포용 dist/ 생성 (UI + vendor + 주식 연구 노트)
│   ├── build_wiki_graph.py  # 주식 연구 노트 색인·본문 내보내기
│   └── requirements.txt
└── .github/workflows/
    └── update.yml           # 주 1회 자동 수집 + 커밋
```

> 각 지표/자산의 시계열은 **개별 JSON 파일**로 분리 저장됩니다. 개별 파일을 직접 열어서 편집·가공한 뒤 `python scripts/analyze.py` 를 돌리면 `current`(백분위·레이블) 와 `assessment` 를 재계산해 반영합니다.

### 프런트엔드 모듈 구성

`index.html`은 일반 브라우저 스크립트를 순서대로 로드하고 마지막에 `app.js`가 화면을 시작합니다.
기존 인라인 이벤트 핸들러가 호출하는 전역 함수는 유지합니다. 모듈을 추가하거나 순서를 바꿀 때는
`index.html`과 스크립트 로드 회귀 테스트를 함께 확인합니다.

| 파일 | 책임 |
|---|---|
| `js/data-client.js` | API 요청 제한·타임아웃·재시도·문서 조회 |
| `js/metadata.js`, `js/watchlist.js` | 지표 표시 정보와 자동 생성 종목·경쟁사 목록 |
| `js/helpers.js`, `js/charts.js` | 표시 함수와 공통 차트 렌더링 |
| `js/dashboard.js`, `js/sidebar.js` | 탭별 지연 로딩·현재 국면과 4분면 차트·지표 카드·내비게이션 |
| `js/stocks.js`, `js/value-screen.js` | 종목·재무·가치 발굴 화면 |
| `js/market-map.js`, `js/player-map.js` | 시장 지도와 기업 지도 |
| `js/wiki-notes.js` | 주식 시장·기업 지도에서 공유하는 노트 조회·본문 뷰어 |

`js/watchlist.js`의 생성 구간은 `scripts/watchlist_data.py`를 수정한 뒤
`python scripts/gen_watchlist.py`로 갱신합니다.

### 리팩터링 회귀 검증

```bash
python -m pip install -r scripts/requirements.txt
python -m unittest discover -s tests -v
node --test --test-isolation=none tests/test_*.js
python -m compileall -q scripts
for source in app.js js/*.js scripts/*.js; do node --check "$source"; done
node scripts/build_static.js
git diff --exit-code -- data
```

회귀 테스트는 외부 데이터 API 호출 없이 임시 파일과 모의 응답을 사용합니다.
정적 빌드는 원본 `data/`를 수정하지 않으며, `dist/`에는 화면 코드·라이브러리·주식 연구 노트 JSON만 복사합니다.
생성된 HTML은 JavaScript·CSS 내용에 따른 버전 주소를 사용해 이전 파일 캐시가 새 화면과 섞이지 않도록 합니다.

데스크톱·모바일 브라우저 회귀 검증은 Playwright를 설치한 환경에서 실행합니다.
아래 검증은 `dist/`를 로컬 서버로 열고 원격 데이터 요청을 저장소의 자료로 대체합니다.

```bash
python -m pip install playwright
python -m playwright install chromium --only-shell
node scripts/build_static.js
python tests/browser_currency_smoke.py
```

스크린샷과 결과 JSON은 기본적으로 `/tmp/currency-browser-smoke/`에 저장합니다.

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

실행이 끝나면 `data/index.json`과 지표·자산·종목별 JSON이 갱신되고, 각 지표별로 `Fetching T10Y2Y... OK (520 points)` 형태의 로그가 찍힙니다.

### 대시보드 미리보기 (로컬)

정적 파일이라 어떤 HTTP 서버로도 띄울 수 있습니다. 파이썬 내장 서버가 가장 간편합니다.

```bash
node scripts/build_static.js
python -m http.server 8000 --bind 0.0.0.0 --directory dist
# 브라우저에서 http://localhost:8000 접속
```

> `file://` 대신 HTTP 서버로 실행하세요. 주식 연구 노트는 로컬 `data/wiki/`를 우선 사용하고, 지표·종목 등은 `js/data-client.js`의 원격 데이터 소스를 조회합니다.

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

`vercel.json`의 설정에 따라 `node scripts/build_static.js`로 정적 산출물을 만들고 `dist/`를 서빙합니다.

### 최초 배포

1. https://vercel.com 로그인 (GitHub 계정으로 가입 권장)
2. **Add New... → Project** 클릭
3. **Import Git Repository** 에서 `lukeeee73/Indicator_dashboard` 선택 → **Import**
4. 설정 화면에서:
   - **Framework Preset**: `Other` (자동으로 잡힐 것)
   - **Build Command**: `node scripts/build_static.js` (`vercel.json`에 정의)
   - **Output Directory**: `dist` (`vercel.json`에 정의)
   - **Install Command**: 비워두기
5. **Deploy** 클릭 → 30초 내외로 `https://<프로젝트명>.vercel.app` URL 발급

### 이후 자동 배포

Vercel 이 GitHub 의 default branch 를 감시하므로,
- 내가 코드를 푸시하거나
- GitHub Actions 가 `data/` 갱신 결과를 자동 커밋하면

**자동으로 재배포**됩니다. 별도 동작 필요 없음.

### 캐시 정책 (`vercel.json`)

`vercel.json`에는 기존 `/data/index.json`·`/data/indicators/*`·`/data/assets/*` 경로의 5분 CDN 캐시 설정이 남아 있습니다. 현재 정적 산출물의 데이터에는 주식 연구 노트 JSON만 포함되며, 지표·자산·종목 시계열은 원격 데이터 소스에서 조회합니다.

---

## 설계 원칙

- **의존성 관리**: 프런트엔드는 일반 JavaScript와 저장소의 차트·마크다운 라이브러리, 수집·분석 의존성은 `scripts/requirements.txt`로 관리.
- **안전 모드**: 한 지표가 실패해도 나머지는 계속 수집. 전부 실패하면 기존 JSON을 덮어쓰지 않음.
- **시간대 일관성**: 모든 타임스탬프는 UTC, ISO 8601 포맷.
- **수집과 판단의 분리**: 이 리포는 파이프라인/대시보드까지만. 주간 판단 노트는 별도 Obsidian vault 에서 관리.

---

## 주식 시장 지도와 연구 노트

주식 탭의 시장·기업 상세 화면은 Obsidian vault(`lukeeee73/luke_wiki`)의 노트를
본문 뷰어로 읽습니다. 위키 탭을 제거한 뒤에도 이 연결은 사용하므로
`js/wiki-notes.js`, 마크다운 렌더러, `data/wiki/`와 노트 동기화는 유지합니다.

### 시장·기업 노트 연결

시장 지도의 노드·기업 상세 패널에 있는 **옵시디언 위키 노트** 버튼으로
지도 요약과 관련된 원문을 읽습니다. 노트는 두 경로로 연결됩니다:

- **큐레이션**: 시장 JSON 의 `markets[].wiki: [{path, label}]` (vault 상대 경로,
  예: `wiki/concepts/hbm.md`). 연결된 노드에는 지도에서 **📖 n** 배지가 붙는다.
- **자동**: `players[].ticker` 를 루틴 뉴스 로그(`wiki/news/tickers/{TICKER} - *.md`)와
  매칭 — `daily-market-analysis` 루틴이 매일 누적하는 종목 뉴스가 그대로 지도에 꽂힌다.
  플레이어 지도(예: HBM)의 기업 상세에서도 같은 방식으로 열린다.

`data/wiki/graph.json` 이 아직 동기화 전이면 섹션은 조용히 숨겨진다.

### 데이터 생성

`scripts/build_wiki_graph.py` 가 vault 를 파싱해 두 가지를 만든다:

- `data/wiki/graph.json` — 노드/엣지 + frontmatter + 인식론 callout + 3D 좌표 점수
- `data/wiki/notes/{i}.json` — 노트 본문 (노트 뷰어; `--no-content` 로 끌 수 있음)

> ⚠️ 본문을 내보내면 대시보드 배포본에 노트 내용이 포함된다.
> 대시보드가 공개 URL 이면 노트도 공개되는 셈이니, 원치 않으면
> 워크플로의 빌드 명령에 `--no-content` 를 붙일 것.

접근 설정:

- **luke_wiki 가 공개(public) 저장소면 추가 설정 불필요** — 기본 토큰으로 체크아웃.
- 비공개면 **Settings → Secrets and variables → Actions** 에 `WIKI_REPO_TOKEN`
  시크릿 추가 (luke_wiki *Contents: Read* 권한의 fine-grained PAT).
- 체크아웃이 안 되면 위키 단계만 건너뛰고 나머지는 계속 진행된다.

### 갱신 주기 — 3단계

| 방법 | 지연 | 설정 |
|------|------|------|
| `wiki-sync.yml` 시간별 폴링 | 최대 1시간 | 기본 동작, 설정 불필요 |
| Actions 에서 **Sync Stock Research Notes** 수동 실행 | 즉시 | 버튼 클릭 |
| luke_wiki push → `repository_dispatch` | 푸시 후 ~1분 | 아래 참고 |

**푸시 즉시 반영 설정** — luke_wiki 저장소에 아래 워크플로를 추가한다
(`.github/workflows/notify-dashboard.yml`). Obsidian 의 git 플러그인으로
commit-and-sync 하는 순간 대시보드가 자동 갱신된다:

```yaml
name: Notify dashboard
on:
  push:
    branches: ["**"]   # 또는 사용 중인 기본 브랜치만
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -X POST \
            -H "Authorization: Bearer ${{ secrets.DASHBOARD_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/lukeeee73/Indicator_dashboard/dispatches \
            -d '{"event_type":"wiki-updated"}'
```

`DASHBOARD_DISPATCH_TOKEN` 은 **luke_wiki 저장소의 시크릿**으로,
Indicator_dashboard 에 *Contents: Read and write* 권한이 있는
fine-grained PAT 를 넣는다 (repository_dispatch 호출에 필요).

로컬 생성: `python scripts/build_wiki_graph.py --vault ../luke_wiki --out data/wiki/graph.json`

---

## 다음 검토

- 환율·통화량·금리·부채·인플레이션 자료의 역할과 해석 기준 정리
- 국가별 비교에 적합한 지표와 표시 단위 검토
- 주식 탭의 유지 범위 검토

---

## 개별 종목 watchlist (18 섹터 그룹 · 155 종목)

대시보드의 **주식 탭 → 개별 종목** 에서 섹터별로 묶인 모든 종목 카드를 확인할 수 있다.
종목 정의는 `scripts/watchlist_data.py` 한 파일에 모여 있으며, 변경 후
`python scripts/gen_watchlist.py` 한 줄로 `fetch_fred.py` / `competitors.py` /
`js/watchlist.js` 가 일관되게 재생성된다. 자세한 절차는
[.claude/routines/daily-market-analysis.md](.claude/routines/daily-market-analysis.md)
"종목·섹터 추가 가이드" 참고.

> 🤖 이 daily 루틴과 주간 시장 리서치 루틴을 **Claude Code 웹**
> (claude.ai/code/routines)에 등록·복원하는 폼 입력값(프롬프트 전문 ·
> 스케줄 · 환경 설정 체크리스트)은
> [.claude/routines/SETUP.md](.claude/routines/SETUP.md) 가 단일 기준이다.
> 루틴은 레포가 아니라 개인 계정에 저장되므로, 삭제했다면 저 문서를 보고
> 다시 등록한다.

| 섹터 그룹 | 종목 수 | 대표 종목 |
|---|---|---|
| 빅테크 / 소프트웨어         | 10 | AAPL · MSFT · GOOGL · AMZN · META · ORCL · CRM · ADBE · IBM · PLTR |
| 반도체 — AI 칩 · 설계        | 11 | NVDA · AMD · INTC · QCOM · AVGO · MRVL · MediaTek · MBLY · SNPS · CDNS · ARM |
| 반도체 — 메모리 (HBM·DRAM)   |  3 | 삼성전자 · SK하이닉스 · MU |
| 반도체 — 파운드리 · 패키징 · 기판 | 3 | TSM · AMKR · Ibiden |
| 반도체 — 장비 · 소재         | 10 | ASML · AMAT · LRCX · TOELY · KLAC · 한미반도체 · Advantest · DISCO · BESI · Shin-Etsu |
| AI 인프라 — 네트워킹 · 광 · 네오클라우드 | 5 | ANET · COHR · MPWR · CRWV · NBIS |
| 로보틱스 / 피지컬 AI         |  5 | TER · HSAI · MP · FANUC · Harmonic Drive |
| 자동차 / 모빌리티            | 10 | TSLA · TM · F · GM · STLA · HMC · RIVN · NIO · 현대차 · 기아 |
| 바이오 / 제약 / 헬스케어     | 10 | LLY · NVO · JNJ · PFE · MRK · ABBV · AZN · UNH · TMO · ABT |
| 에너지 / 원자재              | 10 | XOM · CVX · COP · SHEL · OXY · SLB · FCX · NEM · LIN · APD |
| 금융                          | 10 | JPM · BAC · WFC · C · GS · MS · V · MA · AXP · BRK-B |
| 소비재                        | 10 | WMT · COST · KO · PEP · PG · MO · MCD · HD · NKE · SBUX |
| 산업재 / 방산                 | 14 | CAT · DE · BA · LMT · RTX · NOC · HON · GE · UPS · FDX · AVAV · KTOS · 한화에어로스페이스 · LIG넥스원 |
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

watchlist 가 155 종목으로 늘어 하루에 다 처리하면 부담이 크므로, daily routine 은
요일별로 섹터를 나눠서 처리한다. 매핑은 `scripts/watchlist_data.py` 의
`DAY_OF_WEEK_SECTORS` 에 정의되어 있다:

| 요일 | 처리 섹터 | 종목 수 |
|---|---|---|
| 월요일 | 빅테크 / 소프트웨어 + AI 인프라 (네트워킹·광·네오클라우드) | 15 |
| 화요일 | 반도체 4개 그룹 (AI 칩·설계 / 메모리 / 파운드리·패키징 / 장비·소재) | 27 |
| 수요일 | 로보틱스 / 피지컬 AI + 자동차 / 모빌리티 + 조선 (한국) | 19 |
| 목요일 | 바이오 / 제약 / 헬스케어 | 10 |
| 금요일 | 에너지 / 원자재 + 유틸리티 / 전력 + 전력 인프라 (AI) | 30 |
| 토요일 | 금융 + 부동산 (REITs) | 20 |
| 일요일 | 소비재 + 산업재 / 방산 + 통신 / 미디어 | 34 |

7일에 한 번 모든 종목이 한 바퀴 도는 구조다. 가격·재무 데이터(`update.yml`)
는 여전히 주 1회 일괄 수집한다 — 가벼우므로.
