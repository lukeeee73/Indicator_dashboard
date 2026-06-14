#!/usr/bin/env python3
"""
각 지표의 "현재 위치" 를 과거 분포에 대한 백분위로 환산하고, 그 결과를
성장/인플레 두 축의 종합 점수로 묶어 4분면을 자동 판정하는 모듈.

두 층의 판정을 함께 제공한다.

1) 참조용 백분위 뷰 (full / rolling_10y) — 기존 동작 그대로
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

2) Primary 종합 판정 (백테스트 승자 — comparison.json 의 모델 H)
    - 성장 축  : 지표별 사이클-상대 백분위
                 = 8년 사이클 창 백분위 50% + 6개월 변화 백분위 30% + 10년 창 백분위 20%
    - 인플레 축: 지표별 full(전후) 창 레벨 백분위
    - 두 축 모두 선행/동행/후행 가중치(INDICATOR_WEIGHTS) 로 가중 평균
    - 축 점수를 월 단위로 산출한 뒤 EWMA(span=3) 평활 → 60/40 임계로 라벨
    - 1980-2026 backtest (scripts/compare_models.py) 기준:
        침체  4/4 적중 · 중위 선행 +16개월 · FPR  7.7% · flips/yr 0.54
        인플레 3/3 적중 · 중위 선행  +0개월 · FPR  5.9% · flips/yr 0.52
      (베이스라인 full-창 평균 대비 FPR 을 1/3~1/2 로 줄이면서 선행성 유지)

주의:
    - 모든 지표가 "값이 높을수록 해당 축이 높다" 는 polarity 라고 가정한다.
      (T10Y2Y 확장, INDPRO YoY ↑, PAYEMS YoY ↑, USSLIND ↑, 물가 YoY ↑, BEI ↑, WTI YoY ↑)
      polarity 가 다른 지표를 추가하면 INVERTED_CODES 세트에 넣어 뒤집는다.
    - 원시 시계열 자체는 변경하지 않는다. 기존 payload 에 "current" 필드만 덧붙이고
      최상위에 "assessment" 필드를 추가할 뿐이다.
    - 하이퍼파라미터는 compare_models.py 에서 사전 등록(pre-registered)된 값.
      백테스트 결과를 보고 사후 조정하지 않는다 (과적합 방지).
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
# ICSA: 신규 실업수당 청구 — 높을수록(YoY 급등) 성장 악화이므로 역방향 적용.
INVERTED_CODES: set[str] = {"LRUNTTTTKOR156S", "ICSA"}

# --------------------------------------------------------------------------
# Primary 모델 (백테스트 승자 H) 하이퍼파라미터
# --------------------------------------------------------------------------
# 모두 compare_models.py 에서 사전 등록된 값. 단일 출처 유지를 위해 여기에 두고
# compare_models.py 가 import 한다. 백테스트 결과를 보고 조정하지 않는다.
PRIMARY_MODEL_KEY = "H"        # data/eval/comparison.json 의 모델 키

# 지표별 가중치 (선행=2, 동행=1, 후행/공급측=0.5)
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

# 성장 축: 사이클-상대 백분위 구성
CYCLE_YEARS        = 8     # 사이클 참조 창 (단기부채 사이클)
LONG_YEARS         = 10    # 장기 참조 창
CYCLE_DIFF_MONTHS  = 6     # 변화(모멘텀) 기준 개월
CYCLE_WEIGHT       = 0.5   # 8년 창 백분위 가중
DIFF_WEIGHT        = 0.3   # 6개월 변화 백분위 가중
LONG_WEIGHT        = 0.2   # 10년 창 백분위 가중
MIN_MONTHS_WINDOW  = 24    # 창 내 최소 데이터 포인트
MIN_DIFFS_FOR_DIST = 12    # diff 분포에 최소 12개

# 축 점수 평활
EWMA_SPAN          = 3     # half-life ≈ 2개월
PRIMARY_EWMA_WARMUP = 12   # 궤적 앞에 붙이는 워밍업 개월 수 (EWMA 초기화 안정용)


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


def _weighted_mean(vals: list[tuple[Optional[float], float]]) -> Optional[float]:
    """(percentile, weight) 쌍 목록 → 가중 평균. None 은 skip."""
    num, den = 0.0, 0.0
    for p, w in vals:
        if p is not None:
            num += p * w
            den += w
    return round(num / den, 1) if den > 0 else None


def cycle_relative_percentile(code: str, monthly: pd.Series) -> Optional[float]:
    """Primary 모델의 성장축 코어 — 사이클-상대 백분위.

    8년 사이클 창 백분위(50%) + 6개월 변화 백분위(30%) + 10년 창 백분위(20%).
    "역사 전체에서 어디인가" 보다 "지금 사이클에서 어디이고 어디로 가는가" 를
    우선시한다. 컴포넌트 데이터가 부족하면 해당 가중치는 자동 정규화된다.

    monthly: 월말(ME) last 로 리샘플된 시계열. 마지막 값이 '현재' 로 간주된다.
    """
    if monthly.empty:
        return None
    latest_date = monthly.index[-1]
    latest = float(monthly.iloc[-1])

    cycle_s = monthly[monthly.index >= latest_date - pd.DateOffset(years=CYCLE_YEARS)]
    long_s  = monthly[monthly.index >= latest_date - pd.DateOffset(years=LONG_YEARS)]

    # ① 8년 사이클 백분위
    p_cycle: Optional[float] = None
    if len(cycle_s) >= MIN_MONTHS_WINDOW:
        p_cycle = _apply_polarity(code, _percentile_rank(cycle_s, latest))

    # ② 6개월 변화 백분위 — 8년 창 내 diff 분포를 참조
    p_diff: Optional[float] = None
    if len(cycle_s) > CYCLE_DIFF_MONTHS:
        diffs = cycle_s.diff(CYCLE_DIFF_MONTHS).dropna()
        if len(diffs) >= MIN_DIFFS_FOR_DIST:
            p_diff = _apply_polarity(code, _percentile_rank(diffs, float(diffs.iloc[-1])))

    # ③ 10년 백분위
    p_long: Optional[float] = None
    if len(long_s) >= MIN_MONTHS_WINDOW:
        p_long = _apply_polarity(code, _percentile_rank(long_s, latest))

    return _weighted_mean([
        (p_cycle, CYCLE_WEIGHT), (p_diff, DIFF_WEIGHT), (p_long, LONG_WEIGHT),
    ])


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


def compute_trajectory(indicators: dict, region: str | None = None) -> list[dict]:
    """최근 TRAJECTORY_MONTHS 개월의 (growth_score, inflation_score) 궤적.

    region=None  → US 기준: exclude_assessment 가 아닌 지표만 사용
    region="KR"  → 한국 기준: region="KR" 인 지표만 사용
    """
    growth_ranks: dict[str, pd.Series] = {}
    infl_ranks:   dict[str, pd.Series] = {}

    for code, payload in indicators.items():
        cat = payload.get("category")
        if cat not in ("growth", "inflation"):
            continue
        # 지역 필터
        if region is None:
            if payload.get("exclude_assessment"):
                continue
        else:
            if payload.get("region") != region:
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
# Primary 종합 판정 (모델 H = 사이클-상대 성장 + 가중 인플레 + EWMA 평활)
# --------------------------------------------------------------------------
def _load_primary_backtest_summary() -> Optional[dict]:
    """data/eval/comparison.json 에서 primary 모델의 핵심 성능 요약을 읽는다.

    대시보드에 "이 판정이 얼마나 믿을 만한가" 를 함께 보여주기 위한 것.
    파일이 없으면 None — 판정 자체는 영향받지 않는다.
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "data" / "eval" / "comparison.json"
    try:
        with path.open(encoding="utf-8") as f:
            comp = json.load(f)
        model = comp["models"][PRIMARY_MODEL_KEY]
    except (OSError, KeyError, ValueError):
        return None

    def _sig(m: dict) -> dict:
        return {
            "hit":                  f"{m['n_caught']}/{m['n_episodes_in_window']}",
            "median_lead_months":   m["median_lead_months"],
            "false_positive_rate":  m["false_positive_rate"],
            "flips_per_year":       m["flips_per_year"],
        }

    return {
        "window":    f"{comp['config']['backtest_start']} ~ {comp['config']['backtest_end']}",
        "recession": _sig(model["growth_vs_recession"]),
        "inflation": _sig(model["inflation_vs_episode"]),
    }


