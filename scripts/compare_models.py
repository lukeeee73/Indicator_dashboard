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

하이퍼파라미터 사전 등록(pre-registered)
---------------------------------------
B  alpha_diff   = 0.40  (방향 가중)
   diff_months  = 6
C  지표별 weight  : INDICATOR_WEIGHTS 딕셔너리 참조
D  ewma_span    = 3     (half-life ≈ 2개월)
   entry_high   = 60, exit_high  = 50
   entry_low    = 40, exit_low   = 50

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
    INVERTED_CODES, POSTWAR_CUTOFF,
    _series_to_pandas, _percentile_rank, _apply_polarity, _label_from_percentile,
)
from backtest import (  # noqa: E402
    load_indicators, slice_series, load_recession_episodes,
    load_inflation_episodes, evaluate_signal,
    RELEASE_LAG_DAYS, DEFAULT_LAG_DAYS, BACKTEST_START,
)

EVAL_DIR = ROOT / "data" / "eval"

# ── 사전 등록 하이퍼파라미터 ──────────────────────────────────────────────────
ALPHA_DIFF   = 0.40    # Tier B: 방향 백분위 가중
DIFF_MONTHS  = 6       # Tier B: 몇 개월 변화 기준
EWMA_SPAN    = 3       # Tier D: EWMA 평활 창
ENTRY_HIGH   = 60.0    # Tier D: high 진입 임계
EXIT_HIGH    = 50.0    # Tier D: high 이탈 임계
ENTRY_LOW    = 40.0    # Tier D: low  진입 임계
EXIT_LOW     = 50.0    # Tier D: low  이탈 임계

# Tier C 지표별 가중치 (선행=2, 동행=1, 후행/공급측=0.5)
INDICATOR_WEIGHTS: dict[str, float] = {
    # ── Growth ──────────────────────────────────
    "T10Y2Y":    2.0,   # 선행 – 수익률 곡선
    "USSLIND":   2.0,   # 선행 – Philly Fed 선행지수
    "UMCSENT":   1.5,   # 선행 – 소비자심리
    "INDPRO":    1.0,   # 동행 – 산업생산
    "PAYEMS":    1.0,   # 동행 – 비농업 고용
    "ICSA":      0.5,   # 후행(지연) – 주간 실업청구
    # ── Inflation ───────────────────────────────
    "T10YIE":    2.0,   # 선행 – 10년 기대인플레
    "T5YIFR":    2.0,   # 선행 – 5Y5Y 기대인플레
    "CPILFESL":  1.5,   # 동행 – Core CPI (끈적한 인플레)
    "PCEPI":     1.5,   # 동행 – PCE (Fed 준거)
    "CPIAUCSL":  1.0,   # 동행 – 헤드라인 CPI
    "DCOILWTICO":0.5,   # 후행/공급 – WTI YoY
    "WPSID61":   0.5,   # 후행/공급 – PPI 중간재
    "PCUOMFGOMFG":0.5,  # 후행/공급 – 제조업 PPI
}


# ── 공통 유틸 ──────────────────────────────────────────────────────────────────
def _weighted_mean(vals: list[tuple[float | None, float]]) -> float | None:
    """(percentile, weight) 쌍 목록 → 가중 평균. None 은 skip."""
    num, den = 0.0, 0.0
    for p, w in vals:
        if p is not None:
            num += p * w
            den += w
    return round(num / den, 1) if den > 0 else None


def _classify_quadrant(g: float | None, i: float | None) -> str | None:
    if g is None or i is None:
        return None
    gh = g >= ENTRY_HIGH; gl = g <= ENTRY_LOW
    ih = i >= ENTRY_HIGH; il = i <= ENTRY_LOW
    if gh and ih: return "Q1"
    if gh and il: return "Q2"
    if gl and ih: return "Q3"
    if gl and il: return "Q4"
    if gh:  return "Q1/Q2-edge"
    if gl:  return "Q3/Q4-edge"
    if ih:  return "Q1/Q3-edge"
    if il:  return "Q2/Q4-edge"
    return "Neutral"


def _diff_percentile(code: str, sliced: list[dict]) -> float | None:
    """최신 6개월 변화량이 역사적 변화 분포에서 차지하는 백분위."""
    s = _series_to_pandas(sliced)
    full = s[s.index >= POSTWAR_CUTOFF]
    # 월 단위로 리샘플 (일간 데이터 노이즈 제거)
    monthly = full.resample("ME").last().dropna()
    if len(monthly) < DIFF_MONTHS + 10:
        return None
    diffs = monthly.diff(DIFF_MONTHS).dropna()
    if diffs.empty:
        return None
    current = float(monthly.iloc[-1]) - float(monthly.iloc[-DIFF_MONTHS - 1]) \
        if len(monthly) > DIFF_MONTHS else None
    if current is None:
        return None
    p = _percentile_rank(diffs, current)
    return _apply_polarity(code, p)


