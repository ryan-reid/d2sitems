from selenium import webdriver
from selenium.webdriver.edge.options import Options
import time, os

options = Options()
options.add_argument('--headless=new')
options.add_argument('--window-size=1600,1050')
driver = webdriver.Edge(options=options)
try:
    driver.get('http://127.0.0.1:5000')
    time.sleep(1.5)
    driver.execute_script("const tab = document.querySelector('.nav-tab[data-tab=\"armory-view\"]'); if (tab) tab.click();")
    time.sleep(1.0)
    driver.execute_script("window.openEditStackModalByCode('std', 'Standard of Heroes', 0, 5);")
    time.sleep(1.0)
    driver.save_screenshot(os.path.abspath('screenshot_edit_stack_opened.png'))
    print('Screenshot saved to screenshot_edit_stack_opened.png')
finally:
    driver.quit()
