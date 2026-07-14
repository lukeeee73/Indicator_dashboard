#!/usr/bin/env python3
"""
data/news/{TICKER}/*.json 의 정성 분석 결과를 읽어 stocks JSON 의
valuation.qualitative 블록에 병합한다.

원칙:
    - 가장 최근 날짜 파일 한 건만 stocks JSON 에 반영 (요약/이벤트/리스크)
    - 과거 30일치 narrative_score 만 압축 보관 (history 배열)
    - 뉴스 폴더가 없거나 파일이 없으면 quietly skip (qualitative 블록 미생성)
    - 한 종목 실패해도 나머지 처리는 계속

이 모듈은 fetch_fred.py 가 valuation enrichment 직후에 호출한다.
독립 실행으로도 사용 가능: python scripts/merge_qualitative.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

REPO_ROOT  = Path(__file__).resolve().parent.parent
NEWS_DIR   = REPO_ROOT / "data" / "news"
STOCKS_DIR = REPO_ROOT / "data" / "stocks"

HISTORY_MAX_POINTS = 30  # narrative_score 누적 최대 포인트


def _safe_load(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return None


def _list_news_files(ticker: str) -> list[Path]:
    """data/news/{TICKER}/YYYY-MM-DD.json 패턴의 파일들을 날짜순(오름차순) 반환."""
    folder = NEWS_DIR / ticker
    if not folder.is_dir():
        return []
    files = sorted(folder.glob("[0-9]" * 4 + "-" + "[0-9]" * 2 + "-" + "[0-9]" * 2 + ".json"))
    return files


def _build_history(news_files: list[Path]) -> list[dict]:
    """뉴스 파일들에서 narrative_score 시계열을 만든다 (최근 30개)."""
    points: list[dict] = []
    for f in news_files:
        doc = _safe_load(f)
        if not doc:
            continue
        score = doc.get("narrative_score")
        date  = doc.get("date") or f.stem
        if score is None:
            continue
        try:
            score = float(score)
        except (TypeError, ValueError):
            continue
        if score < -1.0 or score > 1.0:
            continue
        points.append({"date": date, "narrative_score": round(score, 3)})
    return points[-HISTORY_MAX_POINTS:]


def compute_qualitative_block(ticker: str) -> Optional[dict]:
    """단일 종목의 qualitative 블록을 산출. 데이터 없으면 None."""
    files = _list_news_files(ticker)
    if not files:
        return None

    # 가장 최근 파일을 메인 입력으로
    latest_doc = _safe_load(files[-1])
    if not latest_doc:
        return None

    score = latest_doc.get("narrative_score")
    try:
        score = float(score) if score is not None else None
    except (TypeError, ValueError):
        score = None
    if score is not None and (score < -1.0 or score > 1.0):
        score = None

    block = {
        "as_of":           latest_doc.get("date") or files[-1].stem,
        "narrative_score": round(score, 3) if score is not None else None,
        "summary_kr":      latest_doc.get("summary_kr"),
        "key_events":      latest_doc.get("key_events") or [],
        "risks":           latest_doc.get("risks") or [],
        "news_count":      len(latest_doc.get("news") or []),
        "competitor_context": latest_doc.get("competitor_context") or [],
        "history":         _build_history(files),
    }
    return block


def merge_into_stocks(stocks: dict[str, dict]) -> dict[str, dict]:
    """stocks 딕셔너리(또는 디스크 JSON) 의 valuation.qualitative 를 갱신.

    valuation 블록이 아직 없으면 생성하지 않는다 (정량이 먼저 와야 함).
    """
    for ticker, payload in stocks.items():
        try:
            block = compute_qualitative_block(ticker)
            if block is None:
                continue
            val = payload.get("valuation")
            if val is None:
                # 정량 valuation 이 아직 없는 종목은 건드리지 않음
                continue
            val["qualitative"] = block
        except Exception as exc:  # noqa: BLE001
            print(f"  qualitative merge FAILED for {ticker}: {exc}")
    return stocks


def _purge_old_news_files(days: int = 90) -> int:
    """워킹 디렉토리의 오래된 일별 뉴스 파일을 정리. git 히스토리에는 남는다."""
    if not NEWS_DIR.is_dir():
        return 0
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    purged = 0
    for ticker_dir in NEWS_DIR.iterdir():
        if not ticker_dir.is_dir():
            continue
        for f in ticker_dir.glob("*.json"):
            if f.stem < cutoff:
                f.unlink()
                purged += 1
    return purged


# --------------------------------------------------------------------------
# 독립 실행 (개발/디버그용)
# --------------------------------------------------------------------------
def _standalone_main() -> int:
    if not STOCKS_DIR.is_dir():
        print(f"ERROR: {STOCKS_DIR} not found.")
        return 1
    stocks = {f.stem: json.loads(f.read_text()) for f in sorted(STOCKS_DIR.glob("*.json"))}
    merge_into_stocks(stocks)
    for ticker, payload in stocks.items():
        out = STOCKS_DIR / f"{ticker}.json"
        # fetch_fred.py 와 동일하게 파일 끝 개행 (POSIX 관례) — 없으면 매 실행마다
        # 내용이 안 바뀐 종목 파일까지 개행 차이로 diff 가 생긴다.
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    purged = _purge_old_news_files()
    print(f"Merged qualitative into {len(stocks)} stocks. Purged {purged} old news files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_standalone_main())
