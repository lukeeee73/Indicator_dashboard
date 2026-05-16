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
    # ── 빅테크 / 소프트웨어 ─────────────────────────────────────
    "AAPL":   ["MSFT", "GOOGL", "AMZN"],
    "MSFT":   ["AAPL", "GOOGL", "AMZN", "ORCL", "CRM"],
    "GOOGL":  ["MSFT", "META", "AMZN"],
    "AMZN":   ["MSFT", "GOOGL", "AAPL", "WMT"],
    "META":   ["GOOGL", "SNAP", "PINS"],
    "ORCL":   ["MSFT", "CRM", "SAP", "IBM"],
    "CRM":    ["MSFT", "ORCL", "SAP", "ADBE"],
    "ADBE":   ["MSFT", "CRM"],
    "IBM":    ["MSFT", "ORCL", "ACN"],
    "PLTR":   ["MSFT", "ORCL", "SNOW", "IBM"],
    # ── 반도체 ─────────────────────────────────────
    "NVDA":  ["AMD", "AVGO", "TSM", "INTC"],
    "AMD":   ["NVDA", "INTC", "AVGO", "TSM"],
    "INTC":  ["AMD", "TSM", "QCOM"],
    "QCOM":  ["INTC", "AVGO", "TSM", "MU"],
    "TSM":   ["NVDA", "INTC", "AVGO", "AMD"],
    "ASML":  ["AMAT", "LRCX", "KLAC"],
    "AMAT":  ["LRCX", "ASML", "KLAC"],
    "LRCX":  ["AMAT", "ASML", "KLAC"],
    "AVGO":  ["NVDA", "AMD", "QCOM", "TSM"],
    "MU":    ["INTC", "AVGO", "QCOM"],
    # ── 자동차 / 모빌리티 ─────────────────────────────────────
    "TSLA":       ["BYDDY", "GM", "F", "RIVN", "NIO"],
    "TM":         ["GM", "F", "HMC", "STLA"],
    "F":          ["GM", "TSLA", "STLA", "TM"],
    "GM":         ["F", "TSLA", "STLA", "TM"],
    "STLA":       ["F", "GM", "TM", "HMC"],
    "HMC":        ["TM", "F", "GM"],
    "RIVN":       ["TSLA", "F", "GM", "NIO"],
    "NIO":        ["TSLA", "RIVN", "LI", "XPEV"],
    "005380.KS":  ["000270.KS", "TM", "HMC", "TSLA"],
    "000270.KS":  ["005380.KS", "TM", "HMC", "TSLA"],
    # ── 바이오 / 제약 / 헬스케어 ─────────────────────────────────────
    "LLY":   ["NVO", "JNJ", "MRK", "PFE"],
    "NVO":   ["LLY", "JNJ", "MRK", "SNY"],
    "JNJ":   ["LLY", "PFE", "MRK", "ABBV"],
    "PFE":   ["JNJ", "MRK", "ABBV", "AZN"],
    "MRK":   ["JNJ", "PFE", "BMY", "AZN"],
    "ABBV":  ["JNJ", "MRK", "BMY", "PFE"],
    "AZN":   ["PFE", "MRK", "GSK", "ABBV"],
    "UNH":   ["JNJ", "ELV", "CI", "HUM"],
    "TMO":   ["DHR", "ABT", "ILMN"],
    "ABT":   ["JNJ", "TMO", "MDT", "BSX"],
    # ── 에너지 / 원자재 ─────────────────────────────────────
    "XOM":   ["CVX", "SHEL", "BP", "COP"],
    "CVX":   ["XOM", "SHEL", "COP", "OXY"],
    "COP":   ["XOM", "CVX", "OXY", "EOG"],
    "SHEL":  ["XOM", "CVX", "BP", "TTE"],
    "OXY":   ["COP", "EOG", "XOM", "CVX"],
    "SLB":   ["HAL", "BKR"],
    "FCX":   ["BHP", "RIO", "NEM", "SCCO"],
    "NEM":   ["GOLD", "FCX", "AEM", "WPM"],
    "LIN":   ["APD", "AIR.PA"],
    "APD":   ["LIN"],
    # ── 금융 ─────────────────────────────────────
    "JPM":    ["BAC", "WFC", "C", "GS"],
    "BAC":    ["JPM", "WFC", "C"],
    "WFC":    ["JPM", "BAC", "C", "USB"],
    "C":      ["JPM", "BAC", "WFC", "GS"],
    "GS":     ["MS", "JPM", "C"],
    "MS":     ["GS", "JPM", "BLK"],
    "V":      ["MA", "AXP", "PYPL"],
    "MA":     ["V", "AXP", "PYPL"],
    "AXP":    ["V", "MA", "DFS", "COF"],
    "BRK-B":  ["JPM", "BAC", "V", "AAPL"],
    # ── 소비재 ─────────────────────────────────────
    "WMT":   ["COST", "AMZN", "TGT", "KR"],
    "COST":  ["WMT", "TGT", "BJ", "KR"],
    "KO":    ["PEP", "MNST", "KDP"],
    "PEP":   ["KO", "MDLZ", "KDP"],
    "PG":    ["CL", "KMB", "UL", "CHD"],
    "MO":    ["PM", "BTI"],
    "MCD":   ["SBUX", "YUM", "CMG", "QSR"],
    "HD":    ["LOW"],
    "NKE":   ["LULU", "ADDYY", "UAA"],
    "SBUX":  ["MCD", "DPZ", "YUM"],
    # ── 산업재 / 방산 ─────────────────────────────────────
    "CAT":  ["DE", "CNH", "KMTUY"],
    "DE":   ["CAT", "CNH", "AGCO"],
    "BA":   ["EADSY", "LMT", "RTX", "NOC"],
    "LMT":  ["RTX", "NOC", "GD", "BA"],
    "RTX":  ["LMT", "NOC", "GD", "BA"],
    "NOC":  ["LMT", "RTX", "GD", "BA"],
    "HON":  ["GE", "RTX", "MMM"],
    "GE":   ["RTX", "HON", "BA"],
    "UPS":  ["FDX", "AMZN"],
    "FDX":  ["UPS", "AMZN"],
    # ── 부동산 (REITs) ─────────────────────────────────────
    "AMT":   ["CCI", "SBAC", "EQIX", "DLR"],
    "CCI":   ["AMT", "SBAC", "DLR"],
    "PLD":   ["EXR", "PSA", "EGP", "FR"],
    "EQIX":  ["DLR", "AMT", "IRM"],
    "DLR":   ["EQIX", "AMT", "IRM"],
    "O":     ["NNN", "STAG", "WPC"],
    "SPG":   ["MAC", "BPYU", "TCO"],
    "WELL":  ["VTR", "PEAK", "OHI"],
    "PSA":   ["EXR", "CUBE", "LSI"],
    "VICI":  ["GLPI", "MGM", "CZR"],
    # ── 통신 / 미디어 ─────────────────────────────────────
    "VZ":     ["T", "TMUS"],
    "T":      ["VZ", "TMUS"],
    "TMUS":   ["VZ", "T"],
    "CMCSA":  ["CHTR", "DIS", "NFLX"],
    "CHTR":   ["CMCSA", "VZ", "T"],
    "NFLX":   ["DIS", "AMZN", "SPOT", "PARA", "WBD"],
    "DIS":    ["NFLX", "CMCSA", "WBD", "PARA"],
    "SPOT":   ["NFLX", "AAPL"],
    "EA":     ["TTWO", "ATVI", "MSFT"],
    "TTWO":   ["EA", "ATVI", "MSFT"],
    # ── 유틸리티 / 전력 ─────────────────────────────────────
    "NEE":  ["DUK", "SO", "AEP"],
    "SO":   ["DUK", "AEP", "NEE"],
    "DUK":  ["NEE", "SO", "AEP"],
    "AEP":  ["DUK", "SO", "NEE", "EXC"],
    "EXC":  ["AEP", "ED", "SO"],
    "CEG":  ["VST", "NEE", "DUK"],
    "VST":  ["CEG", "NRG", "NEE"],
    "SRE":  ["AEP", "DUK", "NEE"],
    "ED":   ["EXC", "AEP", "DUK"],
    "D":    ["DUK", "NEE", "SO", "AEP"],
    # ── 조선 (한국) ─────────────────────────────────────
    "329180.KS":  ["042660.KS", "010140.KS", "010620.KS"],
    "042660.KS":  ["329180.KS", "010140.KS", "010620.KS"],
    "010140.KS":  ["329180.KS", "042660.KS", "010620.KS"],
    "010620.KS":  ["329180.KS", "042660.KS", "010140.KS"],
}


def get_competitors(ticker: str) -> list[str]:
    return COMPETITORS.get(ticker, [])


def get_watchlist_competitors(ticker: str, watchlist: set[str]) -> list[str]:
    """경쟁사 중 현재 watchlist 에도 포함된 것만 반환 (대시보드 비교 뷰용)."""
    return [c for c in COMPETITORS.get(ticker, []) if c in watchlist]
