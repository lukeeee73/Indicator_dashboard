#!/usr/bin/env python3
"""
한국은행 ECOS Open API 에서 한국 지표를 가져온다. fetch_fred.main() 이 호출한다.

ECOS_API_KEY 환경변수가 없으면 아무것도 수집하지 않는다 — 기존 값은 그대로 남는다.
키는 https://ecos.bok.or.kr/api/ 에서 무료로 즉시 발급된다.

ECOS 는 통계청(고용·산업활동·경기종합지수) 자료까지 재수록하므로, FRED 의 OECD MEI
한국 계열(2023~2024 년 갱신 중단)을 대부분 대체한다. 대체 관계는 각 항목의
"replaces" 에 적고, ECOS 값이 확보되면 낡은 FRED 계열은 출력에서 빠진다.

새 지표를 추가할 때:
  1) 통계표 코드/항목 코드는 StatisticItemList API 로 확인한다
     (예: https://ecos.bok.or.kr/api/StatisticItemList/sample/json/kr/1/10/901Y009).
     항목이 두 단계(계절조정 여부, 원화/달러 기준 등)면 items 에 둘 다 적는다.
  2) js/metadata.js INDICATOR_META 에 같은 코드로 표시 정보를 추가한다.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional

import requests

ECOS_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch"
PAGE_SIZE = 1000
REQUEST_TIMEOUT = 60

# 수집 시작 시점 — 각 표의 실제 시작 이전이면 ECOS 가 있는 데이터만 돌려준다.
EARLIEST = {"M": "196001", "Q": "1960Q1", "A": "1960", "D": "19600101"}

# code: 대시보드에서 쓰는 지표 코드(파일명·Supabase series code).
#   stat/items/cycle: ECOS 통계표·항목·주기
#   name/category/unit/transform: fetch_fred.INDICATORS 와 같은 의미
#   replaces: 이 계열이 확보되면 출력에서 제거할 낡은 FRED 코드
ECOS_INDICATORS: dict[str, dict] = {
    # ── 물가 ── (category=inflation 은 한국 4분면 인플레 축에 들어간다)
    "KR_CPI": {
        "stat": "901Y009", "items": ["0"], "cycle": "M",
        "name": "Korea CPI YoY", "category": "inflation", "unit": "percent",
        "transform": "yoy_pct", "replaces": "KORCPIALLMINMEI",
    },
    "KR_CORE_CPI": {
        # 농산물 및 석유류 제외 지수 — 한국은행·통계청이 쓰는 근원물가 정의
        "stat": "901Y010", "items": ["QB"], "cycle": "M",
        "name": "Korea Core CPI (ex Agriculture & Petroleum) YoY", "category": "inflation",
        "unit": "percent", "transform": "yoy_pct",
    },
    "KR_PPI": {
        "stat": "404Y014", "items": ["*AA"], "cycle": "M",
        "name": "Korea PPI YoY", "category": "inflation", "unit": "percent",
        "transform": "yoy_pct",
    },
    # ── 에너지 ── 오피넷 연동 전까지 소비자물가의 석유류 지수로 연료비를 본다
    "KR_PETROLEUM_CPI": {
        "stat": "901Y010", "items": ["2125"], "cycle": "M",
        "name": "Korea CPI Petroleum Products YoY", "category": "energy", "unit": "percent",
        "transform": "yoy_pct",
    },
    # ── 통화·금리·환율 ──
    "KR_BASE_RATE": {
        "stat": "722Y001", "items": ["0101000"], "cycle": "M",
        "name": "Bank of Korea Base Rate", "category": "dollar", "unit": "percent",
    },
    "KR_M2": {
        "stat": "161Y006", "items": ["BBHA00"], "cycle": "M",
        "name": "Korea M2 (Average, NSA) YoY", "category": "dollar", "unit": "percent",
        "transform": "yoy_pct", "replaces": "MYAGM2KRM189S",
    },
    "KR_JPYKRW": {
        "stat": "731Y004", "items": ["0000002", "0000100"], "cycle": "M",
        "name": "KRW per 100 JPY (Monthly Average)", "category": "dollar", "unit": "krw",
    },
    "KR_CNYKRW": {
        "stat": "731Y004", "items": ["0000053", "0000100"], "cycle": "M",
        "name": "KRW per CNY (Monthly Average)", "category": "dollar", "unit": "krw",
    },
    # ── 고용 ──
    "KR_EMP_RATE": {
        "stat": "901Y027", "items": ["I61E", "I28B"], "cycle": "M",
        "name": "Korea Employment Rate (SA)", "category": "labor", "unit": "percent",
    },
    "KR_EMPLOYED_YOY": {
        # 한국은 '취업자 수 전년동월대비 증감(천 명)' 으로 발표·보도한다 — 원계열 기준
        "stat": "901Y027", "items": ["I61BA", "I28A"], "cycle": "M",
        "name": "Korea Employed Persons YoY Change", "category": "labor", "unit": "thousand_persons",
        "transform": "yoy_diff",
    },
    # ── 소비·심리 ──
    "KR_CCSI": {
        "stat": "511Y002", "items": ["FME", "99988"], "cycle": "M",
        "name": "Korea Composite Consumer Sentiment Index", "category": "consumer", "unit": "index",
    },
    # ── 경기 (growth — 화면에는 섹터가 없고 한국 4분면 성장 축에 들어간다) ──
    "KR_IP": {
        "stat": "901Y033", "items": ["A00", "1"], "cycle": "M",
        "name": "Korea All-Industry Production YoY", "category": "growth", "unit": "percent",
        "transform": "yoy_pct", "replaces": "KORPROINDMISMEI",
    },
    "KR_CLI_CYCLE": {
        "stat": "901Y067", "items": ["I16E"], "cycle": "M",
        "name": "Korea Leading Index Cyclical Component", "category": "growth", "unit": "index",
    },
    "KR_BSI": {
        "stat": "512Y013", "items": ["99988", "AA"], "cycle": "M",
        "name": "Korea BSI All Industries (Business Conditions)", "category": "growth", "unit": "index",
    },
    # ── 주거 ──
    "KR_KB_APT": {
        "stat": "901Y062", "items": ["P63AC"], "cycle": "M",
        "name": "KB Apartment Sale Price Index (Nationwide) YoY", "category": "housing",
        "unit": "percent", "transform": "yoy_pct",
    },
    "KR_KB_APT_SEOUL": {
        "stat": "901Y062", "items": ["P63ACA"], "cycle": "M",
        "name": "KB Apartment Sale Price Index (Seoul) YoY", "category": "housing",
        "unit": "percent", "transform": "yoy_pct",
    },
    # ── 신용 ──
    "KR_HH_LOANS": {
        "stat": "151Y005", "items": ["1110000"], "cycle": "M",
        "name": "Korea Household Loans (Depository Institutions) YoY", "category": "credit",
        "unit": "percent", "transform": "yoy_pct",
    },
    "KR_LOAN_RATE": {
        "stat": "121Y006", "items": ["BECBLA01"], "cycle": "M",
        "name": "Korea Bank Lending Rate (New Loans, Average)", "category": "credit", "unit": "percent",
    },
    # ── 무역 ──
    "KR_GOODS_BALANCE": {
        "stat": "301Y013", "items": ["100000"], "cycle": "M",
        "name": "Korea Goods Balance (BoP)", "category": "trade", "unit": "billion_usd",
        "transform": "million_to_billion",
    },
    "KR_IMPORT_PRICE": {
        "stat": "401Y015", "items": ["*AA", "W"], "cycle": "M",
        "name": "Korea Import Price Index (KRW) YoY", "category": "trade", "unit": "percent",
        "transform": "yoy_pct",
    },
}


class EcosError(RuntimeError):
    """ECOS 가 오류 코드를 돌려줬을 때. 메시지에 API 키를 넣지 않는다."""


def ecos_time_to_date(time: str, cycle: str) -> str:
    """ECOS TIME 문자열 → 기간 첫날 ISO 날짜. 'M':202610, 'Q':2026Q3, 'A':2026, 'D':20261113."""
    if cycle == "M":
        return f"{time[:4]}-{time[4:6]}-01"
    if cycle == "Q":
        quarter = int(time[-1])
        return f"{time[:4]}-{(quarter - 1) * 3 + 1:02d}-01"
    if cycle == "A":
        return f"{time[:4]}-01-01"
    if cycle == "D":
        return f"{time[:4]}-{time[4:6]}-{time[6:8]}"
    raise ValueError(f"지원하지 않는 ECOS 주기: {cycle}")


def _current_period(cycle: str, now: datetime) -> str:
    if cycle == "M":
        return now.strftime("%Y%m")
    if cycle == "Q":
        return f"{now.year}Q{(now.month - 1) // 3 + 1}"
    if cycle == "A":
        return str(now.year)
    return now.strftime("%Y%m%d")


def parse_rows(rows: list[dict], cycle: str) -> list[dict]:
    """ECOS row 목록 → [{'date', 'value'}] (빈 값·숫자가 아닌 값 제외, 날짜 오름차순)."""
    series = []
    for row in rows:
        raw = (row.get("DATA_VALUE") or "").replace(",", "").strip()
        try:
            value = float(raw)
        except ValueError:
            continue
        series.append({"date": ecos_time_to_date(row["TIME"], cycle), "value": value})
    series.sort(key=lambda p: p["date"])
    return series


def fetch_ecos_series(spec: dict, api_key: str, now: Optional[datetime] = None) -> list[dict]:
    """한 계열 전체 이력을 페이지 단위로 받아 [{'date', 'value'}] 로 돌려준다."""
    now = now or datetime.now(timezone.utc)
    cycle = spec["cycle"]
    path_tail = "/".join([spec["stat"], cycle, EARLIEST[cycle], _current_period(cycle, now), *spec["items"]])
    rows: list[dict] = []
    start = 1
    while True:
        end = start + PAGE_SIZE - 1
        url = f"{ECOS_BASE_URL}/{api_key}/json/kr/{start}/{end}/{path_tail}"
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as e:
            # requests 예외 메시지에는 키가 든 URL 이 들어가므로 그대로 올리지 않는다.
            raise EcosError(f"ECOS 요청 실패 ({type(e).__name__}) — {path_tail}") from None
        body = payload.get("StatisticSearch")
        if body is None:
            result = payload.get("RESULT", {})
            if result.get("CODE") == "INFO-200":  # 해당하는 데이터가 없음
                break
            raise EcosError(f"ECOS 오류 {result.get('CODE')}: {result.get('MESSAGE')} — {path_tail}")
        page = body.get("row", [])
        rows.extend(page)
        if not page or end >= int(body.get("list_total_count", 0)):
            break
        start = end + 1
    return parse_rows(rows, cycle)


def collect_ecos(
    api_key: str,
    transforms: dict[str, Callable[[list[dict]], list[dict]]],
    specs: Optional[dict[str, dict]] = None,
) -> tuple[dict, int]:
    """ECOS_INDICATORS 를 수집해 fetch_fred 의 indicator payload 형태로 돌려준다.

    한 계열이 실패해도 나머지는 계속 받는다. 실패한 계열은 결과에 넣지 않아
    호출부가 기존 값을 유지한다.
    """
    specs = ECOS_INDICATORS if specs is None else specs
    collected: dict[str, dict] = {}
    success = 0
    for code, spec in specs.items():
        print(f"Fetching indicator {code} (ECOS {spec['stat']})...", end=" ", flush=True)
        try:
            series = fetch_ecos_series(spec, api_key)
            transform = spec.get("transform")
            if transform:
                series = transforms[transform](series)
            if not series:
                print("FAILED (empty series)")
                continue
            collected[code] = {
                "name": spec["name"],
                "unit": spec["unit"],
                "category": spec["category"],
                "region": "KR",
                "source": "ECOS",
                "exclude_assessment": True,
                "series": series,
            }
            print(f"OK ({len(series)} points)")
            success += 1
        except Exception as e:  # noqa: BLE001 — 다른 계열은 계속 수집
            print(f"FAILED ({e})")
    return collected, success


def drop_replaced(indicators: dict) -> list[str]:
    """ECOS 대체 계열이 있으면 낡은 FRED 계열을 indicators 에서 제거하고 제거한 코드를 돌려준다."""
    dropped = []
    for code, spec in ECOS_INDICATORS.items():
        old = spec.get("replaces")
        if old and code in indicators and old in indicators:
            indicators.pop(old)
            dropped.append(old)
    return dropped
