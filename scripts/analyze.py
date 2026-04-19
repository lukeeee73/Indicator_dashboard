#!/usr/bin/env python3
"""
각 지표의 "현재 위치" 를 과거 분포에 대한 백분위로 환산하고, 그 결과를
성장/인플레 두 축의 종합 점수로 묶어 4분면을 자동 판정하는 모듈.

접근:
    - 두 개의 참조 창(window) 을 병행한다.
        1) full       : 1945-09-02(2차대전 종전) 이후 전체 분포
        2) rolling_10y: 최근 10년 분포
    - 각 지표의 현재값이 참조 창 안에서 몇 번째 백분위에 있는지 계산.
    - 백분위(0~100) → 레이블(high/neutral/low) 매핑:
        >= 60 : high
         < 60  &  > 40 : neutral
        <= 40 : low
    - 축별 종합 점수 = 해당 축 지표들의 백분위 평균.
    - 분면: Q1 (G↑ I↑), Q2 (G↑ I↓), Q3 (G↓ I↑), Q4 (G↓ I↓), 가장자리/중립 라벨도 지원.

주의:
    - 모든 지표가 "값이 높을수록 해당 축이 높다" 는 polarity 라고 가정한다.
      (T10Y2Y 확장, INDPRO YoY ↑, PAYEMS YoY ↑, USSLIND ↑, 물가 YoY ↑, BEI ↑, WTI YoY ↑)
      polarity 가 다른 지표를 추가하면 INVERTED_CODES 세트에 넣어 뒤집는다.
    - 원시 시계열 자체는 변경하지 않는다. 기존 payload 에 "current" 필드만 덧붙이고
      최상위에 "assessment" 필드를 추가할 뿐이다.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd


# --------------------------------------------------------------------------
# 상수
# --------------------------------------------------------------------------
POSTWAR_CUTOFF = "1945-09-02"   # 2차 세계대전 종전(포츠담 → 일본 항복)
ROLLING_YEARS = 10              # 단기부채 사이클 (~5~8년) 을 감싸는 창
HIGH_THRESHOLD = 60.0           # 이 백분위 이상이면 "high"
LOW_THRESHOLD  = 40.0           # 이 백분위 이하이면 "low"
TRAJECTORY_MONTHS = 24          # 2D 산점도에 그릴 최근 궤적 길이

# polarity 가 반대인 지표 코드를 여기에 넣으면 백분위가 (100 - p) 로 뒤집힌다.
# LRUNTTTTKOR156S: 실업률 — 높을수록 성장 악화이므로 역방향 적용.
INVERTED_CODES: set[str] = {"LRUNTTTTKOR156S"}


# --------------------------------------------------------------------------
# 유틸
# --------------------------------------------------------------------------
def _series_to_pandas(points: list[dict]) -> pd.Series:
    if not points:
        return pd.Series(dtype=float)
    df = pd.DataFrame(points)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")["value"].astype(float).sort_index()


def _percentile_rank(sample: pd.Series, value: float) -> Optional[float]:
    """value 가 sample 분포 안에서 차지하는 백분위 (midpoint 방식, 0~100)."""
    sample = sample.dropna()
    n = len(sample)
    if n == 0 or pd.isna(value):
        return None
    below = float((sample < value).sum())
    equal = float((sample == value).sum())
    return (below + 0.5 * equal) / n * 100.0


def _label_from_percentile(p: Optional[float]) -> Optional[str]:
    if p is None:
        return None
    if p >= HIGH_THRESHOLD:
        return "high"
    if p <= LOW_THRESHOLD:
        return "low"
    return "neutral"


def _apply_polarity(code: str, percentile: Optional[float]) -> Optional[float]:
    """INVERTED_CODES 에 속하면 백분위를 뒤집어 축 기여도와 정렬을 맞춘다."""
    if percentile is None:
        return None
    if code in INVERTED_CODES:
        return 100.0 - percentile
    return percentile


# --------------------------------------------------------------------------
# 지표별 "현재" 통계
# --------------------------------------------------------------------------
def compute_current_stats(code: str, series_list: list[dict]) -> Optional[dict]:
    """각 지표의 최신값 + 두 창(full/10y) 에서의 백분위·레이블."""
    s = _series_to_pandas(series_list)
    if s.empty:
        return None
    latest_date = s.index[-1]
    latest_value = float(s.iloc[-1])

    # Full (post-WW2)
    full = s[s.index >= POSTWAR_CUTOFF]
    p_full_raw = _percentile_rank(full, latest_value)
    p_full = _apply_polarity(code, p_full_raw)

    # Rolling 10y (최신 관측일 기준 역산)
    cutoff = latest_date - pd.DateOffset(years=ROLLING_YEARS)
    window = s[(s.index >= cutoff) & (s.index <= latest_date)]
    p_10y_raw = _percentile_rank(window, latest_value)
    p_10y = _apply_polarity(code, p_10y_raw)

    return {
        "value": round(latest_value, 4),
        "date": latest_date.strftime("%Y-%m-%d"),
        "percentile_full": None if p_full is None else round(p_full, 1),
        "percentile_10y":  None if p_10y  is None else round(p_10y,  1),
        "label_full": _label_from_percentile(p_full),
        "label_10y":  _label_from_percentile(p_10y),
    }


# --------------------------------------------------------------------------
# 종합 점수 + 분면 판정
# --------------------------------------------------------------------------
def _classify_quadrant(growth: float, inflation: float) -> str:
    gh = growth    >= HIGH_THRESHOLD
    gl = growth    <= LOW_THRESHOLD
    ih = inflation >= HIGH_THRESHOLD
    il = inflation <= LOW_THRESHOLD

    if gh and ih: return "Q1"              # 성장↑ 인플레↑
    if gh and il: return "Q2"              # 성장↑ 인플레↓
    if gl and ih: return "Q3"              # 성장↓ 인플레↑
    if gl and il: return "Q4"              # 성장↓ 인플레↓

    # 한쪽만 뚜렷한 경우 — "어느 분면 쪽" 에 가까운지 표기
    if gh: return "Q1/Q2-edge"
    if gl: return "Q3/Q4-edge"
    if ih: return "Q1/Q3-edge"
    if il: return "Q2/Q4-edge"
    return "Neutral"


def _aggregate(percentiles: list[float]) -> Optional[float]:
    vals = [p for p in percentiles if p is not None]
    if not vals:
        return None
    return round(float(np.mean(vals)), 1)


def _make_summary(growth: list[float], inflation: list[float]) -> Optional[dict]:
    g = _aggregate(growth)
    i = _aggregate(inflation)
    if g is None or i is None:
        return None
    return {
        "growth_score": g,
        "inflation_score": i,
        "growth_label": _label_from_percentile(g),
        "inflation_label": _label_from_percentile(i),
        "quadrant": _classify_quadrant(g, i),
    }


# --------------------------------------------------------------------------
# 2D 궤적 (최근 24개월)
# --------------------------------------------------------------------------
def _monthly_last(series_list: list[dict]) -> pd.Series:
    """어떤 주기의 시리즈든 '월말 last' 로 재구성."""
    s = _series_to_pandas(series_list)
    if s.empty:
        return s
    return s.resample("ME").last().dropna()


def compute_trajectory(indicators: dict) -> list[dict]:
    """최근 TRAJECTORY_MONTHS 개월의 (growth_score, inflation_score) 궤적.

    각 월말 시점에 대해:
        1) 각 지표의 월말 last 값을 구한다
        2) 그 값이 post-WW2 전체 분포에서 차지하는 백분위(=full 기준) 를 계산
        3) 같은 카테고리끼리 평균내서 그 달의 점수로 삼는다
    => 현재 시점의 전체 분포를 고정 기준으로 두므로 trajectory 가 같은 좌표계에서 이동.
    """
    growth_ranks: dict[str, pd.Series] = {}
    infl_ranks:   dict[str, pd.Series] = {}

    for code, payload in indicators.items():
        cat = payload.get("category")
        if cat not in ("growth", "inflation"):
            continue
        if payload.get("exclude_assessment"):
            continue
        series_list = payload.get("series", [])
        s = _series_to_pandas(series_list)
        if s.empty:
            continue
        full = s[s.index >= POSTWAR_CUTOFF]
        if full.empty:
            continue
        monthly = _monthly_last(series_list)
        if monthly.empty:
            continue
        # 각 월말 값의 백분위를 full 분포에서 구한다 (midpoint rank).
        values = full.values
        n = len(values)

        def rank(v: float) -> float:
            below = float((values < v).sum())
            equal = float((values == v).sum())
            return (below + 0.5 * equal) / n * 100.0

        ranks = monthly.apply(lambda v: rank(float(v)))
        if code in INVERTED_CODES:
            ranks = 100.0 - ranks
        (growth_ranks if cat == "growth" else infl_ranks)[code] = ranks

    if not growth_ranks or not infl_ranks:
        return []

    growth_df = pd.DataFrame(growth_ranks).sort_index()
    infl_df   = pd.DataFrame(infl_ranks).sort_index()

    # 월 단위 인덱스 교집합만 사용 (모든 지표가 값이 있는 달) — 너무 엄격하면 궤적이
    # 짧아지니, 평균은 available 지표들로 계산하고 NaN 은 무시.
    growth_score    = growth_df.mean(axis=1, skipna=True)
    inflation_score = infl_df.mean(axis=1, skipna=True)

    merged = pd.DataFrame({"g": growth_score, "i": inflation_score}).dropna()
    if merged.empty:
        return []
    tail = merged.tail(TRAJECTORY_MONTHS)
    return [
        {
            "date": d.strftime("%Y-%m-%d"),
            "growth_score":    round(float(row["g"]), 1),
            "inflation_score": round(float(row["i"]), 1),
        }
        for d, row in tail.iterrows()
    ]


# --------------------------------------------------------------------------
# 메인 진입점
# --------------------------------------------------------------------------
def enrich_with_assessment(output: dict) -> dict:
    """fetch_fred.py 가 만든 output dict 를 in-place 로 확장한다.

    1) 각 indicator payload 에 "current" 필드 주입
    2) 최상위에 "assessment" 블록 추가
        {
          "full":        { growth_score, inflation_score, quadrant, ... },
          "rolling_10y": { ... },
          "config":      { postwar_cutoff, rolling_years, thresholds },
          "trajectory":  [ {date, growth_score, inflation_score}, ... ]
        }
    """
    indicators = output.get("indicators", {})

    growth_full, growth_10y = [], []
    infl_full,   infl_10y   = [], []

    for code, payload in indicators.items():
        cur = compute_current_stats(code, payload.get("series", []))
        if cur is None:
            continue
        payload["current"] = cur

        # exclude_assessment=True 인 지표(한국 지표 등)는 개별 카드 통계는
        # 계산하되, 미국 4분면 종합 점수에는 포함하지 않는다.
        if payload.get("exclude_assessment"):
            continue

        cat = payload.get("category")
        if cat == "growth":
            growth_full.append(cur["percentile_full"])
            growth_10y.append(cur["percentile_10y"])
        elif cat == "inflation":
            infl_full.append(cur["percentile_full"])
            infl_10y.append(cur["percentile_10y"])

    assessment = {
        "full":        _make_summary(growth_full, infl_full),
        "rolling_10y": _make_summary(growth_10y, infl_10y),
        "config": {
            "postwar_cutoff": POSTWAR_CUTOFF,
            "rolling_years":  ROLLING_YEARS,
            "high_threshold": HIGH_THRESHOLD,
            "low_threshold":  LOW_THRESHOLD,
        },
        "trajectory": compute_trajectory(indicators),
    }
    output["assessment"] = assessment
    return output


# --------------------------------------------------------------------------
# CLI (기존 JSON 을 재분석하고 덮어쓰고 싶을 때)
# --------------------------------------------------------------------------
def _main() -> int:
    import json
    import sys
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "data" / "indicators.json"
    if not path.exists():
        print(f"ERROR: {path} not found", file=sys.stderr)
        return 1
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    enrich_with_assessment(data)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    a = data.get("assessment", {})
    print("Assessment re-computed.")
    print("  full       :", a.get("full"))
    print("  rolling_10y:", a.get("rolling_10y"))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
