#!/usr/bin/env python3
"""
3단계: Tier B / C / D 모델 구현 + baseline(A) 과 비교.

모델 목록
---------
A  baseline       : analyze.py 와 동일 — 레벨 백분위 단순 평균, 60/40 임계
B  diff-aware     : 레벨 백분위 60% + 6개월 변화 백분위 40% 가중합
C  lead-weighted  : 선행/동행/후행 지표에 가중치 차등 부여.
                    인플레축은 full 창만 사용(2단계에서 10y 창이 열등함을 확인).
D  C + smooth     : C 의 축 점수를 EWMA(span=3) 평활 후 히스테리시스 임계 적용
                    (진입 high=60, 이탈=50 / 진입 low=40, 이탈=50)
E  cycle-relative : 8년 사이클 백분위(50%) + 6개월 변화 백분위(30%) + 10년 백분위(20%).
                    "역사적으로 어디인가" 보다 "지금 사이클에서 어디인가, 어디로 가나" 를
                    우선시. 컴포넌트 데이터 부족 시 해당 가중치를 자동 정규화.
                    지표별 가중치는 C 와 동일.
F  EC-hybrid      : 성장 축 = E(8년 사이클), 인플레 축 = C(full 창 가중치).
                    E 의 침체 선행력 + C 의 인플레 정밀도를 조합.
G  F + smooth     : F 의 축 점수에 D 와 동일한 EWMA(span=3) 평활 + 히스테리시스
                    임계를 적용. F 의 약점(flips/yr ≈ 1.1)을 깎는 것이 목적.
                    새 하이퍼파라미터는 없다 — D 에서 사전 등록한 값 재사용.
H  F + EWMA only  : G 의 절제(ablation) — EWMA(span=3) 평활만 적용하고 라벨은
                    기존 60/40 임계 그대로. 히스테리시스가 FPR 을 올리는 주범인지
                    평활 자체가 올리는지 분리해서 본다. 새 파라미터 없음.

하이퍼파라미터 사전 등록(pre-registered)
---------------------------------------
B  alpha_diff   = 0.40  (방향 가중)
   diff_months  = 6
C  지표별 weight  : INDICATOR_WEIGHTS 딕셔너리 참조
D  ewma_span    = 3     (half-life ≈ 2개월)
   entry_high   = 60, exit_high  = 50
   entry_low    = 40, exit_low   = 50
E  cycle_years   = 8, long_years = 10, diff_months = 6
   cycle_weight  = 0.5, diff_weight = 0.3, long_weight = 0.2
   min_months_window = 24  (창 안에 최소 2년 데이터)
   min_diffs_for_dist = 12 (변화 분포에 최소 12개)

결과를 보고 위 값을 조정하지 않는다 — 조정 시 과적합.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from analyze import (  # noqa: E402
    POSTWAR_CUTOFF, ROLLING_YEARS,
    _series_to_pandas, _percentile_rank, _apply_polarity, _label_from_percentile,
    _weighted_mean, compute_current_stats, cycle_relative_percentile,
    # 사전 등록 하이퍼파라미터 — 프로덕션(analyze.py) 과 단일 출처 공유
    INDICATOR_WEIGHTS, EWMA_SPAN,
    CYCLE_YEARS, LONG_YEARS, CYCLE_DIFF_MONTHS,
    CYCLE_WEIGHT, DIFF_WEIGHT, LONG_WEIGHT,
    MIN_MONTHS_WINDOW, MIN_DIFFS_FOR_DIST,
)
from backtest import (  # noqa: E402
    load_indicators, slice_series, load_recession_episodes,
    load_inflation_episodes, evaluate_signal,
    RELEASE_LAG_DAYS, DEFAULT_LAG_DAYS, BACKTEST_START,
)

EVAL_DIR = ROOT / "data" / "eval"

# ── 사전 등록 하이퍼파라미터 (이 파일 고유분) ──────────────────────────────────
# INDICATOR_WEIGHTS / EWMA_SPAN / 사이클-상대(Tier E) 파라미터는 analyze.py 에서
# import — 프로덕션 primary 모델과 단일 출처를 공유한다.
ALPHA_DIFF   = 0.40    # Tier B: 방향 백분위 가중
DIFF_MONTHS  = 6       # Tier B: 몇 개월 변화 기준
ENTRY_HIGH   = 60.0    # Tier D/G: high 진입 임계
EXIT_HIGH    = 50.0    # Tier D/G: high 이탈 임계
ENTRY_LOW    = 40.0    # Tier D/G: low  진입 임계
EXIT_LOW     = 50.0    # Tier D/G: low  이탈 임계

# 기존 이름 호환 (Tier E 구현이 쓰던 별칭)
DIFF_MONTHS_E = CYCLE_DIFF_MONTHS
DIFF_WEIGHT_E = DIFF_WEIGHT


# ── 공통 유틸 ──────────────────────────────────────────────────────────────────
def _blend(level: float | None, diff: float | None) -> float | None:
    if level is None:
        return None
    if diff is None:
        return level
    return round(ALPHA_DIFF * diff + (1 - ALPHA_DIFF) * level, 1)


def _diff_percentile(code: str, s: pd.Series) -> float | None:
    """최신 6개월 변화량의 백분위. s 는 pre-parsed pd.Series."""
    full = s[s.index >= POSTWAR_CUTOFF]
    monthly = full.resample("ME").last().dropna()
    if len(monthly) < DIFF_MONTHS + 10:
        return None
    diffs = monthly.diff(DIFF_MONTHS).dropna()
    if len(monthly) <= DIFF_MONTHS:
        return None
    current = float(monthly.iloc[-1]) - float(monthly.iloc[-DIFF_MONTHS - 1])
    return _apply_polarity(code, _percentile_rank(diffs, current))


# ── 모델별 stats 함수 ───────────────────────────────────────────────────────────
def _stats_level(code: str, sliced: list[dict]) -> tuple[float | None, float | None]:
    cur = compute_current_stats(code, sliced)
    if cur is None:
        return None, None
    return cur["percentile_full"], cur["percentile_10y"]


def _stats_B(code: str, sliced: list[dict]) -> tuple[float | None, float | None]:
    """레벨 백분위 + 방향 백분위 혼합. 시리즈를 한 번만 파싱."""
    s = _series_to_pandas(sliced)
    if s.empty:
        return None, None
    latest = float(s.iloc[-1])
    latest_date = s.index[-1]
    full_s = s[s.index >= POSTWAR_CUTOFF]
    p_full = _apply_polarity(code, _percentile_rank(full_s, latest))
    cutoff = latest_date - pd.DateOffset(years=ROLLING_YEARS)
    p_10y = _apply_polarity(code, _percentile_rank(s[(s.index >= cutoff) & (s.index <= latest_date)], latest))
    dp = _diff_percentile(code, s)
    return _blend(p_full, dp), _blend(p_10y, dp)


def _stats_level_full(code: str, sliced: list[dict]) -> tuple[float | None, None]:
    cur = compute_current_stats(code, sliced)
    return (cur["percentile_full"] if cur else None), None


def _stats_E(code: str, sliced: list[dict]) -> tuple[float | None, None]:
    """8년 사이클 백분위(50%) + 6개월 변화 백분위(30%) + 10년 백분위(20%).
    코어 산식은 analyze.cycle_relative_percentile — 프로덕션과 동일 코드."""
    s = _series_to_pandas(sliced)
    if s.empty:
        return None, None
    monthly = s.resample("ME").last().dropna()
    if monthly.empty:
        return None, None
    return cycle_relative_percentile(code, monthly), None


# ── 통합 row 빌더 ──────────────────────────────────────────────────────────────
def _build_row(as_of: pd.Timestamp, indicators: dict,
               stats_fn=None, weights: dict[str, float] | None = None,
               stats_fn_map: dict[str, object] | None = None) -> dict:
    """stats_fn_map = {"growth": fn, "inflation": fn} 으로 축별 함수를 지정할 수 있다."""
    gf, g10, if_, i10 = [], [], [], []
    for code, payload in indicators.items():
        sliced = slice_series(code, payload["series"], as_of)
        if not sliced:
            continue
        cat = payload["category"]
        fn = stats_fn_map.get(cat, stats_fn) if stats_fn_map else stats_fn
        pf, p10 = fn(code, sliced)
        w = weights.get(code, 1.0) if weights else 1.0
        if cat == "growth":
            gf.append((pf, w)); g10.append((p10, w))
        else:
            if_.append((pf, w)); i10.append((p10, w))
    g_f = _weighted_mean(gf);  g_10 = _weighted_mean(g10)
    i_f = _weighted_mean(if_); i_10 = _weighted_mean(i10)
    return {
        "growth_full": g_f,  "infl_full": i_f,
        "growth_10y":  g_10, "infl_10y":  i_10,
        "g_lab_full":  _label_from_percentile(g_f),
        "i_lab_full":  _label_from_percentile(i_f),
        "g_lab_10y":   _label_from_percentile(g_10),
        "i_lab_10y":   _label_from_percentile(i_10),
    }


# Model F: 성장 축은 E(8년 사이클), 인플레 축은 C(full 창 가중)
_F_FN_MAP: dict[str, object] = {
    "growth":    _stats_E,
    "inflation": _stats_level_full,
}


def walk_model(model: str, indicators: dict,
               start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    # (stats_fn, weights, stats_fn_map)
    stats_map: dict[str, tuple] = {
        "A": (_stats_level,      None,              None),
        "B": (_stats_B,          None,              None),
        "C": (_stats_level_full, INDICATOR_WEIGHTS, None),
        "D": (_stats_level_full, INDICATOR_WEIGHTS, None),
        "E": (_stats_E,          INDICATOR_WEIGHTS, None),
        "F": (None,              INDICATOR_WEIGHTS, _F_FN_MAP),
        "G": (None,              INDICATOR_WEIGHTS, _F_FN_MAP),
        "H": (None,              INDICATOR_WEIGHTS, _F_FN_MAP),
    }
    stats_fn, weights, fn_map = stats_map[model]
    rows = [
        {"month": as_of.to_period("M"),
         **_build_row(as_of, indicators, stats_fn, weights, fn_map)}
        for as_of in pd.date_range(start, end, freq="ME")
    ]
    df = pd.DataFrame(rows).set_index("month")
    if model in ("D", "G"):
        return _apply_smooth_hysteresis(df)
    if model == "H":
        return _apply_smooth_only(df)
    return df


def _apply_smooth_only(df: pd.DataFrame) -> pd.DataFrame:
    """EWMA 평활만 적용, 라벨은 60/40 임계 재산출 (히스테리시스 없음)."""
    df = df.copy()
    for axis in ("growth", "infl"):
        col = f"{axis}_full"
        smoothed = df[col].ewm(span=EWMA_SPAN, min_periods=1).mean().round(1)
        df[col] = smoothed
        lab_col = f"{'g' if axis == 'growth' else 'i'}_lab_full"
        df[lab_col] = smoothed.map(_label_from_percentile)
    return df


def _apply_smooth_hysteresis(df: pd.DataFrame) -> pd.DataFrame:
    """EWMA 평활 → 히스테리시스 라벨 재산출 (in-place copy)."""
    df = df.copy()
    for axis in ("growth", "infl"):
        col = f"{axis}_full"
        smoothed = df[col].ewm(span=EWMA_SPAN, min_periods=1).mean().round(1)
        df[f"{axis}_full"] = smoothed

        lab_col = f"{'g' if axis == 'growth' else 'i'}_lab_full"
        labels = []
        prev = "neutral"
        for v in smoothed:
            if pd.isna(v):
                labels.append(None); continue
            if v >= ENTRY_HIGH:
                prev = "high"
            elif v <= ENTRY_LOW:
                prev = "low"
            elif prev == "high" and v < EXIT_HIGH:
                prev = "neutral"
            elif prev == "low"  and v > EXIT_LOW:
                prev = "neutral"
            labels.append(prev)
        df[lab_col] = labels
    return df


# ── 비교 실행 ─────────────────────────────────────────────────────────────────
def run_comparison() -> None:
    indicators = load_indicators()
    start  = pd.Timestamp(BACKTEST_START)
    end_dt = pd.Timestamp(max(p["series"][-1]["date"] for p in indicators.values()))
    rec = load_recession_episodes()
    inf = load_inflation_episodes()

    results: dict[str, dict] = {}

    for model in ("A", "B", "C", "D", "E", "F", "G", "H"):
        print(f"Walking model {model}…", flush=True)
        df = walk_model(model, indicators, start, end_dt)
        results[model] = {
            "growth_vs_recession":  evaluate_signal(df, "g_lab_full", "low",  rec),
            "inflation_vs_episode": evaluate_signal(df, "i_lab_full", "high", inf),
        }

    # ── JSON 저장 ────────────────────────────────────────────────────────────
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "config": {
            "backtest_start": str(start.date()),
            "backtest_end":   str(end_dt.date()),
            "alpha_diff": ALPHA_DIFF, "diff_months": DIFF_MONTHS,
            "ewma_span": EWMA_SPAN,
            "hysteresis": {
                "entry_high": ENTRY_HIGH, "exit_high": EXIT_HIGH,
                "entry_low": ENTRY_LOW,   "exit_low":  EXIT_LOW,
            },
            "indicator_weights": INDICATOR_WEIGHTS,
            "cycle_e": {
                "cycle_years": CYCLE_YEARS, "long_years": LONG_YEARS,
                "diff_months": DIFF_MONTHS_E,
                "cycle_weight": CYCLE_WEIGHT, "diff_weight": DIFF_WEIGHT_E,
                "long_weight": LONG_WEIGHT,
                "min_months_window": MIN_MONTHS_WINDOW,
                "min_diffs_for_dist": MIN_DIFFS_FOR_DIST,
            },
        },
        "models": results,
    }
    with (EVAL_DIR / "comparison.json").open("w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, default=str)
        f.write("\n")

    # ── 비교 표 출력 ─────────────────────────────────────────────────────────
    print("\n" + "=" * 72)
    print(f"{'':4s} {'신호':30s} {'hit':>5s} {'lead_med':>9s} {'FPR':>7s} {'flip/yr':>8s}")
    print("=" * 72)

    labels = {
        "A": "A baseline",
        "B": "B diff-aware(α=0.4)",
        "C": "C lead-weighted",
        "D": "D C+smooth+hyst",
        "E": "E cycle-relative(8y)",
        "F": "F E(성장)+C(인플레)",
        "G": "G F+smooth+hyst",
        "H": "H F+EWMA only",
    }
    for model, mres in results.items():
        tag = labels[model]
        for sig_key, sig_name in (
            ("growth_vs_recession",  "성장low→침체"),
            ("inflation_vs_episode", "인플high→인플레"),
        ):
            m = mres[sig_key]
            hit  = f"{m['n_caught']}/{m['n_episodes_in_window']}"
            lead = f"{m['median_lead_months']:+.0f}m" if m["median_lead_months"] is not None else "—"
            fpr  = f"{m['false_positive_rate']*100:.1f}%"
            flp  = f"{m['flips_per_year']:.2f}"
            if sig_key == "growth_vs_recession":
                print(f"  {tag:30s} | {sig_name:10s} | {hit:>5s} | {lead:>8s} | {fpr:>6s} | {flp}")
            else:
                print(f"  {'':30s} | {sig_name:10s} | {hit:>5s} | {lead:>8s} | {fpr:>6s} | {flp}")
        print()

    print("=" * 72)
    print("\n상세 per-episode (침체 — growth_vs_recession, full 창):")
    for model, mres in results.items():
        print(f"\n  [{labels[model]}]")
        for r in mres["growth_vs_recession"]["per_episode"]:
            if r.get("start_censored"):
                status = "·  "; tail = "censored"
            elif r["caught"]:
                cap = " ⚠cap" if r.get("lookback_capped") else ""
                status = "✓  "; tail = f"lead={r['lead_months']:+d}mo{cap}  first={r['first_signal']}"
            else:
                status = "✗  "; tail = "missed"
            print(f"    {status}{r['start']} → {r['end']}  {tail}")

    print("\n상세 per-episode (인플레이션 — inflation_vs_episode, full 창):")
    for model, mres in results.items():
        print(f"\n  [{labels[model]}]")
        for r in mres["inflation_vs_episode"]["per_episode"]:
            if r.get("start_censored"):
                status = "·  "; tail = "censored"
            elif r["caught"]:
                cap = " ⚠cap" if r.get("lookback_capped") else ""
                status = "✓  "; tail = f"lead={r['lead_months']:+d}mo{cap}  first={r['first_signal']}"
            else:
                status = "✗  "; tail = "missed"
            print(f"    {status}{r['start']} → {r['end']}  {tail}")

    print(f"\n→ {EVAL_DIR / 'comparison.json'} 에 저장 완료.")


if __name__ == "__main__":
    run_comparison()
