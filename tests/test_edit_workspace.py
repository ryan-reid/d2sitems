"""Tests for the client-side EditWorkspace and WASM integration."""

from pathlib import Path
import unittest

ROOT_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT_DIR / "web"


class EditWorkspaceTests(unittest.TestCase):
    def test_edit_workspace_js_exists_and_served(self):
        js_file = WEB_DIR / "edit_workspace.js"
        self.assertTrue(js_file.is_file())
        content = js_file.read_text(encoding="utf-8")
        self.assertIn("window.EditWorkspace", content)
        self.assertIn("window.D2Wasm", content)

    def test_no_legacy_api_calls_in_edit_workspace(self):
        content = (WEB_DIR / "edit_workspace.js").read_text(encoding="utf-8")
        self.assertNotIn("/api/edit/start", content)
        self.assertNotIn("/api/edit/save", content)
        self.assertNotIn("/api/edit/discard", content)
        self.assertNotIn("/api/item/create", content)
        self.assertNotIn("/api/edit/pack", content)

    def test_no_legacy_api_calls_in_d2_armory(self):
        content = (WEB_DIR / "d2_armory.js").read_text(encoding="utf-8")
        self.assertNotIn("/api/stash/stack-quantity", content)
        self.assertNotIn("/api/item/transfer", content)
        self.assertNotIn("/api/shared-stash", content)

    def test_app_js_defaults_to_wasm_mode(self):
        content = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("isWasmMode: true", content)
        self.assertNotIn("/api/mules/create", content)
        self.assertNotIn("/api/character/quests/complete", content)
        self.assertNotIn("/api/mule/fill", content)


if __name__ == "__main__":
    unittest.main()
