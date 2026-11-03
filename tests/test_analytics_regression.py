"""Offline numerical regression cases frozen from the pre-refactor scripts.

The hashes cover complete monthly timelines/assessment JSON, including labels,
rounding and schema. Small boundary cases below give readable failure context.
Only synthetic inputs and temporary output directories are used.
"""

import copy
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from scripts import analyze, backtest, build_labels, build_principles, compare_models
from scripts.analytics_series import midpoint_percentile, points_to_series, smooth_scores


def digest(payload):
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def frame_payload(frame):
    return {
        "index": [str(item) for item in frame.index],
        "columns": list(frame.columns),
        "data": json.loads(frame.to_json(orient="values")),
    }


def indicator_fixture():
    """Different start dates/frequencies, inverted polarity and delayed releases."""
    months = pd.date_range("2000-01-31", "2015-12-31", freq="ME")
    indicators = {}
    for code, category, start, phase, offset in (
        ("T10Y2Y", "growth", 0, 0, 3),
        ("INDPRO", "growth", 77, 7, 6),
        ("ICSA", "growth", 91, 15, 300),
        ("CPIAUCSL", "inflation", 0, 23, 2),
        ("PCEPI", "inflation", 31, 31, 1),
    ):
        points = []
        for i, month in enumerate(months):
            if i < start or (code == "PCEPI" and i % 17 == 0):
                continue
            value = round(offset + math.sin((i + phase) / 11) * 2 + i % 5 / 10, 5)
            dates = (5, 23) if code in ("T10Y2Y", "ICSA") else (1,)
            for day in dates:
                points.append({"date": month.replace(day=day).strftime("%Y-%m-%d"),
                               "value": value + (0.1 if day == 23 else 0)})
        indicators[code] = {"category": category, "series": points}
    return indicators


def walk_fixture():
    indicators = indicator_fixture()
    for payload in indicators.values():
        for point in payload["series"]:
            point["_ts"] = pd.Timestamp(point["date"])
    return indicators


def assessment_fixture():
    indicators = indicator_fixture()
    for code, original in (("LRUNTTTTKOR156S", "ICSA"), ("KR_CPI", "CPIAUCSL")):
        indicators[code] = copy.deepcopy(indicators[original])
        indicators[code].update(region="KR", exclude_assessment=True)
    indicators["EXCLUDED"] = {"category": "growth", "exclude_assessment": True,
                              "series": [{"date": "2015-12-20", "value": 999}]}
    indicators["ASSET"] = {"category": "asset", "series": []}
    return {"indicators": indicators}


def stats_cases():
    points = [
        {"date": "2015-01-31", "value": 4.123456},
        {"date": "1945-09-01", "value": -999},
        {"date": "2005-01-30", "value": 100},
        {"date": "1945-09-02", "value": 1},
        {"date": "2005-01-31", "value": 3.123456},
        {"date": "2010-01-01", "value": None},
    ]
    return {"normal": ("T10Y2Y", points), "inverted": ("ICSA", points),
            "prewar": ("OLD", [{"date": "1940-01-01", "value": 4}]),
            "empty": ("EMPTY", [])}


def capture_reference():
    """Used once against isolated copies to freeze the constants below."""
    current = {name: analyze.compute_current_stats(code, points)
               for name, (code, points) in stats_cases().items()}
    models = {}
    for model in "ABCDEFGH":
        frame = compare_models.walk_model(model, walk_fixture(),
                                          pd.Timestamp("2015-01-31"),
                                          pd.Timestamp("2015-12-31"))
        models[model] = digest(frame_payload(frame))
    with patch.object(analyze, "_load_primary_backtest_summary", return_value=None):
        enriched = analyze.enrich_with_assessment(assessment_fixture())
    # The input points are not part of this snapshot: only produced analytics.
    assessment = {key: value for key, value in enriched.items() if key != "indicators"}
    assessment["current"] = {code: payload.get("current")
                             for code, payload in enriched["indicators"].items()}
    stats_b = {code: compare_models._stats_B(code, payload["series"])
               for code, payload in indicator_fixture().items()}
    return {"current": current, "models": models, "assessment": digest(assessment),
            "primary_scores": {key: enriched["assessment"]["primary"][key] for key in
                               ("as_of", "growth_score", "inflation_score", "quadrant")},
            "stats_b": stats_b}


