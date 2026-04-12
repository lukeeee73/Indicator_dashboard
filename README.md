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

| 지표 | FRED 코드 | 분면 | 비고 |
|---|---|---|---|
| 미국 10Y-2Y 금리차 | `T10Y2Y` | 성장 | 역전 시 침체 경고 (선행) |
| 미국 10Y BEI | `T10YIE` | 인플레 | 시장 기대 인플레 |
| CPI 전년 동월 대비 | `CPIAUCSL` | 인플레 | 원시값을 YoY % 로 변환 |
| 산업생산지수 | `INDPRO` | 성장 | 성장 현재 상태 |
| WTI 원유 가격 | `DCOILWTICO` | 인플레 | 인플레 선행 |

지표를 추가/수정하려면 `scripts/fetch_fred.py` 상단의 `INDICATORS` 딕셔너리만 편집하면 됩니다.

---

## 디렉토리 구조

```
dalio-dashboard/
├── README.md
├── .gitignore
├── index.html               # 대시보드 진입점 (Chart.js CDN 로드)
├── style.css                # 다크 테마 + 반응형 카드 레이아웃
├── app.js                   # indicators.json fetch & 차트 렌더링
├── vercel.json              # Vercel 배포 설정 (JSON 캐시 정책)
├── data/
│   └── indicators.json      # 수집된 시계열 (GitHub Actions가 갱신)
├── scripts/
│   ├── fetch_fred.py        # FRED API → indicators.json
│   └── requirements.txt
└── .github/workflows/
    └── update.yml           # 주 1회 자동 수집 + 커밋
```

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
