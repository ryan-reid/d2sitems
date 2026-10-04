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
        self.assertEqual(mapping['codes']['bgn'], 'hd_key_bigdinn_key.png')
        self.assertEqual(mapping['uniques']['rainbow facet'], 'hd_jewel_1.png')
        self.assertEqual(mapping['uniques']["defender's fire"], 'hd_body_part_fragment_fire.png')
        self.assertEqual(mapping['uniques']["gheed's fortune"], 'hd_charm_charm_large.png')
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
            self.assertEqual(mapping['codes']['bgn'], 'mod.png')
            self.assertFalse(mapping['provenance']['codes:bgn']['fallback'])
            before = mapping['revision']
            (dirs[0] / 'misc.txt').write_text('code\tinvfile\nbgn\tmod\nother\tmod\n')
            rebuilt = build_image_mappings([str(d) for d in dirs], [str(d) for d in hd], json_path=str(root / 'item_images.json'))
            self.assertNotEqual(before, rebuilt['revision'])

if __name__ == '__main__': unittest.main()
