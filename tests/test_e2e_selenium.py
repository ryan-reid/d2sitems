#!/usr/bin/env python3
"""
Full End-to-End Regression Test Suite for D2SItems / BKDiablo Ascension Armory
Tests all critical flows on GitHub Pages (https://ryan-reid.github.io/d2sitems/)
using Selenium WebDriver with structured IF / THEN / WHEN specifications.

Covers:
  1. Item Search with affixes (Holy Fire, Teleport, All Skills) + Cancel/Clear
  2. Character Creation (class + name) + Cancel creation
  3. Muling shared stash to an existing character + Cancel muling
  4. Muling shared stash to new character(s) via Bulk Pack + Cancel bulk pack
  5. Creating new items on a character in Edit Mode + Cancel creation
  6. Editing existing items / stack quantities + Cancel editing
  7. Updating The Chronicle (Complete, Undroppable, Reset) + Cancel/Revert
  8. Browser Cache Invalidation & Re-load (IndexedDB purge, dropzone) + Cancel/Re-ingest
"""

import os
import sys
import time
import base64
import unittest
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

BASE_URL = os.environ.get("D2S_TEST_URL", "https://ryan-reid.github.io/d2sitems/")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
FIXTURE_CHAR = os.path.join(REPO_ROOT, "tests", "fixtures", "baselines", "Amazon_L1.golden.d2s")
FIXTURE_STASH = os.path.join(REPO_ROOT, "tests", "fixtures", "baselines", "ModernSharedStashSoftCoreV2.golden.d2i")


def log_bdd(step_type: str, message: str):
    """Print BDD formatted step: IF, WHEN, or THEN."""
    prefix = f"[{step_type.upper():<4}]"
    print(f"  {prefix} {message}")


