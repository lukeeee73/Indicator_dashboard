"""Bank of Korea ECOS parsing and store merge. The network is mocked.

Sample payloads are trimmed from live StatisticSearch responses checked on
2026-11-11 with the public sample key (that key returns at most 10 rows, so
these fixtures are not a backfill).
"""

import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from scripts import analyze, data_io, fetch_ecos, fetch_fred


CPI_PAGE = {
    "StatisticSearch": {
        "list_total_count": 3,
        "row": [
            {
                "STAT_CODE": "901Y009",
                "STAT_NAME": "4.2.1. 소비자물가지수",
                "ITEM_CODE1": "0",
                "ITEM_NAME1": "총지수",
                "UNIT_NAME": "2020=100",
                "TIME": "202401",
                "DATA_VALUE": "113.17",
            },
            {
                "ITEM_CODE1": "0",
                "TIME": "202402",
                "DATA_VALUE": "",
            },
            {
                "ITEM_CODE1": "A",
                "ITEM_NAME1": "식료품 및 비주류음료",
                "TIME": "202402",
                "DATA_VALUE": "999",
            },
            {
                "ITEM_CODE1": "0",
                "TIME": "202403",
                "DATA_VALUE": "114.05",
                "UNIT_NAME": "2020=100",
            },
        ],
    }
}

UNRATE_PAGE = {
    "StatisticSearch": {
        "list_total_count": 4,
        "row": [
            {"TIME": "202608", "DATA_VALUE": "2", "ITEM_CODE1": "I61BC", "ITEM_NAME1": "실업률",
             "ITEM_CODE2": "I28A", "ITEM_NAME2": "원계열", "UNIT_NAME": "%"},
            {"TIME": "202608", "DATA_VALUE": "2.7", "ITEM_CODE1": "I61BC", "ITEM_NAME1": "실업률",
             "ITEM_CODE2": "I28B", "ITEM_NAME2": "계절조정", "UNIT_NAME": "%"},
            {"TIME": "202609", "DATA_VALUE": "2", "ITEM_CODE1": "I61BC",
             "ITEM_CODE2": "I28A", "ITEM_NAME2": "원계열"},
            {"TIME": "202609", "DATA_VALUE": "2.6", "ITEM_CODE1": "I61BC",
             "ITEM_CODE2": "I28B", "ITEM_NAME2": "계절조정"},
        ],
    }
}


def monthly_index():
    points = [{"date": f"2024-{month:02d}-01", "value": 100.0} for month in range(1, 13)]
    points.append({"date": "2025-01-01", "value": 110.0})
    return points


