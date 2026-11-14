"""Rate-watch detection, validation and index bookkeeping; FRED and Claude are mocked."""

import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import data_io, rate_watch


def _series(points):
    return [{"date": d, "value": v} for d, v in points]


UPPER = _series([("2026-09-15", 4.50), ("2026-09-16", 4.50), ("2026-09-17", 4.25), ("2026-09-18", 4.25)])
LOWER = _series([("2026-09-15", 4.25), ("2026-09-16", 4.25), ("2026-09-17", 4.00), ("2026-09-18", 4.00)])

GOOD_REPORT = {
    "decision_date": "2026-09-17",
    "headline": "연준 25bp 인하",
    "summary": "요약입니다.",
    "decision": {"previous_range": "4.25–4.50%", "new_range": "4.00–4.25%", "change_bp": -25, "vote": None},
    "sections": [{"title": "결정", "body": "..."}, {"title": "원화·한국 영향", "body": "..."},
                 {"title": "시장", "body": "..."}],
    "market_reaction": [],
    "watch_next": [],
    "sources": [{"title": "FOMC statement", "url": "https://www.federalreserve.gov/x"}],
}


class DetectionTests(unittest.TestCase):
    def test_finds_latest_range_change(self):
        change = rate_watch.find_latest_change(UPPER, LOWER)
        self.assertEqual(change["date"], "2026-09-17")
        self.assertEqual(change["previous"], {"lower": 4.25, "upper": 4.50})
        self.assertEqual(change["current"], {"lower": 4.00, "upper": 4.25})
        self.assertEqual(change["change_bp"], -25)

    def test_flat_series_has_no_change(self):
        flat = _series([("2026-09-15", 4.5), ("2026-09-16", 4.5)])
        self.assertIsNone(rate_watch.find_latest_change(flat, flat))

    def test_new_change_compares_against_last_seen_date(self):
        change = rate_watch.find_latest_change(UPPER, LOWER)
        self.assertTrue(rate_watch.is_new_change(change, {"last_change": {"date": "2026-07-30"}}))
        self.assertFalse(rate_watch.is_new_change(change, {"last_change": {"date": "2026-09-17"}}))
        self.assertFalse(rate_watch.is_new_change(None, {}))

    def test_snapshot_splits_before_and_after_decision(self):
        s = _series([("2026-09-15", 4.1), ("2026-09-16", 4.0), ("2026-09-18", 3.9)])
        summary = rate_watch.summarize_series(s, "2026-09-17")
        self.assertEqual(summary["before"]["value"], 4.0)
        self.assertEqual(summary["latest"]["value"], 3.9)
        self.assertEqual([p["value"] for p in summary["after_decision"]], [3.9])
        self.assertTrue(summary["has_post_decision_data"])


class ReportTests(unittest.TestCase):
    def test_valid_report_passes(self):
        self.assertEqual(rate_watch.validate_report(GOOD_REPORT), [])

    def test_missing_korea_section_and_bad_source_fail(self):
        bad = {**GOOD_REPORT,
               "sections": [{"title": "결정", "body": "..."}],
               "sources": [{"title": "x", "url": "javascript:alert(1)"}]}
        errors = rate_watch.validate_report(bad)
        self.assertTrue(any("원화·한국 영향" in e for e in errors))
        self.assertTrue(any("https" in e for e in errors))

    def test_record_report_prepends_and_replaces_same_date(self):
        change = rate_watch.find_latest_change(UPPER, LOWER)
        index = {"last_change": None, "reports": [{"date": "2026-09-17", "headline": "old"},
                                                  {"date": "2026-07-30", "headline": "older"}]}
        out = rate_watch.record_report(index, change, GOOD_REPORT, "sesn_1")
        self.assertEqual([r["date"] for r in out["reports"]], ["2026-09-17", "2026-07-30"])
        self.assertEqual(out["reports"][0]["headline"], "연준 25bp 인하")
        self.assertEqual(out["reports"][0]["new_range"], "4.00–4.25%")
        self.assertEqual(out["last_change"], change)


class MainFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        patches = [
            patch.object(rate_watch, "REPORTS_DIR", root),
            patch.object(rate_watch, "INDEX_PATH", root / "index.json"),
            patch.dict("os.environ", {"FRED_API_KEY": "k", "RATE_WATCH_AGENT_ID": "agent_1",
                                      "RATE_WATCH_ENVIRONMENT_ID": "env_1"}),
            patch.object(rate_watch, "fetch_series",
                         side_effect=lambda sid, *_: {"DFEDTARU": UPPER, "DFEDTARL": LOWER}.get(sid, UPPER)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.root = root

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, *argv):
        with redirect_stdout(StringIO()):
            return rate_watch.main(list(argv))

    def test_first_run_records_baseline_without_calling_agent(self):
        with patch.object(rate_watch, "run_agent_session") as run:
            self.assertEqual(self._run(), 0)
        run.assert_not_called()
        self.assertEqual(data_io.read_json(self.root / "index.json")["last_change"]["date"], "2026-09-17")

    def test_new_change_runs_agent_and_saves_report(self):
        data_io.write_json(self.root / "index.json",
                           {"last_change": {"date": "2026-07-30"}, "reports": []})
        with patch.object(rate_watch, "run_agent_session", return_value=("sesn_1", GOOD_REPORT)), \
             patch.dict("sys.modules", {"anthropic": unittest.mock.MagicMock()}):
            self.assertEqual(self._run(), 0)
        index = data_io.read_json(self.root / "index.json")
        self.assertEqual(index["reports"][0]["file"], "2026-09-17.json")
        saved = data_io.read_json(self.root / "2026-09-17.json")
        self.assertEqual(saved["session_id"], "sesn_1")

    def test_seen_change_is_a_no_op(self):
        data_io.write_json(self.root / "index.json",
                           {"last_change": {"date": "2026-09-17"}, "reports": []})
        with patch.object(rate_watch, "run_agent_session") as run:
            self.assertEqual(self._run(), 0)
        run.assert_not_called()

    def test_invalid_report_fails_without_touching_index(self):
        data_io.write_json(self.root / "index.json",
                           {"last_change": {"date": "2026-07-30"}, "reports": []})
        with patch.object(rate_watch, "run_agent_session", return_value=("sesn_1", {"headline": "x"})), \
             patch.dict("sys.modules", {"anthropic": unittest.mock.MagicMock()}):
            with patch("sys.stderr", StringIO()):
                self.assertEqual(self._run(), 1)
        self.assertEqual(data_io.read_json(self.root / "index.json")["last_change"]["date"], "2026-07-30")


if __name__ == "__main__":
    unittest.main()
