"""ECOS collection regressions; every request is mocked."""

import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import Mock, patch

import requests

from scripts import fetch_ecos, fetch_fred

KEY = "SECRET-KEY-123"


def page(rows, total):
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json.return_value = {"StatisticSearch": {"list_total_count": total, "row": rows}}
    return resp


def row(time, value):
    return {"TIME": time, "DATA_VALUE": value}


class EcosParsingTests(unittest.TestCase):
    def test_time_formats_map_to_period_start(self):
        self.assertEqual(fetch_ecos.ecos_time_to_date("202610", "M"), "2026-10-01")
        self.assertEqual(fetch_ecos.ecos_time_to_date("2026Q3", "Q"), "2026-07-01")
        self.assertEqual(fetch_ecos.ecos_time_to_date("2025", "A"), "2025-01-01")
        self.assertEqual(fetch_ecos.ecos_time_to_date("20261113", "D"), "2026-11-13")

    def test_rows_skip_blank_values_and_sort_by_date(self):
        rows = [row("202602", "1,234.5"), row("202601", ""), row("202512", "-"), row("202511", "3")]
        self.assertEqual(fetch_ecos.parse_rows(rows, "M"), [
            {"date": "2025-11-01", "value": 3.0},
            {"date": "2026-02-01", "value": 1234.5},
        ])


class EcosFetchTests(unittest.TestCase):
    spec = {"stat": "901Y027", "items": ["I61E", "I28B"], "cycle": "M"}
    now = datetime(2026, 11, 14, tzinfo=timezone.utc)

    def test_pages_until_total_and_builds_item_path(self):
        first = [row(f"2000{m:02d}", str(m)) for m in range(1, 4)]
        second = [row("200004", "4")]
        with patch.object(fetch_ecos, "PAGE_SIZE", 3), \
                patch.object(fetch_ecos.requests, "get", side_effect=[page(first, 4), page(second, 4)]) as get:
            series = fetch_ecos.fetch_ecos_series(self.spec, KEY, now=self.now)
        self.assertEqual([p["value"] for p in series], [1.0, 2.0, 3.0, 4.0])
        urls = [c.args[0] for c in get.call_args_list]
        self.assertTrue(urls[0].endswith(f"/{KEY}/json/kr/1/3/901Y027/M/196001/202611/I61E/I28B"))
        self.assertIn("/json/kr/4/6/", urls[1])

    def test_no_data_result_is_empty_and_errors_hide_the_key(self):
        empty = Mock(raise_for_status=Mock())
        empty.json.return_value = {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}
        with patch.object(fetch_ecos.requests, "get", return_value=empty):
            self.assertEqual(fetch_ecos.fetch_ecos_series(self.spec, KEY, now=self.now), [])

        bad = Mock(raise_for_status=Mock())
        bad.json.return_value = {"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 유효하지 않습니다."}}
        with patch.object(fetch_ecos.requests, "get", return_value=bad):
            with self.assertRaises(fetch_ecos.EcosError) as ctx:
                fetch_ecos.fetch_ecos_series(self.spec, KEY, now=self.now)
        self.assertNotIn(KEY, str(ctx.exception))

        def boom(url, timeout):
            raise requests.ConnectionError(f"failed {url}")
        with patch.object(fetch_ecos.requests, "get", side_effect=boom):
            with self.assertRaises(fetch_ecos.EcosError) as ctx:
                fetch_ecos.fetch_ecos_series(self.spec, KEY, now=self.now)
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertIsNone(ctx.exception.__cause__)


class EcosCollectionTests(unittest.TestCase):
    def test_collect_applies_transform_marks_source_and_skips_failures(self):
        specs = {
            "KR_OK": {"stat": "A", "items": ["1"], "cycle": "M", "name": "ok", "category": "labor",
                      "unit": "thousand_persons", "transform": "yoy_diff"},
            "KR_FAIL": {"stat": "B", "items": ["1"], "cycle": "M", "name": "fail", "category": "labor",
                        "unit": "percent"},
        }
        monthly = [{"date": f"{2024 + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}-01", "value": float(m)} for m in range(1, 15)]

        def fake(spec, key):
            if spec["stat"] == "B":
                raise fetch_ecos.EcosError("down")
            return monthly
        with patch.object(fetch_ecos, "fetch_ecos_series", side_effect=fake), redirect_stdout(StringIO()):
            got, ok = fetch_ecos.collect_ecos(KEY, fetch_fred.TRANSFORMS, specs)
        self.assertEqual(ok, 1)
        self.assertEqual(set(got), {"KR_OK"})
        payload = got["KR_OK"]
        self.assertEqual((payload["region"], payload["source"], payload["exclude_assessment"]), ("KR", "ECOS", True))
        # 12 개월 전 대비 차이는 항상 12
        self.assertEqual([p["value"] for p in payload["series"]], [12.0, 12.0])

    def test_replaced_fred_series_dropped_only_when_ecos_value_exists(self):
        indicators = {"KORCPIALLMINMEI": {}, "MYAGM2KRM189S": {}, "KR_CPI": {}}
        self.assertEqual(fetch_ecos.drop_replaced(indicators), ["KORCPIALLMINMEI"])
        self.assertEqual(set(indicators), {"MYAGM2KRM189S", "KR_CPI"})

    def test_every_ecos_transform_exists_in_collector(self):
        for code, spec in fetch_ecos.ECOS_INDICATORS.items():
            if spec.get("transform"):
                self.assertIn(spec["transform"], fetch_fred.TRANSFORMS, code)


if __name__ == "__main__":
    unittest.main()
