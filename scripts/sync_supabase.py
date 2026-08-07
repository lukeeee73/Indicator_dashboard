#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from supabase import Client, create_client


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"
INDEX_PATH = DATA_ROOT / "index.json"

BATCH_SIZE = 500
LOOKBACK_DAYS = int(os.environ.get("SYNC_LOOKBACK_DAYS", "120"))
FORCE_FULL_SYNC = os.environ.get("FORCE_FULL_SYNC", "").lower() in {
    "1",
    "true",
    "yes",
}

# 뒤에 있는 그룹이 같은 code의 메타데이터를 덮어씁니다. DGS10처럼 자산과
# 경제지표에 동시에 포함된 코드는 assessment 정보가 있는 indicator를 우선합니다.
SERIES_GROUPS = (
    ("assets", "asset", "assets", "FRED"),
    ("indices", "index", "indices", "yahoo"),
    ("stocks", "stock", "stocks", "yahoo"),
    ("indicators", "indicator", "indicators", "FRED"),
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"JSON 파일을 찾을 수 없습니다: {path}")

    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    if not isinstance(payload, dict):
        raise TypeError(f"JSON 최상위 값이 객체가 아닙니다: {path}")

    return payload


def get_required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"필수 환경변수가 없습니다: {name}")
    return value


def connect_supabase() -> Client:
    return create_client(
        get_required_env("SUPABASE_URL"),
        get_required_env("SUPABASE_SECRET_KEY"),
    )


