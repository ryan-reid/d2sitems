#!/usr/bin/env python3
"""
scripts/update_100pct_chronicle.py
Auto-updater for BKDiablo In-Game Holy Grail Chronicle (.d2i shared stash saves).

When the mod author publishes an update with new items, run this script to:
  1. (Optional) Pull the latest mod submodule updates: --pull
  2. Scan the latest mod game tables (uniqueitems.txt, setitems.txt, runes.txt, item-runes.json)
  3. Detect newly added uniques, sets, and runewords
  4. Automatically update the 100% complete Holy Grail Chronicle in exports/100pct_chronicle/
     and optionally active live game saves (--live)
  5. Regenerate companion JSON files and the Web UI checklist

Usage Examples:
  python scripts/update_100pct_chronicle.py --dry-run
  python scripts/update_100pct_chronicle.py
  python scripts/update_100pct_chronicle.py --live
  python scripts/update_100pct_chronicle.py --pull
"""

import os
import sys
import subprocess
import argparse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    parser = argparse.ArgumentParser(
        description="Auto-update BKDiablo 100% In-Game Holy Grail Chronicle stashes from mod data files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--pull", action="store_true", help="Pull latest mod submodule updates (git submodule update --remote) before scanning")
    parser.add_argument("--dry-run", "-n", action="store_true", help="Preview newly detected items without modifying save files")
    parser.add_argument("--live", "-l", action="store_true", help="Also update active game saves in %%USERPROFILE%%\\Saved Games\\Diablo II Resurrected\\Mods\\BKDiablo\\")
    parser.add_argument("--excel", "-e", type=str, help="Specify custom path to mod excel directory (uniqueitems.txt, etc.)")
    parser.add_argument("--strings", "-s", type=str, help="Specify custom path to mod strings directory (item-names.json, etc.)")
    parser.add_argument("--target", "-t", type=str, action="append", help="Specify explicit .d2i stash file(s) to update")
    args, unknown = parser.parse_known_args()

    if args.pull:
        print("[GIT] Updating BKDiablo submodule to latest remote commit...")
        res = subprocess.run(["git", "submodule", "update", "--remote", "mods/BKDiablo"], cwd=REPO_ROOT)
        if res.returncode != 0:
            print("[WARN] Git submodule update returned non-zero code. Proceeding with existing files.")

    cmd = ["dotnet", "run", "--project", "d2sitems.csproj", "--", "update-chronicle"]
    if args.dry_run:
        cmd.append("--dry-run")
    if args.live:
        cmd.append("--live")
    if args.excel:
        cmd.extend(["--excel", args.excel])
    if args.strings:
        cmd.extend(["--strings", args.strings])
    if args.target:
        for t in args.target:
            cmd.extend(["--target", t])
    cmd.extend(unknown)

    result = subprocess.run(cmd, cwd=REPO_ROOT)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
