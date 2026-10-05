"""Tests for the streamlined static web server."""

import http.client
from pathlib import Path
import threading
import unittest

import web_ui

ROOT_DIR = Path(__file__).resolve().parents[1]


class WebServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Bind to port 0 to get an ephemeral free port
        cls.server = web_ui.ReusableTCPServer(("127.0.0.1", 0), web_ui.WasmStaticHTTPRequestHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", path)
        return conn.getresponse()

    def test_serves_index_html(self):
        res = self.request("/")
        self.assertEqual(res.status, 200)
        content_type = res.getheader("Content-Type", "")
        self.assertIn("text/html", content_type)
        body = res.read().decode("utf-8")
        self.assertIn("BKDiablo", body)
        self.assertIn("Ascension Armory", body)

    def test_serves_catalog_meta_json(self):
        res = self.request("/catalog_meta.json")
        self.assertEqual(res.status, 200)
        self.assertEqual(res.getheader("Content-Type"), "application/json")

    def test_wasm_mime_types(self):
        res = self.request("/_framework/dotnet.js")
        self.assertEqual(res.status, 200)
        self.assertEqual(res.getheader("Content-Type"), "application/javascript")
        _ = res.read()

        # Find any .wasm file in _framework
        wasm_files = list((ROOT_DIR / "web" / "_framework").glob("*.wasm"))
        self.assertTrue(len(wasm_files) > 0)
        wasm_rel = f"/_framework/{wasm_files[0].name}"
        res_wasm = self.request(wasm_rel)
        self.assertEqual(res_wasm.status, 200)
        self.assertEqual(res_wasm.getheader("Content-Type"), "application/wasm")
        _ = res_wasm.read()

    def test_cors_and_cache_headers(self):
        res = self.request("/")
        self.assertEqual(res.getheader("Access-Control-Allow-Origin"), "*")
        self.assertIn("no-cache", res.getheader("Cache-Control", ""))
        _ = res.read()


if __name__ == "__main__":
    unittest.main()
