"""Offline regression coverage for collector JSON contracts and entrypoints."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import data_io, fetch_auctions, fetch_fred, merge_qualitative, sync_supabase

ROOT = Path(__file__).resolve().parents[1]


class CollectionJSONTests(unittest.TestCase):
    def test_writers_preserve_unicode_indentation_order_and_final_newline(self):
        payload = {"이름": "한국", "series": [{"date": "2026-01-01", "value": 0}], "empty": None}
        expected = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        with tempfile.TemporaryDirectory() as temp:
            for index, writer in enumerate(
                (data_io.write_json, fetch_fred.save_json, fetch_auctions._write_json)
            ):
                with self.subTest(writer=writer.__name__):
                    path = Path(temp) / str(index) / "nested" / "data.json"
                    writer(path, payload)
                    self.assertEqual(path.read_bytes(), expected)
                    self.assertEqual(data_io.read_json(path), payload)

    def test_readers_keep_their_distinct_missing_and_malformed_file_policies(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "data.json"
            for content, error in ((None, FileNotFoundError), ("{", json.JSONDecodeError)):
                with self.subTest(content=content):
                    if content is not None:
                        path.write_text(content, encoding="utf-8")
                    self.assertIsNone(fetch_fred._read_json(path))
                    self.assertIsNone(merge_qualitative._safe_load(path))
                    with self.assertRaises(error):
                        data_io.read_json(path)
                    with self.assertRaises(error):
                        sync_supabase.read_json(path)

    def test_only_sync_requires_a_json_object(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "data.json"
            for payload in ([], [1], "text", 0, None):
                with self.subTest(payload=payload):
                    data_io.write_json(path, payload)
                    self.assertEqual(data_io.read_json(path), payload)
                    self.assertEqual(fetch_fred._read_json(path), payload)
                    self.assertEqual(merge_qualitative._safe_load(path), payload)
                    with self.assertRaisesRegex(TypeError, "JSON 최상위 값이 객체가 아닙니다"):
                        sync_supabase.read_json(path)

    def test_unicode_errors_are_only_suppressed_by_qualitative_reader(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"
            path.write_bytes(b'"\xff"')
            self.assertIsNone(merge_qualitative._safe_load(path))
            for reader in (data_io.read_json, fetch_fred._read_json, sync_supabase.read_json):
                with self.subTest(reader=reader.__name__), self.assertRaises(UnicodeDecodeError):
                    reader(path)

    def test_writer_propagates_filesystem_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / "file"
            parent.write_text("keep", encoding="utf-8")
            for writer in (data_io.write_json, fetch_fred.save_json, fetch_auctions._write_json):
                with self.subTest(writer=writer.__name__), self.assertRaises(FileExistsError):
                    writer(parent / "data.json", {})
            self.assertEqual(parent.read_text(encoding="utf-8"), "keep")


class QualitativeCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.temp)
        self.enterContext(patch.object(merge_qualitative, "NEWS_DIR", self.root / "news"))
        self.enterContext(patch.object(merge_qualitative, "STOCKS_DIR", self.root / "stocks"))

    def test_latest_summary_and_history_keep_date_score_and_limit_rules(self):
        for day in range(1, 32):
            data_io.write_json(
                self.root / "news" / "A" / f"2026-01-{day:02d}.json",
                {
                    "narrative_score": day / 100,
                    "summary_kr": "요약",
                    "news": [1, 2],
                },
            )
        block = merge_qualitative.compute_qualitative_block("A")
        self.assertEqual(
            block,
            {
                "as_of": "2026-01-31",
                "narrative_score": 0.31,
                "summary_kr": "요약",
                "key_events": [],
                "risks": [],
                "news_count": 2,
                "competitor_context": [],
                "history": [
                    {"date": f"2026-01-{day:02d}", "narrative_score": day / 100}
                    for day in range(2, 32)
                ],
            },
        )
        latest = self.root / "news" / "A" / "2026-01-31.json"
        latest.write_text("{", encoding="utf-8")
        self.assertIsNone(merge_qualitative.compute_qualitative_block("A"))
        self.assertIsNone(merge_qualitative.compute_qualitative_block("MISSING"))

    def test_invalid_history_scores_are_ignored_and_explicit_dates_preserved(self):
        scores = (None, "invalid", -1.1, 1.1, "0.12345", -1, 1)
        paths = []
        for day, score in enumerate(scores, 1):
            path = self.root / "news" / "A" / f"2026-01-{day:02d}.json"
            data_io.write_json(path, {"date": "source-date", "narrative_score": score})
            paths.append(path)
        self.assertEqual(
            merge_qualitative._build_history(paths),
            [
                {"date": "source-date", "narrative_score": 0.123},
                {"date": "source-date", "narrative_score": -1.0},
                {"date": "source-date", "narrative_score": 1.0},
            ],
        )

    def test_standalone_keeps_bytes_and_only_merges_stocks_with_valuation(self):
        before = {"A": {"name": "기업", "valuation": {}}, "B": {"series": []}}
        for ticker, payload in before.items():
            data_io.write_json(self.root / "stocks" / f"{ticker}.json", payload)
            data_io.write_json(
                self.root / "news" / ticker / "2026-01-01.json", {"narrative_score": 0.5}
            )
        with patch.object(
            merge_qualitative, "_purge_old_news_files", return_value=0
        ), redirect_stdout(StringIO()):
            self.assertEqual(merge_qualitative._standalone_main(), 0)
        self.assertIn(
            "qualitative", data_io.read_json(self.root / "stocks" / "A.json")["valuation"]
        )
        self.assertEqual(
            (self.root / "stocks" / "B.json").read_bytes(),
            (json.dumps(before["B"], indent=2, ensure_ascii=False) + "\n").encode(),
        )

    def test_merge_failure_is_isolated_and_standalone_missing_directory_fails(self):
        stocks = {"BROKEN": {"valuation": {}}, "OK": {"valuation": {}}, "NONE": {}}
        with patch.object(
            merge_qualitative,
            "compute_qualitative_block",
            side_effect=[ValueError("bad"), {"summary": "ok"}, {"summary": "skip"}],
        ), redirect_stdout(StringIO()) as log:
            self.assertIs(merge_qualitative.merge_into_stocks(stocks), stocks)
        self.assertEqual(stocks["OK"]["valuation"]["qualitative"], {"summary": "ok"})
        self.assertEqual(stocks["NONE"], {})
        self.assertIn("qualitative merge FAILED for BROKEN", log.getvalue())
        with redirect_stdout(StringIO()):
            self.assertEqual(merge_qualitative._standalone_main(), 1)


class CollectionEntrypointTests(unittest.TestCase):
    def test_package_and_script_imports_work_without_network_or_pipeline_execution(self):
        code = """
