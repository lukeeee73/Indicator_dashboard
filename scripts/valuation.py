#!/usr/bin/env python3
"""
개별 종목의 "기업 가치 대비 시장 가격" 갭(valuation gap) 을 계산하는 모듈.

접근:
    - 세 가지 고전적 방법으로 적정 주가(fair value) 를 산출한 뒤 가중평균.
        1) PE 벤치마크     : EPS_TTM × 섹터 P/E 중앙값
        2) Forward PE 벤치마크 : (price / forward_pe) × 섹터 Forward P/E 중앙값
        3) Graham Number   : sqrt(22.5 × EPS_TTM × 주당순자산)
    - valuation_gap = (현재가 - fair_value) / fair_value
        음수 = 저평가, 양수 = 고평가.
    - 과거 시계열은 분기 EPS 로부터 TTM EPS 를 만들어 PE 벤치마크 방법으로
      과거 fair_value 를 재구성한 뒤 weekly 샘플링한다.

원칙:
    - 입력 데이터(snapshot, quarterly, series) 는 변경하지 않는다.
    - 각 종목 payload 에 "valuation" 블록만 추가한다.
    - 한 종목이 실패해도 다른 종목 처리는 계속 진행한다.
    - eps_ttm <= 0 (적자) 인 종목은 fair_value 산출 불가로 표시한다.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Optional


# --------------------------------------------------------------------------
# 섹터 벤치마크 (S&P 500 섹터별 P/E 중앙값 근사)
# --------------------------------------------------------------------------
# 갱신 주기: 분기 1회 정도 수동 점검.  값이 시장과 크게 어긋나면 valuation 결과가
# 전반적으로 한쪽으로 쏠리므로 주의.
SECTOR_PE_BENCHMARK: dict[str, float] = {
    "Technology": 28.0,
    "Communication Services": 20.0,
    "Consumer Discretionary": 25.0,
    "Consumer Cyclical": 25.0,
    "Healthcare": 18.0,
    "Financial Services": 14.0,
    "Financials": 14.0,
    "Industrials": 20.0,
    "Energy": 12.0,
    "Utilities": 16.0,
    "Real Estate": 18.0,
    "Materials": 16.0,
    "Consumer Staples": 22.0,
}
DEFAULT_PE = 22.0

SECTOR_FORWARD_PE_BENCHMARK: dict[str, float] = {
    "Technology": 22.0,
    "Communication Services": 17.0,
    "Consumer Discretionary": 20.0,
    "Consumer Cyclical": 20.0,
    "Healthcare": 16.0,
    "Financial Services": 12.0,
    "Financials": 12.0,
    "Industrials": 17.0,
    "Energy": 11.0,
    "Utilities": 15.0,
    "Real Estate": 16.0,
    "Materials": 14.0,
    "Consumer Staples": 18.0,
}
DEFAULT_FORWARD_PE = 18.0

GRAHAM_MULTIPLIER = 22.5

# 방법별 가중치 (사용 가능한 방법만 합산해 자동 정규화)
METHOD_WEIGHTS: dict[str, float] = {
    "pe_benchmark":         5.0,
    "forward_pe_benchmark": 3.0,
    "graham_number":        2.0,
}

# valuation_gap → 신호 라벨
SIGNAL_THRESHOLDS = [
    (-0.20, "deep_value"),
    (-0.05, "undervalued"),
    ( 0.05, "fair"),
    ( 0.20, "overvalued"),
]
# 위 구간을 모두 넘으면 "expensive"


# --------------------------------------------------------------------------
# 단일 방법별 fair value
# --------------------------------------------------------------------------
def fair_value_pe(eps_ttm: Optional[float], sector: Optional[str]) -> Optional[float]:
    """EPS_TTM × 섹터 P/E 중앙값. 적자 기업은 None."""
    if eps_ttm is None or eps_ttm <= 0:
        return None
    multiple = SECTOR_PE_BENCHMARK.get(sector or "", DEFAULT_PE)
    return eps_ttm * multiple


def fair_value_forward_pe(
    current_price: Optional[float],
    forward_pe: Optional[float],
    sector: Optional[str],
) -> Optional[float]:
    """현재가 / forward_pe = 시장 내재 forward EPS, 여기에 섹터 forward P/E 를 곱함."""
    if not current_price or not forward_pe or forward_pe <= 0:
        return None
    implied_forward_eps = current_price / forward_pe
    if implied_forward_eps <= 0:
        return None
    multiple = SECTOR_FORWARD_PE_BENCHMARK.get(sector or "", DEFAULT_FORWARD_PE)
    return implied_forward_eps * multiple


def fair_value_graham(
    eps_ttm: Optional[float],
    current_price: Optional[float],
    price_to_book: Optional[float],
) -> Optional[float]:
    """Graham Number = sqrt(22.5 × EPS × BVPS). 적자 또는 P/B 없을 시 None."""
    if eps_ttm is None or eps_ttm <= 0:
        return None
    if not current_price or not price_to_book or price_to_book <= 0:
        return None
    bvps = current_price / price_to_book
    if bvps <= 0:
        return None
    return math.sqrt(GRAHAM_MULTIPLIER * eps_ttm * bvps)


# --------------------------------------------------------------------------
# 신호 라벨
# --------------------------------------------------------------------------
def label_from_gap(gap: Optional[float]) -> Optional[str]:
    if gap is None:
        return None
    for threshold, label in SIGNAL_THRESHOLDS:
        if gap < threshold:
            return label
    return "expensive"


# --------------------------------------------------------------------------
# TTM EPS 시계열 + 과거 valuation gap 재구성
# --------------------------------------------------------------------------
def build_ttm_eps_series(quarterly: list[dict]) -> list[dict]:
    """분기 EPS 로부터 TTM EPS 시계열을 만든다.

    각 분기 q[i] 에 대해 직전 4분기 EPS 합산.  EPS 가 None 인 분기가 있으면
    스킵한다.  반환: [{date, ttm_eps}].
    """
    valid = [q for q in (quarterly or []) if q.get("eps") is not None and q.get("date")]
    valid.sort(key=lambda q: q["date"])
    out: list[dict] = []
    for i in range(3, len(valid)):
        window = valid[i - 3 : i + 1]
        ttm = sum(q["eps"] for q in window)
        out.append({"date": valid[i]["date"], "ttm_eps": ttm})
    return out


def _sample_weekly(series: list[dict]) -> list[dict]:
    """일간 시계열을 주간(매주 마지막 영업일) 한 점으로 다운샘플."""
    seen: dict[str, dict] = {}
    for p in series:
        try:
            d = datetime.strptime(p["date"], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            continue
        # ISO 주간 키 (year, week)
        year, week, _ = d.isocalendar()
        key = f"{year}-W{week:02d}"
        seen[key] = p  # 각 주의 마지막 점이 최종으로 남음 (정렬되어 들어온다고 가정)
    return list(seen.values())


def build_gap_series(
    price_series: list[dict],
    ttm_series: list[dict],
    sector: Optional[str],
) -> list[dict]:
    """과거 가격 시계열에 대해 PE 벤치마크 기반 valuation_gap 을 재구성.

    각 가격 시점에서 그 이전(또는 같은 날짜) 의 가장 최근 TTM EPS 를 forward-fill.
    분기 데이터가 시작되기 전 구간은 신뢰할 수 있는 TTM 이 없으므로 **건너뛴다**
    (오래된 가격에 오늘 EPS 를 적용하면 fair_value 가 왜곡되어 차트가
    오해를 부른다).  주간 한 점으로 다운샘플.

    수집 cron 이 누적될수록 분기 데이터가 쌓여 series 가 자연스럽게 길어진다.
    """
    if not price_series or not ttm_series:
        return []
    multiple = SECTOR_PE_BENCHMARK.get(sector or "", DEFAULT_PE)
    sorted_ttm    = sorted(ttm_series,   key=lambda x: x["date"])
    sorted_prices = sorted(price_series, key=lambda x: x.get("date", ""))
    first_ttm_date = sorted_ttm[0]["date"]

    out: list[dict] = []
    ttm_idx = 0
    current_ttm: Optional[float] = None

    for p in sorted_prices:
        date  = p.get("date")
        price = p.get("value")
        if date is None or price is None or date < first_ttm_date:
            continue
        # 가능하면 더 최근 TTM 으로 전진
        while ttm_idx < len(sorted_ttm) and sorted_ttm[ttm_idx]["date"] <= date:
            current_ttm = sorted_ttm[ttm_idx]["ttm_eps"]
            ttm_idx += 1

        if current_ttm is None or current_ttm <= 0:
            continue
        fair = current_ttm * multiple
        if fair <= 0:
            continue
        gap = (price - fair) / fair
        out.append({
            "date":       date,
            "price":      round(float(price), 2),
            "fair_value": round(fair, 2),
            "gap":        round(gap, 4),
        })

    return _sample_weekly(out)


# --------------------------------------------------------------------------
# 통합 enrichment
# --------------------------------------------------------------------------
def compute_valuation(payload: dict) -> Optional[dict]:
    """단일 종목 payload 에서 valuation 블록을 계산해 반환.

    payload 구조:
        {
            "name": str, "sector": str,
            "series": [{"date","value"}],
            "financials": {
                "snapshot": {"pe_ratio", "forward_pe", "eps_ttm",
                             "price_to_book", ...},
                "quarterly": [{"date","eps", ...}, ...],
            }
        }

    실패(필수 필드 결손) 시 None 을 반환.
    """
    sector = payload.get("sector")
    series = payload.get("series") or []
    fin = payload.get("financials") or {}
    snap = fin.get("snapshot") or {}
    quarterly = fin.get("quarterly") or []

    if not series:
        return None
    last = series[-1]
    current_price = last.get("value")
    if current_price is None:
        return None

    eps_ttm       = snap.get("eps_ttm")
    forward_pe    = snap.get("forward_pe")
    price_to_book = snap.get("price_to_book")

    methods: dict[str, dict] = {}

    fv_pe = fair_value_pe(eps_ttm, sector)
    if fv_pe is not None:
        methods["pe_benchmark"] = {
            "fair_value": round(fv_pe, 2),
            "weight":     METHOD_WEIGHTS["pe_benchmark"],
            "note":       f"EPS_TTM × 섹터 P/E ({SECTOR_PE_BENCHMARK.get(sector or '', DEFAULT_PE):.0f})",
        }

    fv_fpe = fair_value_forward_pe(current_price, forward_pe, sector)
    if fv_fpe is not None:
        methods["forward_pe_benchmark"] = {
            "fair_value": round(fv_fpe, 2),
            "weight":     METHOD_WEIGHTS["forward_pe_benchmark"],
            "note":       f"내재 forward EPS × 섹터 Forward P/E ({SECTOR_FORWARD_PE_BENCHMARK.get(sector or '', DEFAULT_FORWARD_PE):.0f})",
        }

    fv_gr = fair_value_graham(eps_ttm, current_price, price_to_book)
    if fv_gr is not None:
        methods["graham_number"] = {
            "fair_value": round(fv_gr, 2),
            "weight":     METHOD_WEIGHTS["graham_number"],
            "note":       "sqrt(22.5 × EPS × 주당순자산)",
        }

    if not methods:
        return {
            "as_of":         last.get("date"),
            "current_price": round(float(current_price), 2),
            "sector":        sector,
            "methods":       {},
            "fair_value":    None,
            "valuation_gap": None,
            "signal":        "n/a",
            "note":          "EPS 적자 또는 필수 재무 지표 결손으로 fair value 산출 불가",
            "gap_series_weekly": [],
        }

    total_weight = sum(m["weight"] for m in methods.values())
    composite = sum(m["fair_value"] * m["weight"] for m in methods.values()) / total_weight
    gap = (current_price - composite) / composite

    ttm_series = build_ttm_eps_series(quarterly)
    gap_series = build_gap_series(series, ttm_series, sector)

    return {
        "as_of":         last.get("date"),
        "current_price": round(float(current_price), 2),
        "sector":        sector,
        "methods":       methods,
        "fair_value":    round(composite, 2),
        "valuation_gap": round(gap, 4),
        "signal":        label_from_gap(gap),
        "gap_series_weekly": gap_series,
    }


def enrich_stocks_with_valuation(stocks: dict[str, dict]) -> dict[str, dict]:
    """모든 종목 payload 에 'valuation' 블록을 추가해 반환.

    한 종목이 실패해도 다른 종목은 계속 처리한다.  실패한 종목은 valuation
    블록 없이 그대로 둔다(프론트엔드는 결손을 그대로 표시).
    """
    for ticker, payload in stocks.items():
        try:
            block = compute_valuation(payload)
            if block is not None:
                payload["valuation"] = block
        except Exception as exc:  # noqa: BLE001
            print(f"  valuation FAILED for {ticker}: {exc}")
    return stocks
