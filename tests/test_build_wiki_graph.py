import copy
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import build_wiki_graph


FIRST = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
LATEST = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)


class WikiGraphOutputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.vault = root / "vault"
        self.vault.mkdir()
        (self.vault / "Alpha.md").write_text("Alpha links to [[Beta]].\n", encoding="utf-8")
        (self.vault / "Beta.md").write_text("Beta body.\n", encoding="utf-8")
        self.out = root / "output" / "graph.json"

    def build(self, at, *, repo="example/wiki", branch="main", no_content=False):
        argv = ["build_wiki_graph.py", "--vault", str(self.vault), "--out", str(self.out),
                "--repo", repo, "--branch", branch]
        if no_content:
            argv.append("--no-content")
        dates = {name: "2026-10-28" for name in ("Alpha.md", "Beta.md", "Gamma.md")}
        with patch.object(sys, "argv", argv), \
                patch.object(build_wiki_graph, "git_last_dates", return_value=dates), \
                patch.object(build_wiki_graph, "datetime", wraps=datetime) as clock, \
                redirect_stdout(StringIO()):
            clock.now.return_value = at
            self.assertEqual(build_wiki_graph.main(), 0)
        return json.loads(self.out.read_text(encoding="utf-8"))

    def test_first_build_keeps_schema_and_exports_bodies(self):
        graph = self.build(FIRST)
        self.assertEqual(set(graph), {
            "generated", "repo", "repo_url", "branch", "note_count", "edge_count",
            "has_content", "dimension_schema", "nodes", "edges",
        })
        self.assertEqual(graph["generated"], FIRST.isoformat(timespec="seconds"))
        self.assertEqual(graph["note_count"], 2)
        self.assertEqual(graph["edges"], [[0, 1]])
        body = json.loads((self.out.parent / "notes" / "0.json").read_text())
        self.assertEqual(body["content"], "Alpha links to [[Beta]].\n")

    def test_unchanged_graph_preserves_generated_and_existing_bytes(self):
        first = self.build(FIRST)
        # JSON object key order/formatting is not a graph change. Edges are JSON
        # lists on disk, while the builder internally uses tuples.
        reordered = dict(reversed(list(first.items())))
        self.out.write_text(json.dumps(reordered, indent=2), encoding="utf-8")
        before = self.out.read_bytes()
        self.assertEqual(self.build(LATER), first)
        self.assertEqual(self.out.read_bytes(), before)

    def test_changed_source_updates_graph_and_generation_time(self):
        self.build(FIRST)
        (self.vault / "Gamma.md").write_text("Gamma links to [[Alpha]].\n", encoding="utf-8")
        graph = self.build(LATER)
        self.assertEqual(graph["generated"], LATER.isoformat(timespec="seconds"))
        self.assertEqual(graph["note_count"], 3)
        self.assertEqual(graph["edge_count"], 2)
        self.assertIn([0, 2], graph["edges"])
        self.assertTrue((self.out.parent / "notes" / "2.json").is_file())

    def test_repo_and_branch_changes_are_graph_changes(self):
        for kwargs, expected in (({"repo": "other/wiki"}, {"repo": "other/wiki"}),
                                 ({"branch": "other"}, {"branch": "other"})):
            with self.subTest(kwargs=kwargs):
                self.build(FIRST)
                graph = self.build(LATER, **kwargs)
                self.assertEqual(graph["generated"], LATER.isoformat(timespec="seconds"))
                for key, value in expected.items():
                    self.assertEqual(graph[key], value)

    def test_body_only_changes_still_update_note_exports(self):
        self.build(FIRST)
        before = self.out.read_bytes()
        (self.vault / "Beta.md").write_text("Updated body on the same date.\n", encoding="utf-8")
        self.build(LATER)
        self.assertEqual(self.out.read_bytes(), before)
        body = json.loads((self.out.parent / "notes" / "1.json").read_text())
        self.assertEqual(body["content"], "Updated body on the same date.\n")

    def test_no_content_mode_changes_graph_then_becomes_noop(self):
        self.build(FIRST)
        graph = self.build(LATER, no_content=True)
        self.assertEqual(graph["generated"], LATER.isoformat(timespec="seconds"))
        self.assertFalse(graph["has_content"])
        self.assertFalse((self.out.parent / "notes").exists())
        before = self.out.read_bytes()
        self.build(LATEST, no_content=True)
        self.assertEqual(self.out.read_bytes(), before)

    def test_invalid_or_missing_previous_timestamp_is_repaired(self):
        first = self.build(FIRST)
        missing = copy.deepcopy(first)
        del missing["generated"]
        for text in ("{", "[]", "null", json.dumps(missing),
                     json.dumps({**first, "generated": None}),
                     json.dumps({**first, "generated": ""})):
            with self.subTest(previous=text[:30]):
                self.out.write_text(text, encoding="utf-8")
                graph = self.build(LATER)
                self.assertEqual(graph["generated"], LATER.isoformat(timespec="seconds"))
                self.assertEqual(graph["edges"], [[0, 1]])

    def test_other_metadata_is_not_ignored(self):
        first = self.build(FIRST)
        for previous in ({**first, "future_schema_field": True}, {**first, "has_content": 1}):
            with self.subTest(previous_has_content=previous["has_content"]):
                self.out.write_text(json.dumps(previous), encoding="utf-8")
                graph = self.build(LATER)
                self.assertNotIn("future_schema_field", graph)
                self.assertIs(graph["has_content"], True)
                self.assertEqual(graph["generated"], LATER.isoformat(timespec="seconds"))


if __name__ == "__main__":
    unittest.main()