class EcosParserTests(unittest.TestCase):
    def test_catalog_uses_verified_tables_and_leaves_fred_list(self):
        self.assertEqual(
            {code: (spec["stat_code"], spec["item_codes"], spec["transform"], spec["category"])
             for code, spec in fetch_ecos.SERIES.items()},
            {
                "KR_CPI": ("901Y009", ("0",), "yoy_pct", "inflation"),
                "KR_CPI_CORE": ("901Y010", ("DB",), "yoy_pct", "inflation"),
                "KR_M2": ("161Y006", ("BBHA00",), "yoy_pct", "dollar"),
                "KR_IP": ("901Y033", ("AB00", "1"), "yoy_pct", "growth"),
                "KR_UNRATE": ("901Y027", ("I61BC", "I28B"), None, "growth"),
                "KR_POLICY_RATE": ("722Y001", ("0101000",), None, "dollar"),
                "KR_FISCAL_BAL": ("901Y013", ("C",), "billion_krw_to_trillion", "dollar"),
            },
        )
        self.assertEqual(
            fetch_ecos.RETIRED_FRED_CODES,
            {spec["replaces"]: code for code, spec in fetch_ecos.SERIES.items() if spec["replaces"]},
        )
        for code in fetch_ecos.RETIRED_FRED_CODES:
            self.assertNotIn(code, fetch_fred.INDICATORS)
        self.assertIn("KR_UNRATE", analyze.INVERTED_CODES)
        self.assertIn("LRUNTTTTKOR156S", analyze.INVERTED_CODES)
        self.assertNotIn("KR_CPI", analyze.INVERTED_CODES)

    def test_recorded_cpi_page_keeps_headline_and_drops_blanks(self):
        points, total = fetch_ecos.parse_observations(CPI_PAGE, "M", ("0",))
        self.assertEqual(total, 3)
        self.assertEqual(points, [
            {"date": "2024-01-01", "value": 113.17},
            {"date": "2024-03-01", "value": 114.05},
        ])

    def test_recorded_unemployment_page_keeps_only_seasonally_adjusted(self):
        points, _ = fetch_ecos.parse_observations(UNRATE_PAGE, "M", ("I61BC", "I28B"))
        self.assertEqual(points, [
            {"date": "2026-08-01", "value": 2.7},
            {"date": "2026-09-01", "value": 2.6},
        ])
        with self.assertRaisesRegex(fetch_ecos.EcosError, "conflicting values for 2026-08-01"):
            fetch_ecos.parse_observations(UNRATE_PAGE, "M", ("I61BC",))

    def test_single_row_object_string_count_and_result_errors(self):
        points, total = fetch_ecos.parse_observations(
            {"StatisticSearch": {"list_total_count": "1", "row": {
                "TIME": "202610", "DATA_VALUE": 120.73, "ITEM_CODE1": "0",
            }}},
            "M",
            ("0",),
        )
        self.assertEqual(total, 1)
        self.assertEqual(points, [{"date": "2026-10-01", "value": 120.73}])
        for cycle, raw, expected in (
            ("D", "20260105", "2026-01-05"),
            ("Q", "2026Q3", "2026-07-01"),
            ("A", "2025", "2025-01-01"),
        ):
            self.assertEqual(fetch_ecos.parse_time(cycle, raw), expected)
        with self.assertRaisesRegex(fetch_ecos.EcosError, "INFO-200"):
            fetch_ecos.parse_observations(
                {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}},
                "M",
                ("0",),
            )

    def test_transforms_match_existing_yoy_and_fiscal_unit(self):
        yoy = fetch_ecos.apply_transform({"transform": "yoy_pct"}, monthly_index())
        self.assertEqual(yoy, [{"date": "2025-01-01", "value": 10.0}])
        fiscal = fetch_ecos.apply_transform(
            {"transform": "billion_krw_to_trillion"},
            [{"date": "2024-01-01", "value": 11237.0}, {"date": "2024-03-01", "value": -64741.0}],
        )
        self.assertEqual(fiscal, [
            {"date": "2024-01-01", "value": 11.237},
            {"date": "2024-03-01", "value": -64.741},
        ])

    def test_search_url_pages_item_codes_and_hides_the_key_on_http_errors(self):
        self.assertEqual(
            fetch_ecos.build_search_url(
                "KEY", "901Y033", "M", "196001", "202610", ("AB00", "1"), 1001, 2000,
            ),
            "https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1001/2000/901Y033/M/196001/202610/AB00/1",
        )

        def fake_get(url, timeout):
            self.assertIn("/SECRET-KEY/", url)
            self.assertEqual(timeout, fetch_ecos.REQUEST_TIMEOUT)
            if "/missing/" in url:
                raise requests.Timeout(f"timed out for {url}")
            if "/1/2/" in url:
                payload = {"StatisticSearch": {"list_total_count": 3, "row": [
                    {"TIME": "202401", "DATA_VALUE": "1", "ITEM_CODE1": "0"},
                    {"TIME": "202402", "DATA_VALUE": "2", "ITEM_CODE1": "0"},
                ]}}
            elif "/3/4/" in url:
                payload = {"StatisticSearch": {"list_total_count": 3, "row": [
                    {"TIME": "202403", "DATA_VALUE": "3", "ITEM_CODE1": "0"},
                ]}}
            else:
                raise requests.Timeout(f"timed out for {url}")
            response = Mock()
            response.json.return_value = payload
            return response

        spec = {"stat_code": "901Y009", "cycle": "M", "start": "196001", "item_codes": ("0",)}
        moment = datetime(2026, 11, 11, tzinfo=timezone.utc)
        with patch.object(fetch_ecos, "PAGE_SIZE", 2), patch.object(
            fetch_ecos.requests, "get", side_effect=fake_get
        ):
            self.assertEqual(
                fetch_ecos.fetch_observations("SECRET-KEY", spec, moment),
                [
                    {"date": "2024-01-01", "value": 1.0},
                    {"date": "2024-02-01", "value": 2.0},
                    {"date": "2024-03-01", "value": 3.0},
                ],
            )
            with self.assertRaisesRegex(fetch_ecos.EcosError, "HTTP Timeout") as raised:
                fetch_ecos.fetch_observations("SECRET-KEY", {**spec, "stat_code": "missing"}, moment)
        self.assertNotIn("SECRET-KEY", str(raised.exception))

    def test_unemployment_polarity_flips_the_same_percentile(self):
        points = [{"date": "2020-01-01", "value": 1.0}, {"date": "2020-02-01", "value": 3.0}]
        plain = analyze.compute_current_stats("KR_IP", points)
        inverted = analyze.compute_current_stats("KR_UNRATE", points)
        self.assertEqual(inverted["percentile_full"], round(100 - plain["percentile_full"], 1))
        self.assertEqual(inverted["value"], plain["value"])


