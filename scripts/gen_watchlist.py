#!/usr/bin/env python3
"""
Regenerate the watchlist-related blocks in dependent files from
scripts/watchlist_data.py (single source of truth).

Updates:
  - scripts/fetch_fred.py     : STOCKS dict
  - scripts/competitors.py    : COMPETITORS dict
  - app.js                    : STOCK_META, STOCK_GROUPS, PEER_COMPETITORS

Usage:
  python scripts/gen_watchlist.py
"""

from __future__ import annotations

import re
from pathlib import Path

import watchlist_data as W

ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------
# Block generators
# --------------------------------------------------------------------------
def py_repr_str(s: str) -> str:
    """Python string literal with double quotes, escaping inner quotes."""
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def js_repr_str(s: str) -> str:
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def gen_python_stocks() -> str:
    """fetch_fred.py STOCKS dict literal."""
    by_group: dict[str, list] = {}
    for entry in W.STOCKS:
        by_group.setdefault(entry[3], []).append(entry)

    # Compute column widths for nice alignment within each group
    lines = ["STOCKS: dict[str, dict] = {"]
    for group, _desc in W.GROUPS:
        items = by_group.get(group, [])
        if not items:
            continue
        lines.append(f"    # ── {group} ─────────────────────────────────────")
        max_t = max(len(py_repr_str(e[0]) + ":") for e in items)
        max_n = max(len(py_repr_str(e[1]) + ",") for e in items)
        max_s = max(len(py_repr_str(e[2]) + ",") for e in items)
        for ticker, name, sector_en, group_kr, _sub, _color, _dec, _cur, _biz in items:
            t = py_repr_str(ticker) + ":"
            n = py_repr_str(name) + ","
            s = py_repr_str(sector_en) + ","
            g = py_repr_str(group_kr)
            lines.append(
                f"    {t:<{max_t}}  {{\"name\": {n:<{max_n}} \"sector\": {s:<{max_s}} \"group\": {g}}},"
            )
    lines.append("}")
    return "\n".join(lines)


def gen_python_competitors() -> str:
    by_group: dict[str, list] = {}
    for entry in W.STOCKS:
        by_group.setdefault(entry[3], []).append(entry[0])

    lines = ["COMPETITORS: dict[str, list[str]] = {"]
    for group, _desc in W.GROUPS:
        tickers = by_group.get(group, [])
        if not tickers:
            continue
        lines.append(f"    # ── {group} ─────────────────────────────────────")
        max_t = max(len(py_repr_str(t) + ":") for t in tickers)
        for t in tickers:
            peers = W.COMPETITORS.get(t, [])
            peers_str = "[" + ", ".join(py_repr_str(p) for p in peers) + "]"
            tk = py_repr_str(t) + ":"
            lines.append(f"    {tk:<{max_t}}  {peers_str},")
    lines.append("}")
    return "\n".join(lines)


def gen_js_stock_meta() -> str:
    by_group: dict[str, list] = {}
    for entry in W.STOCKS:
        by_group.setdefault(entry[3], []).append(entry)

    lines = ["const STOCK_META = {"]
    for group, _desc in W.GROUPS:
        items = by_group.get(group, [])
        if not items:
            continue
        lines.append(f"  // ── {group} ─────────────────────────────────────")
        for ticker, name, _sec_en, group_kr, sub_kr, color, decimals, currency, business in items:
            ticker_lit = js_repr_str(ticker)
            # Use bare key for simple A-Z tickers, quoted key for the rest
            key = ticker if re.fullmatch(r"[A-Z][A-Z0-9]*", ticker) else ticker_lit
            # Build the object literal — short displayName from a simple rule:
            display_name = _make_display_name(ticker, name)
            obj_parts = [
                f"displayName: {js_repr_str(display_name)}",
                f"fullName: {js_repr_str(name)}",
                f"group: {js_repr_str(group_kr)}",
                f"sector: {js_repr_str(sub_kr)}",
                f"color: {js_repr_str(color)}",
                f"decimals: {decimals}",
                f"currency: {js_repr_str(currency)}",
                f"business: {js_repr_str(business)}",
            ]
            lines.append(f"  {key}: {{ {', '.join(obj_parts)} }},")
    lines.append("};")
    return "\n".join(lines)


