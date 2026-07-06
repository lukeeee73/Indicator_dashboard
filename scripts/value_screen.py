"""
가치투자 스크리닝 — "훌륭한 기업을 훌륭한 가격에" (버핏식 월간 스크린).

워치리스트 전 종목(data/stocks/*.json)의 재무 스냅샷·분기 실적·밸류에이션을
읽어, 깐깐하지만 단순한 4가지 기준을 모두 통과한 기업만 골라낸다.
결과는 data/value_screen.json 하나로 저장되고 웹(주식 탭 → 가치 발굴)이 읽는다.

기준 (4가지 모두 충족해야 통과 — 데이터가 없으면 그 항목은 탈락 처리):
  1. quality-roe     ROE ≥ 15%            — 주주 자본을 굴리는 효율. 버핏의 사업 질 1순위 척도.
  2. quality-margin  영업이익률 ≥ 15%     — 본업 수익성 = 해자(moat)의 강도.
  3. quality-profit  4개 분기 연속 흑자   — 꾸준히 돈을 버는가 (일회성 흑자 배제).
  4. price-discount  밸류 갭 ≤ -20%       — 적정가치 대비 20% 이상 할인 (valuation.py 의 deep_value 존).

깐깐한 '질' 기준으로 좋은 기업을 먼저 거르고, 마지막 '가격' 기준이
그 좋은 기업이 정말 쌀 때까지 기다리게 만든다 — 통과 기업이 0개인 달이
정상이며, 그것이 "기다림" 그 자체다.

실행:  python scripts/value_screen.py
GitHub Actions(value-screen.yml)가 매월 1일 자동 실행해 커밋한다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOCKS_DIR = ROOT / "data" / "stocks"
OUT_PATH = ROOT / "data" / "value_screen.json"

ROE_MIN = 0.15          # ROE ≥ 15%
OP_MARGIN_MIN = 0.15    # 영업이익률 ≥ 15%
PROFIT_QUARTERS = 4     # 최근 4개 분기 연속 순이익 흑자
GAP_MAX = -0.20         # valuation_gap ≤ -20% (deep_value 기준선과 동일)

# 웹 UI 가 그대로 표시하는 기준 정의 (SSOT — app.js 는 이 배열을 렌더만 한다)
CRITERIA = [
    {
        "key": "roe",
        "label": f"ROE ≥ {ROE_MIN:.0%}",
        "desc": "주주 자본을 얼마나 효율적으로 굴리는가 — 버핏이 사업의 질을 재는 1순위 척도.",
    },
    {
        "key": "margin",
        "label": f"영업이익률 ≥ {OP_MARGIN_MIN:.0%}",
        "desc": "본업의 수익성 = 해자(moat)의 강도. 경쟁이 심하면 이 숫자가 버티지 못한다.",
    },
    {
        "key": "profit",
        "label": f"{PROFIT_QUARTERS}개 분기 연속 흑자",
        "desc": "일회성이 아니라 꾸준히 돈을 버는 기업인가. 최근 분기 실적으로 확인.",
    },
    {
        "key": "discount",
        "label": f"적정가치 대비 {abs(GAP_MAX):.0%}+ 할인",
        "desc": "좋은 기업이라도 비싸면 사지 않는다 — 밸류에이션 갭이 −20% 이하(deep value 존)일 때만.",
    },
]


def _check_roe(snapshot: dict) -> dict:
    v = snapshot.get("return_on_equity")
    return {"ok": v is not None and v >= ROE_MIN, "value": round(v, 4) if v is not None else None}


def _check_margin(snapshot: dict) -> dict:
    v = snapshot.get("operating_margin")
    return {"ok": v is not None and v >= OP_MARGIN_MIN, "value": round(v, 4) if v is not None else None}


def _check_profit(quarterly: list) -> dict:
    """최근 PROFIT_QUARTERS 개 분기의 순이익이 모두 흑자인지. 분기 데이터가 모자라면 탈락."""
    rows = [q for q in quarterly if q.get("net_income") is not None]
    rows.sort(key=lambda q: q.get("date") or "")
    recent = rows[-PROFIT_QUARTERS:]
    if len(recent) < PROFIT_QUARTERS:
        return {"ok": False, "value": None}
    streak = sum(1 for q in recent if q["net_income"] > 0)
    return {"ok": streak == PROFIT_QUARTERS, "value": streak}


def _check_discount(valuation: dict | None) -> dict:
    gap = (valuation or {}).get("valuation_gap")
    return {"ok": gap is not None and gap <= GAP_MAX, "value": round(gap, 4) if gap is not None else None}


def screen_stock(payload: dict) -> dict:
    fin = payload.get("financials") or {}
    snapshot = fin.get("snapshot") or {}
    quarterly = fin.get("quarterly") or []
    checks = {
        "roe": _check_roe(snapshot),
        "margin": _check_margin(snapshot),
        "profit": _check_profit(quarterly),
        "discount": _check_discount(payload.get("valuation")),
    }
    n_ok = sum(1 for c in checks.values() if c["ok"])
    return {
        "name": payload.get("name") or "",
        "group": payload.get("group") or "기타",
        "checks": checks,
        "passed_count": n_ok,
        "pass": n_ok == len(checks),
    }


def main() -> None:
    now = datetime.now(timezone.utc)
    results: dict[str, dict] = {}
    for path in sorted(STOCKS_DIR.glob("*.json")):
        ticker = path.stem
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"  ! {ticker}: 읽기 실패 — {e}")
            continue
        results[ticker] = screen_stock(payload)

    passed = sorted(t for t, r in results.items() if r["pass"])
    near_miss = sorted(t for t, r in results.items() if r["passed_count"] == len(CRITERIA) - 1)

    out = {
        "as_of": now.strftime("%Y-%m-%d"),
        "month": now.strftime("%Y-%m"),
        "generated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "criteria": CRITERIA,
        "passed": passed,
        "near_miss": near_miss,
        "results": results,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"screened {len(results)} stocks → pass {len(passed)}, near-miss {len(near_miss)}")
    if passed:
        for t in passed:
            print(f"  ✓ {t} — {results[t]['name']}")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
