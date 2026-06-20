#!/usr/bin/env python3
"""
data/news/{TICKER}/*.json (날짜별 원본 기사) 를 종목별 단일 파일
data/companies/news/{TICKER}.json 로 집계한다 — 웹(기업 구조도)이
한 번의 fetch 로 기업 뉴스 타임라인을 그릴 수 있도록.

시장 뉴스(data/markets/news/<id>.json) 와 같은 '집계 파일' 패턴.
중복(같은 title)은 가장 최근 게시분만 남기고, 게시일 내림차순 정렬.

독립 실행:  python scripts/build_company_news.py
주간 루틴(fetch_fred.py)이 merge_qualitative 직후 호출해도 된다.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NEWS_DIR = REPO_ROOT / "data" / "news"
OUT_DIR = REPO_ROOT / "data" / "companies" / "news"

# 기업 뉴스 타임라인 최대 보관 건수 (오래된 건 잘라 파일 비대화 방지)
MAX_ITEMS = 40


def _norm_date(item: dict) -> str:
    """게시 타임스탬프 → 'YYYY-MM-DD'. 없으면 빈 문자열."""
    raw = item.get("published") or item.get("date") or ""
    return str(raw)[:10]


def _aggregate_ticker(folder: Path) -> dict | None:
    files = sorted(folder.glob("*.json"))
    if not files:
        return None
    # title 기준 dedupe — 더 최근 파일이 뒤에 오므로 나중 값이 이긴다
    by_title: dict[str, dict] = {}
    for fp in files:
        try:
            doc = json.loads(fp.read_text())
        except Exception:  # noqa: BLE001
            continue
        for n in doc.get("news", []):
            title = (n.get("title") or "").strip()
            if not title:
                continue
            by_title[title] = {
                "date": _norm_date(n),
                "title": title,
                "source": n.get("source") or "",
                "url": n.get("url") or "",
                "summary": n.get("summary") or "",
                "impact": n.get("impact") or "",
                "category": n.get("category") or "other",
            }
    if not by_title:
        return None
    items = sorted(by_title.values(), key=lambda x: x["date"], reverse=True)[:MAX_ITEMS]
    return {
        "ticker": folder.name,
        "updated": items[0]["date"] if items else "",
        "count": len(items),
        "news": items,
    }


def main() -> None:
    if not NEWS_DIR.is_dir():
        print(f"no news dir: {NEWS_DIR}")
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for folder in sorted(NEWS_DIR.iterdir()):
        if not folder.is_dir():
            continue
        agg = _aggregate_ticker(folder)
        if not agg:
            continue
        out = OUT_DIR / f"{folder.name}.json"
        out.write_text(json.dumps(agg, ensure_ascii=False, indent=1) + "\n")
        written += 1
    print(f"company news aggregated: {written} tickers → {OUT_DIR}")


if __name__ == "__main__":
    main()
