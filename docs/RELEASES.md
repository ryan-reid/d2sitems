# Pages releases and BK updates

The release cadence matches BT-BKDiff's `Publish Wiki` workflow: pushes to
`main`, manual dispatches, and a daily `0 10 * * *` GitHub Actions fallback
(10:00 UTC, 05:00 Winnipeg daylight time / 04:00 standard time).

`mods/BKDiablo` tracks `BKDiablo-Ascension` in
`BaronBeefStick/BKDiablo-Ascenstion`, matching the wiki's BK submodule.
Every release updates the submodule to its configured remote branch, then builds
and deploys the website. There is no mod-data upgrade or synchronization step.

The native CLI, local server, and utilities default directly to
`mods/BKDiablo/bkdiablo.mpq/data/global/excel`. The WebAssembly project references
the submodule's tables, strings and layout as MSBuild resources. It embeds those
resources for offline browser use without first copying them into this repository.
`EmbeddedData/baselines` contains application test/save templates, and the root
`propertygroups.txt` is an application supplement, not a copied BK input.

`python scripts/build_web_assets.py` generates the browser catalogs, bank layout,
and PNG conversions directly from the submodule. These artifacts are ignored by
Git. Generated mod artwork lives in `web/assets/items/bk/` and `web/assets/bk/`;
the other item artwork supplies retail fallbacks. The local UI server builds the
browser artifacts automatically on startup. Missing submodule inputs fail the
build with an initialization instruction.

`source-revisions.json` in the deployed site records the app and BK commits used.
Failed builds leave the previous deployed marker intact.

## Development setup and Git hooks

```sh
git submodule update --init --recursive
git config core.hooksPath .githooks
python scripts/build_web_assets.py
dotnet publish src/D2SWasm/D2SWasm.csproj -c Release -o web/wasm
```

Copy `web/wasm/wwwroot/_framework` into `web/` to serve the offline engine locally.
`python web_ui.py --no-browser` rebuilds browser artifacts and starts the local UI.
A new clone needs the one-time `core.hooksPath` setting; Git does not transfer
local configuration between checkouts.

The hooks match BT-BKDiff: checkout, merge/pull, and rebase refresh the configured
submodule branches. Pre-commit refreshes them and stages their pointers. The hooks
require network access and stop on synchronization errors. They do not copy mod
files into the parent repository. The release workflow independently refreshes
the submodule because GitHub Actions does not rely on local Git hooks.

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
