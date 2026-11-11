#!/usr/bin/env python3
"""한국은행 ECOS Open API 에서 한국 거시 지표를 받아 기존 분할 저장소에 병합한다.

사용법:
    export ECOS_API_KEY="your_api_key"
    python scripts/fetch_ecos.py

FRED 의 OECD MEI 한국 계열(CPI, 산업생산, M2)은 갱신이 끊겼고,
실업률(LRUNTTTTKOR156S)·정부부채(DEBTTLKRQ052N)는 수집 자체가 실패한다.
이 스크립트가 그 자리를 공식 통계로 갈아끼운다.

원칙:
    - ECOS_API_KEY 가 없으면 아무 파일도 쓰지 않고 종료한다 (기존 데이터 유지).
    - 한 계열이 실패해도 나머지는 저장한다. 실패한 계열의 기존 파일은 남긴다.
    - 성공한 계열만, 자신이 대체하는 죽은 FRED 코드를 저장소에서 제거한다.
    - 시계열 모양은 fetch_fred.py 와 같다: {date: YYYY-MM-DD, value: float}.
    - 키는 URL 경로에만 넣고 로그에는 남기지 않는다.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Optional

import requests

if __package__:
    from .analyze import enrich_with_assessment
    from .fetch_fred import compute_yoy_pct, load_split_store, save_split_store
else:
    from analyze import enrich_with_assessment
    from fetch_fred import compute_yoy_pct, load_split_store, save_split_store


ECOS_SEARCH_URL = "https://ecos.bok.or.kr/api/StatisticSearch"
REQUEST_TIMEOUT = 60
PAGE_SIZE = 1000
MAX_PAGES = 40

# 죽은 FRED/OECD 코드. 대응 ECOS 계열이 성공했을 때만 저장소에서 뺀다.
RETIRED_FRED_CODES = {
    "KORCPIALLMINMEI": "KR_CPI",
    "KORPROINDMISMEI": "KR_IP",
    "MYAGM2KRM189S": "KR_M2",
    "LRUNTTTTKOR156S": "KR_UNRATE",
    "DEBTTLKRQ052N": "KR_FISCAL_BAL",
}


class EcosError(Exception):
    """ECOS 응답을 시계열로 만들지 못할 때. 메시지에 API 키를 넣지 않는다."""


# --------------------------------------------------------------------------
# 수집 정의
# --------------------------------------------------------------------------
# item_codes 는 StatisticSearch 경로의 항목코드1, 항목코드2, ... 순서.
# category 가 growth/inflation 이면 한국 4분면(assessment_kr) 입력이다.
# dollar 는 원화 가치 카드에만 나오고 분면 점수에는 넣지 않는다.
# exclude_assessment 는 미국 4분면 오염을 막는다 (기존 한국 계열과 동일).
#
# 코드는 2026-11-11 에 ECOS sample 키로 통계표·항목·최근 관측을 확인했다.
# 샘플 키는 호출당 10행이라 전체 이력은 여기서 받지 않는다.
SERIES: dict[str, dict] = {
    "KR_CPI": {
        "name": "Korea CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
        "stat_code": "901Y009",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("0",),
        "replaces": "KORCPIALLMINMEI",
    },
    "KR_CPI_CORE": {
        # 901Y010 의 "00" 은 총지수라 헤드라인과 같다. 근원은 "DB".
        "name": "Korea Core CPI YoY",
        "category": "inflation",
        "unit": "percent",
        "transform": "yoy_pct",
        "stat_code": "901Y010",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("DB",),
        "replaces": None,
    },
    "KR_M2": {
        # 설계 문서의 101Y004 는 현재 본표가 아니다. 평잔 원계열은 161Y006/BBHA00.
        "name": "Korea M2 Money Supply YoY",
        "category": "dollar",
        "unit": "percent",
        "transform": "yoy_pct",
        "stat_code": "161Y006",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("BBHA00",),
        "replaces": "MYAGM2KRM189S",
    },
    "KR_IP": {
        # 광공업생산지수(원계열). 전년동월비는 원지수로 계산한다.
        "name": "Korea Industrial Production YoY",
        "category": "growth",
        "unit": "percent",
        "transform": "yoy_pct",
        "stat_code": "901Y033",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("AB00", "1"),
        "replaces": "KORPROINDMISMEI",
    },
    "KR_UNRATE": {
        # 항목2 를 비우면 원계열과 계절조정이 한 달에 두 값으로 섞인다.
        # 분면 점수용으로는 계절조정(I28B)을 쓴다.
        "name": "Korea Unemployment Rate",
        "category": "growth",
        "unit": "percent",
        "transform": None,
        "stat_code": "901Y027",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("I61BC", "I28B"),
        "replaces": "LRUNTTTTKOR156S",
    },
    "KR_POLICY_RATE": {
        "name": "Korea Base Rate",
        "category": "dollar",
        "unit": "percent",
        "transform": None,
        "stat_code": "722Y001",
        "cycle": "M",
        "start": "199905",
        "item_codes": ("0101000",),
        "replaces": None,
    },
    "KR_FISCAL_BAL": {
        # ECOS 에는 GDP 대비 국가채무(D1/D2) 시계열이 없다.
        # 통합재정수지(901Y013/C)는 연간 누적(십억원)이라 조 원으로만 단위를 바꾼다.
        "name": "Korea Consolidated Fiscal Balance (YTD)",
        "category": "dollar",
        "unit": "trillion_krw",
        "transform": "billion_krw_to_trillion",
        "stat_code": "901Y013",
        "cycle": "M",
        "start": "196001",
        "item_codes": ("C",),
        "replaces": "DEBTTLKRQ052N",
    },
}

TRANSFORMS = {
    "yoy_pct": compute_yoy_pct,
    "billion_krw_to_trillion": lambda series: [
        {"date": point["date"], "value": round(point["value"] / 1000.0, 3)}
        for point in series
        if point.get("value") is not None
    ],
}


def _period_end(cycle: str, moment: datetime) -> str:
    if cycle == "M":
        return moment.strftime("%Y%m")
    if cycle == "D":
        return moment.strftime("%Y%m%d")
    if cycle == "A":
        return moment.strftime("%Y")
    if cycle == "Q":
        quarter = (moment.month - 1) // 3 + 1
        return f"{moment.year}Q{quarter}"
    raise EcosError(f"unsupported cycle: {cycle}")


def parse_time(cycle: str, raw: object) -> str:
    """ECOS TIME 문자열을 저장소 날짜(YYYY-MM-DD)로 바꾼다."""
    text = str(raw or "").strip()
    if cycle == "M" and len(text) == 6 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-01"
    if cycle == "D" and len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if cycle == "A" and len(text) == 4 and text.isdigit():
        return f"{text}-01-01"
    if cycle == "Q" and len(text) == 6 and text[4:5] == "Q" and text[5:] in "1234":
        month = {"1": "01", "2": "04", "3": "07", "4": "10"}[text[5]]
        return f"{text[:4]}-{month}-01"
    raise EcosError(f"unsupported time {text!r} for cycle {cycle}")


def build_search_url(
    api_key: str,
    stat_code: str,
    cycle: str,
    start: str,
    end: str,
    item_codes: tuple[str, ...],
    page_start: int,
    page_end: int,
) -> str:
    parts = [
        ECOS_SEARCH_URL,
        api_key,
        "json",
        "kr",
        str(page_start),
        str(page_end),
        stat_code,
        cycle,
        start,
        end,
        *item_codes,
    ]
    return "/".join(parts)


def _as_rows(payload: dict) -> tuple[list[dict], Optional[int]]:
    if not isinstance(payload, dict):
        raise EcosError("response is not a JSON object")
    if "StatisticSearch" not in payload:
        result = payload.get("RESULT") if isinstance(payload.get("RESULT"), dict) else {}
        code = result.get("CODE") or "UNKNOWN"
        message = result.get("MESSAGE") or "no StatisticSearch payload"
        raise EcosError(f"{code}: {message}")
    block = payload.get("StatisticSearch") or {}
    rows = block.get("row") or []
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        raise EcosError("StatisticSearch.row is not a list")
    total_raw = block.get("list_total_count")
    total = int(total_raw) if total_raw not in (None, "") else None
    return rows, total


def _row_matches(row: dict, item_codes: tuple[str, ...]) -> bool:
    for index, code in enumerate(item_codes, start=1):
        if str(row.get(f"ITEM_CODE{index}") or "") != code:
            return False
    return True


def parse_observations(payload: dict, cycle: str, item_codes: tuple[str, ...]) -> tuple[list[dict], Optional[int]]:
    """한 페이지의 ECOS JSON 을 날짜순 관측으로 바꾼다.

    요청한 항목코드와 다른 행은 버린다. 같은 날짜에 값이 다르면 실패한다.
    """
    rows, total = _as_rows(payload)
    by_date: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict) or not _row_matches(row, item_codes):
            continue
        raw_value = row.get("DATA_VALUE")
        if raw_value in (None, ""):
            continue
        try:
            value = round(float(raw_value), 6)
        except (TypeError, ValueError):
            continue
        date = parse_time(cycle, row.get("TIME"))
        previous = by_date.get(date)
        if previous is not None and previous != value:
            raise EcosError(f"conflicting values for {date}: {previous} vs {value}")
        by_date[date] = value
    points = [{"date": date, "value": by_date[date]} for date in sorted(by_date)]
    return points, total


def _collapse(points: list[dict]) -> list[dict]:
    """페이지를 이어 붙인 관측을 날짜순으로 모은다. 값이 다르면 실패한다."""
    by_date: dict[str, float] = {}
    for point in points:
        previous = by_date.get(point["date"])
        if previous is not None and previous != point["value"]:
            raise EcosError(f"conflicting values for {point['date']}: {previous} vs {point['value']}")
        by_date[point["date"]] = point["value"]
    return [{"date": date, "value": by_date[date]} for date in sorted(by_date)]


def fetch_observations(api_key: str, spec: dict, moment: datetime) -> list[dict]:
    """한 통계표의 전 구간을 페이지로 받아 합친다."""
    end = _period_end(spec["cycle"], moment)
    points: list[dict] = []
    total: Optional[int] = None
    for page in range(MAX_PAGES):
        page_start = page * PAGE_SIZE + 1
        page_end = page_start + PAGE_SIZE - 1
        url = build_search_url(
            api_key,
            spec["stat_code"],
            spec["cycle"],
            spec["start"],
            end,
            spec["item_codes"],
            page_start,
            page_end,
        )
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            raise EcosError(f"HTTP {exc.__class__.__name__}") from None
        except ValueError as exc:
            raise EcosError(f"invalid JSON ({exc.__class__.__name__})") from None
        batch, reported = parse_observations(payload, spec["cycle"], spec["item_codes"])
        points.extend(batch)
        if total is None:
            total = reported
        if not batch or total is None or page_end >= total:
            break
    else:
        raise EcosError(f"page limit {MAX_PAGES} exceeded")
    merged = _collapse(points)
    if not merged:
        raise EcosError("no observations")
    return merged


def apply_transform(spec: dict, points: list[dict]) -> list[dict]:
    transform = spec.get("transform")
    if not transform:
        return points
    fn = TRANSFORMS.get(transform)
    if fn is None:
        raise EcosError(f"unknown transform: {transform}")
    converted = fn(points)
    if not converted:
        raise EcosError(f"transform {transform} produced no points")
    return converted


def build_payload(spec: dict, points: list[dict]) -> dict:
    return {
        "name": spec["name"],
        "unit": spec["unit"],
        "category": spec["category"],
        "region": "KR",
        "exclude_assessment": True,
        "source": "ECOS",
        "ecos": {
            "stat_code": spec["stat_code"],
            "cycle": spec["cycle"],
            "item_codes": list(spec["item_codes"]),
        },
        "series": points,
    }


def collect_series(
    api_key: str,
    moment: Optional[datetime] = None,
    series_map: Optional[dict[str, dict]] = None,
) -> tuple[dict[str, dict], list[str]]:
    """계열별 안전 수집. 실패 코드는 두 번째 반환값에 남긴다."""
    moment = moment or datetime.now(timezone.utc)
    series_map = series_map if series_map is not None else SERIES
    collected: dict[str, dict] = {}
    failed: list[str] = []
    for code, spec in series_map.items():
        print(f"Fetching ECOS {code} ({spec['stat_code']})...", end=" ", flush=True)
        try:
            raw = fetch_observations(api_key, spec, moment)
            series = apply_transform(spec, raw)
            collected[code] = build_payload(spec, series)
            print(f"OK ({len(series)} points, {series[0]['date']} ~ {series[-1]['date']})")
        except EcosError as exc:
            failed.append(code)
            print(f"FAILED ({exc})")
        except Exception as exc:  # noqa: BLE001
            failed.append(code)
            print(f"FAILED (unexpected: {exc.__class__.__name__})")
    return collected, failed


def merge_into_store(existing: dict, collected: dict[str, dict], moment: datetime) -> dict:
    """성공한 계열만 반영하고, 그 계열이 대체하는 죽은 FRED 코드만 제거한다."""
    indicators = dict(existing.get("indicators") or {})
    for code, payload in collected.items():
        indicators[code] = payload
        retired = SERIES.get(code, {}).get("replaces")
        if retired and retired in indicators:
            del indicators[retired]
            print(f"Removed retired FRED series {retired} (replaced by {code})")
    output = {
        "last_updated": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indicators": indicators,
        "assets": existing.get("assets") or {},
        "stocks": existing.get("stocks") or {},
        "indices": existing.get("indices") or {},
    }
    enrich_with_assessment(output)
    return output


def main() -> int:
    api_key = os.environ.get("ECOS_API_KEY", "").strip()
    if not api_key:
        print(
            "ECOS_API_KEY 가 없습니다. 한국은행 ECOS 수집을 건너뛰고 기존 데이터를 유지합니다.\n"
            "키 발급: https://ecos.bok.or.kr/api/  (인증키 신청, 무료).\n"
            "GitHub Actions 에는 repository secret 이름 ECOS_API_KEY 로 등록합니다.",
            file=sys.stderr,
        )
        return 0

    moment = datetime.now(timezone.utc)
    collected, failed = collect_series(api_key, moment)
    if not collected:
        print(
            "ERROR: ECOS 계열을 하나도 저장하지 못했습니다. 기존 JSON 을 덮어쓰지 않습니다.",
            file=sys.stderr,
        )
        return 1

    existing = load_split_store()
    output = merge_into_store(existing, collected, moment)
    save_split_store(output)
    print(
        f"\nDone. {len(collected)}/{len(SERIES)} ECOS series updated"
        + (f", failed: {', '.join(failed)}" if failed else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
