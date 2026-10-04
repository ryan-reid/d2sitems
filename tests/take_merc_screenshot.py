import time
import os
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def capture_mercenary():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,1050")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")

    driver = webdriver.Edge(options=options)
    try:
        print("Navigating to http://127.0.0.1:5000...")
        driver.get("http://127.0.0.1:5000")
        
        wait = WebDriverWait(driver, 10)
        # Wait for nav tabs
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.nav-tab[data-tab="armory-view"]')))
        time.sleep(1.0)
        
        # Click Armory View
        print("Switching to Armory tab...")
        driver.execute_script("""
            const armoryTab = document.querySelector('.nav-tab[data-tab="armory-view"]');
            if (armoryTab) armoryTab.click();
        """)
        time.sleep(1.5)

        # Select Sorceress
        print("Selecting Sorceress...")
        driver.execute_script("""
            const sel = document.getElementById('armory-char-select');
            if (sel) {
                sel.value = 'Sorceress';
                sel.dispatchEvent(new Event('change'));
            }
        """)
        time.sleep(2.0)

        # Switch to Mercenary tab
        print("Switching to Mercenary tab...")
        driver.execute_script("""
            if (window.switchRightPanelTab) {
                window.switchRightPanelTab('mercenary');
            }
        """)
        time.sleep(1.5)

        # Hover over Infinity on Right Hand to test tooltip
        print("Hovering over weapon to test tooltip...")
        driver.execute_script("""
            const rHand = document.getElementById('merc-slot-RightHand');
            const itemEl = rHand ? rHand.querySelector('.d2r-item-element') : null;
            if (itemEl) {
                const rect = itemEl.getBoundingClientRect();
                itemEl.dispatchEvent(new MouseEvent('mouseenter', {
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    bubbles: true
                }));
            }
        """)
        time.sleep(1.0)

        out_path_sorc = os.path.abspath("screenshot_sorceress_merc_tooltip.png")
        driver.save_screenshot(out_path_sorc)
        print(f"Saved Sorceress mercenary tooltip screenshot to: {out_path_sorc}")

        # Now test Assassin
        print("Selecting Assassin...")
        driver.execute_script("""
            const sel = document.getElementById('armory-char-select');
            if (sel) {
                sel.value = 'Assassin';
                sel.dispatchEvent(new Event('change'));
            }
        """)
        time.sleep(2.0)

        # Switch to Mercenary tab for Assassin
        print("Switching to Mercenary tab for Assassin...")
        driver.execute_script("""
            if (window.switchRightPanelTab) {
                window.switchRightPanelTab('mercenary');
            }
        """)
        time.sleep(1.5)

        out_path_as = os.path.abspath("screenshot_assassin_merc.png")
        driver.save_screenshot(out_path_as)
        print(f"Saved Assassin mercenary screenshot to: {out_path_as}")

    finally:
        driver.quit()

if __name__ == "__main__":
    capture_mercenary()
