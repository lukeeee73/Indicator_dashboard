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
FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
FISCAL_PAGE_SIZE = 5000
TIMEOUT = 30

# TreasuryDirect 의 공개 문서가 얕아서 어떤 엔드포인트가 우리가 원하는 만기를
# 충분히 돌려주는지 미리 단정할 수 없다. 그래서 후보를 전부 때려보고 결과를
# (cusip, auctionDate) 기준으로 합친다 — 하나가 비어도 나머지로 메워진다.
# 2Y·10Y 는 Note, 30Y 는 Bond 로 분류된다.
CANDIDATE_URLS: list[str] = [
    f"{BASE}/auctioned?format=json&pagesize=10000",
    f"{BASE}/auctioned?format=json&type=Note&pagesize=10000",
    f"{BASE}/auctioned?format=json&type=Bond&pagesize=10000",
    f"{BASE}/auctioned?format=json",
]

# TIPS 와 FRN 은 securityTerm 이 명목채와 똑같다("10-Year" 등). 그런데 auctioned
# 목록에서는 securityType 이 다 "Note" 로 와서 필드만으로는 구분이 안 된다.
# 섞이면 시계열이 망가진다 — 10년 TIPS 는 실질금리라 낙찰금리가 명목의 절반이고
# 발행액도 절반이며, FRN 은 낙찰금리 자체가 없다.
# 그래서 API 에 TIPS·FRN 목록을 따로 물어 CUSIP 집합을 만들고 제외한다.
# 분류를 우리가 추측하지 않고 API 가 하도록 맡기는 방식.
EXCLUDE_URLS: list[str] = [
    f"{BASE}/auctioned?format=json&type=TIPS&pagesize=10000",
    f"{BASE}/auctioned?format=json&type=FRN&pagesize=10000",
]

# 수집 대상 만기. 2Y 는 정책금리 기대에 좌우되는 대조군이고,
# 10Y·30Y 가 재정 리스크가 실제로 드러나는 구간이다.
TENORS: dict[str, str] = {
    "2-Year":  "2Y",
    "10-Year": "10Y",
    "30-Year": "30Y",
}

# 필드명 후보. TreasuryDirect 는 camelCase, Fiscal Data 는 snake_case 를 쓰므로
# 둘 다 등록해 두고 먼저 잡히는 것을 쓴다.
# 이렇게 하면 두 소스가 **같은 normalize() 를 통과**하게 되어, 정의가 어긋날
# 여지가 원천적으로 없어진다 (분모·단위·날짜 형식이 한 곳에서만 결정된다).
FIELD_CANDIDATES: dict[str, tuple[str, ...]] = {
    "auction_date": ("auctionDate", "auction_date"),
    "term":         ("securityTerm", "security_term",
                     "originalSecurityTerm", "original_security_term"),
    "type":         ("securityType", "security_type"),
    "cusip":        ("cusip",),
    "btc":          ("bidToCoverRatio", "bid_to_cover_ratio"),
    "indirect":     ("indirectBidderAccepted", "indirect_bidder_accepted"),
    "direct":       ("directBidderAccepted", "direct_bidder_accepted"),
    "dealer":       ("primaryDealerAccepted", "primary_dealer_accepted"),
    "offering":     ("offeringAmount", "offering_amount"),
    "high_yield":   ("highYield", "high_yield", "highDiscountRate", "high_discount_rate"),
    # 아래 셋은 정합성 검증·필터용 (실제 응답에서 존재를 확인한 필드들)
    "tips":         ("tips",),
    "floating":     ("floatingRate", "floating_rate"),
    "competitive":  ("competitiveAccepted", "competitive_accepted"),
}


