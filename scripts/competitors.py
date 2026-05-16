#!/usr/bin/env python3
"""
종목별 경쟁사 매핑.

이 매핑은 두 곳에서 참조된다:
    1) Claude Code Routine (.claude/routines/daily-market-analysis.md) 이
       경쟁사 동향을 비교할 때
    2) 프론트엔드(app.js) 가 경쟁사 비교 뷰를 그릴 때 (data/index.json 에 노출)

새 종목을 watchlist 에 추가하면 여기에도 경쟁사 목록을 한 줄 추가할 것.
"""

from __future__ import annotations

# 각 종목의 주요 경쟁사 (같은 watchlist 내 종목은 우선, 외부 경쟁사도 참고용 포함)
COMPETITORS: dict[str, list[str]] = {
    # ── 빅테크 / AI 플랫폼 ─────────────────────────────────────────────
    "AAPL":  ["MSFT", "GOOGL", "AMZN"],
    "MSFT":  ["AAPL", "GOOGL", "AMZN", "ORCL"],
    "GOOGL": ["MSFT", "META", "AMZN"],
    "AMZN":  ["MSFT", "GOOGL", "AAPL", "WMT"],
    "META":  ["GOOGL", "SNAP", "PINS"],
    "ORCL":  ["MSFT", "SAP", "IBM", "CRM"],
    "PLTR":  ["SNOW", "IBM", "MSFT"],

    # ── 반도체 ────────────────────────────────────────────────────────
    "NVDA":  ["AMD", "AVGO", "INTC", "TSM"],
    "AMD":   ["NVDA", "INTC", "AVGO", "TSM"],
    "TSM":   ["NVDA", "AVGO", "INTC", "AMD"],
    "AVGO":  ["NVDA", "AMD", "QCOM", "TSM"],

    # ── 자동차 / 모빌리티 ─────────────────────────────────────────────
    "TSLA":  ["BYD", "GM", "F", "RIVN"],

    # ── 바이오 / 제약 / 헬스케어 ──────────────────────────────────────
    "LLY":   ["NVO", "JNJ", "MRK", "PFE"],
    "NVO":   ["LLY", "JNJ", "MRK", "SNY"],
    "JNJ":   ["LLY", "PFE", "MRK", "ABBV"],
    "UNH":   ["JNJ", "ELV", "CI", "HUM"],

    # ── 에너지 / 원자재 ───────────────────────────────────────────────
    "XOM":   ["CVX", "SHEL", "BP", "COP"],
    "FCX":   ["BHP", "RIO", "NEM", "SCCO"],
    "NEM":   ["GOLD", "FCX", "AEM", "WPM"],

    # ── 금융 ──────────────────────────────────────────────────────────
    "JPM":   ["BAC", "WFC", "C", "GS"],
    "V":     ["MA", "AXP", "PYPL"],
    "BRK-B": ["JPM", "BAC", "V", "AAPL"],

    # ── 소비재 ────────────────────────────────────────────────────────
    "WMT":   ["COST", "AMZN", "TGT", "KR"],
    "COST":  ["WMT", "TGT", "BJ", "KR"],
    "KO":    ["PEP", "MNST", "KDP"],

    # ── 산업재 / 방산 ─────────────────────────────────────────────────
    "CAT":   ["DE", "CNH", "KMTUY", "VOLVF"],
    "BA":    ["EADSY", "LMT", "RTX", "NOC"],
    "LMT":   ["RTX", "NOC", "GD", "BA"],

    # ── 부동산 (REITs) ────────────────────────────────────────────────
    "AMT":   ["CCI", "SBAC", "EQIX", "DLR"],
    "PLD":   ["EXR", "PSA", "EGP", "FR"],
    "EQIX":  ["DLR", "AMT", "IRM"],

    # ── 조선 (한국) ───────────────────────────────────────────────────
    "329180.KS": ["042660.KS", "010140.KS", "010620.KS"],
    "042660.KS": ["329180.KS", "010140.KS", "010620.KS"],
}


def get_competitors(ticker: str) -> list[str]:
    return COMPETITORS.get(ticker, [])


def get_watchlist_competitors(ticker: str, watchlist: set[str]) -> list[str]:
    """경쟁사 중 현재 watchlist 에도 포함된 것만 반환 (대시보드 비교 뷰용)."""
    return [c for c in COMPETITORS.get(ticker, []) if c in watchlist]
