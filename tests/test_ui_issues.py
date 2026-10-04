import unittest
import time
import os
import base64
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

BASE_URL = "http://localhost:5000"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_CHAR = os.path.join(REPO_ROOT, "tests", "fixtures", "baselines", "Amazon_L1.golden.d2s")
FIXTURE_STASH = os.path.join(REPO_ROOT, "tests", "fixtures", "baselines", "ModernSharedStashSoftCoreV2.golden.d2i")

class TestUIIssuesResolution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE_STASH, "rb") as f:
            cls.stash_b64 = base64.b64encode(f.read()).decode("ascii")
        with open(FIXTURE_CHAR, "rb") as f:
            cls.char_b64 = base64.b64encode(f.read()).decode("ascii")

        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        cls.driver = webdriver.Chrome(options=chrome_options)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()

    def setUp(self):
        driver = self.driver
        driver.get(BASE_URL)
        WebDriverWait(driver, 10).until(lambda d: d.execute_script("return typeof window.D2Wasm !== 'undefined'"))
        ingest_script = """
        const done = arguments[arguments.length - 1];
        (async () => {
            try {
                if (typeof enableWasmMode === 'function' && !window.state?.isWasmMode) await enableWasmMode();
                await window.D2Wasm.init();
                const charBytes = Uint8Array.from(atob(arguments[0]), c => c.charCodeAt(0));
                const stashBytes = Uint8Array.from(atob(arguments[1]), c => c.charCodeAt(0));
                await window.D2Wasm.ingestFiles([
                    { name: 'TestAmazon.d2s', bytes: charBytes },
                    { name: 'ModernSharedStashSoftCoreV2.d2i', bytes: stashBytes }
                ]);
                await window.refreshWasmDataset();
                done({ success: true });
            } catch(err) {
                done({ success: false, error: err.toString() });
            }
        })();
        """
        res = driver.execute_async_script(ingest_script, self.char_b64, self.stash_b64)
        self.assertTrue(res.get("success"), f"Ingestion failed: {res.get('error')}")
        time.sleep(1)

    def test_01_load_saves_and_verify_shared_stash_counts(self):
        """Verify Shared Stash tabs show item counts and fit without horizontal scrolling."""
        driver = self.driver

        # Switch to Armory View
        armory_nav = driver.find_element(By.CSS_SELECTOR, "button[data-tab='armory-view']")
        armory_nav.click()
        time.sleep(1)

        # Verify Shared Stash count in the main tabs
        shared_tab_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'd2r-tab-btn') and contains(text(), 'Shared')]")
        self.assertIn("(", shared_tab_btn.text)
        self.assertNotIn("(0)", shared_tab_btn.text, "Shared tab should show actual count, not (0)")
        print(f"  [PASS] Main Shared Stash Tab shows count: {shared_tab_btn.text}")

        # Click Shared Tab
        shared_tab_btn.click()
        time.sleep(1)

        # Verify subtab buttons have short names, item counts, and no horizontal scroll
        subtab_buttons = driver.find_elements(By.CSS_SELECTOR, ".d2r-subtab-btn")
        self.assertGreaterEqual(len(subtab_buttons), 5, "Expected at least 5 shared stash subtabs")
        for btn in subtab_buttons:
            text = btn.text.strip()
            self.assertTrue(text.startswith("Shared ") or text.startswith("Tab "), f"Expected short tab name, got {text}")
            self.assertIn("(", text, f"Expected item count in subtab, got {text}")
        print(f"  [PASS] All {len(subtab_buttons)} shared subtabs show short names and counts: {[b.text for b in subtab_buttons]}")

        # Check subtabs container overflow
        subtab_pages = driver.find_element(By.CSS_SELECTOR, ".d2r-subtab-pages")
        scroll_width = driver.execute_script("return arguments[0].scrollWidth;", subtab_pages)
        client_width = driver.execute_script("return arguments[0].clientWidth;", subtab_pages)
        self.assertLessEqual(scroll_width, client_width + 10, f"Subtabs should fit without horizontal scrolling (scrollWidth={scroll_width}, clientWidth={client_width})")
        print("  [PASS] Shared stash subtabs fit completely within screen width without horizontal scrolling")

    def test_02_crafting_and_stackable_tab_images(self):
        """Verify crafting and stackable tabs render proper images without leading slash errors."""
        driver = self.driver
        armory_nav = driver.find_element(By.CSS_SELECTOR, "button[data-tab='armory-view']")
        armory_nav.click()
        time.sleep(1)

        # Switch to Stackable tab
        stackable_tab_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'd2r-tab-btn') and contains(text(), 'Stackable')]")
        stackable_tab_btn.click()
        time.sleep(1)

        # Verify viewport background doesn't 404
        viewport = driver.find_element(By.ID, "d2r-mod-stackable-viewport")
        bg_style = driver.execute_script("return window.getComputedStyle(arguments[0]).backgroundImage;", viewport)
        self.assertNotIn("404", bg_style)
        self.assertIn("panel_additionalstash_all.png", bg_style)
        print("  [PASS] Stackable viewport background loaded:", bg_style)

        # Check watermarks and item icons in stackable slots
        watermarks = driver.find_elements(By.CSS_SELECTOR, "#d2r-mod-stackable-viewport .d2r-mod-slot-watermark")
        self.assertGreater(len(watermarks), 0, "Expected watermark images in empty slots")
        for wm in watermarks[:5]:
            src = wm.get_attribute("src")
            self.assertIn("assets/items/", src)
            self.assertNotIn("//assets", src)
            is_loaded = driver.execute_script("return arguments[0].naturalWidth > 0;", wm)
            self.assertTrue(is_loaded, f"Watermark image failed to load: {src}")
        print(f"  [PASS] Verified {len(watermarks)} watermark icons loaded properly in stackable tab")

        # Switch to Crafting tab
        crafting_tab_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'd2r-tab-btn') and contains(text(), 'Crafting')]")
        crafting_tab_btn.click()
        time.sleep(1)

        craft_viewport = driver.find_element(By.ID, "d2r-mod-crafting-viewport")
        craft_bg = driver.execute_script("return window.getComputedStyle(arguments[0]).backgroundImage;", craft_viewport)
        self.assertIn("stashpanel_bkd.png", craft_bg)
        print("  [PASS] Crafting viewport background loaded:", craft_bg)

        craft_watermarks = driver.find_elements(By.CSS_SELECTOR, "#d2r-mod-crafting-viewport .d2r-mod-slot-watermark")
        self.assertGreater(len(craft_watermarks), 0, "Expected watermark images in crafting slots")
        for wm in craft_watermarks[:5]:
            src = wm.get_attribute("src")
            self.assertIn("assets/items/", src)
            is_loaded = driver.execute_script("return arguments[0].naturalWidth > 0;", wm)
            self.assertTrue(is_loaded, f"Crafting watermark failed to load: {src}")
        print(f"  [PASS] Verified {len(craft_watermarks)} crafting watermark icons loaded properly")

    def test_03_no_confirm_override_for_live_character(self):
        """Verify 'Confirm override for live character' confirmation prompts are eliminated."""
        driver = self.driver
        page_html = driver.page_source
        self.assertNotIn("⚠️ Confirm override for live main character", page_html)
        self.assertNotIn("quests-force-live-check", page_html)
        self.assertNotIn("transfer-force-live-check", page_html)
        self.assertNotIn("pack-force-live-check", page_html)
        print("  [PASS] Verified 'Confirm override for live main character' elements are completely removed")

    def test_04_editing_stacks_requires_edit_mode_and_stages_without_download(self):
        """Verify editing stacks requires Edit mode, stages changes into EditWorkspace, and does not immediately download."""
        driver = self.driver
        armory_nav = driver.find_element(By.CSS_SELECTOR, "button[data-tab='armory-view']")
        armory_nav.click()
        time.sleep(1)

        # Ensure we are in Stackable tab
        stackable_tab_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'd2r-tab-btn') and contains(text(), 'Stackable')]")
        stackable_tab_btn.click()
        time.sleep(1)

        # 1. Without edit mode: clicking an item slot should prompt to turn on edit mode
        res = driver.execute_script("""
            const slot = document.querySelector('#d2r-mod-stackable-viewport .d2r-mod-slot.has-item');
            if (!slot) return 'no_slot';
            slot.click();
            const modal = document.getElementById('edit-stack-modal');
            return modal && modal.style.display !== 'none' ? 'opened' : 'blocked';
        """)
        self.assertEqual(res, 'blocked', "Stack editing should be blocked when Edit Mode is off")
        print("  [PASS] Stack editing is blocked when Edit Mode is off")

        # 2. Turn on Edit Mode
        edit_start_btn = driver.find_element(By.ID, "edit-start")
        edit_start_btn.click()
        time.sleep(1)
        self.assertTrue(driver.execute_script("return window.EditWorkspace?.active;"), "Edit mode should be active")

        # Find Ral Rune slot (r08) in Tab 5
        slot_info = driver.execute_script("""
            const slot = document.querySelector('#d2r-mod-stackable-viewport .d2r-mod-slot[data-code="r08"]');
            if (!slot) return null;
            const code = slot.getAttribute('data-code');
            const name = slot.getAttribute('data-name');
            const qty = parseInt(slot.getAttribute('data-qty'), 10);
            window.openEditStackModalByCode(code, name, qty, 5);
            return { code, name, qty };
        """)
        self.assertIsNotNone(slot_info, "Expected r08 slot in stackable viewport")
        time.sleep(1)

        # Verify modal is now open
        modal = driver.find_element(By.ID, "edit-stack-modal")
        self.assertTrue(modal.is_displayed(), "Edit stack modal should be open")
        print("  [PASS] Edit stack modal opened successfully with Edit mode active")

        # Track downloads before saving stack
        driver.execute_script("""
            window.__downloadCalls = [];
            const origDownload = window.D2Wasm.downloadFile.bind(window.D2Wasm);
            window.D2Wasm.downloadFile = function(name, bytes) {
                window.__downloadCalls.push(name);
                return origDownload(name, bytes);
            };
        """)

        # Change quantity to 64 and submit
        qty_input = driver.find_element(By.ID, "edit-stack-qty-input")
        qty_input.clear()
        qty_input.send_keys("64")

        submit_btn = driver.find_element(By.ID, "btn-submit-edit-stack")
        submit_btn.click()
        time.sleep(2)

        # Verify no immediate file download was triggered!
        download_calls = driver.execute_script("return window.__downloadCalls;")
        self.assertEqual(len(download_calls), 0, f"Expected 0 immediate downloads, got: {download_calls}")
        print("  [PASS] Verified NO automatic/immediate file download occurred on stack save")

        # Verify EditWorkspace staged change
        staged_changes = driver.execute_script("return window.EditWorkspace?.changes;")
        self.assertGreaterEqual(staged_changes, 1, "EditWorkspace should have at least 1 staged change")
        print(f"  [PASS] EditWorkspace successfully registered {staged_changes} staged change(s)")

        # Verify slot badge updated to 64
        updated_qty = driver.execute_script("""
            const slot = document.querySelector('#d2r-mod-stackable-viewport .d2r-mod-slot[data-code="r08"]');
            return slot ? slot.getAttribute('data-qty') : null;
        """)
        self.assertEqual(updated_qty, "64", f"Expected stack qty 64 on slot, got {updated_qty}")
        print("  [PASS] Slot display and data-qty updated cleanly to 64 in browser memory")

    def test_05_save_and_export_clears_export_button_count(self):
        """Verify saving in Edit Mode or clicking Export clears Export(#) button count."""
        driver = self.driver
        export_btn = driver.find_element(By.ID, "wasm-export-btn")
        export_label = driver.find_element(By.ID, "wasm-export-label")

        # Initial clean state
        self.assertIn("Export", export_label.text)
        self.assertNotIn("has-modifications", export_btn.get_attribute("class"))
        print("  [PASS] Initial state: Export button shows 'Export' with 0 pending")

        # Switch to armory and turn on edit mode
        armory_nav = driver.find_element(By.CSS_SELECTOR, "button[data-tab='armory-view']")
        armory_nav.click()
        time.sleep(1)

        edit_start_btn = driver.find_element(By.ID, "edit-start")
        edit_start_btn.click()
        time.sleep(1)

        # Switch to stackable tab and modify Ral Rune
        stackable_tab_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'd2r-tab-btn') and contains(text(), 'Stackable')]")
        stackable_tab_btn.click()
        time.sleep(1)

        driver.execute_script("""
            const slot = document.querySelector('#d2r-mod-stackable-viewport .d2r-mod-slot[data-code="r08"]');
            const code = slot.getAttribute('data-code');
            const name = slot.getAttribute('data-name');
            const qty = parseInt(slot.getAttribute('data-qty'), 10);
            window.openEditStackModalByCode(code, name, qty, 5);
        """)
        time.sleep(1)

        qty_input = driver.find_element(By.ID, "edit-stack-qty-input")
        qty_input.clear()
        qty_input.send_keys("77")

        submit_btn = driver.find_element(By.ID, "btn-submit-edit-stack")
        submit_btn.click()
        time.sleep(1)

        # Verify staged change
        staged = driver.execute_script("return window.EditWorkspace?.changes || 0;")
        self.assertEqual(staged, 1)

        # Click Save changes
        edit_save_btn = driver.find_element(By.ID, "edit-save")
        edit_save_btn.click()
        time.sleep(2)

        # Verify Edit Mode turned off
        is_active = driver.execute_script("return window.EditWorkspace?.active;")
        self.assertFalse(is_active, "Edit mode should be inactive after Save changes")

        # Verify Export button immediately cleared and does NOT show Export(1)
        current_label = driver.find_element(By.ID, "wasm-export-label").text.strip()
        current_btn = driver.find_element(By.ID, "wasm-export-btn")
        modified_count = driver.execute_script("return window.D2Wasm.getModifiedFiles().length;")

        self.assertEqual(modified_count, 0, f"Expected 0 modified files after Save, got {modified_count}")
        self.assertIn("Export", current_label)
        self.assertNotIn("(", current_label)
        self.assertNotIn("has-modifications", current_btn.get_attribute("class"))
        print(f"  [PASS] After Save changes: Export(#) button count cleared cleanly (0 unexported)")

        # Now test manual modification and clicking the Export button directly
        driver.execute_script("""
            // Make a direct modification in loadedFiles
            const stash = window.D2Wasm.loadedFiles.get('ModernSharedStashSoftCoreV2.d2i');
            if (stash) {
                const copy = new Uint8Array(stash);
                copy[copy.length - 1] ^= 0xFF; // flip last byte
                window.D2Wasm.loadedFiles.set('ModernSharedStashSoftCoreV2.d2i', copy);
                window.updateExportButtonState();
            }
        """)
        time.sleep(1)

        # Button should now show Export (1)
        btn_with_mod = driver.find_element(By.ID, "wasm-export-label").text.strip()
        self.assertIn("(1)", btn_with_mod, f"Expected '(1)', got '{btn_with_mod}'")
        print("  [PASS] Direct modification reflects as 'Export (1)'")

        # Click Export button
        export_btn.click()
        time.sleep(2)

        # Verify button immediately cleared back to Export
        final_label = driver.find_element(By.ID, "wasm-export-label").text.strip()
        final_modified = driver.execute_script("return window.D2Wasm.getModifiedFiles().length;")
        self.assertEqual(final_modified, 0, f"Expected 0 modified files after Export, got {final_modified}")
        self.assertIn("Export", final_label)
        self.assertNotIn("(", final_label)
        print(f"  [PASS] After clicking Export button: Export(#) count cleared cleanly")

if __name__ == '__main__':
    unittest.main()