def chunk_rows(
    rows: list[dict[str, Any]],
    size: int = BATCH_SIZE,
) -> Iterator[list[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def optional_details(payload: dict[str, Any]) -> dict[str, Any] | None:
    excluded = {
        "name",
        "unit",
        "series",
        "category",
        "current",
        "sector",
        "group",
        "region",
    }
    details = {
        key: value
        for key, value in payload.items()
        if key not in excluded
    }
    return details or None


def stock_current_data(item: dict[str, Any]) -> dict[str, Any] | None:
    keys = ("valuation_summary", "competitors_in_watchlist")
    current = {key: item[key] for key in keys if key in item}
    return current or None


def build_series_data(
    index_data: dict[str, Any],
    last_updated: str,
) -> tuple[
    list[dict[str, Any]],
    dict[str, list[dict[str, Any]]],
    dict[str, int],
]:
    metadata_by_code: dict[str, dict[str, Any]] = {}
    observations_by_code: dict[str, list[dict[str, Any]]] = {}
    group_counts: dict[str, int] = {}

    for group_key, kind, directory, source in SERIES_GROUPS:
        items = index_data.get(group_key, [])
        if not isinstance(items, list):
            raise TypeError(f"index.json의 {group_key}가 배열이 아닙니다")

        group_counts[group_key] = len(items)

        for item in items:
            code = item["code"]
            filename = item.get("filename", code)
            payload = read_json(DATA_ROOT / directory / f"{filename}.json")

            current_data = payload.get("current")
            if kind == "stock":
                current_data = stock_current_data(item)

            metadata_by_code[code] = {
                "code": code,
                "name": payload.get("name") or item.get("name") or code,
                "kind": kind,
                "category": payload.get("category") or item.get("category"),
                "unit": payload.get("unit") or item.get("unit"),
                "region": payload.get("region") or item.get("region", "US"),
                "source": source,
                "exclude_assessment": item.get("exclude_assessment", False),
                "current_data": current_data,
                "sector": payload.get("sector") or item.get("sector"),
                "group_name": payload.get("group") or item.get("group"),
                "details": optional_details(payload),
                "updated_at": last_updated,
            }

            series = payload.get("series", [])
            if not isinstance(series, list):
                raise TypeError(f"{directory}/{filename}.json의 series가 배열이 아닙니다")
            observations_by_code[code] = series

    return list(metadata_by_code.values()), observations_by_code, group_counts


def sync_series_metadata(
    client: Client,
    rows: list[dict[str, Any]],
) -> None:
    for batch in chunk_rows(rows):
        (
            client
            .table("series")
            .upsert(batch, on_conflict="code")
            .execute()
        )


def latest_observed_at(client: Client, code: str) -> date | None:
    response = (
        client
        .table("observations")
        .select("observed_at")
        .eq("series_code", code)
        .order("observed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None
    return date.fromisoformat(rows[0]["observed_at"])


def observation_rows_since(
    code: str,
    points: list[dict[str, Any]],
    cutoff: date | None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for point in points:
        observed_at = point.get("date")
        value = point.get("value")
        if observed_at is None or value is None:
            continue
        if cutoff is not None and date.fromisoformat(observed_at) < cutoff:
            continue
        rows.append(
            {
                "series_code": code,
                "observed_at": observed_at,
                "value": value,
            }
        )

    return rows


def sync_observations(
    client: Client,
    observations_by_code: dict[str, list[dict[str, Any]]],
) -> int:
    total = 0

    for code, points in observations_by_code.items():
        latest = None if FORCE_FULL_SYNC else latest_observed_at(client, code)
        cutoff = None if latest is None else latest - timedelta(days=LOOKBACK_DAYS)
        rows = observation_rows_since(code, points, cutoff)

        for batch in chunk_rows(rows):
            (
                client
                .table("observations")
                .upsert(
                    batch,
                    on_conflict="series_code,observed_at",
                )
                .execute()
            )

        total += len(rows)
        mode = "전체" if cutoff is None else f"{cutoff.isoformat()} 이후"
        print(f"{code}: {mode} {len(rows):,}개 관측값 동기화")

    return total


def sync_app_meta(
    client: Client,
    index_data: dict[str, Any],
    last_updated: str,
) -> None:
    (
        client
        .table("app_meta")
        .upsert(
            {
                "key": "index",
                "value": index_data,
                "updated_at": last_updated,
            },
            on_conflict="key",
        )
        .execute()
    )


def document_specs() -> Iterator[tuple[str, str, Path]]:
    explicit = (
        ("principles", "timeline", DATA_ROOT / "principles" / "timeline.json"),
        ("value_screen", "latest", DATA_ROOT / "value_screen.json"),
        ("wiki", "graph", DATA_ROOT / "wiki" / "graph.json"),
    )
    for kind, key, path in explicit:
        if path.exists():
            yield kind, key, path

    markets_root = DATA_ROOT / "markets"
    if markets_root.exists():
        for path in sorted(markets_root.rglob("*.json")):
            key = path.relative_to(markets_root).with_suffix("").as_posix()
            yield "market", key, path

    notes_root = DATA_ROOT / "wiki" / "notes"
    if notes_root.exists():
        for path in sorted(notes_root.glob("*.json")):
            yield "wiki_note", path.stem, path


def sync_documents(client: Client, synced_at: str) -> int:
    rows = [
        {
            "kind": kind,
            "key": key,
            "payload": read_json(path),
            "updated_at": synced_at,
        }
        for kind, key, path in document_specs()
    ]

    for batch in chunk_rows(rows):
        (
            client
            .table("documents")
            .upsert(batch, on_conflict="kind,key")
            .execute()
        )

    return len(rows)


def sync_news(client: Client, synced_at: str) -> int:
    news_root = DATA_ROOT / "news"
    rows: list[dict[str, Any]] = []

    if news_root.exists():
        for path in sorted(news_root.glob("*/*.json")):
            rows.append(
                {
                    "ticker": path.parent.name,
                    "date": path.stem,
                    "payload": read_json(path),
                    "updated_at": synced_at,
                }
            )

    for batch in chunk_rows(rows):
        (
            client
            .table("news")
            .upsert(batch, on_conflict="ticker,date")
            .execute()
        )

    return len(rows)


def main() -> None:
    print("Supabase 전체 동기화를 시작합니다.")
    index_data = read_json(INDEX_PATH)
    last_updated = index_data.get("last_updated")
    if not last_updated:
        raise RuntimeError("index.json에 last_updated가 없습니다.")

    metadata, observations, group_counts = build_series_data(
        index_data,
        last_updated,
    )
    client = connect_supabase()

    sync_series_metadata(client, metadata)
    observation_count = sync_observations(client, observations)
    sync_app_meta(client, index_data, last_updated)

    synced_at = datetime.now(timezone.utc).isoformat()
    document_count = sync_documents(client, synced_at)
    news_count = sync_news(client, synced_at)

    print(
        "동기화 완료: "
        + ", ".join(
            f"{key} {value}개"
            for key, value in group_counts.items()
        )
        + f", 관측값 {observation_count:,}개"
        + f", 문서 {document_count:,}개"
        + f", 뉴스 {news_count:,}개"
    )


if __name__ == "__main__":
    main()
