import time
from selenium import webdriver
from selenium.webdriver.edge.options import Options

opts = Options()
opts.add_argument('--headless=new')
opts.add_argument('--window-size=1600,1050')
driver = webdriver.Edge(options=opts)

try:
    driver.get('http://127.0.0.1:5000')
    time.sleep(2.0)
    driver.execute_script("const t = document.querySelector('.nav-tab[data-tab=\"armory-view\"]'); if (t) t.click();")
    time.sleep(1.5)
    driver.execute_script("if (window.switchD2RStashTab) window.switchD2RStashTab('crafting');")
    time.sleep(1.0)

    res = driver.execute_script("""
        const viewport = document.getElementById('d2r-mod-crafting-viewport');
        const slots = Array.from(viewport.querySelectorAll('.d2r-mod-slot'));
        return slots.map(s => {
            const rect = s.getBoundingClientRect();
            const elemAtCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
                title: s.title,
                slotTag: s.tagName,
                slotClass: s.className,
                left: s.style.left,
                top: s.style.top,
                width: s.style.width,
                height: s.style.height,
                hitElement: elemAtCenter ? (elemAtCenter.tagName + '.' + elemAtCenter.className) : null,
                isSlotHit: elemAtCenter === s || (elemAtCenter && s.contains(elemAtCenter))
            };
        });
    """)
    for r in res:
        print(r)

finally:
    driver.quit()