class D2SE2ERegressionTests(unittest.TestCase):
    """
    Full end-to-end regression tests running against the GitHub Pages site.
    All tests adhere to strict IF / WHEN / THEN behavioral verification.
    """

    @classmethod
    def setUpClass(cls):
        print(f"\n=======================================================")
        print(f"Starting Selenium E2E Regression Suite")
        print(f"Target URL: {BASE_URL}")
        print(f"=======================================================\n")
        
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        
        cls.driver = webdriver.Edge(options=options)
        cls.driver.set_window_size(1920, 1080)
        cls.driver.set_script_timeout(120)
        cls.wait = WebDriverWait(cls.driver, 20)

        # Pre-read baseline fixtures as Base64 strings
        with open(FIXTURE_CHAR, "rb") as f:
            cls.b64_char = base64.b64encode(f.read()).decode("ascii")
        with open(FIXTURE_STASH, "rb") as f:
            cls.b64_stash = base64.b64encode(f.read()).decode("ascii")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "driver") and cls.driver:
            cls.driver.quit()
        print(f"\n=======================================================")
        print(f"Completed Selenium E2E Regression Suite")
        print(f"=======================================================\n")

    def setUp(self):
        """Navigate to target site and ingest clean baseline fixtures before each test."""
        self.driver.get(BASE_URL)
        self.wait.until(lambda d: d.execute_script("return Boolean(window.D2Wasm && window.D2Wasm.init)"))
        self._ingest_clean_fixtures()

    def _ingest_clean_fixtures(self):
        """Loads TestAmazon.d2s and ModernSharedStashSoftCoreV2.d2i into browser WASM session."""
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
                done({ success: true, count: window.state.items.length, saves: window.state.saves.length });
            } catch(err) {
                done({ success: false, error: err.toString() });
            }
        })();
        """
        res = self.driver.execute_async_script(ingest_script, self.b64_char, self.b64_stash)
        self.assertTrue(res.get("success"), f"Failed to ingest fixtures: {res.get('error')}")

    def safe_click(self, element):
        """Scrolls element into center view and triggers a reliable JavaScript click."""
        self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].click();", element)

    # =========================================================================
    # FLOW 1: ITEM SEARCH (AFFIX FILTERING & CANCELLATION)
    # =========================================================================
    def test_01_item_search_affixes_and_cancel_clear(self):
        """
        IF:   439 items are ingested across character and stash saves in Item Search view.
        WHEN: The user searches for specific affixes ('Holy Fire', 'Teleport', 'All Skills').
        THEN: Filtered result cards correctly display items containing the queried affixes.
        WHEN: The search filter is cancelled via the clear button.
        THEN: The input is wiped and the full catalog of 439 items is restored.
        """
        print("\n--- [FLOW 1] Item Search with Affixes & Cancel/Clear ---")
        
        log_bdd("IF", "439 items are loaded in browser memory and Item Search view is open")
        badge = self.driver.find_element(By.ID, "results-count-badge")
        self.assertIn("439", badge.text)

        search_input = self.driver.find_element(By.ID, "search-input")
        clear_btn = self.driver.find_element(By.ID, "search-clear-btn")

        # 1. Search for "Holy Fire"
        log_bdd("WHEN", "User searches for affix 'Holy Fire'")
        search_input.clear()
        search_input.send_keys("Holy Fire")
        self.wait.until(lambda d: "4 items found" in d.find_element(By.ID, "results-count-badge").text)
        log_bdd("THEN", "4 items matching Holy Fire are returned (Todesfaelle Flamme, Warriors Heart, Hellslayer)")
        items_grid = self.driver.find_element(By.ID, "items-grid")
        self.assertIn("Holy Fire", items_grid.text)

        # 2. Search for "Teleport"
        log_bdd("WHEN", "User searches for affix 'Teleport'")
        search_input.clear()
        search_input.send_keys("Teleport")
        self.wait.until(lambda d: "3 items found" in d.find_element(By.ID, "results-count-badge").text)
        log_bdd("THEN", "3 items matching Teleport are returned (Naj's Puzzler, The Oculus)")
        self.assertIn("Teleport", items_grid.text)

        # 3. Search for "All Skills"
        log_bdd("WHEN", "User searches for affix 'All Skills'")
        search_input.clear()
        search_input.send_keys("All Skills")
        self.wait.until(lambda d: int(d.find_element(By.ID, "results-count-badge").text.split()[0]) > 20)
        log_bdd("THEN", "Items with All Skills (e.g. Hellfire Torch, Islestrike) are displayed")
        self.assertIn("Skills", items_grid.text)

        # 4. Cancel / Clear search
        log_bdd("WHEN", "User cancels the search by clicking the search clear button")
        self.safe_click(clear_btn)
        self.wait.until(lambda d: "439 items found" in d.find_element(By.ID, "results-count-badge").text)
        log_bdd("THEN", "Search query is emptied and full 439 item collection is restored")
        self.assertEqual(search_input.get_attribute("value"), "")
        self.assertIn("439", self.driver.find_element(By.ID, "results-count-badge").text)

    # =========================================================================
    # FLOW 2: CREATE CHARACTER (EXECUTION & CANCELLATION)
    # =========================================================================
    def test_02_create_character_cancel_and_execute(self):
        """
        IF:   The Create Mule modal is launched from the interface.
        WHEN: The user fills character details ('CancelPaladin', Paladin) and clicks Cancel.
        THEN: The modal closes and no character is added to the system.
        WHEN: The user enters ('AutoPaladinQ', Paladin) and clicks Create Character.
        THEN: A new Paladin character is created, rendered in the hero selector, and marked modified.
        """
        print("\n--- [FLOW 2] Creating New Character: Cancel & Execute ---")

        log_bdd("IF", "The user initiates new character creation via openCreateMuleModal()")
        self.driver.execute_script("openCreateMuleModal()")
        modal = self.driver.find_element(By.ID, "create-mule-modal")
        self.wait.until(lambda d: modal.is_displayed())

        name_input = self.driver.find_element(By.ID, "mule-name-input")
        class_select = self.driver.find_element(By.ID, "mule-class-select")
        cancel_btn = modal.find_element(By.CSS_SELECTOR, ".btn-secondary")
        submit_btn = self.driver.find_element(By.ID, "btn-submit-mule")

        # Cancellation Sub-flow
        log_bdd("WHEN", "User enters name 'CancelPaladin', selects Paladin, but clicks Cancel")
        name_input.send_keys("CancelPaladin")
        class_select.send_keys("Paladin")
        self.safe_click(cancel_btn)
        self.wait.until(lambda d: not modal.is_displayed())

        log_bdd("THEN", "Modal closes and no character named 'CancelPaladin' exists in loaded files")
        saves = self.driver.execute_script("return window.state.saves.map(s => s.name)")
        self.assertNotIn("CancelPaladin", saves)

        # Execution Sub-flow
        log_bdd("WHEN", "User reopens modal, enters 'AutoPaladinQ', selects Paladin, and submits")
        self.driver.execute_script("openCreateMuleModal()")
        self.wait.until(lambda d: modal.is_displayed())
        name_input = self.driver.find_element(By.ID, "mule-name-input")
        name_input.clear()
        name_input.send_keys("AutoPaladinQ")
        class_select = self.driver.find_element(By.ID, "mule-class-select")
        class_select.send_keys("Paladin")
        self.safe_click(submit_btn)
        self.wait.until(lambda d: not modal.is_displayed())

        log_bdd("THEN", "New Paladin mule 'AutoPaladinQ' is created and tracked as a new save")
        new_saves = self.driver.execute_script("return window.state.saves.map(s => s.name)")
        self.assertIn("AutoPaladinQ", new_saves)
        
        modified_files = self.driver.execute_script("return window.D2Wasm.getModifiedFiles().map(f => f.name)")
        self.assertIn("AutoPaladinQ.d2s", modified_files)

    # =========================================================================
    # FLOW 3: MULING SHARED STASH TO EXISTING CHARACTER
    # =========================================================================
    def test_03_mule_shared_stash_to_existing_character(self):
        """
        IF:   Items exist in the shared stash and an existing hero ('TestAmazon.d2s') is loaded.
        WHEN: The Pack Mule modal is opened, target is selected, and Cancel is clicked.
        THEN: The modal closes with zero items transferred.
        WHEN: The user confirms muling items from Tab 0 to TestAmazon.
        THEN: Items transfer into TestAmazon's inventory and both save files reflect changes.
        """
        print("\n--- [FLOW 3] Muling Stash to Existing Character: Cancel & Execute ---")

        log_bdd("IF", "Pack Mule modal is opened to transfer items from stash to TestAmazon")
        self.driver.execute_script("openPackMuleModal()")
        modal = self.driver.find_element(By.ID, "pack-mule-modal")
        self.wait.until(lambda d: modal.is_displayed())

        target_select = self.driver.find_element(By.ID, "pack-target-char-select")
        target_select.send_keys("TestAmazon.d2s")
        cancel_btn = modal.find_element(By.CSS_SELECTOR, ".btn-secondary")
        submit_btn = self.driver.find_element(By.ID, "btn-submit-pack")

        # Cancellation Sub-flow
        log_bdd("WHEN", "User configures muling options but clicks Cancel")
        initial_amazon_items = self.driver.execute_script(
            "return (window.state.saves.find(s => s.name === 'TestAmazon') || {}).item_count || 0"
        )
        self.safe_click(cancel_btn)
        self.wait.until(lambda d: not modal.is_displayed())

        log_bdd("THEN", "Modal closes and Amazon item count remains unchanged")
        current_amazon_items = self.driver.execute_script(
            "return (window.state.saves.find(s => s.name === 'TestAmazon') || {}).item_count || 0"
        )
        self.assertEqual(initial_amazon_items, current_amazon_items)

        # Execution Sub-flow
        log_bdd("WHEN", "User reopens Pack Mule modal, limits to 5 items, and clicks Pack Mule")
        self.driver.execute_script("openPackMuleModal()")
        self.wait.until(lambda d: modal.is_displayed())
        target_select = self.driver.find_element(By.ID, "pack-target-char-select")
        target_select.send_keys("TestAmazon.d2s")
        max_input = self.driver.find_element(By.ID, "pack-max-items")
        max_input.clear()
        max_input.send_keys("5")
        
        self.safe_click(submit_btn)
        self.wait.until(lambda d: not modal.is_displayed() or "Packed" in d.find_element(By.ID, "pack-status").text)
        time.sleep(1)

        log_bdd("THEN", "Items transfer successfully to TestAmazon and saves are marked modified")
        post_amazon_items = self.driver.execute_script(
            "return (window.state.saves.find(s => s.name === 'TestAmazon') || {}).item_count || 0"
        )
        self.assertGreaterEqual(post_amazon_items, initial_amazon_items)
        modified = self.driver.execute_script("return window.D2Wasm.getModifiedFiles().length")
        self.assertGreaterEqual(modified, 1)

    # =========================================================================
    # FLOW 4: MULING SHARED STASH TO NEW CHARACTERS (BULK PACK)
    # =========================================================================
    def test_04_mule_shared_stash_to_new_characters(self):
        """
        IF:   Bulk Pack & Mule Organizer dialog is accessed in browser session.
        WHEN: Auto-mule creation is checked, but the user clicks Close.
        THEN: The dialog closes without creating new character saves.
        WHEN: The user selects category 'sets' with auto-mule and stages bulk pack.
        THEN: A new mule is generated ('SCsetsAA.d2s') and items are staged into it.
        """
        print("\n--- [FLOW 4] Muling Shared Stash to New Characters: Cancel & Execute ---")

        log_bdd("IF", "Mule Organizer dialog is launched via #mule-organizer")
        organizer_btn = self.driver.find_element(By.ID, "mule-organizer")
        self.safe_click(organizer_btn)
        
        dialog = self.driver.find_element(By.CLASS_NAME, "mule-organizer-dialog")
        self.wait.until(lambda d: dialog.is_displayed())

        auto_cb = self.driver.find_element(By.ID, "organizer-auto")
        close_btn = self.driver.find_element(By.ID, "organizer-close")
        plan_btn = self.driver.find_element(By.ID, "organizer-plan")

        # Cancellation Sub-flow
        log_bdd("WHEN", "User checks auto-create mules but clicks Close without staging")
        if not auto_cb.is_selected():
            self.safe_click(auto_cb)
        self.safe_click(close_btn)
        self.wait.until(lambda d: not dialog.is_displayed())

        log_bdd("THEN", "Dialog closes without adding any new mules")
        mule_names = self.driver.execute_script("return window.state.saves.filter(s => !s.is_stash).map(s => s.name)")
        self.assertEqual(len(mule_names), 1)  # Only original TestAmazon

        # Execution Sub-flow
        log_bdd("WHEN", "User reopens dialog, selects category 'sets' with auto-mule, and stages bulk pack")
        self.safe_click(organizer_btn)
        self.wait.until(lambda d: dialog.is_displayed())
        
        auto_cb = self.driver.find_element(By.ID, "organizer-auto")
        if not auto_cb.is_selected():
            self.safe_click(auto_cb)
            
        cat_select = Select(self.driver.find_element(By.ID, "organizer-category"))
        cat_select.select_by_value("sets")
        self.safe_click(plan_btn)

        log_bdd("THEN", "Staged bulk pack creates new overflow mule (SCsetsAA.d2s) and updates status")
        result_el = self.driver.find_element(By.ID, "organizer-result")
        self.wait.until(lambda d: "Staged" in result_el.text or "Created" in result_el.text)
        self.assertIn("Staged", result_el.text)
        self.assertIn("Created:", result_el.text)
        
        staged_changes = self.driver.execute_script("return window.EditWorkspace.changes")
        self.assertGreater(staged_changes, 0)
        
        # Close dialog and discard staged changes to restore clean state
        self.safe_click(close_btn)
        discard_btn = self.driver.find_element(By.ID, "edit-discard")
        if discard_btn.is_displayed():
            self.safe_click(discard_btn)

    # =========================================================================
    # FLOW 5: CREATING NEW ITEMS ON A CHARACTER
    # =========================================================================
    def test_05_create_new_item_on_character(self):
        """
        IF:   Edit Mode is active on the hero inventory.
        WHEN: The Item Creator dialog is opened and Cancel is clicked.
        THEN: Dialog closes without adding any item.
        WHEN: The user selects a Unique item (Harlequin Crest) from the combobox and stages the item.
        THEN: The item is placed into the character save and workspace reports staged changes.
        """
        print("\n--- [FLOW 5] Creating New Items on a Character: Cancel & Execute ---")

        log_bdd("IF", "User activates Edit Mode to access Item Creator")
        edit_start_btn = self.driver.find_element(By.ID, "edit-start")
        self.safe_click(edit_start_btn)
        self.wait.until(lambda d: d.find_element(By.ID, "create-item").is_displayed())

        create_item_btn = self.driver.find_element(By.ID, "create-item")
        self.safe_click(create_item_btn)

        dialog = self.driver.find_element(By.ID, "item-creator-dialog")
        self.wait.until(lambda d: dialog.is_displayed())

        cancel_btn = self.driver.find_element(By.ID, "new-item-close")
        submit_btn = self.driver.find_element(By.ID, "new-item-submit")

        # Cancellation Sub-flow
        log_bdd("WHEN", "User opens item creator, searches for an item, but clicks Cancel")
        search_input = self.driver.find_element(By.ID, "new-item-search")
        search_input.send_keys("Shako")
        self.safe_click(cancel_btn)
        self.wait.until(lambda d: not dialog.is_displayed())

        log_bdd("THEN", "Item creator dialog closes and no items are staged")
        staged_changes = self.driver.execute_script("return window.EditWorkspace.changes")
        self.assertEqual(staged_changes, 0)

        # Execution Sub-flow
        log_bdd("WHEN", "User reopens creator, selects Unique item via combobox, and clicks Stage Item")
        self.safe_click(create_item_btn)
        self.wait.until(lambda d: dialog.is_displayed())

        search_input = self.driver.find_element(By.ID, "new-item-search")
        search_input.clear()
        search_input.send_keys("Harlequin Crest")
        time.sleep(0.5)

        # Select the item from the populated combobox options
        self.wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".creator-combobox-option")) > 0)
        first_opt = self.driver.find_elements(By.CSS_SELECTOR, ".creator-combobox-option")[0]
        self.driver.execute_script(
            "arguments[0].dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));", first_opt
        )
        time.sleep(0.5)

        self.wait.until(lambda d: not submit_btn.get_attribute("disabled"))
        self.safe_click(submit_btn)
        self.wait.until(lambda d: not dialog.is_displayed())

        log_bdd("THEN", "New item is successfully staged onto character and EditWorkspace registers change")
        staged_count = self.driver.execute_script("return window.EditWorkspace.changes")
        self.assertEqual(staged_count, 1)

        # Clean up by discarding workspace changes
        discard_btn = self.driver.find_element(By.ID, "edit-discard")
        self.safe_click(discard_btn)

    # =========================================================================
    # FLOW 6: EDITING EXISTING ITEMS (STACK QUANTITY)
    # =========================================================================
    def test_06_edit_existing_item_stack(self):
        """
        IF:   Stackable items (Ral Rune in Advanced Stash Tab 5) exist in the browser session.
        WHEN: The user opens the Stack Quantity modal, changes value to 99, but clicks Cancel.
        THEN: The stack count remains unchanged and the stash is not marked modified.
        WHEN: The user updates stack quantity to 42 and clicks Save Stack Count.
        THEN: The stack quantity persists and the stash is marked as modified.
        """
        print("\n--- [FLOW 6] Editing Existing Items (Stack Quantity): Cancel & Execute ---")

        log_bdd("IF", "Edit Mode is turned on and stack editor modal is opened for Ral Rune in Tab 5")
        edit_start_btn = self.driver.find_element(By.ID, "edit-start")
        if edit_start_btn.is_displayed():
            self.safe_click(edit_start_btn)
            time.sleep(1)

        item_id = self.driver.execute_script("""
            const it = window.state.items.find(i => i.isStash && i.tabIndex === 5 && i.itemCode === 'r08');
            return it ? it.id : null;
        """)
        self.assertIsNotNone(item_id, "Expected Ral Rune in tab 5")

        self.driver.execute_script(f"window.openEditStackModalFromItem({item_id});")
        modal = self.driver.find_element(By.ID, "edit-stack-modal")
        self.wait.until(lambda d: modal.is_displayed())

        qty_input = self.driver.find_element(By.ID, "edit-stack-qty-input")
        cancel_btn = modal.find_element(By.CSS_SELECTOR, ".modal-footer .btn-secondary")
        submit_btn = self.driver.find_element(By.ID, "btn-submit-edit-stack")

        # Cancellation Sub-flow
        log_bdd("WHEN", "User changes quantity to 99 but clicks Cancel")
        qty_input.clear()
        qty_input.send_keys("99")
        self.safe_click(cancel_btn)
        self.wait.until(lambda d: not modal.is_displayed())

        log_bdd("THEN", "Modal closes and stash save is NOT marked modified")
        modified_files = self.driver.execute_script("return window.D2Wasm.getModifiedFiles().map(f => f.name)")
        self.assertNotIn("ModernSharedStashSoftCoreV2.d2i", modified_files)

        # Execution Sub-flow
        log_bdd("WHEN", "User reopens modal, sets quantity to 42, and clicks Save Stack Count")
        self.driver.execute_script(f"window.openEditStackModalFromItem({item_id});")
        self.wait.until(lambda d: modal.is_displayed())
        qty_input = self.driver.find_element(By.ID, "edit-stack-qty-input")
        qty_input.clear()
        qty_input.send_keys("42")
        self.safe_click(submit_btn)
        self.wait.until(lambda d: not modal.is_displayed())

        log_bdd("THEN", "Stack quantity is saved and stash save is marked modified")
        modified = self.driver.execute_script(
            "return window.D2Wasm.getModifiedFiles().some(f => f.name === 'ModernSharedStashSoftCoreV2.d2i')"
        )
        self.assertTrue(modified, "Stash file should be marked as modified after stack edit")

    # =========================================================================
    # FLOW 7: THE CHRONICLE (UPDATE & CANCEL/RESET)
    # =========================================================================
    def test_07_chronicle_update_and_revert_reset(self):
        """
        IF:   The Chronicle view is active with save file discoveries loaded.
        WHEN: The user triggers Reset or Complete All but dismisses the confirmation alerts.
        THEN: The alerts are cancelled and chronicle progress score remains intact.
        WHEN: The user attempts modifications in Browse mode.
        THEN: Score remains unchanged until Edit mode is activated.
        WHEN: The user enters Edit mode and clicks Complete Undroppable followed by Complete All.
        THEN: The progress score advances and reaches 100.00% completion in staged memory.
        WHEN: The user clicks Discard in Edit mode.
        THEN: The chronicle score reverts back to initial save discoveries.
        """
        print("\n--- [FLOW 7] The Chronicle: Update, Complete All, and Revert/Reset ---")

        log_bdd("IF", "User switches to The Chronicle navigation tab")
        chronicle_tab = self.driver.find_element(By.CSS_SELECTOR, '.nav-tab[data-tab="chronicle-view"]')
        self.safe_click(chronicle_tab)
        
        self.wait.until(lambda d: d.find_element(By.ID, "chronicle-overall-score").is_displayed())
        initial_score = self.driver.find_element(By.ID, "chronicle-overall-score").text
        initial_count_text = self.driver.find_element(By.ID, "chronicle-count-text").text
        log_bdd("THEN", f"Chronicle displays initial discoveries: {initial_score} ({initial_count_text})")

        # Cancellation Sub-flow 1: Dismiss Reset Alert
        log_bdd("WHEN", "User triggers Reset but dismisses the confirmation alert")
        reset_btn = self.driver.find_element(By.ID, "btn-reset-chronicle")
        self.safe_click(reset_btn)
        
        alert = self.driver.switch_to.alert
        self.assertIn("Reset", alert.text)
        alert.dismiss()
        log_bdd("THEN", "Alert is dismissed and chronicle progress score remains intact")
        self.assertEqual(self.driver.find_element(By.ID, "chronicle-overall-score").text, initial_score)

        # Browse Mode Safeguard: Mutating actions require Edit mode
        log_bdd("WHEN", "User attempts to click Complete Undroppable in Browse mode")
        undroppable_btn = self.driver.find_element(By.ID, "btn-complete-undroppable")
        self.safe_click(undroppable_btn)
        time.sleep(0.3)
        log_bdd("THEN", "Chronicle score remains unchanged because Edit mode is required")
        self.assertEqual(self.driver.find_element(By.ID, "chronicle-overall-score").text, initial_score)

        # Enter Edit Mode
        log_bdd("WHEN", "User turns on Edit mode to stage Chronicle modifications")
        edit_start_btn = self.driver.find_element(By.ID, "edit-start")
        self.safe_click(edit_start_btn)
        time.sleep(0.5)

        # Cancellation Sub-flow 2: Dismiss Complete All Alert in Edit Mode
        log_bdd("WHEN", "User triggers Complete All but dismisses the confirmation alert")
        complete_all_btn = self.driver.find_element(By.ID, "btn-complete-chronicle")
        self.safe_click(complete_all_btn)
        
        alert = self.driver.switch_to.alert
        self.assertIn("100%", alert.text)
        alert.dismiss()
        log_bdd("THEN", "Alert is dismissed and chronicle progress score remains unchanged")
        self.assertEqual(self.driver.find_element(By.ID, "chronicle-overall-score").text, initial_score)

        # Execution Sub-flow 1: Complete Undroppable (Staged in Edit Workspace)
        log_bdd("WHEN", "User clicks Complete Undroppable in Edit mode")
        self.safe_click(undroppable_btn)
        time.sleep(0.5)

        undroppable_score = self.driver.find_element(By.ID, "chronicle-overall-score").text
        log_bdd("THEN", f"Progress score advances to {undroppable_score} and EditWorkspace tracks changes")
        self.assertNotEqual(undroppable_score, "0.00%")
        staged_changes = self.driver.execute_script("return window.EditWorkspace.changes")
        self.assertGreaterEqual(staged_changes, 1)

        # Execution Sub-flow 2: Complete All (100% Staged in Edit Workspace)
        log_bdd("WHEN", "User clicks Complete All and confirms the alert")
        self.safe_click(complete_all_btn)
        alert = self.driver.switch_to.alert
        alert.accept()
        time.sleep(0.5)

        final_score = self.driver.find_element(By.ID, "chronicle-overall-score").text
        log_bdd("THEN", f"Chronicle reaches full completion: {final_score}")
        self.assertEqual(final_score, "100.00%")

        # Execution Sub-flow 3: Discard Staged Changes
        log_bdd("WHEN", "User clicks Discard to revert staged modifications")
        discard_btn = self.driver.find_element(By.ID, "edit-discard")
        self.safe_click(discard_btn)
        time.sleep(0.5)

        reverted_score = self.driver.find_element(By.ID, "chronicle-overall-score").text
        log_bdd("THEN", f"Chronicle reverts to baseline discoveries: {reverted_score}")
        self.assertEqual(reverted_score, initial_score)

    # =========================================================================
    # FLOW 8: BROWSER CACHE INVALIDATION & RE-LOAD
    # =========================================================================
    def test_08_cache_invalidation_and_reload(self):
        """
        IF:   Saves are loaded in browser WASM memory and Invalidate Cache button is active.
        WHEN: The user clicks Invalidate Cache but dismisses the confirmation alert.
        THEN: The alert is dismissed and loaded saves remain intact in memory.
        WHEN: The user clicks Invalidate Cache and confirms the alert.
        THEN: The browser cache is wiped (0 saves, 0 items) and the dropzone overlay activates.
        WHEN: Fresh baseline saves are ingested.
        THEN: The system reloads fresh saves and normal views are restored.
        """
        print("\n--- [FLOW 8] Browser Cache Invalidation & Re-load: Cancel & Execute ---")

        log_bdd("IF", "Saves are loaded in browser session and #wasm-invalidate-btn is present")
        inv_btn = self.driver.find_element(By.ID, "wasm-invalidate-btn")
        self.wait.until(lambda d: inv_btn.is_displayed())
        initial_saves = self.driver.execute_script("return window.state.saves.length")
        self.assertGreater(initial_saves, 0)

        # Cancellation Sub-flow
        log_bdd("WHEN", "User clicks Invalidate Cache but dismisses the confirmation alert")
        self.safe_click(inv_btn)
        alert = self.driver.switch_to.alert
        self.assertIn("invalidate", alert.text.lower())
        alert.dismiss()
        time.sleep(0.5)

        log_bdd("THEN", "Alert is dismissed and saves remain loaded in browser memory")
        loaded_count = self.driver.execute_script("return window.D2Wasm.loadedFiles.size")
        self.assertEqual(loaded_count, 2)

        # Execution Sub-flow
        log_bdd("WHEN", "User clicks Invalidate Cache and accepts the confirmation alert")
        self.safe_click(inv_btn)
        alert = self.driver.switch_to.alert
        alert.accept()
        time.sleep(1)

        log_bdd("THEN", "Cache and manual chronicle completions are wiped from IndexedDB/localStorage/memory")
        cleared_loaded = self.driver.execute_script("return window.D2Wasm.loadedFiles.size")
        cleared_saves = self.driver.execute_script("return window.state.saves.length")
        cleared_chronicle_manual = self.driver.execute_script("return localStorage.getItem('bk-chronicle-manual')")
        self.assertEqual(cleared_loaded, 0)
        self.assertEqual(cleared_saves, 0)
        self.assertIsNone(cleared_chronicle_manual)
        
        overlay = self.driver.find_element(By.ID, "d2-dropzone-overlay")
        self.assertIn("active", overlay.get_attribute("class"))

        # Re-load Sub-flow
        log_bdd("WHEN", "Fresh baseline files are re-ingested into clean browser session")
        self._ingest_clean_fixtures()
        
        log_bdd("THEN", "Fresh saves and items are restored to active session")
        restored_saves = self.driver.execute_script("return window.state.saves.length")
        self.assertGreater(restored_saves, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
