#!/usr/bin/env python3
"""
FRED API에서 주요 경제 지표를 가져와 data/indicators.json에 저장하는 스크립트.

사용법:
    export FRED_API_KEY="your_api_key"
    python scripts/fetch_fred.py

원칙:
    - requests만 사용 (pandas, numpy 등은 쓰지 않는다)
    - 한 지표가 실패해도 다른 지표는 계속 수집한다 (안전 모드)
    - 모든 지표가 실패하면 기존 JSON을 덮어쓰지 않는다
    - 날짜는 모두 UTC 기준, ISO 8601 포맷
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests


# --------------------------------------------------------------------------
# 수집할 FRED 지표 정의
# --------------------------------------------------------------------------
# 새 지표를 추가하려면 아래 딕셔너리에 한 줄 추가하면 된다.
#   - name:      대시보드에 표시할 영문 이름
#   - category:  "growth" (성장 분면) | "inflation" (인플레 분면)
#   - unit:      단위 표기. 프론트엔드가 툴팁에 붙일 때 사용
#   - transform: None 이면 원시값 그대로, "yoy_pct" 면 전년 동월 대비 상승률(%)로 변환
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
    "INDPRO": {
        "name": "Industrial Production Index",
        "category": "growth",
        "unit": "index",
        "transform": None,
    },
    "DCOILWTICO": {
        "name": "WTI Crude Oil Price",
        "category": "inflation",
        "unit": "usd_per_barrel",
        "transform": None,
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
def compute_yoy_pct(series: list[dict]) -> list[dict]:
    """전년 동월 대비 상승률(%)로 변환.

    CPIAUCSL 은 월간 데이터이므로, 정렬된 시계열에서 i 번째 값과
    (i - 12) 번째 값을 비교하면 1년 전 대비 상승률이 된다.
    """
    result: list[dict] = []
    for i in range(12, len(series)):
        prev = series[i - 12]["value"]
        curr = series[i]["value"]
        if prev == 0:
            continue  # 0으로 나누기 방지 (현실적으로 발생 안 하지만 안전장치)
        yoy = (curr - prev) / prev * 100.0
        result.append({"date": series[i]["date"], "value": round(yoy, 3)})
    return result




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
            series = compute_yoy_pct(raw) if meta.get("transform") == "yoy_pct" else raw
            entry = {
                "name": meta["name"],
                "unit": meta["unit"],
                "series": series,
            }
            if "category" in meta:
                entry["category"] = meta["category"]
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

    merged_indicators.update(new_indicators)
    merged_assets.update(new_assets)

    success_count = ok_ind + ok_ast
    total_count   = len(INDICATORS) + len(ASSETS)

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
    save_json(OUTPUT_PATH, output)

    print(
        f"\nDone. {success_count}/{total_count} series updated "
        f"(indicators: {ok_ind}/{len(INDICATORS)}, assets: {ok_ast}/{len(ASSETS)}) "
        f"-> {OUTPUT_PATH.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
