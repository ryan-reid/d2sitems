"""End-to-end HTTP draft checks using disposable copies only."""
import copy
import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from unittest.mock import patch
import web_ui


class EditWorkspaceTests(unittest.TestCase):
    def test_stage_discard_save_and_conflict(self):
        with tempfile.TemporaryDirectory() as root:
            fixtures = Path('tests/fixtures/baselines')
            stash_name = 'ModernSharedStashSoftCoreV2.d2i'
            original_stash = (fixtures / (stash_name.replace('.d2i', '.golden.d2i'))).read_bytes()
            original_char = (fixtures / 'Amazon_L1.golden.d2s').read_bytes()
            Path(root, stash_name).write_bytes(original_stash)
            Path(root, 'Hero.d2s').write_bytes(original_char)
            manager = copy.copy(web_ui.DATA_MANAGER)
            manager.lock = threading.Lock()
            profile = dict(manager.get_active_profile(), id='fixture', save_dir=root)
            manager.profiles = [profile]
            manager.active_profile_id = 'fixture'
            self.assertTrue(manager.run_scan()['success'])
            with patch.object(web_ui, 'DATA_MANAGER', manager):
                server = http.server.HTTPServer(('127.0.0.1', 0), web_ui.RequestHandler)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                base = f'http://127.0.0.1:{server.server_port}'
                def call(path, data=None):
                    request = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None,
                                                     headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, timeout=180) as response:
                        return json.load(response)
                try:
                    def start():
                        result = call('/api/edit/start', {'core': 'soft'})
                        self.assertTrue(result['success'], result)
                        return result['edit_session']
                    def move(token):
                        suffix = '?core=soft&edit_session=' + token
                        saves = call('/api/saves' + suffix)['saves']
                        target = next(s for s in saves if s['file'] == 'Hero.d2s')
                        item = next(i for i in call('/api/items' + suffix)['items'] if i.get('isStash') and i.get('tabIndex') == 0 and i['itemCode'] == 'cm1')
                        payload = dict(edit_session=token, SourceFile=stash_name, TargetFile='Hero.d2s',
                                       SourceContainer='SharedStash', TargetContainer='Inventory', SourceTab=0,
                                       ItemSeed=item['itemSeed'], ItemCode=item['itemCode'], SourceX=item['invX'], SourceY=item['invY'],
                                       SourceRevision=item['saveRevision'], TargetRevision=target['saveRevision'])
                        result = call('/api/item/transfer', payload)
                        self.assertTrue(result.get('Success'), result)
                    token = start()
                    move(token)
                    self.assertEqual(Path(root, stash_name).read_bytes(), original_stash)
                    self.assertEqual(Path(root, 'Hero.d2s').read_bytes(), original_char)
                    self.assertTrue(call('/api/edit/discard', {'edit_session':token})['success'])
                    self.assertEqual(Path(root, 'Hero.d2s').read_bytes(), original_char)
                    token = start()
                    move(token)
                    Path(root, 'Hero.d2s').write_bytes(original_char + b'changed')
                    conflict = call('/api/edit/save', {'edit_session':token})
                    self.assertFalse(conflict['success'])
                    self.assertEqual(Path(root, stash_name).read_bytes(), original_stash)
                    Path(root, 'Hero.d2s').write_bytes(original_char)
                    self.assertTrue(call('/api/edit/save', {'edit_session':token})['success'])
                    self.assertNotEqual(Path(root, stash_name).read_bytes(), original_stash)
                    self.assertNotEqual(Path(root, 'Hero.d2s').read_bytes(), original_char)
                finally:
                    server.shutdown()
                    server.server_close()
                    worker.join()

    def test_create_item_validation_and_staging(self):
        with tempfile.TemporaryDirectory() as root:
            fixtures = Path('tests/fixtures/baselines')
            original_char = (fixtures / 'Amazon_L1.golden.d2s').read_bytes()
            Path(root, 'Hero.d2s').write_bytes(original_char)
            manager = copy.copy(web_ui.DATA_MANAGER)
            manager.lock = threading.Lock()
            profile = dict(manager.get_active_profile(), id='fixture', save_dir=root)
            manager.profiles = [profile]
            manager.active_profile_id = 'fixture'
            self.assertTrue(manager.run_scan()['success'])
            with patch.object(web_ui, 'DATA_MANAGER', manager):
                server = http.server.HTTPServer(('127.0.0.1', 0), web_ui.RequestHandler)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                base = f'http://127.0.0.1:{server.server_port}'
                def call(path, data=None):
                    request = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None,
                                                     headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, timeout=180) as response:
                        return json.load(response)
                try:
                    start_res = call('/api/edit/start', {'core': 'soft'})
                    self.assertTrue(start_res['success'], start_res)
                    token = start_res['edit_session']

                    # 1. Attempt to create Unique item without stats -> MUST FAIL
                    bad_req = {
                        'edit_session': token,
                        'source': 'Hero.d2s',
                        'itemCode': 'uap',
                        'quality': 'Unique',
                        'qualityIndex': 248,
                        'x': 0, 'y': 0,
                        'stats': {}
                    }
                    res_empty = call('/api/item/create', bad_req)
                    self.assertFalse(res_empty.get('success'), 'Empty stats for unique item must fail')

                    # 2. Attempt to create Unique item with out-of-range stats -> MUST FAIL
                    bad_stat_req = {
                        'edit_session': token,
                        'source': 'Hero.d2s',
                        'itemCode': 'uap',
                        'quality': 'Unique',
                        'qualityIndex': 248,
                        'x': 0, 'y': 0,
                        'itemStats': [
                            {'statId': 127, 'layer': 0, 'value': 2},
                            {'statId': 216, 'layer': 0, 'value': 12},
                            {'statId': 217, 'layer': 0, 'value': 12},
                            {'statId': 80, 'layer': 0, 'value': 30},
                            {'statId': 36, 'layer': 0, 'value': 10},
                            {'statId': 0, 'layer': 0, 'value': 2},
                            {'statId': 2, 'layer': 0, 'value': 2},
                            {'statId': 3, 'layer': 0, 'value': 2},
                            {'statId': 1, 'layer': 0, 'value': 2}
                        ]
                    }
                    res_bad = call('/api/item/create', bad_stat_req)
                    self.assertFalse(res_bad.get('success'), 'Out of range stat must fail')

                    # 3. Create valid unique item (Harlequin Crest) with auto-placement -> SUCCEEDS
                    good_req = {
                        'edit_session': token,
                        'source': 'Hero.d2s',
                        'itemCode': 'uap',
                        'quality': 'Unique',
                        'qualityIndex': 248,
                        'x': -1, 'y': -1,
                        'itemStats': [
                            {'statId': 127, 'layer': 0, 'value': 2},
                            {'statId': 216, 'layer': 0, 'value': 12},
                            {'statId': 217, 'layer': 0, 'value': 12},
                            {'statId': 80, 'layer': 0, 'value': 50},
                            {'statId': 36, 'layer': 0, 'value': 10},
                            {'statId': 0, 'layer': 0, 'value': 2},
                            {'statId': 2, 'layer': 0, 'value': 2},
                            {'statId': 3, 'layer': 0, 'value': 2},
                            {'statId': 1, 'layer': 0, 'value': 2}
                        ]
                    }
                    res_good = call('/api/item/create', good_req)
                    self.assertTrue(res_good.get('success'), res_good)

                    # Verify incremental rescan updated items in memory
                    items_res = call('/api/items?core=soft&edit_session=' + token)
                    hero_uap = [it for it in items_res.get('items', []) if it.get('sourceFile') == 'Hero.d2s' and it.get('itemCode') == 'uap']
                    self.assertEqual(len(hero_uap), 1)

                    # Verify staging isolation: original Hero.d2s on disk is untouched
                    self.assertEqual(Path(root, 'Hero.d2s').read_bytes(), original_char)

                    # Save workspace -> Hero.d2s is committed to disk
                    save_res = call('/api/edit/save', {'edit_session': token})
                    self.assertTrue(save_res.get('success'), save_res)
                    self.assertNotEqual(Path(root, 'Hero.d2s').read_bytes(), original_char)
                finally:
                    server.shutdown()
                    server.server_close()
                    worker.join()


if __name__ == '__main__':
    unittest.main()
