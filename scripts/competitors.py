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
    "AAPL":  ["MSFT", "GOOGL", "AMZN"],
    "MSFT":  ["AAPL", "GOOGL", "AMZN", "ORCL"],
    "GOOGL": ["MSFT", "META", "AMZN"],
    "AMZN":  ["MSFT", "GOOGL", "AAPL"],
    "NVDA":  ["AMD", "INTC", "QCOM", "AVGO"],
    "META":  ["GOOGL", "SNAP", "PINS"],
    "ORCL":  ["MSFT", "SAP", "IBM", "CRM"],
    "PLTR":  ["SNOW", "IBM", "MSFT"],
    "TSLA":  ["BYD", "GM", "F", "RIVN"],
}


def get_competitors(ticker: str) -> list[str]:
    return COMPETITORS.get(ticker, [])


def get_watchlist_competitors(ticker: str, watchlist: set[str]) -> list[str]:
    """경쟁사 중 현재 watchlist 에도 포함된 것만 반환 (대시보드 비교 뷰용)."""
    return [c for c in COMPETITORS.get(ticker, []) if c in watchlist]