# Captured with the unmodified scripts in an isolated temporary directory.
REFERENCE = {
    "current": {
        "normal": {"value": 4.1235, "date": "2015-01-31", "percentile_full": 62.5,
                   "percentile_10y": 75.0, "label_full": "high", "label_10y": "high"},
        "inverted": {"value": 4.1235, "date": "2015-01-31", "percentile_full": 37.5,
                     "percentile_10y": 25.0, "label_full": "low", "label_10y": "low"},
        "prewar": {"value": 4.0, "date": "1940-01-01", "percentile_full": None,
                   "percentile_10y": 50.0, "label_full": None, "label_10y": "neutral"},
        "empty": None,
    },
    "models": {
        "A": "aa6d0a938239a1d00567384fcf6b560615651d23e9ac04fd983c2f02e23eeac2",
        "B": "b8dbbbda378fd3a41e77f84faa74b445397e34c257a134cf98b3a59ec86ff576",
        "C": "0b917a1b862616115f7f8f7f74afa27c899361444e8d2f1f74974063298b4cb3",
        "D": "641ce63f4a08851006d7408bc5ed55e0e059d93ed266f4f6c24d5c2b1c567209",
        "E": "60e7ca82f9bdccd780c467b64fafde806c4fd7d6f2b8ed3eadf50eb58bf5e0f8",
        "F": "28c23ddc3646e849842ff4d8e4abee41e6ce1d4c19657589372d7ff70dcbff63",
        "G": "757960302390c82e212440199b0141e20bde68e7486c7d1c51adf01cfd6e0498",
        "H": "757960302390c82e212440199b0141e20bde68e7486c7d1c51adf01cfd6e0498",
    },
    "assessment": "e3a3fa7695897375f57ed74e5d77a89cebe9884470d4f3830ce0ccc4d99ef299",
    "primary_scores": {"as_of": "2015-12-31", "growth_score": 26.3,
                       "inflation_score": 81.2, "quadrant": "Q3"},
    "stats_b": {"T10Y2Y": (23.0, 22.7), "INDPRO": (46.6, 46.6),
                "ICSA": (25.9, 25.9), "CPIAUCSL": (80.7, 82.8), "PCEPI": (75.0, 76.9)},
}


class AnalyticsNumericalRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.observed = capture_reference()

    def test_full_and_ten_year_windows_include_exact_cutoffs(self):
        self.assertEqual(self.observed["current"], REFERENCE["current"])

    def test_all_eight_walk_forward_models_match_frozen_timelines(self):
        for model in "ABCDEFGH":
            with self.subTest(model=model):
                self.assertEqual(self.observed["models"][model], REFERENCE["models"][model])

    def test_us_korean_primary_and_reference_assessment_json(self):
        self.assertEqual(self.observed["assessment"], REFERENCE["assessment"])
        self.assertEqual(self.observed["primary_scores"], REFERENCE["primary_scores"])

    def test_diff_blends_keep_unrounded_level_percentiles(self):
        self.assertEqual(self.observed["stats_b"], REFERENCE["stats_b"])

    def test_reference_trajectory_keeps_missing_observations_in_denominator(self):
        points = [{"date": "2020-01-01", "value": 1},
                  {"date": "2020-02-01", "value": None},
                  {"date": "2020-03-01", "value": 3}]
        indicators = {"G": {"category": "growth", "series": points},
                      "I": {"category": "inflation", "series": points}}
        self.assertEqual(analyze.compute_trajectory(indicators), [
            {"date": "2020-01-31", "growth_score": 16.7, "inflation_score": 16.7},
            {"date": "2020-03-31", "growth_score": 50.0, "inflation_score": 50.0},
        ])
        self.assertEqual(analyze.compute_current_stats("G", points)["percentile_full"], 75.0)

    def test_release_lag_cutoff_is_inclusive_and_never_looks_ahead(self):
        as_of = pd.Timestamp("2020-03-31")
        for code, lag in (("T10Y2Y", 1), ("PAYEMS", 21), ("UNKNOWN", 45)):
            cutoff = as_of - pd.Timedelta(days=lag)
            points = [{"_ts": cutoff + pd.Timedelta(seconds=seconds), "value": seconds}
                      for seconds in (-1, 0, 1)]
            self.assertEqual(backtest.slice_series(code, points, as_of), points[:2])
            self.assertIs(backtest.slice_series(code, points, as_of)[1], points[1])

    def test_future_observations_do_not_change_model_rows(self):
        indicators = walk_fixture()
        as_of = pd.Timestamp("2015-06-30")
        future_changed = copy.deepcopy(indicators)
        for payload in future_changed.values():
            for point in payload["series"]:
                if point["_ts"] > as_of:
                    point["value"] = -1e9
        for stats_fn, weights, fn_map in (
            (compare_models._stats_level, None, None),
            (compare_models._stats_B, None, None),
            (None, compare_models.INDICATOR_WEIGHTS, compare_models._F_FN_MAP),
        ):
            self.assertEqual(
                compare_models._build_row(as_of, indicators, stats_fn, weights, fn_map),
                compare_models._build_row(as_of, future_changed, stats_fn, weights, fn_map),
            )

    def test_ewma_and_hysteresis_leave_ten_year_columns_and_input_intact(self):
        frame = pd.DataFrame({
            "growth_full": [np.nan, 70, 55, 45, 30, 55, 70],
            "infl_full": [np.nan, 30, 45, 55, 70, 45, 30],
            "growth_10y": [1, 2, 3, 4, 5, 6, 7],
            "g_lab_full": [None] * 7, "i_lab_full": [None] * 7,
        })
        original = frame.copy(deep=True)
        plain = compare_models._apply_smooth_only(frame)
        hysteresis = compare_models._apply_smooth_hysteresis(frame)
        self.assertEqual(plain["growth_full"].tolist()[1:], [70, 60, 51.4, 40, 47.7, 59])
        self.assertEqual(plain["g_lab_full"].tolist(),
                         ["neutral", "high", "high", "neutral", "low", "neutral", "neutral"])
        self.assertTrue(pd.isna(hysteresis["g_lab_full"].iloc[0]))
        self.assertEqual(hysteresis["g_lab_full"].tolist()[1:],
                         ["high", "high", "high", "low", "low", "neutral"])
        pd.testing.assert_frame_equal(frame, original)
        pd.testing.assert_series_equal(plain["growth_10y"], frame["growth_10y"])
        pd.testing.assert_series_equal(hysteresis["growth_10y"], frame["growth_10y"])

    def test_label_thresholds_and_hysteresis_exits_keep_exact_boundaries(self):
        growth = pd.Series([np.nan, 60, 50, 49.9, 40, 50, 50.1, 59.9, 60, 40])
        frame = pd.DataFrame({"growth_full": growth, "infl_full": 100 - growth})
        # A one-month span isolates label decisions from smoothing weights.
        with patch.object(compare_models, "EWMA_SPAN", 1):
            plain = compare_models._apply_smooth_only(frame)
            hysteresis = compare_models._apply_smooth_hysteresis(frame)
        self.assertEqual(plain["g_lab_full"].tolist(), [
            "neutral", "high", "neutral", "neutral", "low", "neutral", "neutral",
            "neutral", "high", "low",
        ])
        self.assertEqual(plain["i_lab_full"].tolist(), [
            "neutral", "low", "neutral", "neutral", "high", "neutral", "neutral",
            "neutral", "low", "high",
        ])
        self.assertTrue(pd.isna(hysteresis["g_lab_full"].iloc[0]))
        self.assertTrue(pd.isna(hysteresis["i_lab_full"].iloc[0]))
        self.assertEqual(hysteresis["g_lab_full"].tolist()[1:], [
            "high", "high", "neutral", "low", "low", "neutral", "neutral", "high", "low",
        ])
        self.assertEqual(hysteresis["i_lab_full"].tolist()[1:], [
            "low", "low", "neutral", "high", "high", "neutral", "neutral", "low", "high",
        ])


