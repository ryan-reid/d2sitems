#!/usr/bin/env python3
"""Update the last modified time on .d2s files for specified characters."""

import argparse
import glob
import os
import re
import shutil
import time

def load_config(filename="d2sitems.conf"):
    """Load config from file next to this script or in the current directory."""
    config = {}
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), filename),
        os.path.join(os.getcwd(), filename),
    ]
    for path in candidates:
        if not os.path.exists(path):
            continue
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key, value = key.strip(), value.strip()
                if key and value:
                    if value.startswith("~"):
                        value = os.path.expanduser("~") + value[1:]
                    config[key] = value
        break
    return config

# Number-word lookup, ordered longest first within each tier so the longest
# trailing match wins (e.g. "Nineteen" before "Nine").
ONES = [("Nineteen", 19), ("Eighteen", 18), ("Seventeen", 17), ("Sixteen", 16),
        ("Fifteen", 15), ("Fourteen", 14), ("Thirteen", 13), ("Twelve", 12),
        ("Eleven", 11), ("Ten", 10),
        ("Nine", 9), ("Eight", 8), ("Seven", 7), ("Six", 6),
        ("Five", 5), ("Four", 4), ("Three", 3), ("Two", 2), ("One", 1)]
TENS = [("Ninety", 90), ("Eighty", 80), ("Seventy", 70), ("Sixty", 60),
        ("Fifty", 50), ("Forty", 40), ("Thirty", 30), ("Twenty", 20)]

def parse_trailing_number(name):
    """If name ends with a word-form number, return (prefix, number); else (name, None)."""
    # Try compound: <Tens><Ones> e.g. TwentyOne
    for t_word, t_val in TENS:
        for o_word, o_val in ONES:
            suffix = t_word + o_word
            if name.endswith(suffix):
                return name[:-len(suffix)], t_val + o_val
    # Try single tens
    for t_word, t_val in TENS:
        if name.endswith(t_word):
            return name[:-len(t_word)], t_val
    # Try single ones (and teens)
    for o_word, o_val in ONES:
        if name.endswith(o_word):
            return name[:-len(o_word)], o_val
    return name, None

def sort_key(filename):
    """Return a sort key for a save filename (case-insensitive, number-word aware)."""
    name = os.path.splitext(filename)[0]
    prefix, num = parse_trailing_number(name)
    return (prefix.lower(), num if num is not None else -1, name.lower())

def do_sort(save_dir):
    files = sorted(glob.glob(os.path.join(save_dir, "*.d2s")), key=lambda p: sort_key(os.path.basename(p)))
    if not files:
        print(f"No .d2s files found in {save_dir}")
        return

    # Find the file with the most recent mtime (special case: stays on top)
    newest = max(files, key=lambda p: os.path.getmtime(p))

    # Build final order: newest first, then the rest in alphabetical order
    ordered = [newest] + [f for f in files if f != newest]

    # Assign timestamps: first gets "now", each subsequent one is 1 second older
    now = time.time()
    for i, path in enumerate(ordered):
        ts = now - i
        os.utime(path, (ts, ts))
        print(f"  {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts))}  {os.path.basename(path)}")
    print(f"\nSorted {len(ordered)} save files in {save_dir}.")
    print("You may have to quit the game and relaunch for the game to notice")

if __name__ == "__main__":
    config = load_config()
    save_dir = config.get("save_dir",
        os.path.join(os.path.expanduser("~"), "Saved Games", "Diablo II Resurrected"))
    mule_dir = config.get("mule_dir")

    parser = argparse.ArgumentParser(
        description="Update the last modified time on .d2s files for specified characters.")
    parser.add_argument("characters", nargs="*", help="character names to touch")
    parser.add_argument("--sort", action="store_true",
                        help="Sort all save files alphabetically by mtime. The currently-newest "
                             "save keeps the top spot. Trailing number-words (e.g. 'TwentyOne') "
                             "are interpreted as numbers for sorting.")
    args = parser.parse_args()

    if args.sort:
        do_sort(save_dir)
        exit(0)

    if not args.characters:
        parser.error("provide character names to touch, or use --sort to sort all files")

    for name in args.characters:
        path = os.path.join(save_dir, f"{name}.d2s")
        if os.path.exists(path):
            os.utime(path, None)
            mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(path)))
            print(f"Brought forth {name} by touching {path}")
            print("You may have to quit the game and relaunch for the game to notice")
        elif mule_dir and os.path.isdir(mule_dir):
            mule_files = glob.glob(os.path.join(mule_dir, f"{name}.*"))
            if mule_files:
                print(f"Found {name} in mule directory, moving to save directory...")
                for src in mule_files:
                    dst = os.path.join(save_dir, os.path.basename(src))
                    shutil.move(src, dst)
                    print(f"  Moved {os.path.basename(src)}")
                d2s_path = os.path.join(save_dir, f"{name}.d2s")
                if os.path.exists(d2s_path):
                    os.utime(d2s_path, None)
                print(f"Brought forth {name} from mule directory")
                print("You may have to quit the game and relaunch for the game to notice")
            else:
                print(f"File not found: {path}")
                print(f"  Also not found in mule directory: {mule_dir}")
        else:
            print(f"File not found: {path}")
