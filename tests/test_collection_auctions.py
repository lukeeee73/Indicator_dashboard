"""Offline auction fetch fallbacks and unchanged collector JSON output."""

import copy
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from scripts import data_io, fetch_auctions


def response(payload):
    result = Mock()
    result.json.return_value = payload
    return result


def auction_record(**updates):
    return {
        "cusip": "A",
        "auctionDate": "2026-01-01T00:00:00",
        "securityTerm": "10-Year",
        "securityType": "Note",
        "bidToCoverRatio": "2.5",
        "indirectBidderAccepted": "60",
        "directBidderAccepted": "25",
        "primaryDealerAccepted": "15",
        **updates,
    }


class AuctionCollectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(
            patch.multiple(
                fetch_auctions,
                DATA_DIR=self.root,
                INDEX_PATH=self.root / "index.json",
                INDICATORS_DIR=self.root / "indicators",
                AUCTIONS_DIR=self.root / "auctions",
            )
        )
        self.enterContext(redirect_stdout(StringIO()))
        self.enterContext(redirect_stderr(StringIO()))

    def test_candidate_failures_continue_and_first_duplicate_wins(self):
        first = auction_record()
        duplicate = auction_record(bidToCoverRatio="9")
        other = auction_record(cusip="B")
        with patch.object(
            fetch_auctions.requests,
            "get",
            side_effect=[
                requests.Timeout("offline"),
                response([first]),
                response([duplicate, other]),
                response({}),
            ],
        ) as get:
            self.assertEqual(fetch_auctions.fetch_raw(), [first, other])
        self.assertEqual(
            [entry.args[0] for entry in get.call_args_list], fetch_auctions.CANDIDATE_URLS
        )
        self.assertTrue(
            all(entry.kwargs == {"timeout": fetch_auctions.TIMEOUT} for entry in get.call_args_list)
        )

    def test_fiscal_paging_preserves_partial_results_and_endpoint_fallback(self):
        rows = [auction_record()]
        with patch.object(
            fetch_auctions.requests,
            "get",
            side_effect=[
                response({"data": rows, "meta": {"total-pages": 3}}),
                requests.Timeout("offline"),
            ],
        ):
            self.assertEqual(fetch_auctions._fetch_fiscal_endpoint("/test", 40), rows)
        with patch.object(
            fetch_auctions, "_fetch_fiscal_endpoint", side_effect=[[], rows]
        ) as fetch:
            self.assertEqual(fetch_auctions.fetch_fiscaldata(3), rows)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args.args, (fetch_auctions.FISCAL_ENDPOINTS[1], 3))

    def test_primary_only_pipeline_preserves_records_derived_files_and_index(self):
        raw = [auction_record()]
        before = copy.deepcopy(raw)
        data_io.write_json(
            fetch_auctions.INDEX_PATH,
            {
                "last_updated": "keep",
                "assessment": {"q": 1},
                "indicators": [{"code": "OTHER"}, {"code": "AUCT_OLD"}],
            },
        )
        with patch.object(fetch_auctions, "fetch_raw", return_value=raw), patch.object(
            fetch_auctions, "fetch_excluded_cusips", return_value=set()
        ), patch.object(fetch_auctions, "fetch_fiscaldata", return_value=[]), patch.object(
            fetch_auctions, "compute_current_stats", return_value={"value": 2.5}
        ):
            self.assertEqual(fetch_auctions.main(), 0)
        records = data_io.read_json(fetch_auctions.AUCTIONS_DIR / "records.json")
        self.assertEqual(
            records,
            {
                "last_updated": "2026-01-01",
                "count": 1,
                "raw_count": 1,
                "excluded_cusips": 0,
                "source_fields": sorted(raw[0]),
                "consistency": {"fiscal_raw_count": 0, "by_source": {"treasurydirect": 1}},
                "records": [
                    {
                        "date": "2026-01-01",
                        "tenor": "10Y",
                        "cusip": "A",
                        "security_type": "Note",
                        "source": "treasurydirect",
                        "bid_to_cover": 2.5,
                        "offering_amount": None,
                        "high_yield": None,
                        "indirect_amount": 60.0,
                        "direct_amount": 25.0,
                        "dealer_amount": 15.0,
                        "indirect_share": 60.0,
                        "dealer_share": 15.0,
                    }
                ],
            },
        )
        indicator = data_io.read_json(fetch_auctions.INDICATORS_DIR / "AUCT_BTC_10Y.json")
        self.assertEqual(
            indicator,
            {
                "name": "Auction Bid-to-Cover (10Y)",
                "unit": "ratio",
                "category": "dollar",
                "exclude_assessment": True,
                "series": [{"date": "2026-01-01", "value": 2.5}],
                "current": {"value": 2.5},
            },
        )
        index = data_io.read_json(fetch_auctions.INDEX_PATH)
        self.assertEqual(index["last_updated"], "keep")
        self.assertEqual(index["assessment"], {"q": 1})
        self.assertEqual(
            [entry["code"] for entry in index["indicators"]],
            ["OTHER", "AUCT_BTC_10Y", "AUCT_IND_10Y"],
        )
        payloads = {
            path.stem: data_io.read_json(path)
            for path in fetch_auctions.INDICATORS_DIR.glob("*.json")
        }
        fetch_auctions.merge_into_index(payloads)
        self.assertEqual(data_io.read_json(fetch_auctions.INDEX_PATH), index)
        self.assertEqual(raw, before)

    def test_total_failure_preserves_files_and_missing_index_is_nonfatal(self):
        data_io.write_json(fetch_auctions.INDEX_PATH, {"keep": "기존"})
        before = fetch_auctions.INDEX_PATH.read_bytes()
        with patch.object(fetch_auctions, "fetch_raw", return_value=[]), patch.object(
            fetch_auctions, "fetch_fiscaldata"
        ) as secondary:
            self.assertEqual(fetch_auctions.main(), 1)
        secondary.assert_not_called()
        self.assertEqual(fetch_auctions.INDEX_PATH.read_bytes(), before)
        self.assertEqual(list(self.root.iterdir()), [fetch_auctions.INDEX_PATH])
        fetch_auctions.INDEX_PATH.unlink()
        fetch_auctions.merge_into_index({})
        self.assertFalse(fetch_auctions.INDEX_PATH.exists())


if __name__ == "__main__":
    unittest.main()