_DISPLAY_NAME_OVERRIDES = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "GOOGL": "Alphabet (Google)",
    "AMZN": "Amazon",
    "META": "Meta",
    "ORCL": "Oracle",
    "CRM": "Salesforce",
    "ADBE": "Adobe",
    "IBM": "IBM",
    "PLTR": "Palantir",
    "NVDA": "NVIDIA",
    "AMD": "AMD",
    "INTC": "Intel",
    "QCOM": "Qualcomm",
    "TSM": "TSMC",
    "ASML": "ASML",
    "AMAT": "Applied Materials",
    "LRCX": "Lam Research",
    "AVGO": "Broadcom",
    "MU": "Micron",
    "TSLA": "Tesla",
    "TM": "Toyota",
    "F": "Ford",
    "GM": "GM",
    "STLA": "Stellantis",
    "HMC": "Honda",
    "RIVN": "Rivian",
    "NIO": "NIO",
    "005380.KS": "현대차",
    "000270.KS": "기아",
    "LLY": "Eli Lilly",
    "NVO": "Novo Nordisk",
    "JNJ": "J&J",
    "PFE": "Pfizer",
    "MRK": "Merck",
    "ABBV": "AbbVie",
    "AZN": "AstraZeneca",
    "UNH": "UnitedHealth",
    "TMO": "Thermo Fisher",
    "ABT": "Abbott",
    "XOM": "ExxonMobil",
    "CVX": "Chevron",
    "COP": "ConocoPhillips",
    "SHEL": "Shell",
    "OXY": "Occidental",
    "SLB": "Schlumberger",
    "FCX": "Freeport-McMoRan",
    "NEM": "Newmont",
    "LIN": "Linde",
    "APD": "Air Products",
    "JPM": "JPMorgan",
    "BAC": "Bank of America",
    "WFC": "Wells Fargo",
    "C": "Citigroup",
    "GS": "Goldman Sachs",
    "MS": "Morgan Stanley",
    "V": "Visa",
    "MA": "Mastercard",
    "AXP": "Amex",
    "BRK-B": "Berkshire (B)",
    "WMT": "Walmart",
    "COST": "Costco",
    "KO": "Coca-Cola",
    "PEP": "PepsiCo",
    "PG": "P&G",
    "MO": "Altria",
    "MCD": "McDonald's",
    "HD": "Home Depot",
    "NKE": "Nike",
    "SBUX": "Starbucks",
    "CAT": "Caterpillar",
    "DE": "John Deere",
    "BA": "Boeing",
    "LMT": "Lockheed Martin",
    "RTX": "RTX",
    "NOC": "Northrop Grumman",
    "HON": "Honeywell",
    "GE": "GE Aerospace",
    "UPS": "UPS",
    "FDX": "FedEx",
    "AMT": "American Tower",
    "CCI": "Crown Castle",
    "PLD": "Prologis",
    "EQIX": "Equinix",
    "DLR": "Digital Realty",
    "O": "Realty Income",
    "SPG": "Simon Property",
    "WELL": "Welltower",
    "PSA": "Public Storage",
    "VICI": "VICI Properties",
    "VZ": "Verizon",
    "T": "AT&T",
    "TMUS": "T-Mobile",
    "CMCSA": "Comcast",
    "CHTR": "Charter",
    "NFLX": "Netflix",
    "DIS": "Disney",
    "SPOT": "Spotify",
    "EA": "Electronic Arts",
    "TTWO": "Take-Two",
    "NEE": "NextEra Energy",
    "SO": "Southern Co.",
    "DUK": "Duke Energy",
    "AEP": "American Electric",
    "EXC": "Exelon",
    "CEG": "Constellation",
    "VST": "Vistra",
    "SRE": "Sempra",
    "ED": "Con Edison",
    "D": "Dominion",
    "GEV": "GE Vernova",
    "ETN": "Eaton",
    "VRT": "Vertiv",
    "PWR": "Quanta Services",
    "BE": "Bloom Energy",
    "OKLO": "Oklo",
    "034020.KS": "두산에너빌리티",
    "267260.KS": "HD현대일렉트릭",
    "298040.KS": "효성중공업",
    "010120.KS": "LS일렉트릭",
    "329180.KS": "HD현대중공업",
    "042660.KS": "한화오션",
    "010140.KS": "삼성중공업",
    "010620.KS": "HD현대미포",
}


