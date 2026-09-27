#!/usr/bin/env python3
"""
Diablo II: Resurrected Item Sprite Extractor
Decodes authentic .dc6 item sprites using the Act 1 palette (pal.dat) into transparent 32-bit RGBA PNGs
and generates item_images.json mapping item codes, unique IDs, and set items to sprite filenames.
"""

import os
import sys
import glob
import json
import struct
import zlib

DEFAULT_PALETTE_PATH = r"E:\Games\Diablo II Resurrected\Data\global\palette\act1\pal.dat"
DEFAULT_DC6_DIRS = [
    r"E:\Games\Diablo II Resurrected\Data\global\items",
    r"E:\Games\Diablo II Resurrected\Mods\Reimagined\Reimagined.mpq\data\global\items",
]
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
    return [(pal_data[i * 3], pal_data[i * 3 + 1], pal_data[i * 3 + 2]) for i in range(256)]


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

    # Frame 0 pointer
    ptr = struct.unpack("<I", data[24:28])[0]
    if len(data) < ptr + 32:
        return None

    flip, width, height, ox, oy, alloc_size, next_block, length = struct.unpack(
        "<iiiiiiii", data[ptr : ptr + 32]
    )
    if width <= 0 or height <= 0:
        return None

    # DC6 uses bottom-to-top indexed scanlines with run-length encoding
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

    # RGBA Scanlines
    scanlines = bytearray()
    for row in indexed:
        scanlines.append(0)  # Filter type: None
        for p_idx in row:
            if p_idx == 255:
                scanlines.extend((0, 0, 0, 0))  # Transparent
            else:
                r, g, b = palette[p_idx]
                scanlines.extend((r, g, b, 255))  # Opaque RGB

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png.extend(make_png_chunk(b"IHDR", ihdr))
    png.extend(make_png_chunk(b"IDAT", zlib.compress(bytes(scanlines))))
    png.extend(make_png_chunk(b"IEND", b""))
    return bytes(png)


def extract_all_sprites(palette_path=DEFAULT_PALETTE_PATH, dc6_dirs=DEFAULT_DC6_DIRS, out_dir=DEFAULT_OUTPUT_DIR):
    print(f"Loading palette from {palette_path}...")
    palette = load_palette(palette_path)

    os.makedirs(out_dir, exist_ok=True)

    dc6_files = {}
    for d in dc6_dirs:
        if not os.path.exists(d):
            continue
        for f in glob.glob(os.path.join(d, "*.[dD][cC]6")):
            base = os.path.splitext(os.path.basename(f))[0].lower()
            if base not in dc6_files:
                dc6_files[base] = f

    print(f"Discovered {len(dc6_files)} unique DC6 sprite files.")
    converted = 0
    for base, path in dc6_files.items():
        try:
            png_data = decode_dc6_to_png(path, palette)
            if png_data:
                out_path = os.path.join(out_dir, f"{base}.png")
                with open(out_path, "wb") as f:
                    f.write(png_data)
                converted += 1
        except Exception as e:
            print(f"Error converting {path}: {e}")

    # Aliases
    gemb_path = os.path.join(out_dir, "invgemb.png")
    sto2_path = os.path.join(out_dir, "invsto2.png")
    if os.path.exists(gemb_path) and not os.path.exists(sto2_path):
        import shutil
        shutil.copyfile(gemb_path, sto2_path)

    print(f"Successfully converted {converted} item sprites to {out_dir}.")


def build_image_mappings(excel_dirs=DEFAULT_EXCEL_DIRS, json_path=DEFAULT_JSON_PATH):
    print("Building code-to-sprite mapping table from mod Excel files...")
    code_map = {}
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
                        if code and inv and code not in code_map:
                            code_map[code] = f"{inv.lower()}.png"

    code_map["bag"] = "invgemb.png"

    unique_map = {}
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
                            unique_map[str(parts[id_col])] = png
                        if name_col >= 0 and len(parts) > name_col and parts[name_col]:
                            unique_map[parts[name_col].lower()] = png

    set_map = {}
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
                            set_map[str(parts[id_col])] = png
                        if name_col >= 0 and len(parts) > name_col and parts[name_col]:
                            set_map[parts[name_col].lower()] = png

    mapping_data = {
        "codes": code_map,
        "uniques": unique_map,
        "sets": set_map,
    }

    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(mapping_data, f, indent=2)

    print(f"Saved sprite mapping to {json_path} (Codes: {len(code_map)}, Uniques: {len(unique_map)}, Sets: {len(set_map)})")
    return mapping_data


if __name__ == "__main__":
    extract_all_sprites()
    build_image_mappings()
