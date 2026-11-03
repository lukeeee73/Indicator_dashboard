"""FRED/Yahoo collection and split-store regressions; every provider is mocked."""

import copy
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, call, patch

import pandas as pd
import requests

from scripts import data_io, fetch_fred


class PriceCollectionTests(unittest.TestCase):
    def test_yahoo_fetchers_keep_history_options_and_price_conversion(self):
        history = pd.DataFrame(
            {"Close": [3.456, "bad", float("nan"), None, 1.234]},
            index=pd.to_datetime(
                ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-01"], utc=True
            ),
        )
        before = history.copy(deep=True)
        for fetcher, options in (
            (
                fetch_fred.fetch_yahoo_monthly,
                {"period": "max", "interval": "1mo", "auto_adjust": True},
            ),
            (
                fetch_fred.fetch_yahoo_stock,
                {"period": "10y", "interval": "1d", "auto_adjust": True},
            ),
            (
                fetch_fred.fetch_yahoo_index,
                {"period": "20y", "interval": "1d", "auto_adjust": False},
            ),
        ):
            with self.subTest(fetcher=fetcher.__name__), patch("yfinance.Ticker") as ticker:
                ticker.return_value.history.return_value = history
                self.assertEqual(
                    fetcher("SYMBOL"),
                    [{"date": "2026-02-01", "value": 1.23}, {"date": "2026-02-02", "value": 3.46}],
                )
                ticker.assert_called_once_with("SYMBOL")
                ticker.return_value.history.assert_called_once_with(**options)
        pd.testing.assert_frame_equal(history, before)

    def test_yahoo_empty_missing_close_and_provider_errors_preserve_contract(self):
        for fetcher in (
            fetch_fred.fetch_yahoo_monthly,
            fetch_fred.fetch_yahoo_stock,
            fetch_fred.fetch_yahoo_index,
        ):
            with self.subTest(fetcher=fetcher.__name__), patch("yfinance.Ticker") as ticker:
                for history in (
                    pd.DataFrame(),
                    pd.DataFrame({"Open": [1]}, index=pd.to_datetime(["2026-01-01"])),
                ):
                    ticker.return_value.history.return_value = history
                    self.assertEqual(fetcher("X"), [])
                ticker.return_value.history.side_effect = RuntimeError("provider error")
                with self.assertRaisesRegex(RuntimeError, "provider error"):
                    fetcher("X")

    def test_fred_request_and_missing_observation_filtering(self):
        response = Mock()
        response.json.return_value = {
            "observations": [
                {"date": "2026-01-01", "value": "1.25"},
                *({"date": "ignored", "value": value} for value in (".", None, "", "bad", [])),
                {"date": "2026-02-01", "value": 0},
            ]
        }
        with patch.object(fetch_fred.requests, "get", return_value=response) as get:
            self.assertEqual(
                fetch_fred.fetch_series("CODE", "test-key", "1900-01-01"),
                [
                    {"date": "2026-01-01", "value": 1.25},
                    {"date": "2026-02-01", "value": 0.0},
                ],
            )
        get.assert_called_once_with(
            fetch_fred.FRED_BASE_URL,
            params={
                "series_id": "CODE",
                "api_key": "test-key",
                "file_type": "json",
                "observation_start": "1900-01-01",
            },
            timeout=fetch_fred.REQUEST_TIMEOUT,
        )
        response.raise_for_status.assert_called_once_with()

    def test_collection_isolates_network_and_transform_failures_and_counts_empty_success(self):
        raw = [{"date": "2026-01-01", "value": 2_000_000}]
        meta = {
            "name": "지표",
            "unit": "trillion",
            "category": "dollar",
            "region": "KR",
            "exclude_assessment": True,
        }
        group = {
            "OK": {**meta, "transform": "million_to_trillion"},
            "NETWORK": meta,
            "UNKNOWN": {**meta, "transform": "unknown"},
            "EMPTY": meta,
        }
        before = copy.deepcopy(group)
        with patch.object(
            fetch_fred, "fetch_series", side_effect=[raw, requests.Timeout("timeout"), raw, []]
        ), redirect_stdout(StringIO()) as log:
            result, count = fetch_fred.collect_group(group, "key", "indicator")
        self.assertEqual(count, 2)
        self.assertEqual(
            result,
            {
                "OK": {**meta, "series": [{"date": "2026-01-01", "value": 2.0}]},
                "EMPTY": {**meta, "series": []},
            },
        )
        self.assertEqual(group, before)
        self.assertIn("FAILED (network: timeout)", log.getvalue())
        self.assertIn("FAILED (unexpected: unknown transform: unknown)", log.getvalue())


class SplitStoreCollectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        paths = {
            "DATA_DIR": self.root,
            "INDEX_PATH": self.root / "index.json",
            "LEGACY_BUNDLE_PATH": self.root / "indicators.json",
        }
        paths.update(
            {
                f"{name.upper()}_DIR": self.root / name
                for name in ("indicators", "assets", "stocks", "indices")
            }
        )
        self.enterContext(patch.multiple(fetch_fred, **paths))

    def test_split_store_roundtrip_preserves_index_shape_and_cleans_stale_files(self):
        point = [{"date": "2026-01-01", "value": 1}]
        output = {
            "last_updated": "2026-01-01T00:00:00Z",
            "indicators": {
                "DGS10": {
                    "name": "금리",
                    "unit": "percent",
                    "category": "dollar",
                    "region": "US",
                    "exclude_assessment": True,
                    "current": {"value": 1},
                    "series": point,
                }
            },
            "assets": {"GOLD": {"name": "Gold", "unit": "usd", "series": point}},
            "stocks": {
                "AAPL": {
                    "name": "Apple",
                    "sector": "Technology",
                    "group": "기업",
                    "series": point,
                    "valuation": {
                        "as_of": "2026-01-01",
                        "current_price": 1,
                        "fair_value": 2,
                        "valuation_gap": -0.5,
                        "signal": "low",
                        "qualitative": {"narrative_score": 0.25, "as_of": "2025-12-31"},
                    },
                }
            },
            "indices": {"^TEST": {"name": "Index", "description": "설명", "series": point}},
            "assessment": {"quadrant": "Q1"},
            "assessment_kr": None,
        }
        before = copy.deepcopy(output)
        for directory in ("indicators", "assets", "stocks", "indices"):
            data_io.write_json(self.root / directory / "STALE.json", {})
        data_io.write_json(fetch_fred.LEGACY_BUNDLE_PATH, {})
        with patch.object(fetch_fred, "get_watchlist_competitors", return_value=["MSFT"]):
            fetch_fred.save_split_store(output)
        index = data_io.read_json(fetch_fred.INDEX_PATH)
        self.assertEqual(
            index,
            {
                "last_updated": output["last_updated"],
                "indicators": [
                    {
                        "code": "DGS10",
                        "name": "금리",
                        "unit": "percent",
                        "category": "dollar",
                        "region": "US",
                        "exclude_assessment": True,
                        "current": {"value": 1},
                    }
                ],
                "assets": [{"code": "GOLD", "name": "Gold", "unit": "usd"}],
                "stocks": [
                    {
                        "code": "AAPL",
                        "name": "Apple",
                        "sector": "Technology",
                        "group": "기업",
                        "competitors_in_watchlist": ["MSFT"],
                        "valuation_summary": {
                            "as_of": "2026-01-01",
                            "current_price": 1,
                            "fair_value": 2,
                            "valuation_gap": -0.5,
                            "signal": "low",
                            "narrative_score": 0.25,
                            "qualitative_as_of": "2025-12-31",
                        },
                    }
                ],
                "indices": [{"code": "^TEST", "filename": "TEST", "name": "Index"}],
                "assessment": {"quadrant": "Q1"},
                "assessment_kr": None,
            },
        )
        self.assertEqual(
            fetch_fred.load_split_store(),
            {
                key: value
                for key, value in output.items()
                if key not in ("assessment", "assessment_kr")
            },
        )
        self.assertEqual(output, before)
        self.assertFalse(fetch_fred.LEGACY_BUNDLE_PATH.exists())
        self.assertFalse(list(self.root.rglob("STALE.json")))

    def test_loader_skips_bad_payloads_and_honors_index_filenames_and_fallback(self):
        index = {
            "indicators": [{"code": "OK"}, {"code": "BAD"}, {"code": "MISSING"}, {}],
            "assets": [],
            "stocks": [],
            "indices": [{"code": "^A", "filename": "custom"}, {"code": "^B"}, {"code": ""}],
        }
        data_io.write_json(fetch_fred.INDEX_PATH, index)
        data_io.write_json(fetch_fred.INDICATORS_DIR / "OK.json", {})
        (fetch_fred.INDICATORS_DIR / "BAD.json").write_text("{", encoding="utf-8")
        for filename in ("custom", "B"):
            data_io.write_json(fetch_fred.INDICES_DIR / f"{filename}.json", {"name": filename})
        self.assertEqual(
            fetch_fred.load_split_store(),
            {
                "last_updated": None,
                "indicators": {"OK": {}},
                "assets": {},
                "stocks": {},
                "indices": {"^A": {"name": "custom"}, "^B": {"name": "B"}},
            },
        )
        data_io.write_json(fetch_fred.LEGACY_BUNDLE_PATH, {"indicators": {"OLD": {}}})
        fetch_fred.INDEX_PATH.write_text("{", encoding="utf-8")
        self.assertEqual(fetch_fred.load_split_store()["indicators"], {})
        fetch_fred.INDEX_PATH.unlink()
        self.assertEqual(fetch_fred.load_split_store(), {"indicators": {"OLD": {}}, "assets": {}})
        fetch_fred.LEGACY_BUNDLE_PATH.write_text("{", encoding="utf-8")
        self.assertEqual(
            fetch_fred.load_split_store(),
            {"last_updated": None, "indicators": {}, "assets": {}, "stocks": {}, "indices": {}},
        )