class AnalyticsSeriesBoundaryTests(unittest.TestCase):
    def test_midpoint_ties_missing_values_and_extremes(self):
        sample = pd.Series([1, 2, 2, 5, np.nan])
        for value, expected in ((0, 0), (1, 12.5), (2, 50), (5, 87.5), (6, 100)):
            with self.subTest(value=value):
                self.assertEqual(analyze._percentile_rank(sample, value), expected)
        self.assertEqual(midpoint_percentile(sample, 2, dropna=False), 40)
        self.assertIsNone(analyze._percentile_rank(sample, np.nan))
        self.assertIsNone(analyze._percentile_rank(pd.Series(dtype=float), 1))
        self.assertIsNone(analyze._percentile_rank(pd.Series([np.nan]), 1))
        self.assertEqual(analyze._percentile_rank(pd.Series([-np.inf, 1, np.inf]), np.inf),
                         5 / 6 * 100)

    def test_parsing_and_month_end_last_do_not_fill_missing_months(self):
        points = [{"date": "2020-03-04", "value": "4"},
                  {"date": "2020-01-31", "value": None},
                  {"date": "2020-01-02", "value": "2"},
                  {"date": "2020-03-04", "value": "5"}]
        before = copy.deepcopy(points)
        parsed = points_to_series(points)
        pd.testing.assert_series_equal(analyze._series_to_pandas(points), parsed)
        monthly = build_principles.monthly_last(s=parsed)
        self.assertEqual(monthly.tolist(), [2.0, 5.0])
        self.assertEqual(monthly.index.strftime("%Y-%m-%d").tolist(),
                         ["2020-01-31", "2020-03-31"])
        pd.testing.assert_series_equal(analyze._monthly_last(points), monthly)
        self.assertTrue(analyze._series_to_pandas([]).empty)
        self.assertTrue(analyze._monthly_last([]).empty)
        with self.assertRaises(KeyError):
            points_to_series([])
        self.assertEqual(points, before)

    def test_ewma_uses_adjusted_weights_and_rounds_after_smoothing(self):
        raw = pd.Series([10.04, 20.06, np.nan, 30.04])
        before = raw.copy()
        # pandas' adjusted, ignore_na=False weighting across the missing month.
        expected = pd.Series([10.0, 16.7, 16.7, 26.4])
        pd.testing.assert_series_equal(smooth_scores(raw, 3), expected)
        pd.testing.assert_series_equal(raw, before)

    def test_cycle_components_renormalize_at_short_history_boundaries(self):
        self.assertIsNone(analyze.cycle_relative_percentile("G", pd.Series(dtype=float)))
        for count, expected in ((17, None), (18, 50.0), (23, 50.0), (24, 83.5)):
            monthly = pd.Series(range(count), index=pd.date_range("2020-01-31", periods=count,
                                                                  freq="ME"), dtype=float)
            with self.subTest(count=count):
                self.assertEqual(analyze.cycle_relative_percentile("G", monthly), expected)