def _make_display_name(ticker: str, full_name: str) -> str:
    return _DISPLAY_NAME_OVERRIDES.get(ticker, ticker)


def gen_js_stock_groups() -> str:
    lines = ["const STOCK_GROUPS = ["]
    for key, desc in W.GROUPS:
        lines.append(f"  {{ key: {js_repr_str(key)}, desc: {js_repr_str(desc)} }},")
    lines.append("];")
    return "\n".join(lines)


def gen_js_peer_competitors() -> str:
    """Only watchlist-internal peers (JS doesn't need external)."""
    watchlist = {e[0] for e in W.STOCKS}
    by_group: dict[str, list] = {}
    for entry in W.STOCKS:
        by_group.setdefault(entry[3], []).append(entry[0])

    lines = ["const PEER_COMPETITORS = {"]
    for group, _desc in W.GROUPS:
        tickers = by_group.get(group, [])
        if not tickers:
            continue
        lines.append(f"  // ── {group} ─────────────────────────────────────")
        for t in tickers:
            peers = [p for p in W.COMPETITORS.get(t, []) if p in watchlist]
            key = t if re.fullmatch(r"[A-Z][A-Z0-9]*", t) else js_repr_str(t)
            peers_str = "[" + ", ".join(js_repr_str(p) for p in peers) + "]"
            lines.append(f"  {key}: {peers_str},")
    lines.append("};")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# In-place file substitution
# --------------------------------------------------------------------------
def replace_block(text: str, start_marker_regex: str, end_marker: str, new_block: str, file_label: str) -> str:
    """Replace text between the line matching start_marker_regex and end_marker (exact match line).

    The match is for the block contents only; trailing blank lines after the
    end_marker line are preserved (so readability spacing isn't eaten on each run).
    """
    pattern = re.compile(rf"(^{start_marker_regex}[\s\S]*?^{re.escape(end_marker)}\s*$)", re.MULTILINE)
    m = pattern.search(text)
    if not m:
        raise SystemExit(f"[{file_label}] could not find block start /{start_marker_regex}/ ... '{end_marker}'")
    return text[:m.start()] + new_block + text[m.end():]


def main() -> int:
    # Python — fetch_fred.py
    f = ROOT / "scripts" / "fetch_fred.py"
    src = f.read_text()
    src = replace_block(
        src,
        r"STOCKS: dict\[str, dict\] = \{",
        "}",
        gen_python_stocks(),
        "fetch_fred.py STOCKS",
    )
    f.write_text(src)
    print(f"✓ {f.relative_to(ROOT)} : STOCKS regenerated ({len(W.STOCKS)} entries)")

    # Python — competitors.py
    f = ROOT / "scripts" / "competitors.py"
    src = f.read_text()
    src = replace_block(
        src,
        r"COMPETITORS: dict\[str, list\[str\]\] = \{",
        "}",
        gen_python_competitors(),
        "competitors.py COMPETITORS",
    )
    f.write_text(src)
    print(f"✓ {f.relative_to(ROOT)} : COMPETITORS regenerated ({len(W.COMPETITORS)} entries)")

    # JS — app.js: STOCK_META + STOCK_GROUPS + PEER_COMPETITORS
    f = ROOT / "app.js"
    src = f.read_text()
    src = replace_block(src, r"const STOCK_META = \{", "};", gen_js_stock_meta(), "app.js STOCK_META")
    src = replace_block(src, r"const STOCK_GROUPS = \[", "];", gen_js_stock_groups(), "app.js STOCK_GROUPS")
    src = replace_block(src, r"const PEER_COMPETITORS = \{", "};", gen_js_peer_competitors(), "app.js PEER_COMPETITORS")
    f.write_text(src)
    print(f"✓ {f.relative_to(ROOT)} : STOCK_META + STOCK_GROUPS + PEER_COMPETITORS regenerated")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
