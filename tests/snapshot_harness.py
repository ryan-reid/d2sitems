#!/usr/bin/env python3
"""
D2R Save & Stash Snapshot Test Harness
Manages golden test fixtures, snapshots, byte-level diffs, and verification of save files.
"""

import argparse
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
FIXTURES_DIR = os.path.join(SCRIPT_DIR, "fixtures")
BASELINES_DIR = os.path.join(FIXTURES_DIR, "baselines")
SNAPSHOTS_DIR = os.path.join(FIXTURES_DIR, "snapshots")

DEFAULT_SAVE_DIR = os.path.join(
    os.path.expanduser("~"),
    "Saved Games",
    "Diablo II Resurrected",
    "Mods",
    "BKDiablo"
)

DEFAULT_EXCEL_DIR = r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel"

CLASS_MAP = {
    "TestAmazon": "Amazon",
    "TestSin": "Assassin",
    "TestBarb": "Barbarian",
    "TestDruid": "Druid",
    "TestNecro": "Necromancer",
    "TestPally": "Paladin",
    "TestSorc": "Sorceress",
    "TestWarlock": "Warlock",
}

def ensure_dirs():
    os.makedirs(BASELINES_DIR, exist_ok=True)
    os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

def capture_baselines(source_dir=DEFAULT_SAVE_DIR):
    ensure_dirs()
    print(f"=== Capturing Golden Baselines from {source_dir} ===")
    captured = 0

    for test_prefix, class_name in CLASS_MAP.items():
        src_d2s = os.path.join(source_dir, f"{test_prefix}.d2s")
        if os.path.isfile(src_d2s):
            dest_d2s = os.path.join(BASELINES_DIR, f"{class_name}_L1.golden.d2s")
            shutil.copy2(src_d2s, dest_d2s)
            
            src_ctl = os.path.join(source_dir, f"{test_prefix}.ctl")
            if os.path.isfile(src_ctl):
                shutil.copy2(src_ctl, os.path.join(BASELINES_DIR, f"{class_name}_L1.golden.ctl"))

            size = os.path.getsize(dest_d2s)
            md5 = hashlib.md5(open(dest_d2s, "rb").read()).hexdigest()
            print(f"  [SAVED] {class_name}_L1.golden.d2s ({size} bytes, MD5: {md5})")
            captured += 1
        else:
            print(f"  [MISSING] Could not find {src_d2s}")

    # Capture shared stash baseline
    src_stash = os.path.join(source_dir, "ModernSharedStashSoftCoreV2.d2i")
    if os.path.isfile(src_stash):
        dest_stash = os.path.join(BASELINES_DIR, "ModernSharedStashSoftCoreV2.golden.d2i")
        shutil.copy2(src_stash, dest_stash)
        size = os.path.getsize(dest_stash)
        md5 = hashlib.md5(open(dest_stash, "rb").read()).hexdigest()
        print(f"  [SAVED] ModernSharedStashSoftCoreV2.golden.d2i ({size} bytes, MD5: {md5})")

    # Generate metadata manifest
    manifest = {
        "source_dir": source_dir,
        "class_count": captured,
        "files": {}
    }
    for f in glob.glob(os.path.join(BASELINES_DIR, "*")):
        fname = os.path.basename(f)
        manifest["files"][fname] = {
            "size": os.path.getsize(f),
            "md5": hashlib.md5(open(f, "rb").read()).hexdigest()
        }

    with open(os.path.join(BASELINES_DIR, "manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)

    print(f"\nCaptured {captured} character baselines in {BASELINES_DIR}")

def capture_snapshot(label, source_dir=DEFAULT_SAVE_DIR):
    ensure_dirs()
    target_dir = os.path.join(SNAPSHOTS_DIR, label)
    os.makedirs(target_dir, exist_ok=True)
    print(f"=== Capturing Snapshot '{label}' into {target_dir} ===")
    
    count = 0
    for ext in ("*.d2s", "*.d2i", "*.ctl"):
        for f in glob.glob(os.path.join(source_dir, ext)):
            fname = os.path.basename(f)
            dest = os.path.join(target_dir, fname)
            shutil.copy2(f, dest)
            count += 1
            
    print(f"Captured {count} files in snapshot '{label}'.")

def diff_files(file_a, file_b):
    if not os.path.isfile(file_a):
        print(f"Error: {file_a} does not exist.")
        return False
    if not os.path.isfile(file_b):
        print(f"Error: {file_b} does not exist.")
        return False

    bytes_a = open(file_a, "rb").read()
    bytes_b = open(file_b, "rb").read()

    print(f"Comparing:")
    print(f"  A: {file_a} ({len(bytes_a)} bytes)")
    print(f"  B: {file_b} ({len(bytes_b)} bytes)")

    if len(bytes_a) != len(bytes_b):
        print(f"  [FAIL] Size mismatch: A={len(bytes_a)}B, B={len(bytes_b)}B (diff: {len(bytes_b) - len(bytes_a)}B)")
        return False

    diffs = 0
    first_diff = None
    for i in range(len(bytes_a)):
        if bytes_a[i] != bytes_b[i]:
            if first_diff is None:
                first_diff = i
            diffs += 1
            if diffs <= 10:
                print(f"  Diff at offset {i} (0x{i:X}): A=0x{bytes_a[i]:02X} != B=0x{bytes_b[i]:02X}")

    if diffs == 0:
        print("  [PASS] 100% bit-for-bit IDENTICAL.")
        return True
    else:
        print(f"  [FAIL] Total byte differences: {diffs} / {len(bytes_a)} bytes (first diff at offset {first_diff})")
        return False

def run_tests():
    print("=== Running Roundtrip & Fixture Regression Suite ===")
    inspector_proj = os.path.join(SCRIPT_DIR, "inspector", "D2SInspector.csproj")
    if not os.path.isfile(inspector_proj):
        print("Inspector project not found.")
        return 1

    result = subprocess.run(["dotnet", "run", "--project", inspector_proj], cwd=PROJECT_DIR)
    return result.returncode

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="D2R Snapshot Test Harness")
    subparsers = parser.add_subparsers(dest="command")

    # capture-baselines
    p_base = subparsers.add_parser("capture-baselines", help="Capture baseline Level 1 characters as golden files")
    p_base.add_argument("--source", default=DEFAULT_SAVE_DIR, help="Source saves directory")

    # snapshot
    p_snap = subparsers.add_parser("snapshot", help="Capture current save directory state as a named snapshot")
    p_snap.add_argument("label", help="Snapshot name/label")
    p_snap.add_argument("--source", default=DEFAULT_SAVE_DIR, help="Source saves directory")

    # diff
    p_diff = subparsers.add_parser("diff", help="Compare two binary save files byte-by-byte")
    p_diff.add_argument("file_a", help="First file")
    p_diff.add_argument("file_b", help="Second file")

    # test
    subparsers.add_parser("test", help="Run the test suite")

    args = parser.parse_args()

    if args.command == "capture-baselines":
        capture_baselines(args.source)
    elif args.command == "snapshot":
        capture_snapshot(args.label, args.source)
    elif args.command == "diff":
        diff_files(args.file_a, args.file_b)
    elif args.command == "test":
        sys.exit(run_tests())
    else:
        parser.print_help()