# ── 모델 A (baseline) ──────────────────────────────────────────────────────────
def _stats_A(code: str, sliced: list[dict]) -> tuple[float | None, float | None]:
    """(percentile_full, percentile_10y)"""
    from analyze import compute_current_stats
    cur = compute_current_stats(code, sliced)
    if cur is None:
        return None, None
    return cur["percentile_full"], cur["percentile_10y"]


# ── 모델 B (diff-aware) ────────────────────────────────────────────────────────
def _stats_B(code: str, sliced: list[dict]) -> tuple[float | None, float | None]:
    """(combined_full, combined_10y): α*diff + (1-α)*level."""
    from analyze import compute_current_stats
    cur = compute_current_stats(code, sliced)
    if cur is None:
        return None, None
    dp = _diff_percentile(code, sliced)
    def blend(level: float | None) -> float | None:
        if level is None:
            return None
        if dp is None:
            return level
        return round(ALPHA_DIFF * dp + (1 - ALPHA_DIFF) * level, 1)
    return blend(cur["percentile_full"]), blend(cur["percentile_10y"])


# ── 모델 C (lead-weighted, inflation=full only) ───────────────────────────────
def _stats_C(code: str, sliced: list[dict]) -> tuple[float | None, None]:
    """(percentile_full, None) — 10y 는 사용 안 함."""
    from analyze import compute_current_stats
    cur = compute_current_stats(code, sliced)
    if cur is None:
        return None, None
    return cur["percentile_full"], None


# ── Walk 함수들 ────────────────────────────────────────────────────────────────
def _build_row_base(as_of: pd.Timestamp, indicators: dict,
                    stats_fn) -> dict:
    gf, g10, if_, i10 = [], [], [], []
    for code, payload in indicators.items():
        sliced = slice_series(code, payload["series"], as_of)
        if not sliced:
            continue
        pf, p10 = stats_fn(code, sliced)
        cat = payload["category"]
        if cat == "growth":
            gf.append((pf, 1.0)); g10.append((p10, 1.0))
        else:
            if_.append((pf, 1.0)); i10.append((p10, 1.0))
    g_f  = _weighted_mean(gf)
    g_10 = _weighted_mean(g10)
    i_f  = _weighted_mean(if_)
    i_10 = _weighted_mean(i10)
    return {
        "growth_full":  g_f,  "infl_full":  i_f,
        "growth_10y":   g_10, "infl_10y":   i_10,
        "g_lab_full":   _label_from_percentile(g_f),
        "i_lab_full":   _label_from_percentile(i_f),
        "g_lab_10y":    _label_from_percentile(g_10),
        "i_lab_10y":    _label_from_percentile(i_10),
    }


def _build_row_C(as_of: pd.Timestamp, indicators: dict) -> dict:
    gf, if_ = [], []
    for code, payload in indicators.items():
        sliced = slice_series(code, payload["series"], as_of)
        if not sliced:
            continue
        pf, _ = _stats_C(code, sliced)
        w = INDICATOR_WEIGHTS.get(code, 1.0)
        if payload["category"] == "growth":
            gf.append((pf, w))
        else:
            if_.append((pf, w))
    g_f = _weighted_mean(gf)
    i_f = _weighted_mean(if_)
    return {
        "growth_full": g_f, "infl_full": i_f,
        "g_lab_full":  _label_from_percentile(g_f),
        "i_lab_full":  _label_from_percentile(i_f),
        # 10y 컬럼은 None (C 모델은 full 창만 사용)
        "growth_10y": None, "infl_10y": None,
        "g_lab_10y": None,  "i_lab_10y": None,
    }


def walk_model(model: str, indicators: dict,
               start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    rows = []
    for as_of in pd.date_range(start, end, freq="ME"):
        m = as_of.to_period("M")
        if model == "A":
            row = _build_row_base(as_of, indicators, _stats_A)
        elif model == "B":
            row = _build_row_base(as_of, indicators, _stats_B)
        elif model in ("C", "D"):
            row = _build_row_C(as_of, indicators)
        else:
            raise ValueError(model)
        rows.append({"month": m, **row})
    df = pd.DataFrame(rows).set_index("month")
    if model == "D":
        df = _apply_smooth_hysteresis(df)
    return df


def _apply_smooth_hysteresis(df: pd.DataFrame) -> pd.DataFrame:
    """EWMA 평활 → 히스테리시스 라벨 재산출 (in-place copy)."""
    df = df.copy()
    for axis in ("growth", "infl"):
        col = f"{axis}_full"
        smoothed = df[col].ewm(span=EWMA_SPAN, min_periods=1).mean().round(1)
        df[f"{axis}_full"] = smoothed    # 평활된 점수로 교체

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
    timelines: dict[str, pd.DataFrame] = {}

    for model in ("A", "B", "C", "D"):
        print(f"Walking model {model}…", flush=True)
        df = walk_model(model, indicators, start, end_dt)
        timelines[model] = df

        # 성장 신호: full 창 우선, 없으면 10y
        g_col = "g_lab_full"
        i_col = "i_lab_full"

        results[model] = {
            "growth_vs_recession":   evaluate_signal(df, g_col, "low",  rec),
            "inflation_vs_episode":  evaluate_signal(df, i_col, "high", inf),
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
