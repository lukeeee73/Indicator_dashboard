#!/usr/bin/env python3
"""
미국 국채 입찰 결과 수집 — TreasuryDirect Auction Query API (API 키 불필요).

FRED 에는 없는 "수요" 데이터. 재무부가 국채를 팔 때마다 누가 얼마나 사겠다고
손을 들었는지가 공개된다.

  - 응찰률(bid-to-cover) : 파는 물량 대비 들어온 주문 총액. 2.5 면 2.5배가 몰린 것.
  - 낙찰 배분 3분할      : primary dealer / direct / indirect
        indirect = 딜러를 통해 들어온 고객 주문 ≈ 외국 중앙은행·국부펀드·해외기관.
                   외국 수요를 매주 볼 수 있는 유일한 고빈도 데이터.
        primary dealer 비중이 높다 = 아무도 안 사서 딜러가 떠안았다 = 수요 약함.
                   딜러는 응찰 의무가 있어서 남는 물량이 이쪽으로 몰린다.

미 국채 입찰은 그 응찰 의무 때문에 사실상 유찰되지 않는다. 그래서 수요 약화는
"안 팔림" 이 아니라 "더 높은 금리를 줘야 팔림" 으로 나타난다 — 겉보기에는 늘
성공한 입찰이다. 응찰률과 3분할 배분을 봐야 그 안이 보인다.

출력:
  data/auctions/records.json      원본 입찰 기록 (만기·응찰률·3분할·발행량·낙찰금리)
  data/indicators/AUCT_*.json     만기별 파생 시계열 (기존 지표와 동일한 형식)
  data/index.json                 위 파생 시계열을 indicators 목록에 추가

실행 순서 주의:
  fetch_fred.py 가 data/indicators/ 에서 자기 관리 목록에 없는 파일을 지우고
  index.json 을 새로 쓰기 때문에, 이 스크립트는 **fetch_fred.py 다음에** 돌아야 한다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

import requests

from analyze import compute_current_stats


REPO_ROOT      = Path(__file__).resolve().parents[1]
DATA_DIR       = REPO_ROOT / "data"
INDICATORS_DIR = DATA_DIR / "indicators"
AUCTIONS_DIR   = DATA_DIR / "auctions"
INDEX_PATH     = DATA_DIR / "index.json"

BASE = "https://www.treasurydirect.gov/TA_WS/securities"
TIMEOUT = 30

# 응답 스키마가 문서화가 얕아서, 후보 URL 을 순서대로 시도하고 첫 성공을 쓴다.
# 실패해도 어떤 URL 이 무엇을 반환했는지 로그에 남겨 다음 실행에서 좁힐 수 있게 한다.
CANDIDATE_URLS: list[str] = [
    f"{BASE}/auctioned?format=json&pagesize=10000",
    f"{BASE}/auctioned?format=json",
    f"{BASE}/Note?format=json&pagesize=10000",
]

# 수집 대상 만기. 2Y 는 정책금리 기대에 좌우되는 대조군이고,
# 10Y·30Y 가 재정 리스크가 실제로 드러나는 구간이다.
TENORS: dict[str, str] = {
    "2-Year":  "2Y",
    "10-Year": "10Y",
    "30-Year": "30Y",
}

# API 필드명이 문서마다 조금씩 달라서 후보를 두고 먼저 잡히는 것을 쓴다.
FIELD_CANDIDATES: dict[str, tuple[str, ...]] = {
    "auction_date": ("auctionDate",),
    "term":         ("securityTerm", "originalSecurityTerm"),
    "type":         ("securityType",),
    "cusip":        ("cusip",),
    "btc":          ("bidToCoverRatio",),
    "indirect":     ("indirectBidderAccepted",),
    "direct":       ("directBidderAccepted",),
    "dealer":       ("primaryDealerAccepted",),
    "offering":     ("offeringAmount",),
    "high_yield":   ("highYield", "highDiscountRate"),
}


# --------------------------------------------------------------------------
# 파싱 헬퍼
# --------------------------------------------------------------------------
def _pick(record: dict, key: str) -> Optional[Any]:
    """FIELD_CANDIDATES 의 후보 이름 중 먼저 잡히는 값을 반환."""
    for name in FIELD_CANDIDATES[key]:
        val = record.get(name)
        if val not in (None, ""):
            return val
    return None


def _as_float(val: Any) -> Optional[float]:
    """API 가 숫자를 문자열로 주는 경우가 있어 관대하게 변환한다."""
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _as_date(val: Any) -> Optional[str]:
    """'2026-07-15T00:00:00' 같은 값을 'YYYY-MM-DD' 로 자른다."""
    if not val:
        return None
    text = str(val).strip()
    return text[:10] if len(text) >= 10 else None


# --------------------------------------------------------------------------
# 수집
# --------------------------------------------------------------------------
def fetch_raw() -> list[dict]:
    """후보 URL 을 순서대로 시도해 입찰 기록 목록을 가져온다."""
    last_error: Optional[str] = None
    for url in CANDIDATE_URLS:
        print(f"Trying {url} ...", end=" ", flush=True)
        try:
            resp = requests.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as e:
            print(f"FAILED (network: {e})")
            last_error = str(e)
            continue
        except ValueError as e:
            print(f"FAILED (JSON 파싱: {e})")
            last_error = str(e)
            continue

        if isinstance(payload, list) and payload:
            print(f"OK ({len(payload)} records)")
            # 스키마가 바뀌었을 때 바로 알아채도록 첫 레코드의 키를 남긴다.
            print(f"  응답 필드: {sorted(payload[0].keys())}")
            return payload

        print(f"EMPTY (type={type(payload).__name__})")
        last_error = "빈 응답"

    print(f"모든 후보 URL 실패 — 마지막 오류: {last_error}", file=sys.stderr)
    return []


def normalize(raw: list[dict]) -> list[dict]:
    """원본 레코드에서 필요한 필드만 뽑아 정규화. 대상 만기만 남긴다."""
    out: list[dict] = []
    skipped_no_date = 0
    skipped_no_btc = 0

    for rec in raw:
        term = _pick(rec, "term")
        if term not in TENORS:
            continue

        date = _as_date(_pick(rec, "auction_date"))
        if not date:
            skipped_no_date += 1
            continue

        btc = _as_float(_pick(rec, "btc"))
        if btc is None or btc <= 0:
            # 응찰률이 없는 레코드는 수요 판단에 쓸 수 없다.
            skipped_no_btc += 1
            continue

        indirect = _as_float(_pick(rec, "indirect"))
        direct   = _as_float(_pick(rec, "direct"))
        dealer   = _as_float(_pick(rec, "dealer"))

        # 세 값의 합 = 경쟁입찰 낙찰 총액. totalAccepted 는 비경쟁분·SOMA 롤오버가
        # 섞일 수 있어 분모로 쓰지 않는다.
        competitive = None
        shares = [v for v in (indirect, direct, dealer) if v is not None]
        if len(shares) == 3 and sum(shares) > 0:
            competitive = sum(shares)

        out.append({
            "date":            date,
            "tenor":           TENORS[term],
            "cusip":           _pick(rec, "cusip"),
            "security_type":   _pick(rec, "type"),
            "bid_to_cover":    btc,
            "offering_amount": _as_float(_pick(rec, "offering")),
            "high_yield":      _as_float(_pick(rec, "high_yield")),
            "indirect_amount": indirect,
            "direct_amount":   direct,
            "dealer_amount":   dealer,
            "indirect_share":  (indirect / competitive * 100.0) if competitive and indirect is not None else None,
            "dealer_share":    (dealer   / competitive * 100.0) if competitive and dealer   is not None else None,
        })

    if skipped_no_date or skipped_no_btc:
        print(f"  건너뜀: 날짜 없음 {skipped_no_date}건, 응찰률 없음 {skipped_no_btc}건")

    out.sort(key=lambda r: (r["date"], r["tenor"]))
    return out


# --------------------------------------------------------------------------
# 파생 시계열
# --------------------------------------------------------------------------
# 같은 날 같은 만기가 두 번 나오는 경우(재발행 등)는 평균을 낸다.
def _to_series(records: list[dict], tenor: str, field: str) -> list[dict]:
    buckets: dict[str, list[float]] = {}
    for rec in records:
        if rec["tenor"] != tenor:
            continue
        val = rec.get(field)
        if val is None:
            continue
        buckets.setdefault(rec["date"], []).append(val)
    return [
        {"date": d, "value": sum(vals) / len(vals)}
        for d, vals in sorted(buckets.items())
    ]


DERIVED: list[tuple[str, str, str, str, str]] = [
    # (코드 접미사, 필드, 단위, 영문 이름 템플릿, 소수 자리 설명용)
    ("BTC", "bid_to_cover",   "ratio",   "Auction Bid-to-Cover ({t})", ""),
    ("IND", "indirect_share", "percent", "Auction Indirect Bidder Share ({t})", ""),
]


def build_indicator_payloads(records: list[dict]) -> dict[str, dict]:
    """AUCT_<지표>_<만기> 코드별 payload 를 만든다."""
    payloads: dict[str, dict] = {}
    for tenor in TENORS.values():
        for suffix, field, unit, name_tpl, _ in DERIVED:
            series = _to_series(records, tenor, field)
            if not series:
                print(f"  {suffix}_{tenor}: 데이터 없음 — 건너뜀")
                continue
            code = f"AUCT_{suffix}_{tenor}"
            payload = {
                "name":     name_tpl.format(t=tenor),
                "unit":     unit,
                "category": "dollar",
                "exclude_assessment": True,
                "series":   series,
            }
            stats = compute_current_stats(code, series)
            if stats:
                payload["current"] = stats
            payloads[code] = payload
            print(f"  {code}: {len(series)} points ({series[0]['date']} ~ {series[-1]['date']})")
    return payloads


# --------------------------------------------------------------------------
# 저장
# --------------------------------------------------------------------------
def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def merge_into_index(payloads: dict[str, dict]) -> None:
    """fetch_fred.py 가 새로 쓴 index.json 에 입찰 파생 지표를 덧붙인다."""
    if not INDEX_PATH.exists():
        print("data/index.json 이 없다 — fetch_fred.py 를 먼저 실행해야 한다.", file=sys.stderr)
        return

    with INDEX_PATH.open("r", encoding="utf-8") as f:
        index = json.load(f)

    entries: list[dict] = index.get("indicators", []) or []
    # 재실행 시 중복되지 않도록 기존 AUCT_* 항목을 걷어내고 새로 넣는다.
    entries = [e for e in entries if not str(e.get("code", "")).startswith("AUCT_")]

    for code, payload in sorted(payloads.items()):
        entry = {
            "code":     code,
            "name":     payload["name"],
            "unit":     payload["unit"],
            "category": payload["category"],
            "exclude_assessment": True,
        }
        if "current" in payload:
            entry["current"] = payload["current"]
        entries.append(entry)

    index["indicators"] = entries
    _write_json(INDEX_PATH, index)


def main() -> int:
    print("TreasuryDirect 입찰 결과 수집 중...")
    raw = fetch_raw()
    if not raw:
        # 수집 실패가 파이프라인 전체를 막지 않도록 한다 — 기존 데이터는 그대로 둔다.
        print("입찰 데이터를 가져오지 못했다. 기존 파일을 유지하고 종료한다.", file=sys.stderr)
        return 1

    records = normalize(raw)
    print(f"대상 만기({', '.join(TENORS.values())}) 레코드: {len(records)}건")
    if not records:
        print("대상 만기에 해당하는 레코드가 없다. 필드명/만기 표기를 확인해야 한다.", file=sys.stderr)
        return 1

    _write_json(AUCTIONS_DIR / "records.json", {
        "last_updated": records[-1]["date"],
        "count":        len(records),
        "records":      records,
    })

    payloads = build_indicator_payloads(records)
    if not payloads:
        print("파생 시계열을 만들지 못했다.", file=sys.stderr)
        return 1

    for code, payload in payloads.items():
        _write_json(INDICATORS_DIR / f"{code}.json", payload)
    merge_into_index(payloads)

    print(f"Done. 입찰 기록 {len(records)}건 → 파생 지표 {len(payloads)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
