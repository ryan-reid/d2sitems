"""Read-only catalog/API normalization checks; mutations are mocked."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import web_ui


class ApiDataTests(unittest.TestCase):
    def test_core_scope_isolated_without_changing_global_data(self):
        with patch.object(web_ui.SaveDataManager, "reload"):
            manager = web_ui.SaveDataManager()
        manager.saves = [dict(file="Hard.d2s", core="hard"), dict(file="Soft.d2s", core="soft")]
        manager.items = [dict(id=1, sourceCore="hard"), dict(id=2, sourceCore="soft"), dict(id=3)]
        hard = manager.scoped_to_core("hard")
        soft = manager.scoped_to_core("soft")
        self.assertEqual([s["file"] for s in hard.saves], ["Hard.d2s"])
        self.assertEqual([i["id"] for i in hard.items], [1])
        self.assertEqual([i["id"] for i in soft.items], [2])
        self.assertEqual(len(manager.items), 3)
        with self.assertRaises(ValueError):
            manager.scoped_to_core("all")

    def test_shared_stash_matches_character_mode(self):
        with patch.object(web_ui.SaveDataManager, "reload"):
            manager = web_ui.SaveDataManager()
        manager.items = []
        manager.saves = [
            dict(name="Hero", file="Hero.d2s", core="soft", gameVersion="ReignOfTheWarlock"),
            dict(is_stash=True, file="Hard.d2i", core="hard", gameVersion="ReignOfTheWarlock"),
            dict(is_stash=True, file="Soft.d2i", core="soft", gameVersion="ReignOfTheWarlock")
        ]
        self.assertEqual(manager.get_shared_stash_detail("Hero")["save"]["file"], "Soft.d2i")
        self.assertIsNone(manager.get_shared_stash_detail())
        manager.saves.append(dict(manager.saves[-1], file="Duplicate.d2i"))
        self.assertIsNone(manager.get_shared_stash_detail("Hero"))

    def test_stale_catalog_never_restores_old_badges(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = dict(id="test", name="Test", save_dir=directory, excel_dir=directory)
            Path(directory, "Test.json").write_text(json.dumps({
                "file": "Test.d2s", "character": {"name": "Test"},
                "catalogRevision": "old", "items": [{
                    "name": "Test item", "quality": "Unique", "perfectionScore": 100,
                    "isOutOfDate": True, "outOfDateIssues": ["old mismatch"],
                    "verificationStatus": "verified"
                }]
            }), encoding="utf-8")
            with patch.object(web_ui, "detect_profiles", return_value=[profile]):
                manager = web_ui.SaveDataManager()
            item = manager.items[0]
            self.assertEqual(item["verificationStatus"], "unknown")
            self.assertFalse(item["isOutOfDate"])
            self.assertIsNone(item["perfectionNum"])
            self.assertEqual(item["outOfDateIssues"], [])
            self.assertEqual(manager.get_verifier_report()["total_up_to_date"], 0)
            with patch.object(web_ui.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "scan failed")):
                self.assertFalse(manager.run_scan()["success"])

    def test_source_checkout_uses_current_engine(self):
        with patch.object(web_ui.shutil, "which", return_value="dotnet"):
            kind, path = web_ui.find_d2s_runner()
        self.assertEqual(kind, "dotnet")
        self.assertTrue(path.endswith("d2sitems.csproj"))

    def test_chronicle_report_aggregation(self):
        with patch.object(web_ui.SaveDataManager, "reload"):
            manager = web_ui.SaveDataManager()
        manager.saves = [
            {
                "type": "SharedStash",
                "core": "soft",
                "chronicle": {
                    "uniques": [{"id": 1, "name": "The Gnasher"}],
                    "sets": [],
                    "runewords": []
                }
            },
            {
                "type": "SharedStash",
                "core": "hard",
                "chronicle": {
                    "uniques": [{"id": 2, "name": "Deathspade"}],
                    "sets": [],
                    "runewords": []
                }
            }
        ]
        mock_grail = {
            "Unique Items": ["The Gnasher", "Deathspade", "Bane Ash"],
            "Set Items": [],
            "Runewords": []
        }
        with patch("find_items.load_grail_items", return_value=mock_grail):
            with patch.object(manager, "get_active_profile", return_value={"excel_dir": "."}):
                rep_both = manager.get_chronicle_report("both")
                self.assertEqual(rep_both["total_owned"], 2)
                self.assertEqual(rep_both["total_items"], 3)
                rep_soft = manager.get_chronicle_report("soft")
                self.assertEqual(rep_soft["total_owned"], 1)
                rep_hard = manager.get_chronicle_report("hard")
                self.assertEqual(rep_hard["total_owned"], 1)


if __name__ == "__main__":
    unittest.main()
