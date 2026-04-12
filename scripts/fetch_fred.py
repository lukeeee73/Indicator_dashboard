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
from datetime import datetime, timedelta, timezone
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
# 상수
# --------------------------------------------------------------------------
FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "indicators.json"

# 최근 2년치만 결과에 남긴다.
LOOKBACK_DAYS = 365 * 2
# YoY 변환을 위해서는 12개월 이전 값이 필요하므로, CPI는 추가로 1년을 더 조회한다.
YOY_EXTRA_DAYS = 370  # 윤년/월 경계 보수적으로 여유
REQUEST_TIMEOUT = 30  # 초


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


def trim_to_lookback(series: list[dict], cutoff_date: str) -> list[dict]:
    """cutoff_date(YYYY-MM-DD) 이후 데이터만 남긴다."""
    return [point for point in series if point["date"] >= cutoff_date]


# --------------------------------------------------------------------------
# 기존 JSON 입출력
# --------------------------------------------------------------------------
def load_existing(path: Path) -> dict:
    """기존 indicators.json 을 읽어 반환. 파일이 없거나 깨졌으면 빈 구조를 반환."""
    if not path.exists():
        return {"last_updated": None, "indicators": {}}
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"last_updated": None, "indicators": {}}


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
    lookback_cutoff = (now_utc - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    yoy_start = (
        now_utc - timedelta(days=LOOKBACK_DAYS + YOY_EXTRA_DAYS)
    ).strftime("%Y-%m-%d")

    # 실패한 지표는 기존 데이터 유지(없어지지 않도록)
    existing = load_existing(OUTPUT_PATH)
    merged_indicators: dict[str, dict] = dict(existing.get("indicators", {}))

    success_count = 0
    for code, meta in INDICATORS.items():
        needs_yoy = meta["transform"] == "yoy_pct"
        start_date = yoy_start if needs_yoy else lookback_cutoff

        print(f"Fetching {code}...", end=" ", flush=True)
        try:
            raw = fetch_series(code, api_key, start_date)
            if needs_yoy:
                series = trim_to_lookback(compute_yoy_pct(raw), lookback_cutoff)
            else:
                series = raw

            merged_indicators[code] = {
                "name": meta["name"],
                "category": meta["category"],
                "unit": meta["unit"],
                "series": series,
            }
            print(f"OK ({len(series)} points)")
            success_count += 1
        except requests.RequestException as e:
            print(f"FAILED (network: {e})")
        except Exception as e:  # noqa: BLE001  # 어떤 이유로든 다른 지표는 계속 가야 함
            print(f"FAILED (unexpected: {e})")

    if success_count == 0:
        # 전부 실패하면 기존 파일을 건드리지 않는다 (데이터 보존)
        print(
            "ERROR: 모든 지표 수집 실패. 기존 JSON을 덮어쓰지 않습니다.",
            file=sys.stderr,
        )
        return 2

    output = {
        "last_updated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indicators": merged_indicators,
    }
    save_json(OUTPUT_PATH, output)

    print(
        f"\nDone. {success_count}/{len(INDICATORS)} indicators updated "
        f"-> {OUTPUT_PATH.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