class FredPipelineCollectionTests(unittest.TestCase):
    def test_total_failure_keeps_existing_store_and_never_runs_enrichment_or_write(self):
        existing = {
            "indicators": {"OLD": {"series": [1]}},
            "assets": {},
            "stocks": {},
            "indices": {},
        }
        before = copy.deepcopy(existing)
        with patch.dict(fetch_fred.os.environ, {"FRED_API_KEY": "offline"}), patch.multiple(
            fetch_fred, STOCKS={}, INDICES={}
        ), patch.object(fetch_fred, "load_split_store", return_value=existing), patch.object(
            fetch_fred, "collect_group", return_value=({}, 0)
        ), patch.object(
            fetch_fred, "fetch_yahoo_monthly", return_value=[]
        ), patch.object(
            fetch_fred, "fetch_stooq_monthly", side_effect=RuntimeError("offline")
        ), patch.object(
            fetch_fred, "save_split_store"
        ) as save, patch.object(
            fetch_fred, "enrich_with_assessment"
        ) as enrich, redirect_stdout(
            StringIO()
        ), redirect_stderr(
            StringIO()
        ) as log:
            self.assertEqual(fetch_fred.main(), 2)
        save.assert_not_called()
        enrich.assert_not_called()
        self.assertEqual(existing, before)
        self.assertIn("기존 JSON을 덮어쓰지 않습니다", log.getvalue())

    def test_partial_success_keeps_old_series_and_gold_and_financial_fallbacks(self):
        point = [{"date": "2026-01-01", "value": 10}]
        existing = {
            "indicators": {"OLD": {"series": point}},
            "assets": {},
            "stocks": {},
            "indices": {"^OLD": {"series": point}},
        }
        stock_meta = {"name": "Stock", "sector": "Technology", "group": "기업"}
        with patch.dict(fetch_fred.os.environ, {"FRED_API_KEY": "offline"}), patch.multiple(
            fetch_fred, STOCKS={"A": stock_meta}, INDICES={}
        ), patch.object(fetch_fred, "load_split_store", return_value=existing), patch.object(
            fetch_fred, "collect_group", side_effect=[({"NEW": {"series": point}}, 1), ({}, 0)]
        ), patch.object(
            fetch_fred, "fetch_yahoo_monthly", side_effect=[[], [], point]
        ) as monthly, patch.object(
            fetch_fred, "fetch_stooq_monthly", return_value=[]
        ), patch.object(
            fetch_fred, "fetch_yahoo_stock", return_value=point
        ), patch.object(
            fetch_fred, "fetch_yahoo_financials", side_effect=RuntimeError("offline")
        ), patch.object(
            fetch_fred, "save_split_store"
        ) as save, patch.object(
            fetch_fred, "enrich_with_assessment"
        ), patch.object(
            fetch_fred, "enrich_stocks_with_valuation"
        ), patch.object(
            fetch_fred, "merge_qualitative_into_stocks"
        ), redirect_stdout(
            StringIO()
        ), redirect_stderr(
            StringIO()
        ):
            self.assertEqual(fetch_fred.main(), 0)
        output = save.call_args.args[0]
        self.assertEqual(output["indicators"], {"OLD": {"series": point}, "NEW": {"series": point}})
        self.assertEqual(output["indices"], existing["indices"])
        self.assertEqual(
            output["assets"]["GOLD"],
            {"name": "Gold (XAU/USD)", "unit": "usd_per_oz", "series": point},
        )
        self.assertEqual(
            output["stocks"]["A"],
            {**stock_meta, "series": point, "financials": {"snapshot": {}, "quarterly": []}},
        )
        self.assertEqual(monthly.call_args_list, [call("^KS11"), call("^KS11"), call("GC=F")])


if __name__ == "__main__":
    unittest.main()
