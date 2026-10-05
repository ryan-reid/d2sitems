"""Release watcher tests: no network or credentials required."""
import unittest
from unittest.mock import patch

from scripts.homelab import release_monitor as monitor


class Client:
    def __init__(self, marker, busy=None):
        self.marker = marker
        self.busy = busy
        self.dispatches = []

    def request(self, *args, **kwargs):
        return self.marker

    def api(self, path, **kwargs):
        if "payload" in kwargs:
            self.dispatches.append((path, kwargs["payload"]))
            return None
        return {"total_count": int(f"status={self.busy}&" in path)}


class MonitorTests(unittest.TestCase):
    revisions = {"repository": "a" * 40, "BKDiablo": "b" * 40}

    def check(self, client, **kwargs):
        with patch.object(monitor, "current_revisions", return_value=self.revisions):
            return monitor.check(client, **kwargs)

    def test_current_does_not_dispatch(self):
        client = Client(self.revisions)
        self.assertEqual(self.check(client), "current")
        self.assertEqual(client.dispatches, [])

    def test_missing_marker_bootstraps(self):
        client = Client(None)
        self.assertEqual(self.check(client), "dispatched")
        self.assertEqual(client.dispatches, [("ryan-reid/d2sitems/actions/workflows/deploy-pages.yml/dispatches", {"ref": "main"})])

    def test_bk_change_retries_until_published(self):
        client = Client(dict(self.revisions, BKDiablo="c" * 40))
        self.assertEqual(self.check(client), "dispatched")
        self.assertEqual(self.check(client), "dispatched")

    def test_each_active_state_suppresses_dispatch(self):
        for status in ("queued", "in_progress", "waiting", "pending", "requested"):
            with self.subTest(status=status):
                client = Client(None, busy=status)
                self.assertEqual(self.check(client), "busy")
                self.assertEqual(client.dispatches, [])

    def test_dry_run_does_not_dispatch(self):
        client = Client(None)
        self.assertEqual(self.check(client, dry_run=True), "dry-run")
        self.assertEqual(client.dispatches, [])

    def test_invalid_marker_fails_closed(self):
        with self.assertRaises(ValueError):
            self.check(Client({"repository": "bad"}))

    def test_reads_only_configured_bk_branch(self):
        class SourceClient:
            def api(self, path, **kwargs):
                if "/contents/.gitmodules?ref=" in path:
                    return '[submodule "mods/BKDiablo"]\nurl = https://github.com/example/BK\nbranch = mod/branch\n'
                if path == "ryan-reid/d2sitems/commits/main":
                    return {"sha": "a" * 40}
                if path == "example/BK/commits/mod%2Fbranch":
                    return {"sha": "b" * 40}
                raise AssertionError(path)
        self.assertEqual(monitor.current_revisions(SourceClient()), self.revisions)


if __name__ == "__main__":
    unittest.main()