def compute_primary_assessment(indicators: dict) -> Optional[dict]:
    """미국 성장/인플레 지표로 primary 종합 판정 + 궤적을 계산한다.

    backtest(compare_models.py 모델 H) 와 동일한 산식:
      - 성장 축  : cycle_relative_percentile() 의 INDICATOR_WEIGHTS 가중 평균
      - 인플레 축: full(전후) 창 레벨 백분위의 INDICATOR_WEIGHTS 가중 평균
      - 월 단위로 (TRAJECTORY_MONTHS + PRIMARY_EWMA_WARMUP) 개월 걸어가며 산출
        후 EWMA(span=EWMA_SPAN) 평활. 마지막 달이 '현재' 판정.
    backtest 와 달리 발표 지연(release lag) 시뮬레이션은 하지 않는다 — 운영
    시점에는 '지금 손에 있는 데이터' 가 곧 알 수 있는 전부이므로.
    """
    growth_monthly: dict[str, pd.Series] = {}
    infl_raw:       dict[str, pd.Series] = {}

    for code, payload in indicators.items():
        if payload.get("exclude_assessment") or payload.get("region") == "KR":
            continue
        cat = payload.get("category")
        if cat not in ("growth", "inflation"):
            continue
        s = _series_to_pandas(payload.get("series", []))
        if s.empty:
            continue
        if cat == "growth":
            monthly = s.resample("ME").last().dropna()
            if not monthly.empty:
                growth_monthly[code] = monthly
        else:
            infl_raw[code] = s

    if not growth_monthly or not infl_raw:
        return None

    end = max(
        max(s.index.max() for s in growth_monthly.values()),
        max(s.index.max() for s in infl_raw.values()),
    )
    end_month = pd.Timestamp(end).to_period("M").to_timestamp("M")
    month_index = pd.date_range(
        end=end_month, periods=TRAJECTORY_MONTHS + PRIMARY_EWMA_WARMUP, freq="ME",
    )

    g_scores: list[Optional[float]] = []
    i_scores: list[Optional[float]] = []
    for t in month_index:
        g_vals: list[tuple[Optional[float], float]] = []
        for code, monthly in growth_monthly.items():
            m = monthly[monthly.index <= t]
            if m.empty:
                continue
            g_vals.append((cycle_relative_percentile(code, m),
                           INDICATOR_WEIGHTS.get(code, 1.0)))
        g_scores.append(_weighted_mean(g_vals))

        i_vals: list[tuple[Optional[float], float]] = []
        for code, s in infl_raw.items():
            sub = s[s.index <= t]
            if sub.empty:
                continue
            full = sub[sub.index >= POSTWAR_CUTOFF]
            if full.empty:
                continue
            p = _apply_polarity(code, _percentile_rank(full, float(sub.iloc[-1])))
            i_vals.append((p, INDICATOR_WEIGHTS.get(code, 1.0)))
        i_scores.append(_weighted_mean(i_vals))

    df = pd.DataFrame({"g": g_scores, "i": i_scores}, index=month_index).dropna()
    if df.empty:
        return None

    smoothed = df.ewm(span=EWMA_SPAN, min_periods=1).mean().round(1)
    tail = smoothed.tail(TRAJECTORY_MONTHS)

    g_now = float(smoothed["g"].iloc[-1])
    i_now = float(smoothed["i"].iloc[-1])

    return {
        "model": PRIMARY_MODEL_KEY,
        "method": (
            "growth: cycle-relative percentile "
            f"({CYCLE_YEARS}y {CYCLE_WEIGHT:.0%} + {CYCLE_DIFF_MONTHS}m-diff {DIFF_WEIGHT:.0%} "
            f"+ {LONG_YEARS}y {LONG_WEIGHT:.0%}); "
            "inflation: post-1945 full-window percentile; "
            f"lead-weighted; EWMA(span={EWMA_SPAN})"
        ),
        "as_of":            smoothed.index[-1].strftime("%Y-%m-%d"),
        "growth_score":     g_now,
        "inflation_score":  i_now,
        "growth_label":     _label_from_percentile(g_now),
        "inflation_label":  _label_from_percentile(i_now),
        "quadrant":         _classify_quadrant(g_now, i_now),
        "trajectory": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "growth_score":    round(float(row["g"]), 1),
                "inflation_score": round(float(row["i"]), 1),
            }
            for d, row in tail.iterrows()
        ],
        "backtest": _load_primary_backtest_summary(),
    }


