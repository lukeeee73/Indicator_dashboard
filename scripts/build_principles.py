#!/usr/bin/env python3
"""
"Principles" 탭용 데이터 빌더 — 레이 달리오식 4분면 프레임워크를 이용해
"과거 특정 시점으로 돌아가 그 때 알 수 있었던 정보만으로 투자 결정을 내렸다면"
을 시뮬레이션할 수 있는 월별 타임라인을 만든다.

핵심 아이디어
------------
1. 국면(quadrant) 판정은 **그 시점에 알 수 있었던 데이터만** 사용한다.
   backtest.py / compare_models.py 가 이미 구현한 "발표 지연(release lag)
   시뮬레이션 + 모델 H(백테스트 승자)" 월별 워크포워드를 그대로 재사용한다.
   즉 1999-06 시점의 국면은 1999-06 이후 데이터를 전혀 보지 않고 산출된다.
2. 자산별 수익률은 **레포에 이미 있는 시계열만** 사용한다 (외부 API 호출 없음).
   - 채권: FRED DGS10(10년물 금리)에서 duration 근사로 총수익 지수를 역산.
   - 미국 주식: data/indices/GSPC.json (Yahoo ^GSPC, 가격지수).
   - 한국 주식: data/assets/KOSPI.json (가격지수, KRW).
   - 금: data/assets/GOLD.json (XAU/USD 현물, fetch_fred.py 가 수집) — 있을 때만.
   - 현금: 데이터 없음 → 무이자 보유(명목가치 고정)로 명시적으로 근사.
   각 근사의 한계는 output JSON의 "note" 필드에 그대로 남긴다 — 나중에
   실제 데이터를 구하면 이 스크립트만 교체하면 된다.
3. 각 월에 그 시점의 시장 지표 스냅샷(기준금리 FEDFUNDS, 미국 10년물 DGS10,
   금 시세, CPI YoY)을 함께 실어 프론트엔드가 "진입/청산 시점의 시장 상황" 과
   "비슷한 과거 국면의 시장 상황" 을 보여줄 수 있게 한다. FEDFUNDS/GOLD 는
   아직 수집 전이면 null 로 남는다 (다음 주간 갱신 때 채워짐).

이 스크립트는 새 지표를 수집하지 않는다. 기존 data/ 를 읽어 재조합할 뿐이다.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from analyze import _classify_quadrant  # noqa: E402
from backtest import load_indicators, BACKTEST_START  # noqa: E402
from compare_models import walk_model  # noqa: E402

DATA_DIR = ROOT / "data"
OUT_DIR = DATA_DIR / "principles"
OUT_PATH = OUT_DIR / "timeline.json"

PRIMARY_MODEL_KEY = "H"

# 10년물 국채의 근사 수정듀레이션. r_월 = y_전월/12 - DURATION × Δy (연율 → 월율 근사).
# 실제 듀레이션은 만기 접근과 금리 수준에 따라 변하지만, 교육용 근사이므로 고정값 사용.
BOND_DURATION = 7.0

QUADRANT_PLAYBOOK = {
    "Q1": {
        "label": "성장 ↑ · 인플레 ↑",
        "hint": "원자재 · 신흥국 주식 · 인플레 연동채",
        "principle": (
            "성장과 인플레가 함께 오르는 국면 — 명목채권은 실질수익률을 깎아먹기 쉽고, "
            "실물자산·신흥국 자산이 상대적으로 유리했던 국면이다."
        ),
    },
    "Q2": {
        "label": "성장 ↑ · 인플레 ↓",
        "hint": "선진국 주식 · 회사채",
        "principle": (
            "디스인플레이션 속 성장 국면 — '골디락스'. 주식·회사채처럼 성장에 베팅하는 "
            "자산이 우호적이었던 국면이다."
        ),
    },
    "Q3": {
        "label": "성장 ↓ · 인플레 ↑",
        "hint": "금 · 인플레 연동채 · 원자재",
        "principle": (
            "스태그플레이션 국면 — 주식과 채권이 동시에 흔들리기 쉽다. 현금·명목채권의 "
            "실질가치가 인플레에 빠르게 침식된다."
        ),
    },
    "Q4": {
        "label": "성장 ↓ · 인플레 ↓",
        "hint": "장기 국채 · 현금",
        "principle": (
            "디플레이션적 침체 국면 — 명목채권(장기 국채)이 가격 상승(금리 하락) 이득을 "
            "누리기 쉽고, 위험자산은 낙폭이 컸던 국면이다."
        ),
    },
}


def build_quadrant_timeline() -> pd.DataFrame:
    """backtest.py/compare_models.py 의 walk-forward(발표 지연 반영) 재사용."""
    indicators = load_indicators()
    start = pd.Timestamp(BACKTEST_START)
    end = pd.Timestamp(max(p["series"][-1]["date"] for p in indicators.values()))
    df = walk_model(PRIMARY_MODEL_KEY, indicators, start, end)
    df = df.copy()
    df["quadrant"] = [
        _classify_quadrant(g, i) if pd.notna(g) and pd.notna(i) else None
        for g, i in zip(df["growth_full"], df["infl_full"])
    ]
    return df


def load_series(path: Path) -> pd.Series:
    with path.open(encoding="utf-8") as f:
        payload = json.load(f)
    df = pd.DataFrame(payload["series"])
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")["value"].astype(float).sort_index()


def load_series_optional(path: Path) -> pd.Series | None:
    """아직 수집되지 않았을 수 있는 시계열(FEDFUNDS, GOLD 등)은 없으면 None."""
    if not path.exists():
        return None
    try:
        s = load_series(path)
    except (json.JSONDecodeError, KeyError, ValueError):
        return None
    return s if not s.empty else None


def asof_value(s: pd.Series | None, d: pd.Timestamp, digits: int = 2) -> float | None:
    """d 이전(포함) 마지막 관측값 — 시계열이 없거나 아직 시작 전이면 None."""
    if s is None:
        return None
    sub = s[s.index <= d]
    if sub.empty:
        return None
    return round(float(sub.iloc[-1]), digits)


def monthly_last(s: pd.Series) -> pd.Series:
    return s.resample("ME").last().dropna()


def build_bond_total_return_index(dgs10_pct_monthly: pd.Series) -> pd.Series:
    """FRED DGS10(연율 %, 월말)에서 duration 근사로 총수익 지수를 역산.

    r_월 = y_전월/12 (이자 수익) - DURATION × Δy (금리 변화에 따른 가격 손익)
    """
    y = dgs10_pct_monthly / 100.0
    values = [100.0]
    for i in range(1, len(y)):
        y_prev = float(y.iloc[i - 1])
        dy = float(y.iloc[i] - y.iloc[i - 1])
        r = y_prev / 12.0 - BOND_DURATION * dy
        values.append(values[-1] * (1.0 + r))
    return pd.Series(values, index=y.index)


def build_price_index(monthly: pd.Series) -> pd.Series:
    base = float(monthly.iloc[0])
    return monthly / base * 100.0


def series_to_index_list(s: pd.Series) -> list[dict]:
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for d, v in s.items()
    ]


def main() -> int:
    print("국면(quadrant) 워크포워드 재구성 중 (모델 H, 발표 지연 반영)...")
    qdf = build_quadrant_timeline()
    print(f"  {len(qdf)}개월 ({qdf.index.min()} ~ {qdf.index.max()})")

    cpi_yoy_monthly = monthly_last(load_series(DATA_DIR / "indicators" / "CPIAUCSL.json"))

    # 시장 지표 스냅샷용 시계열 — 진입/청산 시점과 과거 국면 비교에 사용.
    # FEDFUNDS(기준금리)·GOLD(금 현물)는 fetch_fred.py 가 다음 갱신 때 수집한다.
    dgs10_monthly = monthly_last(load_series(DATA_DIR / "assets" / "DGS10.json"))
    fedfunds_monthly = load_series_optional(DATA_DIR / "assets" / "FEDFUNDS.json")
    if fedfunds_monthly is not None:
        fedfunds_monthly = monthly_last(fedfunds_monthly)
    gold_monthly = load_series_optional(DATA_DIR / "assets" / "GOLD.json")
    if gold_monthly is not None:
        gold_monthly = monthly_last(gold_monthly)
    gold_yoy_monthly = (
        (gold_monthly.pct_change(periods=12) * 100.0).dropna()
        if gold_monthly is not None else None
    )

    months: list[dict] = []
    for period, row in qdf.iterrows():
        d = period.to_timestamp("M")
        months.append({
            "date": d.strftime("%Y-%m-%d"),
            "growth_score": None if pd.isna(row["growth_full"]) else round(float(row["growth_full"]), 1),
            "inflation_score": None if pd.isna(row["infl_full"]) else round(float(row["infl_full"]), 1),
            "growth_label": row["g_lab_full"] if pd.notna(row["g_lab_full"]) else None,
            "inflation_label": row["i_lab_full"] if pd.notna(row["i_lab_full"]) else None,
            "quadrant": row["quadrant"],
            "cpi_yoy": asof_value(cpi_yoy_monthly, d, digits=3),
            # 그 달의 시장 지표 스냅샷 (없으면 null)
            "fed_funds": asof_value(fedfunds_monthly, d),
            "us10y": asof_value(dgs10_monthly, d),
            "gold": asof_value(gold_monthly, d),
            "gold_yoy": asof_value(gold_yoy_monthly, d, digits=1),
        })

    print("자산 수익률 지수 구성 중 (채권 근사 / 미국 주식 / 코스피 / 금)...")
    bond_index = build_bond_total_return_index(dgs10_monthly)

    gspc_monthly = monthly_last(load_series(DATA_DIR / "indices" / "GSPC.json"))
    stock_us_index = build_price_index(gspc_monthly)

    kospi_monthly = monthly_last(load_series(DATA_DIR / "assets" / "KOSPI.json"))
    stock_kr_index = build_price_index(kospi_monthly)

    assets = {
        "bond_us10y": {
            "label": "미국 10년 국채 (근사 총수익 지수)",
            "note": (
                f"FRED DGS10 월말 금리에서 duration 근사로 역산한 총수익 지수입니다 "
                f"(r_월 = y_전월/12 − {BOND_DURATION:.1f} × Δy). 실제 국채 총수익 지수가 "
                "아닌 교육용 근사치이며, 컨벡시티·듀레이션 변화는 반영하지 않습니다."
            ),
            "start": bond_index.index[0].strftime("%Y-%m-%d"),
            "end": bond_index.index[-1].strftime("%Y-%m-%d"),
            "index": series_to_index_list(bond_index),
        },
        "stock_us_sp500": {
            "label": "S&P 500 (가격지수, 배당 미반영)",
            "note": (
                "Yahoo Finance ^GSPC 월말 종가 기준 가격지수입니다. 배당 재투자분이 "
                "빠져 있어 장기 실제 총수익보다 연 1.5~2%p 가량 낮게 잡힐 수 있습니다."
            ),
            "start": stock_us_index.index[0].strftime("%Y-%m-%d"),
            "end": stock_us_index.index[-1].strftime("%Y-%m-%d"),
            "index": series_to_index_list(stock_us_index),
        },
        "stock_kr_kospi": {
            "label": "코스피 (가격지수, KRW)",
            "note": (
                "KOSPI 월말 종가 기준 가격지수(원화)입니다. 배당 미반영, 원/달러 환율 "
                "환산 없이 원화 표시 그대로 사용합니다."
            ),
            "start": stock_kr_index.index[0].strftime("%Y-%m-%d"),
            "end": stock_kr_index.index[-1].strftime("%Y-%m-%d"),
            "index": series_to_index_list(stock_kr_index),
        },
        "cash": {
            "label": "현금 (무이자 보유)",
            "note": (
                "단기금리(3개월물 등) 데이터가 레포에 없어 이자 없이 명목가치를 그대로 "
                "들고 있다고 가정합니다. 인플레이션에 의한 실질가치 침식만 반영됩니다."
            ),
            "synthetic_flat": True,
        },
    }

    # 금 — GOLD.json 이 수집된 뒤에만 투자 가능 자산으로 추가된다.
    if gold_monthly is not None:
        gold_index = build_price_index(gold_monthly)
        assets["gold_xau"] = {
            "label": "금 (XAU/USD 현물)",
            "note": (
                "금 현물(XAU/USD) 월말 가격 기준 가격지수입니다. 보관 비용·ETF 수수료는 "
                "반영하지 않으며 달러 표시 그대로 사용합니다."
            ),
            "start": gold_index.index[0].strftime("%Y-%m-%d"),
            "end": gold_index.index[-1].strftime("%Y-%m-%d"),
            "index": series_to_index_list(gold_index),
        }

    with (DATA_DIR / "labels" / "us_recessions.json").open(encoding="utf-8") as f:
        recessions = [
            {"peak": ep["peak"], "trough": ep["trough"]}
            for ep in json.load(f)["episodes"]
        ]
    with (DATA_DIR / "labels" / "us_inflation_episodes.json").open(encoding="utf-8") as f:
        inflation_eps = [
            {"start": ep["start"], "end": ep["end"]}
            for ep in json.load(f)["consensus"]["episodes"]
        ]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "quadrant_model": {
            "key": PRIMARY_MODEL_KEY,
            "description": (
                "각 월의 국면은 그 시점까지 발표되었을 데이터만 사용해(발표 지연 시뮬레이션) "
                "재계산한 것입니다 — 실제 그 시점의 투자자가 알 수 있었던 정보만 반영합니다. "
                "산식은 scripts/analyze.py 의 모델 H(백테스트 승자)와 동일합니다."
            ),
            "backtest_start": BACKTEST_START,
        },
        "months": months,
        "assets": assets,
        # 프론트엔드가 지표별 가용 여부를 알 수 있도록 노출 — false 인 지표는
        # fetch_fred.py 의 다음 주간 갱신 때 수집되어 채워진다.
        "market_indicators": {
            "fed_funds": {"label": "미국 기준금리", "unit": "%", "available": fedfunds_monthly is not None},
            "us10y": {"label": "미국 10년물 금리", "unit": "%", "available": True},
            "gold": {"label": "금 (XAU/USD)", "unit": "$/oz", "available": gold_monthly is not None},
            "cpi_yoy": {"label": "CPI YoY", "unit": "%", "available": True},
        },
        "recession_episodes": recessions,
        "inflation_episodes": inflation_eps,
        "quadrant_playbook": QUADRANT_PLAYBOOK,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {OUT_PATH}  ({len(months)}개월, 자산 {len(assets)}종)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
