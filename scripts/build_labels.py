#!/usr/bin/env python3
"""
미국 인플레이션 '국면' 라벨을 객관적인 규칙으로 데이터에서 자동 생성한다.

설계 원칙
---------
1) 손으로 "이때는 인플레였다" 라고 찍지 않는다. 모든 episode 는 명시된 규칙 +
   현재 보유 시계열만으로 재현 가능해야 한다.
2) 단일 임계가 아닌 4개의 독립적 규칙을 병렬로 평가하고, 각각의 episode 목록과
   '2개 이상 규칙이 동시에 켜진' consensus episode 까지 함께 저장한다.
3) 임계는 모두 사전 등록(pre-registered) 한다 — 평가 결과를 보고 임계를 만지면
   라벨이 모델에 맞게 휘어진다. 본 스크립트의 RULES 딕셔너리를 함부로 수정 금지.

규칙
----
R1 (headline_5pct):  CPIAUCSL  YoY ≥ 5.0%   가 ≥ 6 개월 연속
R2 (core_4pct):      CPILFESL  YoY ≥ 4.0%   가 ≥ 6 개월 연속
R3 (pce_3pct_long):  PCEPI     YoY ≥ 3.0%   가 ≥ 12 개월 연속  (Fed 2% 목표 + 1pp 지속 위반)
R4 (relative_top25): CPIAUCSL  YoY 가 1948-01 이후 분포의 75 백분위 이상이
                     ≥ 6 개월 연속

각 episode 는 {start, end, peak_value, peak_date, rule} 형태.
end 는 '규칙이 마지막으로 충족된 달' (inclusive).

산출물
------
data/labels/us_inflation_episodes.json
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
INDICATORS_DIR = ROOT / "data" / "indicators"
LABELS_DIR = ROOT / "data" / "labels"

# 사전 등록 규칙 — 결과 본 뒤 수정 금지.
RULES = [
    {
        "id": "headline_5pct",
        "code": "CPIAUCSL",
        "kind": "absolute",
        "threshold": 5.0,
        "min_months": 6,
        "description": "Headline CPI YoY ≥ 5.0% for ≥ 6 consecutive months.",
    },
    {
        "id": "core_4pct",
        "code": "CPILFESL",
        "kind": "absolute",
        "threshold": 4.0,
        "min_months": 6,
        "description": "Core CPI YoY ≥ 4.0% for ≥ 6 consecutive months.",
    },
    {
        "id": "pce_3pct_long",
        "code": "PCEPI",
        "kind": "absolute",
        "threshold": 3.0,
        "min_months": 12,
        "description": "PCE YoY ≥ 3.0% for ≥ 12 consecutive months (Fed target 2% + 1pp persistent breach).",
    },
    {
        "id": "relative_top25",
        "code": "CPIAUCSL",
        "kind": "relative",
        "percentile": 75.0,
        "min_months": 6,
        "description": "Headline CPI YoY in top quartile (≥ 75th percentile of post-1948 distribution) for ≥ 6 consecutive months.",
    },
]


# --------------------------------------------------------------------------
def _load_series(code: str) -> pd.Series:
    path = INDICATORS_DIR / f"{code}.json"
    with path.open() as f:
        payload = json.load(f)
    df = pd.DataFrame(payload["series"])
    df["date"] = pd.to_datetime(df["date"])
    s = df.set_index("date")["value"].astype(float).sort_index()
    # 월 단위로 통일 — 모든 인플레 시리즈는 이미 월간이지만 안전을 위해 month-start 정규화.
    s.index = s.index.to_period("M").to_timestamp()
    return s


def _runs_above(mask: pd.Series, min_len: int) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """mask 가 True 인 연속 구간 중 길이 ≥ min_len 인 (start, end) 목록."""
    runs: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    in_run = False
    start: pd.Timestamp | None = None
    prev: pd.Timestamp | None = None
    for date, hit in mask.items():
        if hit and not in_run:
            in_run = True
            start = date
        elif not hit and in_run:
            assert start is not None and prev is not None
            length = (prev.to_period("M") - start.to_period("M")).n + 1
            if length >= min_len:
                runs.append((start, prev))
            in_run = False
            start = None
        prev = date
    if in_run and start is not None and prev is not None:
        length = (prev.to_period("M") - start.to_period("M")).n + 1
        if length >= min_len:
            runs.append((start, prev))
    return runs


def _evaluate_rule(rule: dict) -> dict:
    series = _load_series(rule["code"])
    if rule["kind"] == "absolute":
        threshold_value = float(rule["threshold"])
    elif rule["kind"] == "relative":
        threshold_value = float(np.percentile(series.dropna().values, rule["percentile"]))
    else:
        raise ValueError(f"Unknown rule kind: {rule['kind']}")

    mask = series >= threshold_value
    runs = _runs_above(mask, rule["min_months"])

    episodes = []
    for start, end in runs:
        window = series.loc[start:end]
        peak_idx = window.idxmax()
        episodes.append({
            "start": start.strftime("%Y-%m"),
            "end": end.strftime("%Y-%m"),
            "months": (end.to_period("M") - start.to_period("M")).n + 1,
            "peak_date": peak_idx.strftime("%Y-%m"),
            "peak_value": round(float(window.max()), 3),
        })

    return {
        "id": rule["id"],
        "description": rule["description"],
        "code": rule["code"],
        "kind": rule["kind"],
        "threshold_value": round(threshold_value, 4),
        "min_months": rule["min_months"],
        "data_start": series.index.min().strftime("%Y-%m"),
        "data_end":   series.index.max().strftime("%Y-%m"),
        "n_episodes": len(episodes),
        "episodes": episodes,
    }


def _consensus(rule_results: list[dict], min_rules: int = 2) -> list[dict]:
    """월 단위로 '몇 개 규칙이 켜져 있는가' 를 세고, ≥ min_rules 가 ≥ 6 개월 연속인 구간."""
    months: dict[pd.Timestamp, int] = {}
    for r in rule_results:
        for ep in r["episodes"]:
            start = pd.Timestamp(ep["start"])
            end   = pd.Timestamp(ep["end"])
            for m in pd.date_range(start, end, freq="MS"):
                months[m] = months.get(m, 0) + 1

    if not months:
        return []
    idx = pd.date_range(min(months), max(months), freq="MS")
    counts = pd.Series([months.get(m, 0) for m in idx], index=idx)
    mask = counts >= min_rules
    runs = _runs_above(mask, 6)
    return [
        {
            "start": s.strftime("%Y-%m"),
            "end":   e.strftime("%Y-%m"),
            "months": (e.to_period("M") - s.to_period("M")).n + 1,
            "max_rules_concurrent": int(counts.loc[s:e].max()),
        }
        for s, e in runs
    ]


def main() -> int:
    rule_results = [_evaluate_rule(r) for r in RULES]
    consensus = _consensus(rule_results, min_rules=2)

    out = {
        "kind": "us_inflation_episodes",
        "generated_by": "scripts/build_labels.py",
        "methodology": (
            "Episodes are derived programmatically from FRED series stored in this repo "
            "using four pre-registered rules. No episode is hand-picked. "
            "Consensus episodes are months in which ≥2 rules are simultaneously satisfied "
            "for ≥6 consecutive months."
        ),
        "rules": rule_results,
        "consensus": {
            "min_rules_concurrent": 2,
            "min_months": 6,
            "n_episodes": len(consensus),
            "episodes": consensus,
        },
    }

    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = LABELS_DIR / "us_inflation_episodes.json"
    with out_path.open("w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {out_path}")
    for r in rule_results:
        print(f"  {r['id']:18s} threshold={r['threshold_value']:>6}  episodes={r['n_episodes']}")
    print(f"  {'consensus(>=2)':18s}                         episodes={len(consensus)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