# --------------------------------------------------------------------------
# 메인 진입점
# --------------------------------------------------------------------------
def enrich_with_assessment(output: dict) -> dict:
    """fetch_fred.py 가 만든 output dict 를 in-place 로 확장한다.

    1) 각 indicator payload 에 "current" 필드 주입
    2) 최상위에 "assessment" 블록 추가
        {
          "primary":     { model, growth_score, ..., quadrant, trajectory, backtest },
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

    _config = {
        "postwar_cutoff": POSTWAR_CUTOFF,
        "rolling_years":  ROLLING_YEARS,
        "high_threshold": HIGH_THRESHOLD,
        "low_threshold":  LOW_THRESHOLD,
    }

    # 미국 4분면 assessment
    #   primary     — 백테스트 승자 모델(H) 의 종합 판정. 대시보드의 헤드라인.
    #   full/10y    — 참조용 단순 백분위 뷰 (기존 동작 그대로 유지).
    output["assessment"] = {
        "primary":     compute_primary_assessment(indicators),
        "full":        _make_summary(growth_full, infl_full),
        "rolling_10y": _make_summary(growth_10y, infl_10y),
        "config":      _config,
        "trajectory":  compute_trajectory(indicators),
    }

    # 한국 4분면 assessment (region="KR" 인 지표만)
    kr_growth_full, kr_growth_10y = [], []
    kr_infl_full,   kr_infl_10y   = [], []
    for code, payload in indicators.items():
        if payload.get("region") != "KR":
            continue
        cur = payload.get("current")
        if cur is None:
            continue
        cat = payload.get("category")
        if cat == "growth":
            kr_growth_full.append(cur["percentile_full"])
            kr_growth_10y.append(cur["percentile_10y"])
        elif cat == "inflation":
            kr_infl_full.append(cur["percentile_full"])
            kr_infl_10y.append(cur["percentile_10y"])

    output["assessment_kr"] = {
        "full":        _make_summary(kr_growth_full, kr_infl_full),
        "rolling_10y": _make_summary(kr_growth_10y, kr_infl_10y),
        "config":      _config,
        "trajectory":  compute_trajectory(indicators, region="KR"),
    }

    return output


# --------------------------------------------------------------------------
# CLI (기존 JSON 을 재분석하고 덮어쓰고 싶을 때)
# --------------------------------------------------------------------------
def _main() -> int:
    import sys
    from pathlib import Path

    # fetch_fred.py 의 분할 저장 API 를 재사용해 동일한 파일 구조를 유지한다.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from fetch_fred import load_split_store, save_split_store, LEGACY_BUNDLE_PATH  # noqa: E402

    data = load_split_store()
    has_indicators = bool(data.get("indicators"))
    if not has_indicators:
        print(f"ERROR: 분할 데이터(data/index.json) 또는 {LEGACY_BUNDLE_PATH} 가 비어있습니다.",
              file=sys.stderr)
        return 1
    enrich_with_assessment(data)
    save_split_store(data)
    a = data.get("assessment", {})
    print("Assessment re-computed.")
    p = a.get("primary") or {}
    print("  primary    :", {k: p.get(k) for k in
                             ("model", "as_of", "growth_score", "inflation_score",
                              "growth_label", "inflation_label", "quadrant")})
    print("  full       :", a.get("full"))
    print("  rolling_10y:", a.get("rolling_10y"))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
