#!/usr/bin/env python3
"""Local development server and launcher for d2sitems.

Serves the static web/ application with WebAssembly support, matching the
GitHub Pages deployment architecture.
"""

import argparse
import http.server
import mimetypes
import os
from pathlib import Path
import shutil
import socketserver
import subprocess
import sys
import webbrowser

ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/octet-stream", ".dat")


def ensure_built():
    """Ensure web assets and WASM engine are built before serving."""
    # 1. Build browser catalogs, bank layout, and sprites directly from BKDiablo submodule
    build_script = ROOT_DIR / "scripts" / "build_web_assets.py"
    if build_script.is_file():
        subprocess.run([sys.executable, str(build_script)], check=True, cwd=ROOT_DIR)

    # 2. Ensure WASM framework is published into web/_framework
    wasm_framework = WEB_DIR / "_framework" / "dotnet.js"
    if not wasm_framework.is_file():
        print("WebAssembly framework missing in web/_framework. Publishing D2SWasm...")
        wasm_temp = ROOT_DIR / "web" / "wasm"
        subprocess.run(
            ["dotnet", "publish", str(ROOT_DIR / "src" / "D2SWasm" / "D2SWasm.csproj"),
             "-c", "Release", "-o", str(wasm_temp)],
            check=True, cwd=ROOT_DIR
        )
        src_framework = wasm_temp / "wwwroot" / "_framework"
        dest_framework = WEB_DIR / "_framework"
        dest_framework.mkdir(parents=True, exist_ok=True)
        for item in src_framework.iterdir():
            dest = dest_framework / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)
        shutil.rmtree(wasm_temp, ignore_errors=True)
        print("WebAssembly engine successfully published to web/_framework.")


class WasmStaticHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler configured with WASM MIME types and CORS headers."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def guess_type(self, path):
        path_str = str(path)
        if path_str.endswith(".wasm"):
            return "application/wasm"
        if path_str.endswith(".dat"):
            return "application/octet-stream"
        if path_str.endswith(".json"):
            return "application/json"
        if path_str.endswith(".js") or path_str.endswith(".mjs"):
            return "application/javascript"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def run_server(port=5000, open_browser=True):
    ensure_built()
    handler = WasmStaticHTTPRequestHandler
    with ReusableTCPServer(("0.0.0.0", port), handler) as httpd:
        url = f"http://localhost:{port}"
        print(f"Serving 100% Client-Side D2R Armory (GitHub Pages architecture) at {url}")
        print("Press Ctrl+C to stop the server.")
        if open_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5000, help="Port to serve on (default: 5000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open browser")
    parser.add_argument("--build-only", action="store_true", help="Build browser assets and exit without starting server")
    args = parser.parse_args()

    if args.build_only:
        ensure_built()
    else:
        run_server(port=args.port, open_browser=not args.no_browser)