class EcosPipelineTests(unittest.TestCase):
    def test_missing_key_skips_without_requests_or_writes(self):
        for value in ("", "   "):
            with self.subTest(value=value), patch.dict(
                fetch_ecos.os.environ, {"ECOS_API_KEY": value}
            ), patch.object(fetch_ecos.requests, "get") as get, patch.object(
                fetch_ecos, "save_split_store"
            ) as save, redirect_stderr(StringIO()) as err:
                self.assertEqual(fetch_ecos.main(), 0)
            get.assert_not_called()
            save.assert_not_called()
            self.assertIn("ECOS_API_KEY", err.getvalue())
            self.assertIn("기존 데이터", err.getvalue())

    def test_total_failure_does_not_replace_the_store(self):
        with patch.dict(fetch_ecos.os.environ, {"ECOS_API_KEY": "present"}), patch.object(
            fetch_ecos, "collect_series", return_value=({}, ["KR_CPI"])
        ), patch.object(fetch_ecos, "save_split_store") as save, redirect_stdout(
            StringIO()
        ), redirect_stderr(StringIO()) as err:
            self.assertEqual(fetch_ecos.main(), 1)
        save.assert_not_called()
        self.assertIn("덮어쓰지 않습니다", err.getvalue())

    def test_success_replaces_only_fetched_fred_series_and_keeps_the_rest(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        paths = {
            "DATA_DIR": root,
            "INDEX_PATH": root / "index.json",
            "LEGACY_BUNDLE_PATH": root / "indicators.json",
        }
        paths.update({
            f"{name.upper()}_DIR": root / name
            for name in ("indicators", "assets", "stocks", "indices")
        })
        point = [{"date": "2024-01-01", "value": 1.0}]
        data_io.write_json(root / "index.json", {
            "last_updated": "2020-01-01T00:00:00Z",
            "indicators": [
                {"code": "DGS10", "name": "US 10Y", "unit": "percent", "category": "dollar",
                 "exclude_assessment": True},
                {"code": "KORCPIALLMINMEI", "name": "old cpi", "unit": "percent",
                 "category": "inflation", "region": "KR", "exclude_assessment": True},
                {"code": "MYAGM2KRM189S", "name": "old m2", "unit": "percent",
                 "category": "dollar", "region": "KR", "exclude_assessment": True},
            ],
            "assets": [],
            "stocks": [],
            "indices": [],
        })
        for code in ("DGS10", "KORCPIALLMINMEI", "MYAGM2KRM189S"):
            data_io.write_json(root / "indicators" / f"{code}.json", {
                "name": code, "unit": "percent", "category": "dollar", "series": point,
            })

        def fake_fetch(api_key, spec, moment):
            self.assertEqual(api_key, "present")
            if spec["stat_code"] == "161Y006":
                raise fetch_ecos.EcosError("HTTP Timeout")
            if spec["stat_code"] == "901Y009":
                return monthly_index()
            if spec["stat_code"] == "901Y027":
                return [{"date": "2025-01-01", "value": 2.6}, {"date": "2025-02-01", "value": 2.8}]
            raise AssertionError(spec["stat_code"])

        subset = {code: fetch_ecos.SERIES[code] for code in ("KR_CPI", "KR_M2", "KR_UNRATE")}
        with patch.multiple(fetch_fred, **paths), patch.dict(
            fetch_ecos.os.environ, {"ECOS_API_KEY": "present"}
        ), patch.object(fetch_ecos, "SERIES", subset), patch.object(
            fetch_ecos, "fetch_observations", side_effect=fake_fetch
        ), redirect_stdout(StringIO()) as log, redirect_stderr(StringIO()):
            self.assertEqual(fetch_ecos.main(), 0)

        self.assertFalse((root / "indicators" / "KORCPIALLMINMEI.json").exists())
        self.assertTrue((root / "indicators" / "MYAGM2KRM189S.json").exists())
        self.assertTrue((root / "indicators" / "DGS10.json").exists())
        cpi = data_io.read_json(root / "indicators" / "KR_CPI.json")
        self.assertEqual(cpi["source"], "ECOS")
        self.assertEqual(cpi["ecos"], {"stat_code": "901Y009", "cycle": "M", "item_codes": ["0"]})
        self.assertEqual(cpi["region"], "KR")
        self.assertTrue(cpi["exclude_assessment"])
        self.assertEqual(cpi["category"], "inflation")
        self.assertEqual(cpi["series"], [{"date": "2025-01-01", "value": 10.0}])
        unrate = data_io.read_json(root / "indicators" / "KR_UNRATE.json")
        self.assertEqual(unrate["category"], "growth")
        self.assertEqual(unrate["series"][-1], {"date": "2025-02-01", "value": 2.8})
        index = data_io.read_json(root / "index.json")
        codes = [entry["code"] for entry in index["indicators"]]
        self.assertEqual(codes, ["DGS10", "MYAGM2KRM189S", "KR_CPI", "KR_UNRATE"])
        self.assertIsNotNone(index["assessment_kr"]["full"])
        self.assertIn("growth_score", index["assessment_kr"]["full"])
        self.assertIn("inflation_score", index["assessment_kr"]["full"])
        self.assertIn("Removed retired FRED series KORCPIALLMINMEI", log.getvalue())
        self.assertNotIn("MYAGM2KRM189S", log.getvalue())
        self.assertNotIn("present", log.getvalue())


if __name__ == "__main__":
    unittest.main()
