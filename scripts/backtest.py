#!/usr/bin/env python3
"""
2단계 백테스트 하네스.

각 월말 시점 t 에서, 그 시점까지 알 수 있었던 데이터(발표 지연 시뮬레이션)만 사용해
현재 analyze.py 의 자동판정 로직을 재실행한다. 그 결과 시계열을
data/labels/ 의 미국 침체/인플레 정답과 비교해 lead time / hit rate / false positive
rate / flips-per-year 를 측정한다.

한계 (정직 기록)
----------------
1. 발표 지연(release lag) 만 시뮬레이션. 데이터 자체의 사후 개정(revision) 은
   반영되지 않는다 — 현재 보유 시계열을 '그 시점에 알았던 것' 으로 가정.
2. CPI / INDPRO / PAYEMS YoY 는 fetch_fred.py 가 저장 시 미리 계산한 값을
   그대로 사용. 따라서 '나중에 원지표가 개정되어 YoY 가 바뀐' 부분은 무시된다.
   (엄밀한 vintage 백테스트는 ALFRED API 가 필요. 본 스크립트의 범위 밖.)
3. T10Y2Y(1976-) · USSLIND(1982-) 등 일부 지표는 backtest 초반에 history 가
   짧아 rolling_10y 백분위가 노이즈일 수 있다. 평가는 1980 이후 침체/인플레
   episode 만 대상으로 한다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from analyze import compute_current_stats, _make_summary  # noqa: E402

INDICATORS_DIR = ROOT / "data" / "indicators"
LABELS_DIR     = ROOT / "data" / "labels"
EVAL_DIR       = ROOT / "data" / "eval"

# 발표 지연 (참조월 t 의 값이 t + lag_days 일에 발표된다고 가정).
# 보수적으로 약간 길게 잡는다. 출처: BLS/Fed/FRED 발표 일정 (대략).
RELEASE_LAG_DAYS = {
    # daily / market data — 거의 즉시
    "T10Y2Y": 1, "DGS10": 1, "T10YIE": 1, "T5YIFR": 1, "DCOILWTICO": 1,
    "ICSA": 7,
    # monthly macro
    "INDPRO": 17, "PAYEMS": 21, "USSLIND": 30,
    "CPIAUCSL": 14, "CPILFESL": 14, "PCEPI": 30, "PCUOMFGOMFG": 30,
    "M2SL": 30, "UMCSENT": 14, "WPSID61": 21, "GFDEGDQ188S": 90,
}
DEFAULT_LAG_DAYS = 45

BACKTEST_START = "1980-01-31"


# --------------------------------------------------------------------------
def load_indicators() -> dict[str, dict]:
    """미국 + 평가에 들어가는(growth/inflation) 지표만 로드."""
    out: dict[str, dict] = {}
    for path in sorted(INDICATORS_DIR.glob("*.json")):
        with path.open() as f:
            payload = json.load(f)
        if payload.get("exclude_assessment"):
            continue
        if payload.get("region") == "KR":
            continue
        if payload.get("category") not in ("growth", "inflation"):
            continue
        for point in payload["series"]:
            point["_ts"] = pd.Timestamp(point["date"])
        out[path.stem] = payload
    return out


def slice_series(code: str, series: list[dict], as_of: pd.Timestamp) -> list[dict]:
    lag = pd.Timedelta(days=RELEASE_LAG_DAYS.get(code, DEFAULT_LAG_DAYS))
    cutoff = as_of - lag
    return [p for p in series if p["_ts"] <= cutoff]


def assess_at(as_of: pd.Timestamp, indicators: dict[str, dict]) -> dict:
    growth_full, growth_10y, infl_full, infl_10y = [], [], [], []
    for code, payload in indicators.items():
        sliced = slice_series(code, payload["series"], as_of)
        if not sliced:
            continue
        cur = compute_current_stats(code, sliced)
        if cur is None:
            continue
        cat = payload["category"]
        if cat == "growth":
            growth_full.append(cur["percentile_full"])
            growth_10y.append(cur["percentile_10y"])
        else:
            infl_full.append(cur["percentile_full"])
            infl_10y.append(cur["percentile_10y"])
    return {
        "full":        _make_summary(growth_full, infl_full),
        "rolling_10y": _make_summary(growth_10y, infl_10y),
    }


def walk(indicators: dict[str, dict], start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    rows = []
    for as_of in pd.date_range(start, end, freq="ME"):
        a = assess_at(as_of, indicators)
        full = a.get("full") or {}
        r10  = a.get("rolling_10y") or {}
        rows.append({
            "month":       as_of.to_period("M"),
            "growth_full": full.get("growth_score"),
            "infl_full":   full.get("inflation_score"),
            "g_lab_full":  full.get("growth_label"),
            "i_lab_full":  full.get("inflation_label"),
            "quad_full":   full.get("quadrant"),
            "growth_10y":  r10.get("growth_score"),
            "infl_10y":    r10.get("inflation_score"),
            "g_lab_10y":   r10.get("growth_label"),
            "i_lab_10y":   r10.get("inflation_label"),
            "quad_10y":    r10.get("quadrant"),
        })
    return pd.DataFrame(rows).set_index("month")


# --------------------------------------------------------------------------
def load_recession_episodes() -> list[tuple[pd.Period, pd.Period]]:
    with (LABELS_DIR / "us_recessions.json").open() as f:
        data = json.load(f)
    out = []
    for ep in data["episodes"]:
        peak   = pd.Period(ep["peak"],   freq="M")
        trough = pd.Period(ep["trough"], freq="M")
        out.append((peak + 1, trough))   # NBER convention: 침체 = [peak+1, trough]
    return out


def load_inflation_episodes() -> list[tuple[pd.Period, pd.Period]]:
    with (LABELS_DIR / "us_inflation_episodes.json").open() as f:
        data = json.load(f)
    return [
        (pd.Period(ep["start"], freq="M"), pd.Period(ep["end"], freq="M"))
        for ep in data["consensus"]["episodes"]
    ]


def evaluate_signal(df: pd.DataFrame, label_col: str, target_value: str,
                    episodes: list[tuple[pd.Period, pd.Period]],
                    lookback: int = 24, fp_buffer: int = 12) -> dict:
    """이진 신호(label_col == target_value) 와 정답 episode 비교.

    검열(censoring) 처리:
      - start_censored: episode 시작이 backtest_start 직후라 lookback 창이 잘리는 경우
        → 통계에서 제외하고 별도 표시.
      - lookback_capped: 첫 신호가 search_start 와 정확히 일치 → 더 일찍 켜졌을 가능성
        있음. lead 값은 ≥lookback 으로 해석. 별도 플래그.
    """
    series = (df[label_col] == target_value).astype(bool)
    bt_start = df.index.min()

    per_episode = []
    for s, e in episodes:
        if e < bt_start or s > df.index.max():
            continue   # backtest window 밖
        search_start = s - lookback
        if search_start < bt_start:
            # episode 시작이 backtest 창 안에 lookback 만큼의 여유가 없음
            per_episode.append({
                "start": str(s), "end": str(e),
                "first_signal": None, "lead_months": None,
                "caught": None, "start_censored": True,
            })
            continue
        signaled = series[(series.index >= search_start) & (series.index <= e) & series]
        if signaled.empty:
            per_episode.append({
                "start": str(s), "end": str(e),
                "first_signal": None, "lead_months": None,
                "caught": False, "start_censored": False,
            })
        else:
            first = signaled.index.min()
            lead = (s - first).n   # 양수=선행
            capped = (first == search_start)
            per_episode.append({
                "start": str(s), "end": str(e),
                "first_signal": str(first), "lead_months": int(lead),
                "caught": True, "start_censored": False,
                "lookback_capped": bool(capped),
            })

    scoreable = [r for r in per_episode if not r.get("start_censored")]
    n_eps    = len(scoreable)
    n_caught = sum(1 for r in scoreable if r["caught"])
    leads    = [r["lead_months"] for r in scoreable if r["caught"]]

    near_episode = pd.Series(False, index=df.index)
    for s, e in episodes:
        mask = (df.index >= s - fp_buffer) & (df.index <= e)
        near_episode |= mask
    nonepisode_months = ~near_episode
    fp_months = int((series & nonepisode_months).sum())
    n_nonep   = int(nonepisode_months.sum())
    fpr = fp_months / max(n_nonep, 1)

    transitions = int((series.astype(int).diff().abs() == 1).sum())
    n_months = len(df)
    flips_per_year = transitions / max(n_months / 12.0, 1)

    return {
        "n_episodes_in_window": n_eps,
        "n_caught":             n_caught,
        "hit_rate":             round(n_caught / max(n_eps, 1), 3),
        "median_lead_months":   float(np.median(leads)) if leads else None,
        "mean_lead_months":     round(float(np.mean(leads)), 2) if leads else None,
        "false_positive_rate":  round(fpr, 4),
        "fp_months":            fp_months,
        "nonepisode_months":    n_nonep,
        "flips_per_year":       round(flips_per_year, 2),
        "per_episode":          per_episode,
    }


# --------------------------------------------------------------------------
def main() -> int:
    indicators = load_indicators()
    print(f"US growth+inflation indicators: {len(indicators)}")
    for code, p in indicators.items():
        first = p["series"][0]["date"]
        last  = p["series"][-1]["date"]
        print(f"  {code:14s} {p['category']:10s} {first} → {last}  ({len(p['series'])} pts)")

    start = pd.Timestamp(BACKTEST_START)
    end_dt = pd.Timestamp(max(p["series"][-1]["date"] for p in indicators.values()))
    df = walk(indicators, start, end_dt)
    print(f"\nBacktest months: {len(df)}  ({df.index.min()} → {df.index.max()})")

    rec = load_recession_episodes()
    inf = load_inflation_episodes()

    metrics = {
        "config": {
            "model":            "baseline (analyze.py percentile + 60/40 threshold)",
            "backtest_start":   str(start.date()),
            "backtest_end":     str(end_dt.date()),
            "n_months":         len(df),
            "release_lag_days": RELEASE_LAG_DAYS,
            "default_lag_days": DEFAULT_LAG_DAYS,
        },
        "growth_low_vs_recession_full":   evaluate_signal(df, "g_lab_full", "low",  rec),
        "growth_low_vs_recession_10y":    evaluate_signal(df, "g_lab_10y", "low",  rec),
        "inflation_high_vs_episode_full": evaluate_signal(df, "i_lab_full", "high", inf),
        "inflation_high_vs_episode_10y":  evaluate_signal(df, "i_lab_10y", "high", inf),
    }

    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with (EVAL_DIR / "baseline.json").open("w") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False, default=str)
        f.write("\n")
    df_out = df.copy()
    df_out.index = df_out.index.astype(str)
    df_out.to_json(EVAL_DIR / "baseline_timeline.json", orient="index", indent=2)

    print(f"\nWrote {EVAL_DIR / 'baseline.json'}")
    print(f"Wrote {EVAL_DIR / 'baseline_timeline.json'}")

    for key in ("growth_low_vs_recession_full",   "growth_low_vs_recession_10y",
                "inflation_high_vs_episode_full", "inflation_high_vs_episode_10y"):
        m = metrics[key]
        print(f"\n=== {key} ===")
        print(f"  episodes: {m['n_caught']}/{m['n_episodes_in_window']} caught  ({m['hit_rate']*100:.0f}%)")
        print(f"  lead time (median / mean): {m['median_lead_months']} / {m['mean_lead_months']} months")
        print(f"  false-positive rate:       {m['false_positive_rate']*100:.1f}%  ({m['fp_months']}/{m['nonepisode_months']} non-episode months)")
        print(f"  flips per year:            {m['flips_per_year']}")
        for r in m["per_episode"]:
            if r.get("start_censored"):
                stat = "·"; tail = "start_censored (backtest 창 밖)"
            elif r["caught"]:
                stat = "✓"
                cap = " ⚠cap" if r.get("lookback_capped") else ""
                tail = f"lead={r['lead_months']:+d}mo{cap}"
            else:
                stat = "✗"; tail = "no signal"
            first = r["first_signal"] or "—"
            print(f"    {stat}  {r['start']} → {r['end']}   first={first:>8s}   {tail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
