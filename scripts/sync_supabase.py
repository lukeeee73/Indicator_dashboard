#!/usr/bin/env python3

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterator

from supabase import Client, create_client


# 현재 Python 파일의 위치를 기준으로 저장소 루트를 찾습니다.
REPO_ROOT = Path(__file__).resolve().parents[1]

# JSON 데이터가 들어 있는 data/ 디렉토리입니다.
DATA_ROOT = REPO_ROOT / "data"

# 지표 목록과 메타데이터가 들어 있는 파일입니다.
INDEX_PATH = DATA_ROOT / "index.json"

# 한 번의 요청으로 보낼 관측값 개수입니다.
BATCH_SIZE = 500


# 처음 시험할 때는 두 지표만 넣습니다.
# 전체 데를 넣을 때는 None으로 이터바꿉니다.
TARGET_CODES: set[str] | None = None


def read_json(path: Path) -> dict[str, Any]:
    """UTF-8 JSON 파일을 읽어 파이썬 딕셔너리로 반환합니다."""

    if not path.exists():
        raise FileNotFoundError(
            f"JSON 파일을 찾을 수 없습니다: {path}"
        )

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def get_required_env(name: str) -> str:
    """필수 환경변수를 읽고, 없으면 실행을 중단합니다."""

    value = os.environ.get(name)

    if not value:
        raise RuntimeError(
            f"필수 환경변수가 없습니다: {name}"
        )

    return value


def connect_supabase() -> Client:
    """GitHub Secret을 이용해 Supabase 클라이언트를 만듭니다."""

    url = get_required_env("SUPABASE_URL")
    secret_key = get_required_env(
        "SUPABASE_SECRET_KEY"
    )

    return create_client(url, secret_key)


def chunk_rows(
    rows: list[dict[str, Any]],
    size: int,
) -> Iterator[list[dict[str, Any]]]:
    """긴 행 목록을 일정한 크기의 묶음으로 나눕니다."""

    for start in range(0, len(rows), size):
        end = start + size
        yield rows[start:end]


def select_indicators(
    index_data: dict[str, Any],
) -> list[dict[str, Any]]:
    """index.json에서 동기화 대상 지표만 선택합니다."""

    indicators = index_data.get("indicators", [])

    if TARGET_CODES is None:
        return indicators

    return [
        item
        for item in indicators
        if item["code"] in TARGET_CODES
    ]


def build_series_rows(
    indicators: list[dict[str, Any]],
    last_updated: str,
) -> list[dict[str, Any]]:
    """index.json의 지표 정보를 series 테이블 행으로 변환합니다."""

    rows: list[dict[str, Any]] = []

    for item in indicators:
        rows.append(
            {
                "code": item["code"],
                "name": item["name"],
                "kind": "indicator",
                "category": item.get("category"),
                "unit": item.get("unit"),
                "region": item.get(
                    "region",
                    "US",
                ),
                "exclude_assessment": item.get(
                    "exclude_assessment",
                    False,
                ),
                "current_data": item.get(
                    "current"
                ),
                "updated_at": last_updated,
            }
        )

    return rows


def build_observation_rows(
    code: str,
) -> list[dict[str, Any]]:
    """개별 지표 JSON의 series 배열을 DB 행 목록으로 변환합니다."""

    path = (
        DATA_ROOT
        / "indicators"
        / f"{code}.json"
    )

    payload = read_json(path)
    series = payload.get("series", [])

    rows: list[dict[str, Any]] = []

    for point in series:
        date = point.get("date")
        value = point.get("value")

        if date is None or value is None:
            continue

        rows.append(
            {
                "series_code": code,
                "observed_at": date,
                "value": value,
            }
        )

    return rows


def sync_series_metadata(
    client: Client,
    rows: list[dict[str, Any]],
) -> None:
    """지표 메타데이터를 series 테이블에 upsert합니다."""

    if not rows:
        return

    (
        client
        .table("series")
        .upsert(rows)
        .execute()
    )


def sync_observations(
    client: Client,
    code: str,
    rows: list[dict[str, Any]],
) -> None:
    """날짜별 관측값을 여러 묶음으로 나누어 upsert합니다."""

    for batch in chunk_rows(
        rows,
        BATCH_SIZE,
    ):
        (
            client
            .table("observations")
            .upsert(batch)
            .execute()
        )

    print(
        f"{code}: "
        f"{len(rows):,}개 관측값 동기화"
    )


def sync_app_meta(
    client: Client,
    index_data: dict[str, Any],
) -> None:
    """index.json 전체를 app_meta('index')에 저장합니다.

    프론트엔드(app.js)는 지표 목록을 series 테이블이 아니라 이 app_meta 에서
    읽어옵니다. 여기가 갱신되지 않으면 series/observations 를 아무리 채워도
    화면에는 예전 목록만 보입니다 — 실제로 이 누락 때문에 2026-07-17 이후
    추가된 지표가 대시보드에 나타나지 않았습니다.
    """

    (
        client
        .table("app_meta")
        .upsert(
            {
                "key": "index",
                "value": index_data,
            }
        )
        .execute()
    )

    print(
        "app_meta('index') 갱신: "
        f"지표 {len(index_data.get('indicators', []))}개, "
        f"자산 {len(index_data.get('assets', []))}개, "
        f"종목 {len(index_data.get('stocks', []))}개, "
        f"지수 {len(index_data.get('indices', []))}개"
    )


def main() -> None:
    """JSON을 읽고 Supabase 동기화 과정을 순서대로 실행합니다."""

    print("Supabase 동기화를 시작합니다.")

    index_data = read_json(INDEX_PATH)

    last_updated = index_data.get(
        "last_updated"
    )

    if not last_updated:
        raise RuntimeError(
            "index.json에 last_updated가 없습니다."
        )

    indicators = select_indicators(
        index_data
    )

    if not indicators:
        raise RuntimeError(
            "동기화할 지표가 없습니다."
        )

    client = connect_supabase()

    series_rows = build_series_rows(
        indicators,
        last_updated,
    )

    sync_series_metadata(
        client,
        series_rows,
    )

    total_observations = 0

    for item in indicators:
        code = item["code"]

        observation_rows = (
            build_observation_rows(code)
        )

        sync_observations(
            client,
            code,
            observation_rows,
        )

        total_observations += len(
            observation_rows
        )

    # 시계열을 다 넣은 뒤에 목록을 갱신합니다. 순서가 반대면 프론트가
    # 아직 없는 시계열을 조회하는 순간이 생깁니다.
    sync_app_meta(client, index_data)

    print(
        "동기화 완료: "
        f"지표 {len(indicators)}개, "
        f"관측값 {total_observations:,}개"
    )


if __name__ == "__main__":
    main()