def _is_truthy_flag(val: Any) -> bool:
    """API 가 'Yes'/'No' 또는 true/false 로 주는 플래그를 관대하게 해석."""
    if val is None:
        return False
    return str(val).strip().lower() in ("yes", "y", "true", "1")


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
    """후보 URL 을 모두 시도해 결과를 합친다. (cusip, auctionDate) 로 중복 제거."""
    merged: dict[tuple, dict] = {}
    schema_logged = False

    for url in CANDIDATE_URLS:
        print(f"Trying {url} ...", end=" ", flush=True)
        try:
            resp = requests.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
        except requests.RequestException as e:
            print(f"FAILED (network: {e})")
            continue
        except ValueError as e:
            print(f"FAILED (JSON 파싱: {e})")
            continue

        if not isinstance(payload, list) or not payload:
            print(f"EMPTY (type={type(payload).__name__})")
            continue

        added = 0
        for rec in payload:
            if not isinstance(rec, dict):
                continue
            key = (rec.get("cusip"), rec.get("auctionDate"), rec.get("securityTerm"))
            if key not in merged:
                merged[key] = rec
                added += 1
        print(f"OK ({len(payload)} records, 신규 {added}건)")

        # 스키마가 바뀌었을 때 바로 알아채도록 첫 레코드의 키를 한 번만 남긴다.
        if not schema_logged:
            print(f"  응답 필드: {sorted(payload[0].keys())}")
            schema_logged = True

    if not merged:
        print("모든 후보 URL 에서 입찰 기록을 얻지 못했다.", file=sys.stderr)
        return []

    print(f"합계 {len(merged)}건 (중복 제거 후)")
    return list(merged.values())


def fetch_excluded_cusips() -> set[str]:
    """TIPS·FRN 의 CUSIP 집합. 명목채 시계열에서 걸러내기 위해 API 에 직접 묻는다."""
    excluded: set[str] = set()
    for url in EXCLUDE_URLS:
        print(f"제외 목록 {url} ...", end=" ", flush=True)
        try:
            resp = requests.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
        except (requests.RequestException, ValueError) as e:
            print(f"FAILED ({e})")
            continue

        if not isinstance(payload, list):
            print(f"EMPTY (type={type(payload).__name__})")
            continue

        found = {rec["cusip"] for rec in payload
                 if isinstance(rec, dict) and rec.get("cusip")}
        excluded |= found
        print(f"OK ({len(found)} CUSIP)")

    if not excluded:
        # 제외 목록을 못 받으면 TIPS·FRN 이 명목채 시계열에 섞인다.
        print("경고: TIPS/FRN CUSIP 목록을 받지 못했다. 시계열이 오염될 수 있다.",
              file=sys.stderr)
    return excluded


def normalize(raw: list[dict], excluded_cusips: set[str] | None = None,
              source: str = "treasurydirect") -> list[dict]:
    """원본 레코드에서 필요한 필드만 뽑아 정규화. 대상 만기의 명목채만 남긴다.

    TreasuryDirect(camelCase)와 Fiscal Data(snake_case)가 **모두 이 함수를**
    통과한다. 분모·단위·날짜 형식이 여기서만 결정되므로 두 소스의 정의가
    어긋날 수 없다.
    """
    excluded_cusips = excluded_cusips or set()
    out: list[dict] = []
    skipped_no_date = 0
    skipped_no_btc = 0
    skipped_linker = 0
    denom_mismatch = 0

    for rec in raw:
        term = _pick(rec, "term")
        if term not in TENORS:
            continue

        # TIPS·FRN 제외 — 만기 표기가 명목채와 같아서 여기서 안 걸러내면 섞인다.
        # 두 겹으로 막는다: 레코드 자체의 tips/floatingRate 플래그(실제 응답에
        # 존재함을 확인) + API 가 분류해 준 CUSIP 제외 목록.
        # 어느 한쪽이 없거나 소스가 달라도 나머지가 걸러 준다.
        if (_is_truthy_flag(_pick(rec, "tips"))
                or _is_truthy_flag(_pick(rec, "floating"))
                or _pick(rec, "cusip") in excluded_cusips):
            skipped_linker += 1
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

        # API 가 주는 competitiveAccepted 와 대조해 분모 정의가 맞는지 확인한다.
        # 두 소스가 이 값을 다르게 정의하면 indirect 비중이 소리 없이 어긋나므로,
        # 어긋난 건수를 세어 로그로 드러낸다.
        reported = _as_float(_pick(rec, "competitive"))
        if competitive and reported and abs(competitive - reported) / reported > 0.01:
            denom_mismatch += 1

        out.append({
            "date":            date,
            "tenor":           TENORS[term],
            "cusip":           _pick(rec, "cusip"),
            "security_type":   _pick(rec, "type"),
            "source":          source,
            "bid_to_cover":    btc,
            "offering_amount": _as_float(_pick(rec, "offering")),
            "high_yield":      _as_float(_pick(rec, "high_yield")),
            "indirect_amount": indirect,
            "direct_amount":   direct,
            "dealer_amount":   dealer,
            "indirect_share":  (indirect / competitive * 100.0) if competitive and indirect is not None else None,
            "dealer_share":    (dealer   / competitive * 100.0) if competitive and dealer   is not None else None,
        })

    if skipped_no_date or skipped_no_btc or skipped_linker:
        print(f"  [{source}] 건너뜀: TIPS/FRN {skipped_linker}건, "
              f"날짜 없음 {skipped_no_date}건, 응찰률 없음 {skipped_no_btc}건")
    if denom_mismatch:
        print(f"  [{source}] 경고: 3분할 합계와 competitiveAccepted 가 1% 넘게 "
              f"어긋난 레코드 {denom_mismatch}건", file=sys.stderr)

    out.sort(key=lambda r: (r["date"], r["tenor"]))
    return out


