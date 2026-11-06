"""Offline catalog validation and importer failure regressions."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("reference_importer", ROOT / "scripts/import_reference_catalog.py")
importer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(importer)


class ReferenceCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / "data/reference-catalog.json").read_text(encoding="utf-8"))

    def test_reviewed_catalog_counts_and_sources(self):
        importer.validate_catalog(self.catalog)
        self.assertEqual(len(self.catalog["costumes"]), 3224)
        self.assertEqual(len(self.catalog["portraits"]), 1499)
        self.assertEqual(len(self.catalog["sources"]), 5)

    def test_stable_ids_are_globally_unique(self):
        records = self.catalog["costumes"] + self.catalog["portraits"]
        ids = [record["id"] for record in records]
        self.assertEqual(len(ids), len(set(ids)))
        for value in ("SPR-0001", "gia-anime-SPR-0001", "charadb-O001", "shisei-C001", "portrait-f71f980dde3"):
            self.assertIn(value, ids)

    def test_every_image_is_a_source_url(self):
        for record in self.catalog["costumes"] + self.catalog["portraits"]:
            for role in ("thumb", "full"):
                importer.validate_image_url(record[role], record, role)
        portrait = self.catalog["portraits"][0]
        self.assertEqual(portrait["full"], "https://ai-portrait-gallery.pages.dev/img/full/f71f980dde3.png")
        self.assertEqual(portrait["thumb"], "https://ai-portrait-gallery.pages.dev/img/thumb/f71f980dde3.webp")

    def test_sensitive_categories_and_upstream_flags_are_retained(self):
        sensitive = [row for row in self.catalog["costumes"] if row["category"] in importer.SENSITIVE_CATEGORIES]
        self.assertTrue(sensitive)
        self.assertTrue(all(row["nsfw"] for row in sensitive))
        self.assertEqual(sum(row["nsfw"] for row in self.catalog["costumes"] if row["source"] == "charadb"), 44)

    def test_historical_views_are_pinned(self):
        rows = [row for row in self.catalog["costumes"] if row["source"] == "shisei"]
        self.assertEqual(len(rows), 57)
        self.assertEqual(sum(len(row["views"]) for row in rows), 227)
        for row in rows:
            for view in row["views"]:
                self.assertIn(importer.SHISEI_COMMIT, view["full"])
                self.assertIn("/w900/", view["full"])
                self.assertIn("/w300/", view["thumb"])

    def test_duplicate_ids_are_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["costumes"][1]["id"] = catalog["costumes"][0]["id"]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            importer.validate_catalog(catalog)

    def test_wrong_counts_and_commit_are_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["portraits"].pop()
        with self.assertRaisesRegex(ValueError, "count"):
            importer.validate_catalog(catalog)
        catalog = dict(self.catalog, upstreamCommit="main")
        with self.assertRaisesRegex(ValueError, "revision"):
            importer.validate_catalog(catalog)

    def test_local_untrusted_and_credential_urls_are_rejected(self):
        record = self.catalog["costumes"][0]
        for value in ("file:///private.png", "http://127.0.0.1/test.png", "https://example.org/SPR-0001.png",
                      "https://token@ai-costume-gallery.pages.dev/png/SPR-0001.png",
                      record["full"] + "?token=sample", record["full"] + "#fragment"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                importer.validate_image_url(value, record, "full")

    def test_changed_licensing_is_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["sources"][2]["note"] = ""
        with self.assertRaisesRegex(ValueError, "licensing"):
            importer.validate_catalog(catalog)

    def test_invalid_flags_are_rejected(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["costumes"][0]["nsfw"] = "false"
        with self.assertRaisesRegex(ValueError, "flag"):
            importer.validate_catalog(catalog)

    def test_atomic_replace_failure_preserves_previous_catalog(self):
        with tempfile.TemporaryDirectory(prefix="pose-catalog-test-") as directory:
            target = Path(directory) / "catalog.json"
            target.write_bytes(b"previous catalog")
            with patch.object(importer.os, "replace", side_effect=OSError("simulated replace failure")):
                with self.assertRaises(OSError):
                    importer.write_catalog(self.catalog, target)
            self.assertEqual(target.read_bytes(), b"previous catalog")
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_invalid_catalog_does_not_replace_previous_file(self):
        with tempfile.TemporaryDirectory(prefix="pose-catalog-test-") as directory:
            target = Path(directory) / "catalog.json"
            target.write_bytes(b"previous catalog")
            with self.assertRaises(ValueError):
                importer.write_catalog({}, target)
            self.assertEqual(target.read_bytes(), b"previous catalog")

    def test_repeated_write_is_deterministic(self):
        with tempfile.TemporaryDirectory(prefix="pose-catalog-test-") as directory:
            target = Path(directory) / "catalog.json"
            importer.write_catalog(self.catalog, target)
            first = target.read_bytes()
            importer.write_catalog(self.catalog, target)
            self.assertEqual(first, target.read_bytes())
            self.assertEqual(json.loads(first), self.catalog)

    def test_importer_only_fetches_known_metadata(self):
        with patch.object(importer, "urlopen") as request:
            with self.assertRaisesRegex(ValueError, "Unknown metadata"):
                importer.fetch_metadata("../img/image.png")
            request.assert_not_called()

    def test_metadata_fetch_has_timeout_and_size_limit(self):
        with patch.object(importer, "urlopen") as request:
            response = request.return_value.__enter__.return_value
            response.read.return_value = b"x" * (importer.MAX_METADATA_BYTES + 1)
            with self.assertRaisesRegex(ValueError, "size limit"):
                importer.fetch_metadata("costume-zh.json", timeout=12)
            self.assertEqual(request.call_args.kwargs["timeout"], 12)
            self.assertIn(importer.UPSTREAM_COMMIT, request.call_args.args[0].full_url)
            response.read.assert_called_once_with(importer.MAX_METADATA_BYTES + 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
