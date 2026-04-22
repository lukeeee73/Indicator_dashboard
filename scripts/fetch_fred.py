#!/usr/bin/env python3
"""
FRED API에서 주요 경제 지표를 가져와 data/indicators.json에 저장하는 스크립트.

사용법:
    export FRED_API_KEY="your_api_key"
    python scripts/fetch_fred.py

원칙:
    - 한 지표가 실패해도 다른 지표는 계속 수집한다 (안전 모드)
    - 모든 지표가 실패하면 기존 JSON을 덮어쓰지 않는다
    - 날짜는 모두 UTC 기준, ISO 8601 포맷
    - 수집 이후 analyze 모듈이 각 지표에 "현재 위치(percentile/label)" 와
      성장/인플레 종합 점수(assessment 블록) 를 주입한다.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from analyze import enrich_with_assessment


# --------------------------------------------------------------------------
# 수집할 FRED 지표 정의
# --------------------------------------------------------------------------
# 새 지표를 추가하려면 아래 딕셔너리에 한 줄 추가하면 된다.
#   - name:      대시보드에 표시할 영문 이름
#   - category:  "growth" (성장 분면) | "inflation" (인플레 분면)
#   - unit:      단위 표기. 프론트엔드가 툴팁에 붙일 때 사용
#   - transform: None        → 원시값 그대로
#                "yoy_pct"   → 월간 시계열의 전년 동월 대비 상승률(%) 로 변환
#                "yoy_pct_daily" → 일간 시계열을 월말 last 로 리샘플 후 YoY(%)
INDICATORS: dict[str, dict] = {
    "T10Y2Y": {
        "name": "10Y-2Y Treasury Spread",
        "category": "growth",
        "unit": "percent",
        "transform": None,
    },
    "T10YIE": {
        "name": "10-Year Breakeven Inflation Rate",
        "category": "inflation",
        "unit": "percent",
        "transform": None,
    },
    "CPIAUCSL": {
        # 원시 CPI 지수값은 절대치라 의미가 약하므로 전년 동월 대비 % 로 변환
        "name": "CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "CPILFESL": {
        # Core CPI (식품·에너지 제외). "끈적한(sticky) 인플레" 의 척도.
        "name": "Core CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "PCEPI": {
        # PCE 물가지수. Fed 가 통화정책 기준으로 보는 지표.
        "name": "PCE YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "INDPRO": {
        # 원시 지수값 대신 YoY 변화율을 본다 — 레짐 비교가 가능해짐.
        "name": "Industrial Production YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "PAYEMS": {
        # 비농업 고용. 성장의 현재 상태.
        "name": "Nonfarm Payrolls YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
    },
    "USSLIND": {
        # Philly Fed State Leading Index — 향후 6개월 성장률 전망 (level).
        "name": "State Leading Index",
        "category": "growth",
        "unit": "percent",
        "transform": None,
    },
    "DCOILWTICO": {
        # 일간 가격을 월말 last 로 리샘플 후 YoY — 공급측 인플레 압력으로 사용.
        "name": "WTI Crude Oil YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct_daily",
    },

    # ── 달러 가치 분석 지표 (미국) ──────────────────────────────────────
    # 금리·통화량·재정 건전성을 통해 달러의 상대 가치를 판단하는 데 쓰인다.
    # exclude_assessment=True: 4분면 성장/인플레 점수에는 포함하지 않는다.
    "DGS10": {
        "name": "US 10-Year Treasury Yield",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "exclude_assessment": True,
    },
    "M2SL": {
        "name": "US M2 Money Supply YoY",
        "category": "dollar",
        "unit": "percent",
        "transform": "yoy_pct",
        "exclude_assessment": True,
    },
    "GFDEGDQ188S": {
        # 분기 데이터, 이미 GDP 대비 % — transform 없이 원시값 사용
        "name": "US Federal Debt (% of GDP)",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "exclude_assessment": True,
    },

    # ── 달러 가치 분석 지표 (한국) ──────────────────────────────────────
    "IRLTLT01KRM156N": {
        "name": "Korea 10-Year Government Bond Yield",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },
    "MYAGM2KRM189S": {
        "name": "Korea M2 Money Supply YoY",
        "category": "dollar",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "DEBTTLKRQ052N": {
        # 분기 데이터, IMF/World Bank 경유 — GDP 대비 % 원시값 사용
        "name": "Korea General Government Debt (% of GDP)",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },

    # ── 한국 지표 (OECD / FRED) ──────────────────────────────────────────
    # exclude_assessment=True: 개별 카드 백분위는 계산하되,
    # 미국 4분면 종합 점수(assessment)에는 포함하지 않는다.
    "KORCPIALLMINMEI": {
        "name": "Korea CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "KORPROINDMISMEI": {
        "name": "Korea Industrial Production YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
        "region": "KR",
        "exclude_assessment": True,
    },
    "LRUNTTTTKOR156S": {
        # 실업률은 역방향 폴라리티 — 높을수록 성장 악화. analyze.py INVERTED_CODES 에 등록됨.
        "name": "Korea Unemployment Rate",
        "category": "growth",
        "unit": "percent",
        "transform": None,
        "region": "KR",
        "exclude_assessment": True,
    },
}


# --------------------------------------------------------------------------
# 비교 자산(Assets) 정의
# --------------------------------------------------------------------------
# INDICATORS 가 "4분면 진단용 지표"라면 ASSETS 는 "지표 움직임을 검증할 가격 계열".
# 프론트엔드의 비교(compare) 기능에서 겹쳐보기/나란히보기의 오버레이 대상이 된다.
#
# 주의:
#   - SP500 / DJIA 같은 지수형 시리즈는 FRED 라이선스상 최근 10년만 받아진다.
#     따라서 자산마다 실제 보유 범위가 다르며, 프론트엔드는 가용 범위만 표시한다.
#   - 각 시계열은 일간(daily) 기준이지만 휴장/주말에는 결측이라 날짜가 안 맞을 수 있다.
#     프론트엔드에서 "가장 최근 과거값으로 align" 해서 겹쳐 그린다.
ASSETS: dict[str, dict] = {
    "GOLDAMGBD228NLBM": {
        "name": "Gold (London PM Fix)",
        "unit": "usd_per_oz",
        "transform": None,
    },
    "DTWEXBGS": {
        "name": "USD Trade-Weighted Broad Index",
        "unit": "index",
        "transform": None,
    },
    "SP500": {
        # FRED 라이선스로 최근 10년만. 전체 타임프레임 선택 시에도 10년치.
        "name": "S&P 500",
        "unit": "index",
        "transform": None,
    },
    "DGS10": {
        "name": "10-Year Treasury Yield",
        "unit": "percent",
        "transform": None,
    },
    "VIXCLS": {
        "name": "VIX Volatility Index",
        "unit": "index",
        "transform": None,
    },
    "DEXKOUS": {
        "name": "USD/KRW Exchange Rate",
        "unit": "krw_per_usd",
        "transform": None,
    },
    "BAMLH0A0HYM2": {
        "name": "US High-Yield Bond Spread",
        "unit": "percent",
        "transform": None,
    },
    "IRLTLT01KRM156N": {
        "name": "Korea 10-Year Government Bond Yield",
        "unit": "percent",
        "transform": None,
    },
}


# --------------------------------------------------------------------------
# 상수
# --------------------------------------------------------------------------
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "indicators.json"

# FRED에서 가져올 수 있는 최대한의 과거 데이터를 받는다.
# FRED 시계열은 최대 1800년대 후반까지 존재하므로, 충분히 과거의 날짜를 시작점으로 지정한다.
# 실제로는 각 시계열의 최초 관측일 이후 데이터만 반환되므로 문제없다.
FRED_EARLIEST_DATE = "1776-07-04"
REQUEST_TIMEOUT = 60  # 초 (과거 데이터까지 조회하므로 여유 있게)


# --------------------------------------------------------------------------
# FRED 호출
# --------------------------------------------------------------------------
def fetch_series(series_id: str, api_key: str, start_date: str) -> list[dict]:
    """FRED에서 단일 시계열을 가져와 [{'date': 'YYYY-MM-DD', 'value': float}, ...] 로 반환.

    FRED는 결측치를 "." 로 돌려주므로 그런 포인트는 제외한다.
    """
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start_date,
    }
    resp = requests.get(FRED_BASE_URL, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()

    series: list[dict] = []
    for obs in payload.get("observations", []):
        raw_value = obs.get("value")
        if raw_value in (".", None, ""):
            continue  # 결측치 skip
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        series.append({"date": obs["date"], "value": value})
    return series


# --------------------------------------------------------------------------
# 변환 함수들
# --------------------------------------------------------------------------
def _series_to_pandas(series: list[dict]) -> pd.Series:
    """[{date, value}] → DatetimeIndex 기준 pd.Series (오름차순 정렬)."""
    if not series:
        return pd.Series(dtype=float)
    df = pd.DataFrame(series)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")["value"].astype(float).sort_index()


def _pandas_to_series(s: pd.Series) -> list[dict]:
    """pd.Series → [{date: 'YYYY-MM-DD', value: float}] 리스트."""
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 3)}
        for d, v in s.items()
        if pd.notna(v)
    ]


def compute_yoy_pct(series: list[dict]) -> list[dict]:
    """월간 시계열의 전년 동월 대비 상승률(%). 12 기간 전 대비 pct_change."""
    s = _series_to_pandas(series)
    if s.empty:
        return []
    yoy = s.pct_change(periods=12) * 100.0
    return _pandas_to_series(yoy.dropna())


def compute_yoy_pct_daily(series: list[dict]) -> list[dict]:
    """일간 시계열을 월말(last) 로 리샘플 → YoY(%).

    WTI 같은 일간 가격 데이터에 대해서도 월 단위 YoY 를 뽑아, 다른 인플레 지표와
    같은 기준(월간 YoY%) 에서 백분위/레이블 비교가 가능하도록 한다.
    """
    s = _series_to_pandas(series)
    if s.empty:
        return []
    monthly_last = s.resample("ME").last().dropna()
    yoy = monthly_last.pct_change(periods=12) * 100.0
    return _pandas_to_series(yoy.dropna())


TRANSFORMS = {
    "yoy_pct":       compute_yoy_pct,
    "yoy_pct_daily": compute_yoy_pct_daily,
}


# --------------------------------------------------------------------------
# Yahoo Finance 수집 (FRED에 없는 지수)
# --------------------------------------------------------------------------
def fetch_yahoo_monthly(symbol: str) -> list[dict]:
    """Yahoo Finance에서 월별 종가(Close) 시계열을 [{date, value}, ...] 로 반환.

    실패 시 빈 리스트 반환 — 호출부에서 기존값을 유지한다.
    """
    try:
        import yfinance as yf  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("yfinance 가 설치되지 않았습니다. pip install yfinance") from e

    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="max", interval="1mo", auto_adjust=True)
    if hist.empty:
        return []

    series: list[dict] = []
    for idx, row in hist.iterrows():
        date_str = (
            idx.tz_localize(None).strftime("%Y-%m-%d")
            if idx.tzinfo else idx.strftime("%Y-%m-%d")
        )
        try:
            val = float(row["Close"])
        except (TypeError, ValueError, KeyError):
            continue
        if pd.isna(val):
            continue
        series.append({"date": date_str, "value": round(val, 2)})
    return sorted(series, key=lambda x: x["date"])


# --------------------------------------------------------------------------
# 기존 JSON 입출력
# --------------------------------------------------------------------------
def load_existing(path: Path) -> dict:
    """기존 indicators.json 을 읽어 반환. 파일이 없거나 깨졌으면 빈 구조를 반환."""
    empty = {"last_updated": None, "indicators": {}, "assets": {}}
    if not path.exists():
        return empty
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            data.setdefault("assets", {})
            return data
    except (json.JSONDecodeError, OSError):
        return empty


def collect_group(group: dict, api_key: str, label: str) -> tuple[dict, int]:
    """INDICATORS/ASSETS 를 한 번에 수집하는 공용 루프.

    반환:
        (수집된 시리즈 dict, 성공 카운트)
    실패한 시리즈는 결과 dict 에 포함하지 않는다 — 호출부에서 기존값을 유지하도록.
    """
    collected: dict[str, dict] = {}
    success = 0
    for code, meta in group.items():
        print(f"Fetching {label} {code}...", end=" ", flush=True)
        try:
            raw = fetch_series(code, api_key, FRED_EARLIEST_DATE)
            transform = meta.get("transform")
            if transform:
                fn = TRANSFORMS.get(transform)
                if fn is None:
                    raise ValueError(f"unknown transform: {transform}")
                series = fn(raw)
            else:
                series = raw
            entry = {
                "name": meta["name"],
                "unit": meta["unit"],
                "series": series,
            }
            if "category" in meta:
                entry["category"] = meta["category"]
            if "region" in meta:
                entry["region"] = meta["region"]
            if meta.get("exclude_assessment"):
                entry["exclude_assessment"] = True
            collected[code] = entry
            print(f"OK ({len(series)} points)")
            success += 1
        except requests.RequestException as e:
            print(f"FAILED (network: {e})")
        except Exception as e:  # noqa: BLE001  # 어떤 이유로든 다른 시리즈는 계속 가야 함
            print(f"FAILED (unexpected: {e})")
    return collected, success


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")  # 파일 끝 개행 (POSIX 관례)


# --------------------------------------------------------------------------
# 메인 파이프라인
# --------------------------------------------------------------------------
def main() -> int:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        print("ERROR: FRED_API_KEY 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        return 1

    now_utc = datetime.now(timezone.utc)

    # 실패한 시리즈는 기존 데이터 유지 (없어지지 않도록)
    existing = load_existing(OUTPUT_PATH)
    merged_indicators: dict[str, dict] = dict(existing.get("indicators", {}))
    merged_assets: dict[str, dict] = dict(existing.get("assets", {}))

    new_indicators, ok_ind = collect_group(INDICATORS, api_key, "indicator")
    new_assets,    ok_ast  = collect_group(ASSETS,    api_key, "asset")

    # KOSPI YoY — Yahoo Finance 경유 (FRED 미제공)
    print("Fetching indicator KOSPI_YOY (Yahoo Finance ^KS11)...", end=" ", flush=True)
    try:
        raw_kospi = fetch_yahoo_monthly("^KS11")
        if raw_kospi:
            kospi_yoy = compute_yoy_pct(raw_kospi)
            new_indicators["KOSPI_YOY"] = {
                "name": "KOSPI YoY",
                "unit": "percent",
                "category": "growth",
                "region": "KR",
                "exclude_assessment": True,
                "series": kospi_yoy,
            }
            print(f"OK ({len(kospi_yoy)} points)")
            ok_ind += 1
        else:
            print("FAILED (empty series)")
    except Exception as e:  # noqa: BLE001
        print(f"FAILED (unexpected: {e})")

    # KOSPI 원시 가격 — 비교 자산으로도 추가
    print("Fetching asset KOSPI (Yahoo Finance ^KS11)...", end=" ", flush=True)
    try:
        raw_kospi_price = fetch_yahoo_monthly("^KS11")
        if raw_kospi_price:
            new_assets["KOSPI"] = {
                "name": "KOSPI",
                "unit": "index",
                "series": raw_kospi_price,
            }
            print(f"OK ({len(raw_kospi_price)} points)")
            ok_ast += 1
        else:
            print("FAILED (empty series)")
    except Exception as e:  # noqa: BLE001
        print(f"FAILED (unexpected: {e})")

    merged_indicators.update(new_indicators)
    merged_assets.update(new_assets)

    success_count = ok_ind + ok_ast
    total_count   = len(INDICATORS) + len(ASSETS) + 2  # +2: KOSPI_YOY, KOSPI asset

    if success_count == 0:
        # 전부 실패하면 기존 파일을 건드리지 않는다 (데이터 보존)
        print(
            "ERROR: 모든 시리즈 수집 실패. 기존 JSON을 덮어쓰지 않습니다.",
            file=sys.stderr,
        )
        return 2

    output = {
        "last_updated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indicators": merged_indicators,
        "assets": merged_assets,
    }

    # 각 지표에 "current" (percentile/label) 를 주입하고, 성장/인플레 종합
    # 점수와 분면 판정(assessment) 을 최상위에 추가한다.
    print("\nAnalyzing (percentile / labels / quadrant)...", flush=True)
    enrich_with_assessment(output)

    save_json(OUTPUT_PATH, output)

    print(
        f"\nDone. {success_count}/{total_count} series updated "
        f"(indicators: {ok_ind}/{len(INDICATORS) + 1}, "
        f"assets: {ok_ast}/{len(ASSETS) + 1}) "
        f"-> {OUTPUT_PATH.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