import importlib, socket, sys
from pathlib import Path
from unittest.mock import patch
root = Path(sys.argv[1])
sys.path[:0] = [str(root), str(root / 'scripts')]
with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
    for name, entrypoint in (
        ('fetch_fred', 'main'), ('fetch_auctions', 'main'), ('fetch_ecos', 'main'),
        ('merge_qualitative', '_standalone_main'), ('sync_supabase', 'main'),
    ):
        for prefix in ('scripts.', ''):
            module = importlib.import_module(prefix + name)
            assert callable(getattr(module, entrypoint))
"""
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run(
                [sys.executable, "-c", code, str(ROOT)],
                cwd=temp,
                capture_output=True,
                text=True,
                timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_fred_script_and_module_cli_keep_missing_api_key_exit_contract(self):
        env = dict(os.environ)
        env.pop("FRED_API_KEY", None)
        for arguments in ([str(ROOT / "scripts" / "fetch_fred.py")], ["-m", "scripts.fetch_fred"]):
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    [sys.executable, *arguments],
                    cwd=ROOT,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertIn("FRED_API_KEY 환경변수가 설정되지 않았습니다", result.stderr)

    def test_ecos_script_and_module_cli_skip_when_the_key_is_absent(self):
        env = dict(os.environ)
        env.pop("ECOS_API_KEY", None)
        for arguments in ([str(ROOT / "scripts" / "fetch_ecos.py")], ["-m", "scripts.fetch_ecos"]):
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    [sys.executable, *arguments],
                    cwd=ROOT,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertIn("ECOS_API_KEY", result.stderr)
                self.assertIn("기존 데이터", result.stderr)


if __name__ == "__main__":
    unittest.main()
