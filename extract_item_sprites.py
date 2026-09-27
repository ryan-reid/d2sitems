#!/usr/bin/env python3
"""
Diablo II: Resurrected Item Sprite Extractor
Extracts authentic item graphics from both:
1. Classic Diablo II .dc6 sprites decoded against Act 1 palette (pal.dat in BGR order)
2. Modern Diablo II: Resurrected High-Definition 32-bit RGBA SpA1 .sprite assets
and generates comprehensive item_images.json mapping item codes, unique IDs, and sets to sprites.
"""

import os
import sys
import glob
import json
import struct
import zlib
import shutil

DEFAULT_PALETTE_PATH = r"E:\Games\Diablo II Resurrected\Data\global\palette\act1\pal.dat"
DEFAULT_DC6_DIRS = [
    r"E:\Games\Diablo II Resurrected\Data\global\items",
    r"E:\Games\Diablo II Resurrected\Mods\Reimagined\Reimagined.mpq\data\global\items",
]
DEFAULT_HD_ITEMS_ROOT = r"E:\Games\Diablo II Resurrected\Data\hd\global\ui\items"
DEFAULT_HD_JSON_DIR = r"E:\Games\Diablo II Resurrected\Data\hd\items"
DEFAULT_EXCEL_DIRS = [
    r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel",
    r"E:\Games\Diablo II Resurrected\Mods\btdiablo\btdiablo.mpq\data\global\excel",
    r"E:\Games\Diablo II Resurrected\Mods\Reimagined\Reimagined.mpq\data\global\excel",
    r"E:\Games\Diablo II Resurrected\Mods\D2RMM\D2RMM.mpq\data\global\excel",
]
DEFAULT_OUTPUT_DIR = r"web\assets\items"
DEFAULT_JSON_PATH = r"web\item_images.json"


def load_palette(pal_path):
    if not os.path.exists(pal_path):
        raise FileNotFoundError(f"Palette file not found: {pal_path}")
    with open(pal_path, "rb") as f:
        pal_data = f.read(768)
    # pal.dat is stored in BGR order (Blue, Green, Red)
    return [(pal_data[i * 3 + 2], pal_data[i * 3 + 1], pal_data[i * 3]) for i in range(256)]


def make_png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def decode_dc6_to_png(dc6_path: str, palette: list) -> bytes | None:
    """Decode frame 0 of a DC6 sprite file into valid 32-bit RGBA PNG bytes."""
    with open(dc6_path, "rb") as f:
        data = f.read()

    if len(data) < 24:
        return None

    v, flags, fmt, skip, dirs, frames = struct.unpack("<iiiiii", data[:24])
    total_frames = dirs * frames
    if total_frames < 1 or len(data) < 28:
        return None

    ptr = struct.unpack("<I", data[24:28])[0]
    if len(data) < ptr + 32:
        return None

    flip, width, height, ox, oy, alloc_size, next_block, length = struct.unpack(
        "<iiiiiiii", data[ptr : ptr + 32]
    )
    if width <= 0 or height <= 0:
        return None

    indexed = [[255] * width for _ in range(height)]
    raw = data[ptr + 32 : ptr + 32 + length]
    raw_len = len(raw)

    x, y = 0, height - 1
    i = 0
    while i < raw_len and y >= 0:
        b = raw[i]
        i += 1
        if b == 0x80:
            x = 0
            y -= 1
        elif b & 0x80:
            x += b & 0x7F
        else:
            for _ in range(b):
                if x < width and y >= 0 and i < raw_len:
                    indexed[y][x] = raw[i]
                x += 1
                i += 1

    scanlines = bytearray()
    for row in indexed:
        scanlines.append(0)
        for p_idx in row:
            if p_idx == 255:
                scanlines.extend((0, 0, 0, 0))
            else:
                r, g, b = palette[p_idx]
                scanlines.extend((r, g, b, 255))

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png.extend(make_png_chunk(b"IHDR", ihdr))
    png.extend(make_png_chunk(b"IDAT", zlib.compress(bytes(scanlines))))
    png.extend(make_png_chunk(b"IEND", b""))
    return bytes(png)


def decode_spa1_to_png(sprite_path: str) -> bytes | None:
    """Decode a D2R HD SpA1 .sprite file into high-res 32-bit RGBA PNG bytes."""
    with open(sprite_path, "rb") as f:
        header = f.read(40)
        raw = f.read()

    if len(header) < 40 or header[:4] != b"SpA1":
        return None

    w = struct.unpack("<I", header[8:12])[0]
    h = struct.unpack("<I", header[12:16])[0]
    if w <= 0 or h <= 0 or len(raw) < w * h * 4:
        return None

    scanlines = bytearray()
    row_bytes = w * 4
    for y in range(h):
        scanlines.append(0)
        scanlines.extend(raw[y * row_bytes : (y + 1) * row_bytes])

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png.extend(make_png_chunk(b"IHDR", ihdr))
    png.extend(make_png_chunk(b"IDAT", zlib.compress(bytes(scanlines), level=1)))
    png.extend(make_png_chunk(b"IEND", b""))
    return bytes(png)


