import time
import os
from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def capture_crafting_and_stack():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,1050")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")

    driver = webdriver.Edge(options=options)
    try:
        driver.get("http://127.0.0.1:5000")
        wait = WebDriverWait(driver, 10)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.nav-tab[data-tab="armory-view"]')))
        time.sleep(1.0)
        
        # Switch to Armory
        driver.execute_script("""
            const tab = document.querySelector('.nav-tab[data-tab="armory-view"]');
            if (tab) tab.click();
        """)
        time.sleep(1.5)

        # Click Crafting tab in Shared Stash
        print("Clicking Crafting tab...")
        driver.execute_script("""
            if (window.switchD2RStashTab) {
                window.switchD2RStashTab('crafting');
            }
        """)
        time.sleep(1.5)
        driver.save_screenshot(os.path.abspath("screenshot_crafting_tab.png"))
        print("Saved screenshot_crafting_tab.png")

        # Click Stackable tab in Shared Stash
        print("Clicking Stackable tab...")
        driver.execute_script("""
            if (window.switchD2RStashTab) {
                window.switchD2RStashTab('stackable');
            }
        """)
        time.sleep(1.5)
        driver.save_screenshot(os.path.abspath("screenshot_stackable_tab.png"))
        print("Saved screenshot_stackable_tab.png")

        # Try clicking on a slot in Stackable to see the edit modal / card
        print("Clicking a stackable slot to open modal...")
        driver.execute_script("""
            const slot = document.querySelector('.d2r-mod-slot');
            if (slot) slot.click();
        """)
        time.sleep(1.0)
        driver.save_screenshot(os.path.abspath("screenshot_stack_modal.png"))
        print("Saved screenshot_stack_modal.png")

    finally:
        driver.quit()

if __name__ == "__main__":
    capture_crafting_and_stack()