# --------------------------------------------------------------------------
# Fiscal Data — 만기된 채권까지 포함한 전체 이력
# --------------------------------------------------------------------------
# TreasuryDirect 의 auctioned 목록은 "아직 살아 있는" 채권만 돌려준다. 그래서
# 만기 도래한 옛 10년물이 통째로 빠지고, 30년물만 과대 대표되는 생존 편향이
# 생긴다. Fiscal Data 의 auctions_query 는 만기된 것까지 보존하므로 이걸로
# 과거 구간을 메운다.
# 데이터셋 경로도 문서로 확정하지 못해 후보를 순서대로 시도한다.
FISCAL_ENDPOINTS: list[str] = [
    "/v1/accounting/od/auctions_query",
    "/v2/accounting/od/auctions_query",
    "/v1/accounting/od/auctions",
]


def _fetch_fiscal_endpoint(path: str, max_pages: int) -> list[dict]:
    """한 엔드포인트를 페이지 단위로 끝까지 받는다. 실패하면 빈 목록."""
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        url = (f"{FISCAL_BASE}{path}?sort=-auction_date"
               f"&page[size]={FISCAL_PAGE_SIZE}&page[number]={page}")
        try:
            resp = requests.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
        except (requests.RequestException, ValueError) as e:
            if page == 1:
                print(f"  {path} 실패 ({e})")
            else:
                print(f"  {path} page {page} 실패 ({e}) — 여기까지만 사용")
            break

        rows = payload.get("data") if isinstance(payload, dict) else None
        if not rows:
            break
        out.extend(rows)

        if page == 1:
            print(f"  {path} OK — 응답 필드: {sorted(rows[0].keys())}")

        meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
        total_pages = meta.get("total-pages")
        if isinstance(total_pages, int) and page >= total_pages:
            break
    return out


def fetch_fiscaldata(max_pages: int = 40) -> list[dict]:
    """Fiscal Data 입찰 데이터셋 전체 이력. 후보 엔드포인트 중 되는 것을 쓴다."""
    for path in FISCAL_ENDPOINTS:
        rows = _fetch_fiscal_endpoint(path, max_pages)
        if rows:
            print(f"Fiscal Data 합계 {len(rows)}건 ({path})")
            return rows
    print("Fiscal Data 후보 엔드포인트가 모두 실패했다.", file=sys.stderr)
    return []


