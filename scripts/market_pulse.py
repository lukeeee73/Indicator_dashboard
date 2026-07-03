#!/usr/bin/env python3
"""
market_pulse.py — 시장 뉴스 스토어의 방향성 신호(signals)를 집계해
시장별 병목 압력·수요 모멘텀을 산출하고, 병목 severity 승급/완화 '제안'과
병목 이동(migration) 경보를 data/markets/analysis/{industry}.json 에 쓴다.

설계 원칙 (탐지와 판단의 분리):
    - 이 스크립트는 지도(data/markets/{industry}.json)를 직접 고치지 않는다.
      탐지(결정적 집계)까지만 하고, 반영은 market-research 루틴(LLM/사람)이
      제안·근거를 검증한 뒤 수행한다.
    - 판정 기준은 data/markets/criteria/{industry}.json 이 SSOT.
      시장마다 병목의 성격(capacity/monopoly/demand/policy/finance)과
      승급/완화 조건·키워드가 다르다.
    - 뉴스 신호는 시간 감쇠(반감기)와 다중 소스 요건(hysteresis)을 거친다 —
      단발 헤드라인 하나로 지도가 바뀌지 않게.

입력:
    data/markets/{industry}.json          시장 구조 (현재 severity·players·links)
    data/markets/news/{industry}.json     시장 뉴스 스토어 (signals[] 태그)
    data/markets/criteria/{industry}.json 시장별 판정 기준
    data/stocks/{TICKER}.json             (보조) watchlist narrative_score history

출력:
    data/markets/analysis/{industry}.json 시장별 점수·제안·근거·경보

사용:
    python scripts/market_pulse.py                  # criteria 가 있는 전 산업
    python scripts/market_pulse.py --industry ai-semiconductor
    python scripts/market_pulse.py --check          # 검증만 (출력 파일 안 씀)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT    = Path(__file__).resolve().parent.parent
MARKETS_DIR  = REPO_ROOT / "data" / "markets"
NEWS_DIR     = MARKETS_DIR / "news"
CRITERIA_DIR = MARKETS_DIR / "criteria"
ANALYSIS_DIR = MARKETS_DIR / "analysis"
STOCKS_DIR   = REPO_ROOT / "data" / "stocks"

SIGNAL_TYPES = ("supply_tightening", "supply_easing", "demand_up", "demand_down")
# tanh 정규화 스케일 — 신선한 strength-3 신호 1건(w=1.5)이 ≈0.76 이 되게.
PRESSURE_SCALE = 1.5


# ── 유틸 ────────────────────────────────────────────────────────────────────

def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def _parse_date(s: str | None) -> datetime | None:
    """'YYYY-MM-DD' | 'YYYY-MM' → aware datetime(UTC). 월만 있으면 15일로 (편향 최소화)."""
    if not s:
        return None
    try:
        if len(s) == 7:  # YYYY-MM
            d = datetime.strptime(s + "-15", "%Y-%m-%d")
        else:
            d = datetime.strptime(s[:10], "%Y-%m-%d")
        return d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _decay(age_days: float, half_life: float) -> float:
    return 0.5 ** (age_days / half_life)


def _squash(raw: float) -> float:
    return round(math.tanh(raw / PRESSURE_SCALE), 3)


# ── 신호 추출 ────────────────────────────────────────────────────────────────

def _fallback_signals(item: dict, mkt_kw: dict, global_kw: dict) -> list[dict]:
    """signals 미태깅 뉴스의 키워드 폴백 분류 (보수적: strength 1)."""
    text = f"{item.get('title', '')} {item.get('summary', '')}"
    found: list[dict] = []
    pairs = [
        ("supply_tightening", "tightening"),
        ("supply_easing", "easing"),
        ("demand_up", "demand_up"),
        ("demand_down", "demand_down"),
    ]
    for sig_type, kw_key in pairs:
        kws = list(global_kw.get(kw_key, [])) + list((mkt_kw or {}).get(kw_key, []))
        if any(k and k in text for k in kws):
            found.append({"type": sig_type, "strength": 1})
    return found


def _collect_signals(items: list[dict], criteria_m: dict, cfg: dict,
                     now: datetime, global_kw: dict) -> list[dict]:
    """윈도 내 뉴스에서 (type, weight, source, evidence) 신호 이벤트를 뽑는다."""
    out: list[dict] = []
    for item in items:
        d = _parse_date(item.get("date"))
        if not d:
            continue
        age = (now - d).total_seconds() / 86400
        if age < 0 or age > cfg["window_days"]:
            continue
        decay = _decay(age, cfg["half_life_days"])
        signals = item.get("signals")
        if signals is None:
            signals = _fallback_signals(item, (criteria_m or {}).get("keywords"), global_kw)
        for s in signals:
            t = s.get("type")
            if t not in SIGNAL_TYPES:
                continue
            strength = min(3, max(1, int(s.get("strength", 1))))
            out.append({
                "type": t,
                "weight": round((strength / 2.0) * decay, 4),
                "strength": strength,
                "source": item.get("source", ""),
                "date": item.get("date"),
                "title": item.get("title", ""),
            })
    return out


def _narrative_momentum(m: dict, cfg: dict, now: datetime) -> float | None:
    """watchlist 플레이어의 narrative_score history 를 감쇠 평균 (보조 신호)."""
    per_ticker: list[float] = []
    for p in m.get("players", []):
        if not (p.get("ticker") and p.get("in_watchlist")):
            continue
        f = STOCKS_DIR / f"{p['ticker']}.json"
        if not f.is_file():
            continue
        try:
            q = _load(f).get("valuation", {}).get("qualitative", {})
        except Exception:  # noqa: BLE001
            continue
        wsum = vsum = 0.0
        for pt in q.get("history", []):
            d = _parse_date(pt.get("date"))
            s = pt.get("narrative_score")
            if d is None or not isinstance(s, (int, float)):
                continue
            age = (now - d).total_seconds() / 86400
            if age < 0 or age > cfg["window_days"]:
                continue
            w = _decay(age, cfg["half_life_days"])
            wsum += w
            vsum += w * float(s)
        if wsum > 0:
            per_ticker.append(vsum / wsum)
    if not per_ticker:
        return None
    return sum(per_ticker) / len(per_ticker)


# ── 검증 ────────────────────────────────────────────────────────────────────

def validate(map_doc: dict, news_doc: dict, criteria: dict) -> list[str]:
    errors: list[str] = []
    mids = {m["id"] for m in map_doc["markets"]}
    lids = {l["id"] for l in map_doc["layers"]}
    sev  = set(map_doc["severity_legend"])
    for m in map_doc["markets"]:
        if m["layer"] not in lids:
            errors.append(f"map: {m['id']} bad layer {m['layer']}")
        b = m.get("bottleneck")
        if b is not None and b.get("severity") not in sev:
            errors.append(f"map: {m['id']} bad severity")
        if m.get("recent_news"):
            errors.append(f"map: {m['id']} has deprecated recent_news (use news store)")
    for l in map_doc.get("links", []):
        if l["from"] not in mids or l["to"] not in mids:
            errors.append(f"map: bad link {l['from']}→{l['to']}")
    for mid, items in news_doc.get("markets", {}).items():
        if mid not in mids:
            errors.append(f"news: unknown market {mid}")
        if len(items) > 20:
            errors.append(f"news: {mid} has >20 items")
        dates = [i.get("date", "") for i in items]
        if dates != sorted(dates, reverse=True):
            errors.append(f"news: {mid} not newest-first")
        for i in items:
            if not str(i.get("url", "")).startswith("http"):
                errors.append(f"news: {mid} bad url ({i.get('title', '')[:30]})")
            if i.get("impact") not in ("+", "-", "neutral"):
                errors.append(f"news: {mid} bad impact")
            for s in i.get("signals") or []:
                if s.get("type") not in SIGNAL_TYPES:
                    errors.append(f"news: {mid} bad signal type {s.get('type')}")
                if not isinstance(s.get("strength", 1), int) or not 1 <= s.get("strength", 1) <= 3:
                    errors.append(f"news: {mid} bad signal strength")
    for mid in criteria.get("markets", {}):
        if mid not in mids:
            errors.append(f"criteria: unknown market {mid}")
    trans = criteria.get("severity_transitions", {})
    for d in ("escalate", "deescalate"):
        for frm, to in trans.get(d, {}).items():
            if to not in sev and to != "none":
                errors.append(f"criteria: {d} target {to} not in severity_legend")
    return errors


# ── 본 계산 ──────────────────────────────────────────────────────────────────

def analyze_industry(industry: str, now: datetime, check_only: bool) -> dict | None:
    map_path      = MARKETS_DIR / f"{industry}.json"
    news_path     = NEWS_DIR / f"{industry}.json"
    criteria_path = CRITERIA_DIR / f"{industry}.json"
    if not map_path.is_file() or not criteria_path.is_file():
        print(f"  {industry}: map 또는 criteria 없음 — skip")
        return None
    map_doc  = _load(map_path)
    news_doc = _load(news_path) if news_path.is_file() else {"markets": {}}
    criteria = _load(criteria_path)

    errors = validate(map_doc, news_doc, criteria)
    if errors:
        for e in errors:
            print(f"  VALIDATION FAIL: {e}")
        raise SystemExit(1)
    if check_only:
        print(f"  {industry}: validation OK ({len(map_doc['markets'])} markets)")
        return None

    cfg = dict(criteria.get("defaults", {}))
    cfg.setdefault("window_days", 150)
    cfg.setdefault("half_life_days", 60)
    cfg.setdefault("escalate_threshold", 0.45)
    cfg.setdefault("deescalate_threshold", -0.35)
    cfg.setdefault("min_signals", 2)
    cfg.setdefault("min_sources", 2)
    cfg.setdefault("node_arrow_threshold", 0.35)
    cfg.setdefault("migration_easing_threshold", -0.2)
    cfg.setdefault("migration_tightening_threshold", 0.35)
    global_kw = criteria.get("global_keywords", {})
    trans = criteria.get("severity_transitions", {})

    # 소비자(하류 수요) 매핑: links 의 from=수요, to=공급 — X 의 소비자 = from where to==X
    consumers: dict[str, list[str]] = {}
    for l in map_doc.get("links", []):
        consumers.setdefault(l["to"], []).append(l["from"])
    # 무향 인접 (병목 이동 탐지용)
    adjacency: dict[str, set[str]] = {}
    for l in map_doc.get("links", []):
        adjacency.setdefault(l["from"], set()).add(l["to"])
        adjacency.setdefault(l["to"], set()).add(l["from"])

    results: dict[str, dict] = {}
    for m in map_doc["markets"]:
        mid = m["id"]
        crit = criteria.get("markets", {}).get(mid, {})
        events = _collect_signals(news_doc.get("markets", {}).get(mid, []), crit, cfg, now, global_kw)

        def _sum(t: str) -> float:
            return sum(e["weight"] for e in events if e["type"] == t)

        def _cnt(t: str) -> int:
            return sum(1 for e in events if e["type"] == t)

        def _src(t: str) -> int:
            return len({e["source"] for e in events if e["type"] == t and e["source"]})

        pressure_raw = _sum("supply_tightening") - _sum("supply_easing")
        demand_raw   = _sum("demand_up") - _sum("demand_down")
        pressure     = _squash(pressure_raw)
        demand_news  = _squash(demand_raw)
        narr = _narrative_momentum(m, cfg, now)
        demand_momentum = round(0.7 * demand_news + 0.3 * narr, 3) if narr is not None else demand_news

        current = (m.get("bottleneck") or {}).get("severity") or "none"
        proposal = None
        note = None
        if current == "structural" or crit.get("bottleneck_type") == "monopoly":
            # 구조적 독점은 뉴스로 자동 전이하지 않는다 — 강한 완화 신호만 감시 표시
            if pressure <= cfg["deescalate_threshold"]:
                note = "structural_watch: 강한 완화 신호 누적 — 대체 공급원 등장 여부 루틴이 수동 점검"
        elif pressure >= cfg["escalate_threshold"] \
                and _cnt("supply_tightening") >= cfg["min_signals"] \
                and _src("supply_tightening") >= cfg["min_sources"]:
            to = trans.get("escalate", {}).get(current)
            if to and to != current:
                strong = pressure >= cfg["escalate_threshold"] + 0.2
                proposal = {"action": "escalate", "from": current, "to": to,
                            "confidence": "high" if strong else "med"}
        elif pressure <= cfg["deescalate_threshold"] \
                and _cnt("supply_easing") >= cfg["min_signals"] \
                and _src("supply_easing") >= cfg["min_sources"]:
            to = trans.get("deescalate", {}).get(current)
            if to and to != current:
                strong = pressure <= cfg["deescalate_threshold"] - 0.2
                proposal = {"action": "deescalate", "from": current, "to": to,
                            "confidence": "high" if strong else "med"}

        evidence = sorted(events, key=lambda e: e["weight"], reverse=True)[:5]
        results[mid] = {
            "name_kr": m.get("name_kr", mid),
            "current_severity": current,
            "bottleneck_type": crit.get("bottleneck_type"),
            "bottleneck_pressure": pressure,
            "demand_momentum": demand_momentum,
            "narrative_momentum": round(narr, 3) if narr is not None else None,
            "signal_count": len(events),
            "source_count": len({e["source"] for e in events if e["source"]}),
            "status": "ok" if events else "no_signals",
            "proposal": proposal,
            "note": note,
            "evidence": [{"date": e["date"], "title": e["title"], "type": e["type"],
                          "strength": e["strength"], "weight": e["weight"]} for e in evidence],
        }

    # 성장 전망: 자체 수요 모멘텀 + 하류(소비자) 수요 모멘텀의 파급
    for mid, r in results.items():
        cons = [results[c]["demand_momentum"] for c in consumers.get(mid, []) if c in results]
        pull = sum(cons) / len(cons) if cons else 0.0
        r["growth_outlook"] = round(0.6 * r["demand_momentum"] + 0.4 * pull, 3)

    # 수혜 경로: 압력이 높고 수요가 받쳐주는 시장 → 점유율 상위 공급사에 가격결정력
    for m in map_doc["markets"]:
        r = results[m["id"]]
        tight = r["bottleneck_pressure"] >= cfg["node_arrow_threshold"] or \
            (r["current_severity"] in ("acute", "structural") and r["bottleneck_pressure"] >= 0)
        r["pricing_power"] = bool(tight and r["demand_momentum"] >= 0)
        if r["pricing_power"]:
            ps = sorted([p for p in m.get("players", []) if p.get("share")],
                        key=lambda p: p["share"], reverse=True)[:4]
            r["beneficiaries"] = [{"name": p["name"], "ticker": p.get("ticker"),
                                   "share": p["share"],
                                   "in_watchlist": bool(p.get("in_watchlist"))} for p in ps]
            r["cost_pressure_to"] = consumers.get(m["id"], [])
        else:
            r["beneficiaries"] = []
            r["cost_pressure_to"] = []

    # 경보: severity 전이 제안 + 병목 이동(완화 노드의 인접 노드가 조여옴)
    alerts: list[dict] = []
    for mid, r in results.items():
        if r["proposal"]:
            alerts.append({
                "type": "severity_change_proposed", "market": mid, "name_kr": r["name_kr"],
                **r["proposal"],
                "pressure": r["bottleneck_pressure"],
                "evidence": r["evidence"][:3],
            })
    for mid, r in results.items():
        easing = r["bottleneck_pressure"] <= cfg["migration_easing_threshold"] or \
            r["current_severity"] == "easing"
        if not easing:
            continue
        targets = [n for n in adjacency.get(mid, set())
                   if results.get(n, {}).get("bottleneck_pressure", 0) >= cfg["migration_tightening_threshold"]]
        if targets:
            alerts.append({
                "type": "bottleneck_migration", "market": mid, "name_kr": r["name_kr"],
                "to": sorted(targets, key=lambda n: -results[n]["bottleneck_pressure"]),
                "to_names": [results[n]["name_kr"] for n in
                             sorted(targets, key=lambda n: -results[n]["bottleneck_pressure"])],
            })
    alerts.sort(key=lambda a: (a["type"] != "severity_change_proposed",))

    # 주목 시장 랭킹 (병목 압력 + 성장 전망 복합)
    ranked = sorted(results.items(),
                    key=lambda kv: -(0.6 * kv[1]["bottleneck_pressure"] + 0.4 * kv[1]["growth_outlook"]))
    top_focus = [{"market": mid, "name_kr": r["name_kr"],
                  "score": round(0.6 * r["bottleneck_pressure"] + 0.4 * r["growth_outlook"], 3)}
                 for mid, r in ranked[:5] if r["status"] == "ok"]

    out = {
        "industry": industry,
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "params": {k: cfg[k] for k in ("window_days", "half_life_days", "escalate_threshold",
                                       "deescalate_threshold", "min_signals", "min_sources",
                                       "node_arrow_threshold")},
        "disclaimer": "뉴스 신호의 결정적 집계로 산출된 자동 '제안'이다. 지도 반영은 market-research 루틴이 근거를 검증한 뒤 수행한다. 투자 조언이 아니다.",
        "top_focus": top_focus,
        "alerts": alerts,
        "markets": results,
    }
    ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = ANALYSIS_DIR / f"{industry}.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    n_sig = sum(r["signal_count"] for r in results.values())
    print(f"  {industry}: {len(results)} markets · {n_sig} signals · "
          f"{len([a for a in alerts if a['type'] == 'severity_change_proposed'])} 전이 제안 · "
          f"{len([a for a in alerts if a['type'] == 'bottleneck_migration'])} 이동 경보 → {out_path.relative_to(REPO_ROOT)}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="시장 뉴스 신호 집계 → 병목 전이 제안 생성")
    ap.add_argument("--industry", help="특정 산업만 (기본: criteria 가 있는 전 산업)")
    ap.add_argument("--check", action="store_true", help="검증만 수행 (분석 파일 안 씀)")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    industries = [args.industry] if args.industry else \
        sorted(p.stem for p in CRITERIA_DIR.glob("*.json"))
    if not industries:
        print("criteria 파일이 없습니다 — data/markets/criteria/{industry}.json 을 먼저 만드세요.")
        return 1
    print(f"market pulse @ {now:%Y-%m-%d %H:%M UTC}")
    for ind in industries:
        analyze_industry(ind, now, args.check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
