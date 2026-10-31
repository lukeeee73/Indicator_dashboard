import copy
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from itertools import product
from pathlib import Path
from unittest.mock import patch

from scripts import value_screen


def quarters(*incomes):
    dates = ("2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31")
    return [{"date": date, "net_income": income} for date, income in zip(dates, incomes)]


def stock(quarterly=None, *, roe=0.15, margin=0.15, gap=-0.20):
    return {
        "name": "Example",
        "group": "Example group",
        "financials": {
            "snapshot": {"return_on_equity": roe, "operating_margin": margin},
            "quarterly": quarters(1, 2, 3, 4) if quarterly is None else quarterly,
        },
        "valuation": {"valuation_gap": gap},
    }


class ProfitTests(unittest.TestCase):
    def test_missing_recent_income_cannot_be_replaced_by_older_profit(self):
        # Four profitable observations must not hide a missing one in the latest four.
        for missing_index in range(1, 5):
            with self.subTest(missing_index=missing_index):
                quarterly = quarters(1, 2, 3, 4, 5)
                quarterly[missing_index]["net_income"] = None
                self.assertEqual(
                    value_screen._check_profit(quarterly), {"ok": False, "value": None}
                )

    def test_absent_recent_income_is_missing_data(self):
        quarterly = quarters(1, 2, 3, 4, 5)
        del quarterly[-1]["net_income"]
        self.assertEqual(value_screen._check_profit(quarterly), {"ok": False, "value": None})

    def test_insufficient_quarters_are_missing_data(self):
        for count in range(4):
            with self.subTest(count=count):
                self.assertEqual(
                    value_screen._check_profit(quarters(1, 2, 3)[:count]),
                    {"ok": False, "value": None},
                )

    def test_complete_window_counts_positive_income_only(self):
        for incomes, expected in (
            ((1, 2, 3, 4), {"ok": True, "value": 4}),
            ((0, 2, 3, 4), {"ok": False, "value": 3}),
            ((1, -2, 3, 4), {"ok": False, "value": 3}),
            ((0, -2, 0, -4), {"ok": False, "value": 0}),
        ):
            with self.subTest(incomes=incomes):
                self.assertEqual(value_screen._check_profit(quarters(*incomes)), expected)

    def test_older_missing_or_losing_quarter_is_outside_window(self):
        for older in (None, -10, 0):
            with self.subTest(older=older):
                self.assertEqual(
                    value_screen._check_profit(quarters(older, 1, 2, 3, 4)),
                    {"ok": True, "value": 4},
                )

    def test_dates_choose_window_without_mutating_input(self):
        chronological = quarters(-10, 1, 2, 3, 4)
        quarterly = [chronological[i] for i in (4, 0, 3, 1, 2)]
        before = copy.deepcopy(quarterly)
        self.assertEqual(value_screen._check_profit(quarterly), {"ok": True, "value": 4})
        self.assertEqual(quarterly, before)


class ScreeningTests(unittest.TestCase):
    def test_exact_thresholds_pass_without_mutating_payload(self):
        payload = stock()
        before = copy.deepcopy(payload)
        result = value_screen.screen_stock(payload)
        self.assertEqual(result["passed_count"], 4)
        self.assertTrue(result["pass"])
        self.assertEqual(payload, before)

    def test_missing_income_prevents_full_screen_pass(self):
        result = value_screen.screen_stock(stock(quarters(1, 2, 3, 4, None)))
        self.assertEqual(result["checks"]["profit"], {"ok": False, "value": None})
        self.assertEqual(result["passed_count"], 3)
        self.assertFalse(result["pass"])

    def test_missing_financials_and_valuation_fail_all_checks(self):
        for payload in ({}, {"financials": None, "valuation": None}):
            with self.subTest(payload=payload):
                result = value_screen.screen_stock(payload)
                self.assertEqual(result["name"], "")
                self.assertEqual(result["group"], "기타")
                self.assertEqual(result["passed_count"], 0)
                self.assertFalse(result["pass"])
                self.assertTrue(all(c == {"ok": False, "value": None}
                                    for c in result["checks"].values()))


class ClassificationTests(unittest.TestCase):
    def test_every_criterion_combination_preserves_three_of_four_candidates(self):
        results = {}
        expected_passed = []
        expected_near_miss = []
        for flags in product((False, True), repeat=4):
            ticker = "".join(str(int(flag)) for flag in flags)
            roe, margin, profit, discount = flags
            results[ticker] = value_screen.screen_stock(stock(
                quarters(1, 2, 3, 4 if profit else -4),
                roe=0.15 if roe else 0.1499,
                margin=0.15 if margin else 0.1499,
                gap=-0.20 if discount else -0.1999,
            ))
            if all(flags):
                expected_passed.append(ticker)
            elif sum(flags) == 3:
                expected_near_miss.append(ticker)
        # Deliberately scramble insertion order; public JSON lists stay sorted.
        results = dict(reversed(list(results.items())))
        before = copy.deepcopy(results)
        passed, near_miss = value_screen.classify_results(results)
        self.assertEqual(passed, sorted(expected_passed))
        self.assertEqual(near_miss, sorted(expected_near_miss))
        self.assertEqual(results, before)

    def test_empty_results(self):
        self.assertEqual(value_screen.classify_results({}), ([], []))


class OutputTests(unittest.TestCase):
    def test_main_writes_compatible_json_using_temporary_data_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stocks_dir = root / "stocks"
            stocks_dir.mkdir()
            out_path = root / "value_screen.json"
            payloads = {
                "PASS": stock(),
                "PRICE": stock(gap=0),
                "ROE": stock(roe=None),
                "MARGIN": stock(margin=None),
                "PROFIT": stock(quarters(1, 2, 3, 4, None)),
                "FAIL": stock([], roe=None, margin=None, gap=None),
            }
            for ticker, payload in payloads.items():
                (stocks_dir / f"{ticker}.json").write_text(json.dumps(payload), encoding="utf-8")
            (stocks_dir / "BROKEN.json").write_text("{", encoding="utf-8")
            with patch.multiple(value_screen, ROOT=root, STOCKS_DIR=stocks_dir, OUT_PATH=out_path):
                with redirect_stdout(StringIO()) as log:
                    value_screen.main()
            output = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertEqual(set(output), {
                "as_of", "month", "generated_utc", "criteria", "passed", "near_miss", "results"
            })
            self.assertEqual(output["criteria"], value_screen.CRITERIA)
            self.assertEqual(output["passed"], ["PASS"])
            self.assertEqual(output["near_miss"], ["MARGIN", "PRICE", "PROFIT", "ROE"])
            self.assertEqual(set(output["results"]), set(payloads))
            self.assertIn("BROKEN: 읽기 실패", log.getvalue())
            self.assertIn("screened 6 stocks → pass 1, near-miss 4", log.getvalue())


if __name__ == "__main__":
    unittest.main()