def extract_all_sprites(palette_path=DEFAULT_PALETTE_PATH, dc6_dirs=DEFAULT_DC6_DIRS,
                        hd_root=DEFAULT_HD_ITEMS_ROOT, out_dir=DEFAULT_OUTPUT_DIR):
    os.makedirs(out_dir, exist_ok=True)

    # 1. Classic DC6 sprites (with BGR palette fix)
    print(f"Loading palette from {palette_path} (BGR order)...")
    palette = load_palette(palette_path)

    dc6_files = {}
    for d in dc6_dirs:
        if not os.path.exists(d):
            continue
        for f in glob.glob(os.path.join(d, "*.[dD][cC]6")):
            base = os.path.splitext(os.path.basename(f))[0].lower()
            if base not in dc6_files:
                dc6_files[base] = f

    print(f"Converting {len(dc6_files)} classic DC6 sprite files...")
    dc6_converted = 0
    for base, path in dc6_files.items():
        try:
            png_data = decode_dc6_to_png(path, palette)
            if png_data:
                out_path = os.path.join(out_dir, f"{base}.png")
                with open(out_path, "wb") as f:
                    f.write(png_data)
                dc6_converted += 1
        except Exception as e:
            print(f"Error converting {path}: {e}")

    gemb_path = os.path.join(out_dir, "invgemb.png")
    sto2_path = os.path.join(out_dir, "invsto2.png")
    if os.path.exists(gemb_path) and not os.path.exists(sto2_path):
        shutil.copyfile(gemb_path, sto2_path)

    print(f"Successfully converted {dc6_converted} classic DC6 sprites.")

    # 2. Modern D2R HD SpA1 sprites
    hd_converted = 0
    hd_files_map = {}
    if os.path.exists(hd_root):
        print(f"Converting modern D2R HD SpA1 sprites from {hd_root}...")
        for prefix in ["armor", "weapon", "misc"]:
            p = os.path.join(hd_root, prefix)
            if not os.path.exists(p):
                continue
            for root, dirs, files in os.walk(p):
                for f in files:
                    if f.endswith(".sprite") and not f.endswith(".lowend.sprite"):
                        src_path = os.path.join(root, f)
                        rel_path = os.path.relpath(src_path, p)
                        asset_key = os.path.splitext(rel_path)[0].replace("\\", "/").lower()
                        clean_name = "hd_" + asset_key.replace("/", "_") + ".png"
                        hd_files_map[asset_key] = clean_name

                        try:
                            png_data = decode_spa1_to_png(src_path)
                            if png_data:
                                out_path = os.path.join(out_dir, clean_name)
                                with open(out_path, "wb") as out_f:
                                    out_f.write(png_data)
                                hd_converted += 1
                        except Exception as e:
                            print(f"Error converting HD sprite {src_path}: {e}")

        print(f"Successfully converted {hd_converted} D2R HD sprites.")

    return hd_files_map


