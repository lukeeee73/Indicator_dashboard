"""Supabase collection contracts verified with local JSON and mock clients only."""

import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, call, patch

from scripts import data_io, sync_supabase


class SupabaseCollectionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(sync_supabase, "DATA_ROOT", self.root))

    def test_series_metadata_and_observations_keep_group_precedence_and_index_current(self):
        point = [{"date": "2026-01-01", "value": 4}]
        data_io.write_json(self.root / "assets" / "DGS10.json", {"name": "Asset", "series": []})
        data_io.write_json(
            self.root / "indices" / "CUSTOM.json", {"description": "설명", "series": []}
        )
        data_io.write_json(
            self.root / "stocks" / "A.json",
            {"name": "Stock", "current": {"ignored": True}, "financials": {}, "series": point},
        )
        data_io.write_json(
            self.root / "indicators" / "DGS10.json",
            {
                "name": "Indicator",
                "unit": "percent",
                "category": "dollar",
                "region": "KR",
                "current": {"value": 4},
                "series": point,
            },
        )
        index = {
            "assets": [{"code": "DGS10"}],
            "indices": [{"code": "^I", "filename": "CUSTOM", "name": "Index"}],
            "stocks": [
                {
                    "code": "A",
                    "sector": "Technology",
                    "group": "기업",
                    "valuation_summary": {"fair_value": 5},
                    "competitors_in_watchlist": [],
                }
            ],
            "indicators": [{"code": "DGS10", "exclude_assessment": True}],
        }
        metadata, observations, counts = sync_supabase.build_series_data(index, "timestamp")
        self.assertEqual(
            metadata,
            [
                {
                    "code": "DGS10",
                    "name": "Indicator",
                    "kind": "indicator",
                    "category": "dollar",
                    "unit": "percent",
                    "region": "KR",
                    "source": "FRED",
                    "exclude_assessment": True,
                    "current_data": {"value": 4},
                    "sector": None,
                    "group_name": None,
                    "details": None,
                    "updated_at": "timestamp",
                },
                {
                    "code": "^I",
                    "name": "Index",
                    "kind": "index",
                    "category": None,
                    "unit": None,
                    "region": "US",
                    "source": "yahoo",
                    "exclude_assessment": False,
                    "current_data": None,
                    "sector": None,
                    "group_name": None,
                    "details": {"description": "설명"},
                    "updated_at": "timestamp",
                },
                {
                    "code": "A",
                    "name": "Stock",
                    "kind": "stock",
                    "category": None,
                    "unit": None,
                    "region": "US",
                    "source": "yahoo",
                    "exclude_assessment": False,
                    "current_data": {
                        "valuation_summary": {"fair_value": 5},
                        "competitors_in_watchlist": [],
                    },
                    "sector": "Technology",
                    "group_name": "기업",
                    "details": {"financials": {}},
                    "updated_at": "timestamp",
                },
            ],
        )
        self.assertEqual(observations, {"DGS10": point, "^I": [], "A": point})
        self.assertEqual(counts, {"assets": 1, "indices": 1, "stocks": 1, "indicators": 1})

    def test_invalid_group_and_series_raise_the_existing_diagnostics(self):
        with self.assertRaisesRegex(TypeError, "index.json의 assets가 배열이 아닙니다"):
            sync_supabase.build_series_data({"assets": {}}, "timestamp")
        data_io.write_json(self.root / "assets" / "A.json", {"series": None})
        with self.assertRaisesRegex(TypeError, "assets/A.json의 series가 배열이 아닙니다"):
            sync_supabase.build_series_data({"assets": [{"code": "A"}]}, "timestamp")

    def test_metadata_batches_keep_500_row_limit_conflict_key_and_failure_propagation(self):
        rows = [{"code": str(index)} for index in range(501)]
        client = Mock()
        sync_supabase.sync_series_metadata(client, rows)
        self.assertEqual(client.table.call_args_list, [call("series"), call("series")])
        self.assertEqual(
            client.table.return_value.upsert.call_args_list,
            [
                call(rows[:500], on_conflict="code"),
                call(rows[500:], on_conflict="code"),
            ],
        )
        self.assertEqual(client.table.return_value.upsert.return_value.execute.call_count, 2)
        client.reset_mock()
        sync_supabase.sync_series_metadata(client, [])
        client.table.assert_not_called()
        client.table.return_value.upsert.return_value.execute.side_effect = RuntimeError(
            "remote failure"
        )
        with self.assertRaisesRegex(RuntimeError, "remote failure"):
            sync_supabase.sync_series_metadata(client, rows)
        self.assertEqual(client.table.call_count, 1)

    def test_incremental_and_full_sync_keep_inclusive_lookback_and_missing_value_filter(self):
        points = [
            {"date": "2026-01-01", "value": 1},
            {"date": "2026-01-02", "value": 0},
            {"date": "2026-01-03", "value": None},
            {"value": 3},
        ]
        for full, expected in ((False, points[1:2]), (True, points[:2])):
            with self.subTest(full=full), patch.multiple(
                sync_supabase, FORCE_FULL_SYNC=full, LOOKBACK_DAYS=1
            ), patch.object(
                sync_supabase, "latest_observed_at", return_value=date(2026, 1, 3)
            ) as latest, redirect_stdout(
                StringIO()
            ):
                client = Mock()
                self.assertEqual(
                    sync_supabase.sync_observations(client, {"A": points}), len(expected)
                )
                client.table.assert_called_once_with("observations")
                client.table.return_value.upsert.assert_called_once_with(
                    [
                        {"series_code": "A", "observed_at": point["date"], "value": point["value"]}
                        for point in expected
                    ],
                    on_conflict="series_code,observed_at",
                )
                self.assertEqual(latest.call_count, 0 if full else 1)

    def test_latest_observation_query_keeps_filter_order_limit_and_empty_result(self):
        client = Mock()
        query = (
            client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
        )
        query.execute.return_value.data = [{"observed_at": "2026-01-03"}]
        self.assertEqual(sync_supabase.latest_observed_at(client, "A"), date(2026, 1, 3))
        client.table.assert_called_once_with("observations")
        client.table.return_value.select.assert_called_once_with("observed_at")
        client.table.return_value.select.return_value.eq.assert_called_once_with("series_code", "A")
        client.table.return_value.select.return_value.eq.return_value.order.assert_called_once_with(
            "observed_at", desc=True
        )
        client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.assert_called_once_with(
            1
        )
        query.execute.return_value.data = []
        self.assertIsNone(sync_supabase.latest_observed_at(client, "A"))

    def test_documents_skip_retired_timeline_and_keep_stock_notes_news_and_conflict_keys(self):
        paths = [
            "principles/timeline.json",
            "value_screen.json",
            "wiki/graph.json",
            "markets/us/nested.json",
            "markets/au.json",
            "wiki/notes/note.json",
            "news/B/2026-01-02.json",
            "news/A/2026-01-01.json",
        ]
        for path in paths:
            data_io.write_json(self.root / path, {"file": path})
        client = Mock()
        self.assertEqual(sync_supabase.sync_documents(client, "timestamp"), 5)
        client.table.assert_called_once_with("documents")
        specs = [
            ("value_screen", "latest", paths[1]),
            ("wiki", "graph", paths[2]),
            ("market", "au", paths[4]),
            ("market", "us/nested", paths[3]),
            ("wiki_note", "note", paths[5]),
        ]
        client.table.return_value.upsert.assert_called_once_with(
            [
                {"kind": kind, "key": key, "payload": {"file": path}, "updated_at": "timestamp"}
                for kind, key, path in specs
            ],
            on_conflict="kind,key",
        )
        client.reset_mock()
        self.assertEqual(sync_supabase.sync_news(client, "timestamp"), 2)
        client.table.assert_called_once_with("news")
        client.table.return_value.upsert.assert_called_once_with(
            [
                {
                    "ticker": ticker,
                    "date": date_text,
                    "payload": {"file": path},
                    "updated_at": "timestamp",
                }
                for ticker, date_text, path in (
                    ("A", "2026-01-01", paths[7]),
                    ("B", "2026-01-02", paths[6]),
                )
            ],
            on_conflict="ticker,date",
        )

    def test_empty_or_invalid_documents_and_news_never_start_upserts(self):
        client = Mock()
        self.assertEqual(sync_supabase.sync_documents(client, "timestamp"), 0)
        self.assertEqual(sync_supabase.sync_news(client, "timestamp"), 0)
        client.table.assert_not_called()
        for sync, path in (
            (sync_supabase.sync_documents, "value_screen.json"),
            (sync_supabase.sync_news, "news/A/2026-01-01.json"),
        ):
            with self.subTest(path=path):
                data_io.write_json(self.root / path, [])
                with self.assertRaises(TypeError):
                    sync(client, "timestamp")
                client.table.assert_not_called()

    def test_client_env_contract_and_missing_timestamp_fail_before_connection(self):
        with patch.dict(
            sync_supabase.os.environ,
            {"SUPABASE_URL": "https://example.invalid", "SUPABASE_SECRET_KEY": "offline"},
            clear=True,
        ), patch.object(sync_supabase, "create_client") as create:
            self.assertIs(sync_supabase.connect_supabase(), create.return_value)
            create.assert_called_once_with("https://example.invalid", "offline")
        with patch.dict(sync_supabase.os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "필수 환경변수가 없습니다: SUPABASE_URL"):
                sync_supabase.connect_supabase()
        with patch.object(sync_supabase, "read_json", return_value={}), patch.object(
            sync_supabase, "connect_supabase"
        ) as connect, redirect_stdout(StringIO()):
            with self.assertRaisesRegex(RuntimeError, "index.json에 last_updated가 없습니다"):
                sync_supabase.main()
            connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
