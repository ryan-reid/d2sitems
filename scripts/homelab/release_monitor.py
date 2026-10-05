#!/usr/bin/env python3
"""Compare published revisions and conditionally dispatch the GitHub Pages build."""

import argparse
import configparser
import json
import logging
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

REPOSITORY = "ryan-reid/d2sitems"
BRANCH = "main"
WORKFLOW = "deploy-pages.yml"
MARKER = "https://ryan-reid.github.io/d2sitems/source-revisions.json"
API = "https://api.github.com"
LOG = logging.getLogger("d2sitems-monitor")


class Client:
    def __init__(self, token):
        self.token = token

    def request(self, url, *, payload=None, raw=False, missing_ok=False):
        headers = {"User-Agent": "d2sitems-release-monitor", "Cache-Control": "no-cache"}
        if urlparse(url).netloc == "api.github.com":
            headers.update({
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            })
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        try:
            with urlopen(Request(url, data=data, headers=headers), timeout=30) as response:
                body = response.read().decode("utf-8")
        except HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            # Do not log headers or response bodies, which may contain credentials.
            raise RuntimeError(f"HTTP {error.code} from {urlparse(url).netloc}; retry next timer tick") from None
        return body if raw else (json.loads(body) if body else None)

    def api(self, path, **kwargs):
        return self.request(f"{API}/repos/{path}", **kwargs)


def valid_sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Invalid source revision; refusing to dispatch")
    return value


def current_revisions(client):
    revision = valid_sha(client.api(f"{REPOSITORY}/commits/{BRANCH}")["sha"])
    # Read the configuration at the exact repository revision being compared.
    modules = client.api(f"{REPOSITORY}/contents/.gitmodules?ref={revision}", raw=True)
    config = configparser.ConfigParser(interpolation=None)
    config.read_string(modules)
    revisions = {"repository": revision}
    for name, section in (("BKDiablo", 'submodule "mods/BKDiablo"'),):
        url = urlparse(config[section]["url"])
        if url.scheme != "https" or url.netloc != "github.com":
            raise ValueError("Expected a GitHub HTTPS submodule URL")
        repository = url.path.strip("/").removesuffix(".git")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
            raise ValueError("Invalid upstream repository")
        branch = quote(config[section]["branch"], safe="")
        revisions[name] = valid_sha(client.api(f"{repository}/commits/{branch}")["sha"])
    return revisions


def check(client, *, dry_run=False):
    deployed = client.request(f"{MARKER}?check={time.time_ns()}", missing_ok=True)
    if deployed is not None:
        if not isinstance(deployed, dict):
            raise ValueError("Invalid deployed revision marker")
        for key in ("repository", "BKDiablo"):
            valid_sha(deployed.get(key))
    revisions = current_revisions(client)
    changed = [key for key, value in revisions.items() if deployed is None or deployed[key] != value]
    if not changed:
        LOG.info("Live armory is current; no build needed")
        return "current"

    # Query each active state explicitly so older waiting runs cannot be missed.
    for status in ("queued", "in_progress", "waiting", "pending", "requested"):
        runs = client.api(f"{REPOSITORY}/actions/workflows/{WORKFLOW}/runs?branch={BRANCH}&status={status}&per_page=1")
        if runs["total_count"]:
            LOG.info("Pages workflow already %s; check again next tick", status)
            return "busy"
    LOG.info("Changed sources: %s", ", ".join(changed))
    if dry_run:
        LOG.info("Dry run: would dispatch conditional Pages build")
        return "dry-run"
    client.api(f"{REPOSITORY}/actions/workflows/{WORKFLOW}/dispatches",
               payload={"ref": BRANCH})
    LOG.info("Dispatched conditional Pages build; published marker remains the source of truth")
    return "dispatched"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        token = args.token_file.read_text().strip()
        if not token:
            raise ValueError("GitHub token file is empty")
        check(Client(token), dry_run=args.dry_run)
    except Exception as error:
        LOG.error("Check failed (%s): %s", type(error).__name__, error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