class AnalyticsBuilderRegressionTests(unittest.TestCase):
    def test_series_loaders_preserve_sorting_missing_values_and_month_start_labels(self):
        points = [{"date": "2020-03-17", "value": 3},
                  {"date": "2020-01-29", "value": None},
                  {"date": "2020-01-04", "value": 1}]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "CPIAUCSL.json"
            path.write_text(json.dumps({"series": points}), encoding="utf-8")
            raw = build_principles.load_series(path)
            with patch.object(build_labels, "INDICATORS_DIR", path.parent):
                labels = build_labels._load_series("CPIAUCSL")
            self.assertEqual(raw.index.strftime("%Y-%m-%d").tolist(),
                             ["2020-01-04", "2020-01-29", "2020-03-17"])
            self.assertEqual(labels.index.strftime("%Y-%m-%d").tolist(),
                             ["2020-01-01", "2020-01-01", "2020-03-01"])
            np.testing.assert_equal(raw.to_numpy(), [1, np.nan, 3])
            np.testing.assert_equal(labels.to_numpy(), raw.to_numpy())
            self.assertIsNone(build_principles.load_series_optional(path.parent / "absent.json"))
            path.write_text('{"series": []}', encoding="utf-8")
            with self.assertRaises(KeyError):
                build_principles.load_series(path)
            self.assertIsNone(build_principles.load_series_optional(path))

    def test_market_snapshots_use_only_observations_at_or_before_the_month(self):
        series = pd.Series([1.2345, 9], index=pd.to_datetime(["2020-01-31", "2020-03-31"]))
        self.assertIsNone(build_principles.asof_value(series, pd.Timestamp("2020-01-30")))
        self.assertIsNone(build_principles.asof_value(None, pd.Timestamp("2020-03-31")))
        self.assertEqual(build_principles.asof_value(series, pd.Timestamp("2020-02-29"), 3), 1.234)
        self.assertEqual(build_principles.asof_value(series, pd.Timestamp("2020-03-31")), 9)

    def test_asset_index_arithmetic_keeps_original_compounding_and_rounding(self):
        monthly = pd.Series([4, 4.2, 3.8, 4], index=pd.date_range("2020-01-31", periods=4,
                                                               freq="ME"))
        bond = build_principles.build_bond_total_return_index(monthly)
        self.assertEqual(build_principles.series_to_index_list(bond), [
            {"date": "2020-01-31", "value": 100.0},
            {"date": "2020-02-29", "value": 98.9333},
            {"date": "2020-03-31", "value": 102.0497},
            {"date": "2020-04-30", "value": 100.9442},
        ])
        self.assertEqual(build_principles.build_price_index(monthly).tolist(), [100, 105, 95, 100])

    def test_label_rule_and_consensus_json_are_frozen_from_original_builder(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dates = pd.date_range("2000-01-01", periods=48, freq="MS")
            for code, offset in (("CPIAUCSL", 0), ("CPILFESL", -1), ("PCEPI", -2)):
                points = [{"date": date.strftime("%Y-%m-%d"), "value": value + offset}
                          for date, value in zip(dates, [2] * 6 + [6] * 18 + [3] * 6 + [8] * 18)]
                (root / f"{code}.json").write_text(json.dumps({"series": points}), encoding="utf-8")
            with patch.multiple(build_labels, INDICATORS_DIR=root, LABELS_DIR=root / "labels"), \
                    redirect_stdout(StringIO()):
                self.assertEqual(build_labels.main(), 0)
            payload = json.loads((root / "labels" / "us_inflation_episodes.json").read_text())
            self.assertEqual(payload["consensus"]["episodes"], [
                {"start": "2000-07", "end": "2001-12", "months": 18, "max_rules_concurrent": 3},
                {"start": "2002-07", "end": "2003-12", "months": 18, "max_rules_concurrent": 4},
            ])
            self.assertEqual(digest(payload), LABEL_REFERENCE)


LABEL_REFERENCE = "1fb49840786abf8f679e7b9da845d6352d03d42c1036dbe731a2ce1e6ea718e0"


class AnalyticsImportTests(unittest.TestCase):
    def test_package_and_script_imports_work_without_network_or_pipeline_execution(self):
        code = """
import importlib
import socket
import sys
from pathlib import Path
from unittest.mock import patch

root = Path(sys.argv[1])
sys.path[:0] = [str(root), str(root / 'scripts')]
with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
    for prefix in ('scripts.', ''):
        for name, function in (
            ('analytics_series', 'points_to_series'),
            ('analyze', 'enrich_with_assessment'),
            ('compare_models', 'walk_model'),
            ('build_labels', 'main'),
            ('build_principles', 'main'),
        ):
            module = importlib.import_module(prefix + name)
            assert callable(getattr(module, function))
"""
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run(
                [sys.executable, "-c", code, str(root)],
                cwd=temp, capture_output=True, text=True, timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