def build_image_mappings(excel_dirs=DEFAULT_EXCEL_DIRS, hd_json_dir=DEFAULT_HD_JSON_DIR,
                         hd_files_map=None, json_path=DEFAULT_JSON_PATH):
    print("Building comprehensive sprite mappings (Classic + D2R HD)...")
    out_dir = os.path.dirname(os.path.abspath(json_path))
    items_dir = os.path.join(out_dir, "assets", "items")

    # Discover HD file map if not passed
    if not hd_files_map:
        hd_files_map = {}
        for f in glob.glob(os.path.join(items_dir, "hd_*.png")):
            base = os.path.splitext(os.path.basename(f))[0]
            # hd_weapon_axe_hand_axe -> axe/hand_axe
            asset_key = base[3:].replace("_", "/")
            hd_files_map[asset_key] = os.path.basename(f)

    # 1. Classic code mapping from Excel
    classic_codes = {}
    for edir in excel_dirs:
        for fname in ["armor.txt", "weapons.txt", "misc.txt"]:
            p = os.path.join(edir, fname)
            if not os.path.exists(p):
                continue
            with open(p, "r", encoding="latin-1") as f:
                headers = [h.strip() for h in f.readline().split("\t")]
                if "code" not in headers or "invfile" not in headers:
                    continue
                c_idx = headers.index("code")
                i_idx = headers.index("invfile")
                for line in f:
                    parts = [p.strip() for p in line.split("\t")]
                    if len(parts) > max(c_idx, i_idx):
                        code = parts[c_idx]
                        inv = parts[i_idx]
                        if code and inv and code not in classic_codes:
                            classic_codes[code] = f"{inv.lower()}.png"

    classic_codes["bag"] = "invgemb.png"

    classic_uniques = {}
    for edir in excel_dirs:
        p = os.path.join(edir, "uniqueitems.txt")
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="latin-1") as f:
            headers = [h.strip() for h in f.readline().split("\t")]
            id_col = headers.index("*ID") if "*ID" in headers else -1
            name_col = headers.index("index") if "index" in headers else -1
            inv_col = headers.index("invfile") if "invfile" in headers else -1
            for line in f:
                parts = [p.strip() for p in line.split("\t")]
                if inv_col >= 0 and len(parts) > inv_col:
                    inv = parts[inv_col]
                    if inv:
                        png = f"{inv.lower()}.png"
                        if id_col >= 0 and len(parts) > id_col and parts[id_col]:
                            classic_uniques[str(parts[id_col])] = png
                        if name_col >= 0 and len(parts) > name_col and parts[name_col]:
                            classic_uniques[parts[name_col].lower()] = png

    classic_sets = {}
    for edir in excel_dirs:
        p = os.path.join(edir, "setitems.txt")
        if not os.path.exists(p):
            continue
        with open(p, "r", encoding="latin-1") as f:
            headers = [h.strip() for h in f.readline().split("\t")]
            id_col = headers.index("*ID") if "*ID" in headers else -1
            name_col = headers.index("index") if "index" in headers else -1
            inv_col = headers.index("invfile") if "invfile" in headers else -1
            for line in f:
                parts = [p.strip() for p in line.split("\t")]
                if inv_col >= 0 and len(parts) > inv_col:
                    inv = parts[inv_col]
                    if inv:
                        png = f"{inv.lower()}.png"
                        if id_col >= 0 and len(parts) > id_col and parts[id_col]:
                            classic_sets[str(parts[id_col])] = png
                        if name_col >= 0 and len(parts) > name_col and parts[name_col]:
                            classic_sets[parts[name_col].lower()] = png

    # 2. Modern D2R HD Mappings from items.json, uniques.json, sets.json
    hd_codes = {}
    hd_uniques = {}
    hd_sets = {}

    items_json_path = os.path.join(hd_json_dir, "items.json")
    if os.path.exists(items_json_path):
        with open(items_json_path, "r", encoding="utf-8") as f:
            items_json = json.load(f)
        for entry in items_json:
            for code, info in entry.items():
                asset = info.get("asset", "").lower()
                clean_name = "hd_" + asset.replace("/", "_") + ".png"
                if os.path.exists(os.path.join(items_dir, clean_name)):
                    hd_codes[code] = clean_name

    uniques_json_path = os.path.join(hd_json_dir, "uniques.json")
    if os.path.exists(uniques_json_path):
        with open(uniques_json_path, "r", encoding="utf-8") as f:
            uniques_json = json.load(f)
        for entry in uniques_json:
            for uname, info in entry.items():
                asset = info.get("normal", "").lower()
                clean_name = "hd_" + asset.replace("/", "_") + ".png"
                if os.path.exists(os.path.join(items_dir, clean_name)):
                    hd_uniques[uname.lower()] = clean_name
                    hd_uniques[uname.lower().replace("_", " ")] = clean_name

    sets_json_path = os.path.join(hd_json_dir, "sets.json")
    if os.path.exists(sets_json_path):
        with open(sets_json_path, "r", encoding="utf-8") as f:
            sets_json = json.load(f)
        for entry in sets_json:
            for sname, info in entry.items():
                asset = info.get("normal", "").lower()
                clean_name = "hd_" + asset.replace("/", "_") + ".png"
                if os.path.exists(os.path.join(items_dir, clean_name)):
                    hd_sets[sname.lower()] = clean_name
                    hd_sets[sname.lower().replace("_", " ")] = clean_name

    # 3. Merged Best-Quality mappings (HD preferred, falling back to classic)
    merged_codes = dict(classic_codes)
    merged_codes.update(hd_codes)

    merged_uniques = dict(classic_uniques)
    merged_uniques.update(hd_uniques)

    merged_sets = dict(classic_sets)
    merged_sets.update(hd_sets)

    mapping_data = {
        "codes": merged_codes,
        "uniques": merged_uniques,
        "sets": merged_sets,
        "hd_codes": hd_codes,
        "hd_uniques": hd_uniques,
        "hd_sets": hd_sets,
        "classic_codes": classic_codes,
        "classic_uniques": classic_uniques,
        "classic_sets": classic_sets,
    }

    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(mapping_data, f, indent=2)

    print(f"Saved complete sprite mapping to {json_path}")
    print(f"  Merged codes: {len(merged_codes)} (HD: {len(hd_codes)}, Classic: {len(classic_codes)})")
    print(f"  Merged uniques: {len(merged_uniques)} (HD: {len(hd_uniques)}, Classic: {len(classic_uniques)})")
    print(f"  Merged sets: {len(merged_sets)} (HD: {len(hd_sets)}, Classic: {len(classic_sets)})")
    return mapping_data


if __name__ == "__main__":
    hd_map = extract_all_sprites()
    build_image_mappings(hd_files_map=hd_map)
