"""Run with: python -m unittest discover -s tests -p test_catalog.py"""
import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract_item_sprites import build_image_mappings

ROOT = Path(__file__).resolve().parents[1]

class CatalogTests(unittest.TestCase):
    def test_real_mapping_matches_mod(self):
        mapping = json.loads((ROOT / 'web/item_images.json').read_text(encoding='utf-8'))
        self.assertEqual(Path(mapping['codes']['bgn']).name, 'hd_key_bigdinn_key.png')
        # Release builds must follow the current mod asset, not the bundled
        # snapshot's historical hand-assigned Rainbow Facet icon.
        if 'artworkSources' in mapping:
            definitions = json.loads((ROOT / 'mods/BKDiablo/bkdiablo.mpq/data/hd/items/uniques.json').read_text(encoding='utf-8-sig'))
            facet = next(info for entry in definitions for name, info in entry.items()
                         if ''.join(c for c in name.lower() if c.isalnum()) == 'rainbowfacet')
            self.assertEqual(Path(mapping['uniques']['rainbow facet']).name,
                             'hd_' + facet['normal'].lower().replace('/', '_') + '.png')
        self.assertEqual(Path(mapping['uniques']["defender's fire"]).name, 'hd_body_part_fragment_fire.png')
        self.assertEqual(Path(mapping['uniques']["gheed's fortune"]).name, 'hd_charm_charm_large.png')
        for group in ('codes', 'uniques', 'sets', 'classic_codes', 'classic_uniques', 'classic_sets'):
            for name, file in mapping[group].items():
                self.assertTrue((ROOT / 'web/assets/items' / file).is_file(), (group, name, file))
        self.assertTrue(mapping['revision'])

    def test_mod_classic_precedes_retail_hd(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dirs = [root / 'mod', root / 'retail']
            hd = [root / 'mod-hd', root / 'retail-hd']
            for directory in dirs + hd: directory.mkdir()
            assets = root / 'assets/items'; assets.mkdir(parents=True)
            for name in ['mod.png', 'hd_retail_icon.png']: (assets / name).touch()
            (dirs[0] / 'misc.txt').write_text('code\tinvfile\nbgn\tmod\n')
            (dirs[1] / 'misc.txt').write_text('code\tinvfile\nbgn\tretail\n')
            (hd[1] / 'items.json').write_text('[{"bgn":{"asset":"retail/icon"}}]')
            mapping = build_image_mappings([str(d) for d in dirs], [str(d) for d in hd], json_path=str(root / 'item_images.json'))
            self.assertEqual(Path(mapping['codes']['bgn']).name, 'mod.png')
            self.assertFalse(mapping['provenance']['codes:bgn']['fallback'])
            before = mapping['revision']
            (dirs[0] / 'misc.txt').write_text('code\tinvfile\nbgn\tmod\nother\tmod\n')
            rebuilt = build_image_mappings([str(d) for d in dirs], [str(d) for d in hd], json_path=str(root / 'item_images.json'))
            self.assertNotEqual(before, rebuilt['revision'])


class ItemFilterTests(unittest.TestCase):
    def setUp(self):
        self.items = [
            {"name": "The Scalper", "type": "Throwing Axe"},
            {"name": "Warshrike", "type": "Throwing Knife"},
            {"name": "Demon's Arch", "type": "Javelin"},
            {"name": "Gargoyle's Bite", "type": "Javelin"},
            {"name": "Titan's Revenge", "type": "Amazon Javelin"},
            {"name": "Crystal Sword", "type": "Sword"},
            {"name": "Berserker Axe", "type": "Axe"},
            {"name": "War Hammer", "type": "Hammer"},
            {"name": "Hydra Bow", "type": "Bow"},
            {"name": "Harlequin Crest", "type": "Helm"},
            {"name": "Stormshield", "type": "Shield"},
            {"name": "Stone of Jordan", "type": "Ring"},
            {"name": "Mara's Kaleidoscope", "type": "Amulet"},
            {"name": "Annihilus", "type": "Small Charm"},
            {"name": "Rainbow Facet", "type": "Jewel"},
            {"name": "Ber Rune", "type": "Rune"},
            {"name": "Perfect Ruby", "type": "Ruby"},
        ]

    def test_filter_weapons_all(self):
        import re
        from find_items import matches_field
        weapons = [it for it in self.items if matches_field(it, 'type', re.compile('weapon', re.I))]
        self.assertEqual(len(weapons), 9)
        for w in weapons:
            self.assertNotIn(w.get('type', '').lower(), ['helm', 'shield', 'ring', 'amulet', 'small charm', 'jewel', 'rune', 'ruby'])

    def test_filter_throwing_weapons(self):
        import re
        from find_items import matches_field
        throwing = [it for it in self.items if matches_field(it, 'type', re.compile('throwing', re.I))]
        self.assertEqual(len(throwing), 5)
        names = [it['name'] for it in throwing]
        self.assertTrue(any('The Scalper' in n for n in names))
        self.assertTrue(any("Demon's Arch" in n for n in names))
        self.assertTrue(any("Gargoyle's Bite" in n for n in names))

    def test_filter_javelins(self):
        import re
        from find_items import matches_field
        javelins = [it for it in self.items if matches_field(it, 'type', re.compile('javelin', re.I))]
        self.assertEqual(len(javelins), 3)
        for jav in javelins:
            self.assertIn(jav.get('type'), ['Javelin', 'Amazon Javelin'])

    def test_index_html_has_throwing_and_bt_bk_categories(self):
        html = (ROOT / 'web/index.html').read_text(encoding='utf-8')
        self.assertIn('<option value="weapon">Weapons (All)</option>', html)
        self.assertIn('<option value="throwing">Throwing Weapons (Axes, Knives, Javelins)</option>', html)
        self.assertIn('<option value="javelin">Javelins</option>', html)
        self.assertIn('<option value="mace">Maces / Clubs / Hammers</option>', html)
        self.assertIn('<option value="dagger">Daggers / Knives</option>', html)

    def test_app_js_has_type_filter_map_and_matcher(self):
        js = (ROOT / 'web/app.js').read_text(encoding='utf-8')
        self.assertIn('TYPE_FILTER_MAP', js)
        self.assertIn('matchesTypeFilter', js)
        self.assertIn('matchesTypeFilter(it, f.type)', js)

if __name__ == '__main__': unittest.main()