def merge_sources(primary: list[dict], secondary: list[dict]) -> tuple[list[dict], dict]:
    """두 소스를 합치고, 겹치는 구간이 실제로 일치하는지 감사한다.

    - 키는 (cusip, date). 같은 입찰이면 두 소스에서 같은 CUSIP·같은 날짜로 온다.
    - 겹칠 때는 primary(TreasuryDirect — 이미 검증한 쪽)를 남기고,
      secondary 는 primary 에 없는 구간만 메운다.
    - 겹치는 구간의 응찰률·indirect 비중을 대조해 불일치를 집계한다.
      숫자가 어긋난 채로 이어 붙이면 시계열에 가짜 단차가 생기기 때문에,
      이 감사 결과를 결과 파일에 남겨 눈으로 확인할 수 있게 한다.
    """
    by_key = {(r["cusip"], r["date"]): r for r in primary}

    overlap = 0
    btc_mismatch: list[dict] = []
    share_mismatch: list[dict] = []
    added = 0

    for rec in secondary:
        key = (rec["cusip"], rec["date"])
        base = by_key.get(key)
        if base is None:
            by_key[key] = rec
            added += 1
            continue

        overlap += 1
        a, b = base["bid_to_cover"], rec["bid_to_cover"]
        if a is not None and b is not None and abs(a - b) > 0.01:
            btc_mismatch.append({"cusip": rec["cusip"], "date": rec["date"],
                                 "treasurydirect": a, "fiscaldata": b})

        a, b = base["indirect_share"], rec["indirect_share"]
        if a is not None and b is not None and abs(a - b) > 0.5:
            share_mismatch.append({"cusip": rec["cusip"], "date": rec["date"],
                                   "treasurydirect": round(a, 2),
                                   "fiscaldata": round(b, 2)})

    merged = sorted(by_key.values(), key=lambda r: (r["date"], r["tenor"]))

    audit = {
        "overlap_records":     overlap,
        "filled_from_fiscal":  added,
        "btc_mismatch":        len(btc_mismatch),
        "indirect_mismatch":   len(share_mismatch),
        "btc_mismatch_sample":      btc_mismatch[:5],
        "indirect_mismatch_sample": share_mismatch[:5],
    }

    print(f"병합: 겹침 {overlap}건, Fiscal Data 로 메움 {added}건 → 총 {len(merged)}건")
    if btc_mismatch or share_mismatch:
        print(f"  경고: 겹치는 구간 불일치 — 응찰률 {len(btc_mismatch)}건, "
              f"indirect 비중 {len(share_mismatch)}건", file=sys.stderr)
        for m in (btc_mismatch + share_mismatch)[:5]:
            print(f"    {m}", file=sys.stderr)
    elif overlap:
        print(f"  겹치는 {overlap}건 모두 두 소스의 값이 일치")

    return merged, audit


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

    excluded = fetch_excluded_cusips()
    records = normalize(raw, excluded, source="treasurydirect")
    print(f"대상 만기({', '.join(TENORS.values())}) 명목채 레코드: {len(records)}건")
    if not records:
        # 만기 표기가 예상과 다르면 여기서 걸린다 — 실제로 어떤 값이 왔는지 남긴다.
        seen = sorted({str(r.get("securityTerm")) for r in raw if isinstance(r, dict)})
        print(f"대상 만기에 해당하는 레코드가 없다. 응답의 securityTerm 값: {seen[:40]}",
              file=sys.stderr)
        return 1

    # 낙찰 배분 필드가 실제로 왔는지 확인 — 안 왔으면 indirect 계열이 통째로 빈다.
    with_share = sum(1 for r in records if r["indirect_share"] is not None)
    print(f"  낙찰 3분할이 있는 레코드: {with_share}/{len(records)}건")
    if with_share == 0:
        sample = next((r for r in raw if isinstance(r, dict)), {})
        print("  경고: indirect/direct/primaryDealer 필드를 못 찾았다. "
              f"응답 필드명 확인 필요 → {sorted(sample.keys())}", file=sys.stderr)

    # ── Fiscal Data 로 과거 구간 메우기 ────────────────────────────────
    print("\nFiscal Data 로 과거 이력 보강 중...")
    fiscal_raw = fetch_fiscaldata()
    audit: dict = {"fiscal_raw_count": len(fiscal_raw)}
    if fiscal_raw:
        # 같은 normalize() 를 통과시킨다 — 분모·단위·날짜 정의가 동일해진다.
        fiscal_records = normalize(fiscal_raw, excluded, source="fiscaldata")
        print(f"Fiscal Data 명목채 레코드: {len(fiscal_records)}건")
        records, merge_audit = merge_sources(records, fiscal_records)
        audit.update(merge_audit)
    else:
        print("Fiscal Data 없이 TreasuryDirect 만으로 진행한다.", file=sys.stderr)

    by_source = {}
    for r in records:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    audit["by_source"] = by_source

    # 진단 정보를 파일에 같이 남긴다 — 스키마가 바뀌었을 때 Actions 로그를 뒤지지
    # 않고 결과물만 보고도 원인을 알 수 있도록.
    sample = next((r for r in raw if isinstance(r, dict)), {})
    _write_json(AUCTIONS_DIR / "records.json", {
        "last_updated":     records[-1]["date"],
        "count":            len(records),
        "raw_count":        len(raw),
        "excluded_cusips":  len(excluded),
        "source_fields":    sorted(sample.keys()),
        "consistency":      audit,
        "records":          records,
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
