# Pages releases and BK updates

The release cadence matches BT-BKDiff's `Publish Wiki` workflow: pushes to
`main`, manual dispatches, and a daily `0 10 * * *` GitHub Actions fallback
(10:00 UTC, 05:00 Winnipeg daylight time / 04:00 standard time).

`mods/BKDiablo` tracks `BKDiablo-Ascension` in
`BaronBeefStick/BKDiablo-Ascenstion`, matching the wiki's BK submodule.
Every build updates the submodule to its configured remote branch, then:

1. Runs `python scripts/prepare_release.py` to refresh the embedded tables,
   strings and bank layout, regenerate bank geometry, apply BK HD item/panel
   artwork, rebuild image mappings, and fingerprint the resulting catalog.
2. Exports the unique-item creator catalog from the current mod tables.
3. Publishes the WebAssembly engine and deploys `web/` to Pages.

The preparation step requires the supported BK inputs; missing inputs stop
deployment. The application-owned `propertygroups.txt` supplement, baseline
saves, and committed artwork for assets absent from BK remain available.
Artwork provenance distinguishes refreshed mod sprites from committed fallback
assets. If BK begins shipping classic DC6 overrides, preparation stops until a
palette is configured rather than silently retaining obsolete artwork.

`source-revisions.json` in the deployed site records the app and BK commits
actually used. Failed builds leave the previous deployed marker intact.
Generated files are rebuilt in Actions; updating the submodule does not require
committing another copy of the generated catalogs or WebAssembly files.

## Homelab watcher

`scripts/homelab/release_monitor.py` uses the same marker-comparison and
`workflow_dispatch` mechanism as the wiki watcher. Its separate systemd timer
checks every minute with up to 30 seconds jitter. It watches only BKDiablo and
the app repository, suppresses dispatch while any Pages run is active, and
retries changes after failures. BT-only updates do not deploy d2sitems.

Install the script at `/opt/d2sitems-monitor/release_monitor.py` and the two
provided units in `/etc/systemd/system/`. The service uses the existing
`/etc/wiki-monitor/github-token` through systemd credentials; the token needs
Actions read/write access to both repositories. Never put credentials in Git.
Back up existing remote files before replacing them.

```sh
sudo python3 /opt/d2sitems-monitor/release_monitor.py --token-file /etc/wiki-monitor/github-token --dry-run
sudo systemctl daemon-reload
sudo systemctl enable --now d2sitems-monitor.timer
systemctl list-timers d2sitems-monitor.timer
journalctl -u d2sitems-monitor.service -n 20
```

Publish this repository change before enabling the timer: the watcher reads
`.gitmodules` from `main`. To disable checks, disable `d2sitems-monitor.timer`;
GitHub's daily fallback remains. No inbound webhook, port, or Docker service is
required. Monitor failures are logged in the systemd journal.
