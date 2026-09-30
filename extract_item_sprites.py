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
    r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\items",
    r"E:\Games\Diablo II Resurrected\Data\global\items",
]
DEFAULT_HD_ITEMS_ROOTS = [
    r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\hd\global\ui\items",
    r"E:\Games\Diablo II Resurrected\Data\hd\global\ui\items",
]
DEFAULT_HD_JSON_DIRS = [
    r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\hd\items",
    r"E:\Games\Diablo II Resurrected\Data\hd\items",
]
DEFAULT_EXCEL_DIRS = [
    r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel",
    r"E:\Games\Diablo II Resurrected\Data\global\excel",
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
                        hd_roots=DEFAULT_HD_ITEMS_ROOTS, out_dir=DEFAULT_OUTPUT_DIR):
    os.makedirs(out_dir, exist_ok=True)

    # 1. Classic DC6 sprites (with BGR palette fix)
    print(f"Loading palette from {palette_path} (BGR order)...")
    palette = load_palette(palette_path)

    dc6_files = {}
    # Scan in reverse so BKDiablo overrides retail
    for d in reversed(dc6_dirs):
        if not os.path.exists(d):
            continue
        for f in glob.glob(os.path.join(d, "*.[dD][cC]6")):
            base = os.path.splitext(os.path.basename(f))[0].lower()
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
    for hd_root in reversed(hd_roots):
        if not os.path.exists(hd_root):
            continue
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


def build_image_mappings(excel_dirs=DEFAULT_EXCEL_DIRS, hd_json_dirs=DEFAULT_HD_JSON_DIRS,
                         hd_files_map=None, json_path=DEFAULT_JSON_PATH):
    """Resolve each definition from the mod before considering a retail match."""
    import csv
    import hashlib
    import re
    items_dir = os.path.join(os.path.dirname(os.path.abspath(json_path)), "assets", "items")
    groups = ("codes", "uniques", "sets")
    result = {prefix + group: {} for prefix in ("", "hd_", "classic_") for group in groups}
    result["provenance"] = {}
    result["variants"] = {}
    fingerprints = {}

    def read_bytes(path):
        with open(path, "rb") as stream:
            data = stream.read()
        fingerprints[os.path.abspath(path)] = hashlib.sha256(data).hexdigest()
        return data

    def key(value):
        return re.sub(r"[^a-z0-9]", "", value.lower())

    def existing(name):
        return name if name and os.path.isfile(os.path.join(items_dir, name)) else None

    def hd_file(asset):
        # uniques.json can reference ../misc relative to the inventory items root.
        asset = asset.lower().replace("\\", "/")
        if asset.startswith("../misc/"):
            asset = asset[len("../misc/"):]
        return existing("hd_" + asset.replace("/", "_") + ".png") if asset else None

    sources = []
    for position, excel_dir in enumerate(excel_dirs):
        tables = {group: {} for group in groups}
        for group, filenames in (("codes", ("armor.txt", "weapons.txt", "misc.txt")),
                                 ("uniques", ("uniqueitems.txt",)), ("sets", ("setitems.txt",))):
            for filename in filenames:
                path = os.path.join(excel_dir, filename)
                if not os.path.isfile(path):
                    continue
                rows = csv.DictReader(read_bytes(path).decode("latin1").splitlines(), delimiter="\t")
                for row in rows:
                    identity = row.get("code" if group == "codes" else "index", "").strip()
                    if not identity:
                        continue
                    tables[group][identity.lower()] = row
        hd = {}
        json_dir = hd_json_dirs[position] if position < len(hd_json_dirs) else ""
        for group, filename in (("codes", "items.json"), ("uniques", "uniques.json"), ("sets", "sets.json")):
            path = os.path.join(json_dir, filename)
            hd[group] = {}
            if os.path.isfile(path):
                for entry in json.loads(read_bytes(path).decode("utf-8-sig")):
                    for identity, info in entry.items():
                        hd[group][key(identity)] = info
        sources.append((excel_dir, tables, hd))

    for group in groups:
        identities = set().union(*(set(tables[group]) for _, tables, _ in sources))
        for identity in sorted(identities):
            chosen = None
            classics = None
            modern = None
            provenance = None
            variants = {}
            aliases = {identity}
            for source_index, (source_dir, tables, hd) in enumerate(sources):
                row = tables[group].get(identity)
                if not row:
                    continue
                # The authoritative row owns the numeric ID; never borrow a conflicting retail ID.
                if not provenance and row.get("*ID"):
                    aliases.add(row["*ID"].strip())
                classic = existing(row.get("invfile", "").strip().lower() + ".png")
                info = hd[group].get(key(identity), {})
                modern_candidate = hd_file(info.get("asset" if group == "codes" else "normal", ""))
                if not chosen and (modern_candidate or classic):
                    chosen = modern_candidate or classic
                    modern = modern_candidate
                    classics = classic
                    provenance = {"definition": source_dir, "source": "BKDiablo" if source_index == 0 else "retail", "fallback": source_index != 0}
                    variants = {tier: hd_file(info.get(tier, "")) or chosen for tier in ("normal", "uber", "ultra")}
                    break
            if not chosen:
                continue
            for alias in aliases:
                result[group][alias] = chosen
                if modern:
                    result["hd_" + group][alias] = modern
                if classics:
                    result["classic_" + group][alias] = classics
                result["provenance"][group + ":" + alias] = provenance
                result["variants"][group + ":" + alias] = variants
    # Include resolved artwork bytes so replacing an icon changes the catalog revision.
    artwork = {name for group in groups for prefix in ("", "hd_", "classic_") for name in result[prefix + group].values()}
    artwork.update(name for variants in result["variants"].values() for name in variants.values() if name)
    for name in sorted(artwork):
        read_bytes(os.path.join(items_dir, name))
    result["schemaVersion"] = 2
    result["inputHashes"] = fingerprints
    result["revision"] = hashlib.sha256(json.dumps(fingerprints, sort_keys=True).encode()).hexdigest()
    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    import tempfile
    handle, staging = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(json_path)), suffix=".pending")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staging, json_path)
    finally:
        if os.path.exists(staging): os.remove(staging)
    print(f"Saved verified mappings to {json_path}: " + ", ".join(f"{group}={len(result[group])}" for group in groups))
    return result


if __name__ == "__main__":
    hd_map = extract_all_sprites()
    build_image_mappings(hd_files_map=hd_map)

