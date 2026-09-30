#!/usr/bin/env python3
"""
D2SItems Web UI Server
Provides a local web interface to explore, search, and inspect Diablo II save files,
characters, shared stashes, and Holy Grail progression.
"""

import shutil
import argparse
import glob
import hashlib
import http.server
import json
import mimetypes
import os
import re
import socketserver
import struct
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("application/javascript", ".js")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(SCRIPT_DIR, "web")
CONF_FILE = os.path.join(SCRIPT_DIR, "d2sitems.conf")

# Default paths
DEFAULT_USER_HOME = os.path.expanduser("~")
DEFAULT_D2R_SAVE_DIR = os.path.join(DEFAULT_USER_HOME, "Saved Games", "Diablo II Resurrected")
DEFAULT_D2R_EXCEL_DIR = r"E:\Games\Diablo II Resurrected\Data\global\excel"
FALLBACK_EXCEL_DIR = r"C:\Program Files (x86)\Diablo II Resurrected\data\global\excel"
ITEMS_ASSETS_DIR = os.path.join(WEB_DIR, "assets", "items")
SPRITE_MAPPINGS_FILE = os.path.join(WEB_DIR, "item_images.json")

def catalog_revision(directory):
    if not directory or not os.path.isdir(directory):
        return None
    manifest = "".join(os.path.basename(path).lower() + ":" + hashlib.sha256(open(path, "rb").read()).hexdigest().upper() + "\n"
                       for path in sorted(glob.glob(os.path.join(directory, "*.txt")), key=lambda path: os.path.basename(path).lower()))
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest().upper()

def get_sprite_mappings():
    if os.path.isfile(SPRITE_MAPPINGS_FILE):
        try:
            with open(SPRITE_MAPPINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"codes": {}, "uniques": {}, "sets": {}}

def resolve_item_art(item, catalog, classic=False):
    quality = (item.get("quality") or "").lower()
    group = "uniques" if quality == "unique" else "sets" if quality == "set" else "codes"
    identifier = item.get("uniqueId" if quality == "unique" else "setId")
    name = (item.get("name") or item.get("displayName") or "").split("(")[0].strip().lower()
    code = (item.get("itemCode") or "").strip()
    keys = [code] if group == "codes" else [str(identifier) if identifier is not None else None, name]
    for kind, key in [(group, key) for key in keys if key] + [("codes", code)]:
        fallback = catalog.get(kind, {}).get(key)
        if not fallback:
            continue
        identity = kind + ":" + key
        tier = {"Normal": "normal", "Exceptional": "uber", "Elite": "ultra"}.get(item.get("tier"), "normal")
        file = (catalog.get("classic_" + kind, {}).get(key) or fallback) if classic else catalog.get("variants", {}).get(identity, {}).get(tier, fallback)
        return {"file": file, "identity": identity, **catalog.get("provenance", {}).get(identity, {})}
    return {"file": None, "source": "unmatched"}

# Find d2sitems executable or dotnet project
D2S_EXE_CANDIDATES = [
    os.path.join(SCRIPT_DIR, "bin", "Release", "net10.0", "win-x64", "publish", "d2sitems.exe"),
    os.path.join(SCRIPT_DIR, "bin", "Debug", "net10.0", "d2sitems.exe"),
    os.path.join(SCRIPT_DIR, "d2sitems.exe"),
]

def runner_command(runner_type, runner_path):
    return [runner_path] if runner_type == "exe" else ["dotnet", "run", "--project", runner_path, "--no-launch-profile", "--"]

def find_d2s_runner():
    """Returns (runner_type, path/command)."""
    # A source checkout must execute the current engine, not a stale checked-in binary.
    csproj = os.path.join(SCRIPT_DIR, "d2sitems.csproj")
    if os.path.isfile(csproj) and shutil.which("dotnet"):
        return ("dotnet", csproj)
    for candidate in D2S_EXE_CANDIDATES:
        if os.path.isfile(candidate):
            return ("exe", candidate)
    csproj = os.path.join(SCRIPT_DIR, "d2sitems.csproj")
    if os.path.isfile(csproj):
        return ("dotnet", csproj)
    return (None, None)

def load_conf():
    config = {}
    if os.path.isfile(CONF_FILE):
        with open(CONF_FILE, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if v.startswith("~"):
                    v = os.path.expanduser("~") + v[1:]
                config[k] = v
    return config

DEFAULT_BKDIABLO_SAVE_DIR = os.path.join(DEFAULT_D2R_SAVE_DIR, "Mods", "BKDiablo")
DEFAULT_BKDIABLO_EXCEL_DIR = r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel"

def detect_profiles():
    """Detect available save profiles specifically for BKDiablo with optional retail fallback."""
    profiles = []
    conf = load_conf()
    bkd_save = conf.get("save_dir", DEFAULT_BKDIABLO_SAVE_DIR)
    if not os.path.isdir(bkd_save) and os.path.isdir(DEFAULT_BKDIABLO_SAVE_DIR):
        bkd_save = DEFAULT_BKDIABLO_SAVE_DIR
    bkd_excel = conf.get("excel_dir", DEFAULT_BKDIABLO_EXCEL_DIR)
    if not os.path.isdir(bkd_excel) and os.path.isdir(DEFAULT_BKDIABLO_EXCEL_DIR):
        bkd_excel = DEFAULT_BKDIABLO_EXCEL_DIR

    # 1. Primary Profile: BKDiablo
    if os.path.isdir(bkd_save):
        profiles.append({
            "id": "bkdiablo",
            "name": "BKDiablo",
            "save_dir": bkd_save,
            "excel_dir": bkd_excel,
            "is_default": True
        })

    # 2. Optional Fallback: Retail D2R (Unmodded)
    if os.path.isdir(DEFAULT_D2R_SAVE_DIR) and os.path.normcase(os.path.normpath(DEFAULT_D2R_SAVE_DIR)) != os.path.normcase(os.path.normpath(bkd_save)):
        vanilla_saves = glob.glob(os.path.join(DEFAULT_D2R_SAVE_DIR, "*.d2s")) + glob.glob(os.path.join(DEFAULT_D2R_SAVE_DIR, "*.d2i"))
        if vanilla_saves:
            profiles.append({
                "id": "retail",
                "name": "Retail D2R (Unmodded)",
                "save_dir": DEFAULT_D2R_SAVE_DIR,
                "excel_dir": DEFAULT_D2R_EXCEL_DIR if os.path.isdir(DEFAULT_D2R_EXCEL_DIR) else FALLBACK_EXCEL_DIR,
                "is_default": False
            })

    return profiles

class SaveDataManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.profiles = detect_profiles()
        self.active_profile_id = self.profiles[0]["id"] if self.profiles else "default"
        self.saves = []       # list of character & stash summaries
        self.items = []       # list of all loaded items
        self.grail_data = None
        self.last_scanned = None
        self._hire_lookup = None
        self._merc_strings = None
        self.reload()

    def get_active_profile(self):
        for p in self.profiles:
            if p["id"] == self.active_profile_id:
                return p
        return self.profiles[0] if self.profiles else {
            "id": "custom",
            "name": "Custom",
            "save_dir": DEFAULT_D2R_SAVE_DIR,
            "excel_dir": DEFAULT_D2R_EXCEL_DIR
        }

    def set_active_profile(self, profile_id):
        with self.lock:
            for p in self.profiles:
                if p["id"] == profile_id:
                    self.active_profile_id = profile_id
                    break
        self.reload()

    def add_custom_profile(self, name, save_dir, excel_dir):
        with self.lock:
            pid = f"custom-{len(self.profiles)+1}"
            self.profiles.append({
                "id": pid,
                "name": name,
                "save_dir": save_dir,
                "excel_dir": excel_dir,
                "is_default": False
            })
            self.active_profile_id = pid
        self.reload()
        return pid

    def reload(self):
        with self.lock:
            active_p = self.get_active_profile()
            save_dirs = []
            if active_p["id"] == "all":
                for p in self.profiles:
                    if p["id"] != "all" and os.path.isdir(p.get("save_dir", "")):
                        save_dirs.append((p["name"], p["save_dir"]))
            else:
                s_dir = active_p.get("save_dir", "")
                if os.path.isdir(s_dir):
                    save_dirs.append((active_p["name"], s_dir))

            current_revision = catalog_revision(active_p.get("excel_dir"))
            loaded_saves = []
            loaded_items = []
            item_id_counter = 1

            sprite_mappings = get_sprite_mappings()
            code_map = sprite_mappings.get("codes", {})
            unique_map = sprite_mappings.get("uniques", {})
            set_map = sprite_mappings.get("sets", {})
            classic_code_map = sprite_mappings.get("classic_codes", {})
            classic_unique_map = sprite_mappings.get("classic_uniques", {})
            classic_set_map = sprite_mappings.get("classic_sets", {})

            for profile_label, s_dir in save_dirs:
                json_files = glob.glob(os.path.join(s_dir, "*.json"))
                for jf in json_files:
                    # Ignore lootfilter.json and Settings.json
                    base_name = os.path.basename(jf).lower()
                    if base_name in ("lootfilter.json", "settings.json", "d2sitems.conf.json"):
                        continue

                    try:
                        with open(jf, "r", encoding="utf-8", errors="ignore") as f:
                            data = json.load(f)
                    except Exception:
                        continue

                    file_name = data.get("file", os.path.basename(jf))
                    char_info = data.get("character")
                    is_stash = data.get("type") == "SharedStash" or not char_info
                    items_in_file = data.get("items", [])

                    save_entry = {
                        "file": file_name,
                        "path": jf,
                        "profile": profile_label,
                        "is_stash": is_stash,
                        "item_count": len(items_in_file),
                        "saveRevision": data.get("saveRevision"),
                    }

                    if is_stash:
                        save_entry["name"] = "Shared Stash"
                        save_entry["core"] = data.get("core", "soft")
                        save_entry["gameVersion"] = data.get("gameVersion", "")
                        save_entry["tabs"] = data.get("tabs", [])
                        total_gold = sum(t.get("gold", 0) for t in data.get("tabs", []))
                        save_entry["total_gold"] = total_gold
                    else:
                        save_entry["name"] = char_info.get("name", os.path.splitext(file_name)[0])
                        save_entry["level"] = char_info.get("level", 1)
                        save_entry["class"] = char_info.get("class", "Unknown")
                        save_entry["core"] = char_info.get("core", "soft")
                        save_entry["gameVersion"] = char_info.get("gameVersion", "")
                        save_entry["stats"] = data.get("stats", {})
                        save_entry["hasCorpse"] = char_info.get("hasCorpse", False)

                    loaded_saves.append(save_entry)

                    # Normalize items
                    source_name = save_entry["name"]
                    for it in items_in_file:
                        it_norm = dict(it)
                        it_norm["id"] = item_id_counter
                        item_id_counter += 1
                        it_norm["profile"] = profile_label
                        it_norm["sourceName"] = source_name
                        it_norm["sourceFile"] = file_name
                        it_norm["saveRevision"] = data.get("saveRevision")
                        it_norm["catalogRevision"] = data.get("catalogRevision")
                        it_norm["catalogStale"] = not current_revision or data.get("catalogRevision") != current_revision
                        if it_norm["catalogStale"]:
                            it_norm["verificationStatus"] = "unknown"
                            it_norm["isOutOfDate"] = False
                            it_norm["perfection"] = None
                            it_norm["perfectionScore"] = None
                            it_norm["outOfDateIssues"] = []
                        it_norm["isStash"] = is_stash

                        # Helper flags
                        flags = it_norm.get("flags") or []
                        it_norm["isEthereal"] = any("ethereal" in str(f).lower() for f in flags)
                        it_norm["isRuneword"] = any("runeword" in str(f).lower() for f in flags)
                        it_norm["isCorrupted"] = bool(it_norm.get("isCorrupted")) or any("corrupt" in str(f).lower() for f in flags) or any(s.get("id") == "corrupted" for s in it_norm.get("stats", []))

                        # Extract clean display name
                        raw_name = it_norm.get("name") or it_norm.get("baseName") or "Unknown Item"
                        it_norm["displayName"] = raw_name

                        art = resolve_item_art(it_norm, sprite_mappings)
                        it_norm["invFile"] = art["file"]
                        it_norm["invFileClassic"] = resolve_item_art(it_norm, sprite_mappings, True)["file"]
                        it_norm["artworkSource"] = art.get("source")
                        it_norm["artworkFallback"] = art.get("fallback", False)

                        # Perfection
                        perf = it_norm.get("perfectionScore") if it_norm.get("perfectionScore") is not None else it_norm.get("perfection")
                        if perf is not None:
                            try:
                                if isinstance(perf, str) and perf.endswith("%"):
                                    it_norm["perfectionNum"] = float(perf[:-1])
                                else:
                                    it_norm["perfectionNum"] = float(perf)
                                it_norm["perfection"] = it_norm["perfectionNum"]
                                it_norm["perfectionScore"] = it_norm["perfectionNum"]
                            except (ValueError, TypeError):
                                it_norm["perfectionNum"] = None
                        else:
                            it_norm["perfectionNum"] = None

                        if it_norm.get("perfectionNum") is not None and it_norm["perfectionNum"] >= 100.0:
                            if "flags" not in it_norm or it_norm["flags"] is None:
                                it_norm["flags"] = []
                            if "Perfect" not in it_norm["flags"]:
                                it_norm["flags"].append("Perfect")
                        it_norm["isOutOfDate"] = not it_norm["catalogStale"] and bool(it.get("isOutOfDate", False))
                        it_norm["outOfDateIssues"] = [] if it_norm["catalogStale"] else (it.get("outOfDateIssues") or [])

                        loaded_items.append(it_norm)

            self.saves = loaded_saves
            self.items = loaded_items
            self.grail_data = None  # Lazy load on request

    def run_scan(self):
        """Execute d2sitems to parse save files for active profile."""
        active_p = self.get_active_profile()
        runner_type, runner_path = find_d2s_runner()
        if not runner_type:
            return {"success": False, "error": "Could not find d2sitems.exe or dotnet project."}

        dirs_to_scan = []
        if active_p["id"] == "all":
            for p in self.profiles:
                if p["id"] != "all" and os.path.isdir(p.get("save_dir", "")):
                    dirs_to_scan.append((p.get("excel_dir"), p.get("save_dir")))
        else:
            dirs_to_scan.append((active_p.get("excel_dir"), active_p.get("save_dir")))

        logs = []
        success = True
        for excel_dir, save_dir in dirs_to_scan:
            cmd = []
            if runner_type == "exe":
                cmd = [runner_path]
            else:
                cmd = ["dotnet", "run", "--project", runner_path, "--"]

            if excel_dir and os.path.isdir(excel_dir):
                cmd.extend(["--excel", excel_dir])
            cmd.append(save_dir)

            try:
                proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True, timeout=60)
                success = success and proc.returncode == 0
                logs.append(f"Scanning {save_dir} with excel {excel_dir}...\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
            except Exception as e:
                success = False
                logs.append(f"Error running scan on {save_dir}: {str(e)}")

        self.reload()
        return {"success": success, "log": "\n---\n".join(logs), "saves_count": len(self.saves), "items_count": len(self.items)}

    def search_items(self, query_params):
        """Filter items in memory with rich criteria."""
        q = query_params.get("q", "").strip().lower()
        quality = query_params.get("quality", "").strip()
        item_type = query_params.get("type", "").strip().lower()
        tier = query_params.get("tier", "").strip().lower()
        source = query_params.get("source", "").strip()
        location = query_params.get("location", "").strip().lower()
        ethereal = query_params.get("ethereal", "").strip().lower()
        sockets = query_params.get("sockets", "").strip()
        min_perf = query_params.get("min_perf")
        max_perf = query_params.get("max_perf")
        perfect = query_params.get("perfect", "").strip().lower()
        stat_keyword = query_params.get("stat", "").strip().lower()
        out_of_date = query_params.get("out_of_date", "").strip().lower()
        corrupted = query_params.get("corrupted", "").strip().lower()
        sort_by = query_params.get("sort", "name_asc")

        filtered = []
        for it in self.items:
            # Out of date filter
            if out_of_date == "yes" and not it.get("isOutOfDate"):
                continue
            if out_of_date == "no" and it.get("verificationStatus") != "verified":
                continue

            # Corrupted filter
            if corrupted == "yes" and not it.get("isCorrupted"):
                continue
            if corrupted == "no" and it.get("isCorrupted"):
                continue

            # 1. Source / Character filter
            if source and source != "all":
                if it["sourceName"] != source and it["sourceFile"] != source:
                    continue

            # 2. Quality filter
            if quality and quality != "all":
                it_q = (it.get("quality") or "").lower()
                req_q = quality.lower()
                if req_q == "runeword":
                    if not it.get("isRuneword"):
                        continue
                elif req_q in ("craft", "crafted"):
                    if it_q not in ("craft", "crafted"):
                        continue
                elif it_q != req_q:
                    continue

            # 3. Item type filter
            if item_type and item_type != "all":
                it_t = (it.get("type") or "").lower()
                if item_type not in it_t:
                    continue

            # 4. Tier filter
            if tier and tier != "all":
                it_tier = (it.get("tier") or "").lower()
                if it_tier != tier:
                    continue

            # 5. Location filter
            if location and location != "all":
                it_loc = (it.get("location") or "").lower()
                if location not in it_loc:
                    continue

            # 6. Ethereal
            if ethereal == "yes" and not it.get("isEthereal"):
                continue
            if ethereal == "no" and it.get("isEthereal"):
                continue

            # 7. Sockets
            if sockets and sockets != "all":
                count = it.get("socketCount", 0)
                open_cnt = it.get("openSockets", 0)
                if sockets == "has":
                    if count <= 0: continue
                elif sockets == "open":
                    if open_cnt <= 0: continue
                else:
                    try:
                        s_req = int(sockets)
                        if count != s_req: continue
                    except ValueError:
                        pass

            # 8. Perfection Score
            perf_val = it.get("perfectionNum")
            if perfect in ("yes", "100", "perfect"):
                if perf_val is None or perf_val < 100.0:
                    continue
            elif perfect == "90":
                if perf_val is None or perf_val < 90.0:
                    continue

            if min_perf:
                try:
                    if perf_val is None or perf_val < float(min_perf):
                        continue
                except ValueError:
                    pass
            if max_perf:
                try:
                    if perf_val is None or perf_val > float(max_perf):
                        continue
                except ValueError:
                    pass

            # 9. Free-text search (q)
            if q:
                perf_query = q in ("perfect", "perf", "100%", "100% perf", "100% perfect")
                perf_match = perf_query and (perf_val is not None and perf_val >= 100.0)

                # Matches name, baseName, itemCode, sockets, or stat description
                name_match = q in it.get("displayName", "").lower()
                base_match = q in (it.get("baseName") or "").lower()
                set_match = q in (it.get("set") or "").lower()
                flag_match = any(q in str(f).lower() for f in (it.get("flags") or []))

                # Stat match
                stat_match = False
                for stat_list in ("stats", "runewordStats"):
                    for s in it.get(stat_list) or []:
                        desc = (s.get("description") or s.get("id") or "").lower()
                        if q in desc:
                            stat_match = True
                            break
                    if stat_match:
                        break

                # Socket bonuses match
                if not stat_match:
                    for sb in it.get("socketBonuses") or []:
                        if q in sb.lower():
                            stat_match = True
                            break

                # Socketed gems/runes match
                if not stat_match:
                    for sk in it.get("sockets") or []:
                        if q in sk.get("name", "").lower():
                            stat_match = True
                            break

                if not (name_match or base_match or set_match or flag_match or stat_match or perf_match):
                    continue

            # 10. Specific stat keyword filter
            if stat_keyword:
                stat_found = False
                for stat_list in ("stats", "runewordStats"):
                    for s in it.get(stat_list) or []:
                        desc = (s.get("description") or s.get("id") or "").lower()
                        if stat_keyword in desc:
                            stat_found = True
                            break
                    if stat_found:
                        break
                if not stat_found:
                    for sb in it.get("socketBonuses") or []:
                        if stat_keyword in sb.lower():
                            stat_found = True
                            break
                if not stat_found:
                    continue

            filtered.append(it)

        # Sorting
        if sort_by == "perfection_desc":
            filtered.sort(key=lambda x: (x.get("perfectionNum") is not None, x.get("perfectionNum") or 0), reverse=True)
        elif sort_by == "perfection_asc":
            filtered.sort(key=lambda x: (x.get("perfectionNum") is not None, x.get("perfectionNum") or 100))
        elif sort_by == "ilvl_desc":
            filtered.sort(key=lambda x: x.get("itemLevel") or 0, reverse=True)
        elif sort_by == "quality_desc":
            q_ranks = {"unique": 7, "set": 6, "runeword": 5, "crafted": 4, "rare": 3, "magic": 2, "superior": 1, "normal": 0}
            filtered.sort(key=lambda x: q_ranks.get((x.get("quality") or "").lower(), 0), reverse=True)
        elif sort_by == "character_asc":
            filtered.sort(key=lambda x: (x["sourceName"].lower(), x.get("displayName", "").lower()))
        else: # name_asc
            filtered.sort(key=lambda x: x.get("displayName", "").lower())

        return filtered

    def _load_mercenary_lookups(self):
        self._hire_lookup = {}
        self._merc_strings = {}

        candidate_strings = [
            r"E:\Games\Mods\BKDiablo\Repo\bkdiablo.mpq\data\local\lng\strings\mercenaries.json",
            r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\local\lng\strings\mercenaries.json",
            r"E:\Games\Diablo II Resurrected\Data\local\lng\strings\mercenaries.json",
        ]
        for sp in candidate_strings:
            if os.path.isfile(sp):
                try:
                    with open(sp, "r", encoding="utf-8-sig") as f:
                        for it in json.load(f):
                            k = it.get("Key")
                            v = it.get("enUS")
                            if k and v:
                                self._merc_strings[k] = v
                    break
                except Exception:
                    pass

        candidate_hireling = [
            r"E:\Games\Mods\BKDiablo\Repo\bkdiablo.mpq\data\global\excel\hireling.txt",
            r"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel\hireling.txt",
            r"E:\Games\Diablo II Resurrected\Data\global\excel\hireling.txt",
        ]
        for hp in candidate_hireling:
            if os.path.isfile(hp):
                try:
                    with open(hp, "r", encoding="utf-8", errors="ignore") as f:
                        lines = [l.strip().split("\t") for l in f if l.strip()]
                    if lines:
                        headers = lines[0]
                        for row in lines[1:]:
                            d = dict(zip(headers, row))
                            if d.get("Version") == "100" and "Id" in d:
                                try:
                                    self._hire_lookup[int(d["Id"])] = d
                                except ValueError:
                                    pass
                    break
                except Exception:
                    pass

    def get_mercenary_meta(self, target_char):
        """Extract authentic mercenary metadata (name, type, level, dead/alive) from .d2s file."""
        if not target_char:
            return None
        save_path = target_char.get("path")
        if not save_path or not os.path.isfile(save_path):
            return None
        d2s_path = os.path.splitext(save_path)[0] + ".d2s"
        if not os.path.isfile(d2s_path):
            return None

        try:
            with open(d2s_path, "rb") as f:
                data = f.read(256)
            if len(data) < 175:
                return None
            flags, seed, name_id, hire_id, exp = struct.unpack("<IIHHI", data[159:175])
            if hire_id == 0 and name_id == 0 and exp == 0:
                return None

            if not self._hire_lookup:
                self._load_mercenary_lookups()

            hd = self._hire_lookup.get(hire_id, {})
            name_first = hd.get("NameFirst", "")
            if name_first.startswith("merca2"):
                base_idx = int(name_first[6:]) if len(name_first) > 6 else 1
                name_key = f"merca2{base_idx + name_id:02d}"
            elif name_first.startswith("MercX"):
                base_idx = int(name_first[5:]) if len(name_first) > 5 else 101
                name_key = f"MercX{base_idx + name_id}"
            elif name_first.startswith("merc0"):
                base_idx = int(name_first[5:]) if len(name_first) > 5 else 1
                name_key = f"merc{base_idx + name_id:02d}"
            elif name_first.startswith("merc3"):
                base_idx = int(name_first[5:]) if len(name_first) > 5 else 1
                name_key = f"merc3{base_idx + name_id:02d}"
            else:
                name_key = name_first

            name = self._merc_strings.get(name_key, "Mercenary")
            hire_type = hd.get("Hireling", "Mercenary")
            sub_type = hd.get("*SubType", "")
            char_level = target_char.get("level", 90)

            return {
                "name": name,
                "type": hire_type,
                "subType": sub_type,
                "level": char_level,
                "isDead": bool(flags & 0x10000),
                "experience": exp,
                "seed": seed,
                "hirelingId": hire_id,
                "nameId": name_id
            }
        except Exception:
            return None

    def get_character_detail(self, char_name):
        """Find character and group their items into paperdoll slots & inventory."""
        target_char = None
        for s in self.saves:
            if not s.get("is_stash") and s["name"].lower() == char_name.lower():
                target_char = s
                break

        if not target_char:
            return None

        char_items = [it for it in self.items if it["sourceName"].lower() == char_name.lower() and it.get("sourceFile") == target_char.get("file")]

        # Categorize by location
        equipped_slots = {
            "Head": None,
            "Neck": None,
            "Torso": None,
            "RightHand": None,   # Main hand
            "LeftHand": None,    # Off hand / Shield
            "Gloves": None,
            "RightRing": None,
            "LeftRing": None,
            "Belt": None,
            "Boots": None,
            "AlternateRightHand": None,
            "AlternateLeftHand": None,
        }

        inventory = []
        stash = []
        cube = []
        belt_slots = []
        mercenary = []
        other = []

        for it in char_items:
            loc = it.get("location", "")
            is_merc = it.get("isMercenary") or "Merc" in loc or "Hireling" in loc
            if is_merc:
                mercenary.append(it)
                continue

            # Belt potions (Mode=InBelt) go to potion belt, never equipped slot
            if it.get("mode") == "InBelt" or loc == "InBelt":
                belt_slots.append(it)
                continue

            # Normalize slot names if coming from raw D2S location values
            mapped_loc = loc
            if loc == "RightArm":
                mapped_loc = "RightHand"
            elif loc == "LeftArm":
                mapped_loc = "LeftHand"
            elif loc == "Feet":
                mapped_loc = "Boots"

            if mapped_loc in equipped_slots:
                # Active equipment takes precedence over corpse equipment
                if equipped_slots[mapped_loc] is None or not it.get("isCorpse"):
                    equipped_slots[mapped_loc] = it
            elif loc == "Inventory":
                inventory.append(it)
            elif loc == "Stash":
                stash.append(it)
            elif loc == "Cube":
                cube.append(it)
            elif loc == "Belt":
                belt_slots.append(it)
            else:
                other.append(it)

        # Update target_char corpse flag if corpse items were found
        has_corpse = target_char.get("hasCorpse", False) or any(it.get("isCorpse") for it in char_items)
        target_char["hasCorpse"] = has_corpse

        merc_info = self.get_mercenary_meta(target_char)

        return {
            "character": target_char,
            "equipped": equipped_slots,
            "inventory": inventory,
            "stash": stash,
            "cube": cube,
            "belt": belt_slots,
            "mercenary": mercenary,
            "mercenary_info": merc_info,
            "other": other,
            "hasCorpse": has_corpse,
            "total_items": len(char_items)
        }

    def get_shared_stash_detail(self, character=None):
        """Group all items in shared stash into tabs."""
        stash_saves = [s for s in self.saves if s.get("is_stash")]
        if not stash_saves:
            return None
        if character:
            selected = next((save for save in self.saves if not save.get("is_stash") and save.get("name") == character), None)
            if not selected:
                return None
            stash_saves = [save for save in stash_saves if save.get("core") == selected.get("core") and save.get("gameVersion") == selected.get("gameVersion")]
        if len(stash_saves) != 1:
            return None
        save_entry = stash_saves[0]
        stash_items = [it for it in self.items if it.get("isStash") and it.get("sourceFile") == save_entry.get("file")]
        tabs_meta = save_entry.get("tabs", [])

        # Group items by tabIndex
        tabs = []
        for i, meta in enumerate(tabs_meta):
            tab_items = [it for it in stash_items if it.get("tabIndex") == i]
            raw_name = meta.get("name", "")
            if not raw_name or raw_name.startswith("Shared Stash Tab"):
                tab_name = "Stackable" if (i == 5 or (len(tabs_meta) == 6 and i == 5)) else f"Shared {i + 1}"
            else:
                tab_name = raw_name

            tabs.append({
                "index": i,
                "name": tab_name,
                "gold": meta.get("gold", 0),
                "itemCount": len(tab_items),
                "items": tab_items
            })

        # Extra tabs if any items are indexed beyond metadata
        found_indices = set(range(len(tabs_meta)))
        extra_indices = sorted(set(it.get("tabIndex", 0) for it in stash_items if it.get("tabIndex", 0) not in found_indices))
        for i in extra_indices:
            tab_items = [it for it in stash_items if it.get("tabIndex") == i]
            tabs.append({
                "index": i,
                "name": f"Shared {i + 1}",
                "gold": 0,
                "itemCount": len(tab_items),
                "items": tab_items
            })

        return {
            "save": save_entry,
            "tabs": tabs,
            "total_gold": save_entry.get("total_gold", 0),
            "total_items": len(stash_items)
        }

    def get_grail_report(self):
        """Generate Holy Grail checklist and statistics."""
        active_p = self.get_active_profile()
        excel_dir = active_p.get("excel_dir")
        if not excel_dir or not os.path.isdir(excel_dir):
            return {"error": f"Game excel directory not found: {excel_dir}"}

        # Import find_items helper
        try:
            sys.path.insert(0, SCRIPT_DIR)
            import find_items
            exclude_names = set(n.strip() for n in load_conf().get("exclude_items", "").split(",") if n.strip())
            grail = find_items.load_grail_items(excel_dir, exclude=exclude_names)

            # Map owned items
            owned = {}
            for it in self.items:
                raw_name = it.get("name") or it.get("baseName") or ""
                m = re.match(r"^(.*?)\s*\(.*\)\s*$", raw_name)
                key = m.group(1).strip() if m else raw_name.strip()
                if key:
                    owned.setdefault(key, []).append({
                        "item_name": raw_name,
                        "source": it["sourceName"],
                        "file": it["sourceFile"],
                        "location": it.get("location", ""),
                        "perfection": it.get("perfection"),
                        "perfectionNum": it.get("perfectionNum"),
                        "ilvl": it.get("itemLevel")
                    })

            sets_by_set = grail.pop("_setsByName", {})
            set_order = grail.pop("_setOrder", [])
            set_item_bases = grail.pop("_setItemBases", {})
            unique_item_bases = grail.pop("_uniqueItemBases", {})
            runeword_runes = grail.pop("_runewordRunes", {})

            categories = []
            total_items = 0
            total_owned = 0

            for cat_name, item_names in grail.items():
                cat_owned_count = 0
                cat_items = []

                if cat_name == "Set Items" and sets_by_set:
                    for s_name in sorted(set_order):
                        set_sub_items = []
                        set_sub_owned = 0
                        for iname in sorted(sets_by_set.get(s_name, [])):
                            holders = owned.get(iname, [])
                            is_have = len(holders) > 0
                            if is_have:
                                set_sub_owned += 1
                                cat_owned_count += 1
                            set_sub_items.append({
                                "name": iname,
                                "base": set_item_bases.get(iname, ""),
                                "collected": is_have,
                                "holders": holders
                            })
                        cat_items.append({
                            "is_group": True,
                            "group_name": s_name,
                            "owned_count": set_sub_owned,
                            "total_count": len(sets_by_set.get(s_name, [])),
                            "items": set_sub_items
                        })
                else:
                    bases = unique_item_bases if cat_name == "Unique Items" else {}
                    runes_map = runeword_runes if cat_name == "Runewords" else {}
                    for iname in sorted(item_names):
                        holders = owned.get(iname, [])
                        is_have = len(holders) > 0
                        if is_have:
                            cat_owned_count += 1
                        cat_items.append({
                            "name": iname,
                            "base": bases.get(iname, ""),
                            "runes": runes_map.get(iname, []),
                            "collected": is_have,
                            "holders": holders
                        })

                total_items += len(item_names)
                total_owned += cat_owned_count
                pct = (cat_owned_count / len(item_names) * 100) if item_names else 0

                categories.append({
                    "category": cat_name,
                    "owned": cat_owned_count,
                    "total": len(item_names),
                    "percent": round(pct, 1),
                    "items": cat_items
                })

            overall_pct = (total_owned / total_items * 100) if total_items else 0
            return {
                "total_owned": total_owned,
                "total_items": total_items,
                "percent": round(overall_pct, 2),
                "categories": categories
            }

        except Exception as ex:
            return {"error": f"Failed to compute grail report: {str(ex)}"}

    def get_verifier_report(self):
        """Returns statistics and list of all out-of-date items."""
        with self.lock:
            eligible_items = [it for it in self.items if it.get("quality") in ("Unique", "Set") or it.get("isRuneword")]
            out_of_date_items = [it for it in eligible_items if it.get("isOutOfDate")]
            up_to_date_items = [it for it in eligible_items if it.get("verificationStatus") == "verified"]

            by_char = {}
            for it in out_of_date_items:
                cname = it["sourceName"]
                by_char[cname] = by_char.get(cname, 0) + 1

            below_min_count = 0
            above_max_count = 0
            missing_count = 0

            for it in out_of_date_items:
                issues = it.get("outOfDateIssues", [])
                for iss in issues:
                    if "BELOW" in iss:
                        below_min_count += 1
                    elif "ABOVE" in iss:
                        above_max_count += 1
                    elif "Missing" in iss:
                        missing_count += 1

            return {
                "total_checked": len(eligible_items),
                "total_out_of_date": len(out_of_date_items),
                "total_up_to_date": len(up_to_date_items),
                "percent_out_of_date": round((len(out_of_date_items) / len(eligible_items) * 100) if eligible_items else 0, 1),
                "by_character": by_char,
                "counts_by_issue": {
                    "below_min": below_min_count,
                    "above_max": above_max_count,
                    "missing_stats": missing_count
                },
                "items": out_of_date_items
            }

    def get_item_comparison(self, item_id):
        """Returns detailed comparison for an item against its current game definition."""
        with self.lock:
            it = None
            for item in self.items:
                if item.get("id") == item_id:
                    it = item
                    break
            if not it:
                return None

            all_stats = (it.get("runewordStats") or []) + (it.get("stats") or [])
            stats_comparison = []

            for s in all_stats:
                stat_id = s.get("id", "")
                desc = s.get("description", stat_id)
                val = s.get("value")
                exp_min = s.get("expectedMin")
                exp_max = s.get("expectedMax")
                rng = s.get("range")
                oor = s.get("outOfRange")

                status = "ok" if exp_min is not None and exp_max is not None else "unknown"
                if oor == "below_min":
                    status = "below_min"
                elif oor == "above_max":
                    status = "above_max"
                elif exp_min is not None and exp_max is not None and (val < exp_min or val > exp_max):
                    status = "below_min" if val < exp_min else "above_max"

                stats_comparison.append({
                    "id": stat_id,
                    "description": desc,
                    "actualValue": val,
                    "expectedMin": exp_min,
                    "expectedMax": exp_max,
                    "range": rng,
                    "status": status
                })

            # Also include missing stats detected in outOfDateIssues
            for iss in it.get("outOfDateIssues", []):
                if iss.startswith("Missing stat:"):
                    m = re.match(r"^Missing stat:\s*(.*?)\s*\[(-?\d+)-(-?\d+)\]", iss)
                    if m:
                        s_name = m.group(1).strip()
                        s_min = int(m.group(2))
                        s_max = int(m.group(3))
                        stats_comparison.append({
                            "id": s_name,
                            "description": s_name,
                            "actualValue": None,
                            "expectedMin": s_min,
                            "expectedMax": s_max,
                            "range": f"{s_min}-{s_max}" if s_min != s_max else str(s_min),
                            "status": "missing"
                        })

            return {
                "item": it,
                "stats_comparison": stats_comparison,
                "is_out_of_date": it.get("isOutOfDate", False),
                "issues": it.get("outOfDateIssues", []),
                "catalogRevision": it.get("catalogRevision"),
                "catalogStale": it.get("catalogStale", True)
            }

# Global manager instance
DATA_MANAGER = SaveDataManager()

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = dict(urllib.parse.parse_qsl(parsed.query))

        # API Routes
        if path == "/api/profiles":
            self.send_json({
                "profiles": DATA_MANAGER.profiles,
                "active_id": DATA_MANAGER.active_profile_id
            })
            return

        if path == "/api/saves":
            self.send_json({
                "profile": DATA_MANAGER.get_active_profile(),
                "saves": DATA_MANAGER.saves,
                "total_items": len(DATA_MANAGER.items)
            })
            return

        if path == "/api/items":
            items = DATA_MANAGER.search_items(params)
            self.send_json({
                "total": len(items),
                "items": items # Return every match; counts must reflect reachable results.
            })
            return

        if path == "/api/verifier":
            report = DATA_MANAGER.get_verifier_report()
            self.send_json(report)
            return

        if path.startswith("/api/item-compare/"):
            try:
                item_id = int(path[len("/api/item-compare/"):])
                comp = DATA_MANAGER.get_item_comparison(item_id)
                if comp:
                    self.send_json(comp)
                else:
                    self.send_error(404, "Item not found")
            except ValueError:
                self.send_error(400, "Invalid item ID")
            return

        if path.startswith("/api/item/"):
            try:
                item_id = int(path[len("/api/item/"):])
                item = next((it for it in DATA_MANAGER.items if it.get("id") == item_id), None)
                if item:
                    self.send_json(item)
                else:
                    self.send_error(404, "Item not found")
            except ValueError:
                self.send_error(400, "Invalid item ID")
            return

        if path.startswith("/api/character/"):
            char_name = urllib.parse.unquote(path[len("/api/character/"):])
            detail = DATA_MANAGER.get_character_detail(char_name)
            if detail:
                self.send_json(detail)
            else:
                self.send_error(404, "Character not found")
            return

        if path == "/api/shared-stash":
            stash_detail = DATA_MANAGER.get_shared_stash_detail(params.get("character"))
            if stash_detail:
                self.send_json(stash_detail)
            else:
                self.send_error(404, "Shared stash not found")
            return

        if path == "/api/grail":
            report = DATA_MANAGER.get_grail_report()
            self.send_json(report)
            return

        if path == "/api/container-dimensions":
            active_p = DATA_MANAGER.get_active_profile()
            excel_dir = active_p.get("excel_dir") or DEFAULT_D2R_EXCEL_DIR
            dims = {
                "inventory": {"width": 11, "height": 8},
                "stash": {"width": 16, "height": 13},
                "cube": {"width": 6, "height": 6},
                "sharedStash": {"width": 16, "height": 13}
            }
            inv_txt = os.path.join(excel_dir, "inventory.txt")
            if os.path.isfile(inv_txt):
                try:
                    with open(inv_txt, "r", encoding="latin1") as f:
                        header = f.readline().strip().split("\t")
                        if "class" in header and "gridX" in header and "gridY" in header:
                            c_i = header.index("class")
                            gx_i = header.index("gridX")
                            gy_i = header.index("gridY")
                            for line in f:
                                parts = line.strip().split("\t")
                                if len(parts) > max(c_i, gx_i, gy_i):
                                    c = parts[c_i].strip()
                                    gx = int(parts[gx_i].strip()) if parts[gx_i].strip().isdigit() else 0
                                    gy = int(parts[gy_i].strip()) if parts[gy_i].strip().isdigit() else 0
                                    if gx > 0 and gy > 0:
                                        if c in ("Big Bank Page 1", "Big Bank Page2", "Bank Page 1", "Bank Page2"):
                                            dims["stash"] = {"width": gx, "height": gy}
                                            dims["sharedStash"] = {"width": gx, "height": gy}
                                        elif c in ("Transmogrify Box Page 1", "Transmogrify Box2"):
                                            dims["cube"] = {"width": gx, "height": gy}
                                        elif c in ("Amazon", "Barbarian", "Paladin", "Sorceress", "Necromancer", "Druid", "Assassin", "Warlock"):
                                            dims["inventory"] = {"width": gx, "height": gy}
                except Exception:
                    pass
            self.send_json(dims)
            return

        # Static assets
        return super().do_GET()

    def do_POST(self):
        origin = self.headers.get("Origin")
        allowed = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
        if origin and origin not in allowed:
            self.send_json({"success": False, "error": "Save changes must originate from this local editor."})
            return
        try:
            self.handle_post()
        except (ValueError, TypeError, KeyError, IndexError, OSError, subprocess.SubprocessError) as error:
            self.send_json({"success": False, "error": str(error)})

    def handle_post(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else b""
        data = json.loads(body.decode("utf-8")) if body else {}

        if path in ("/api/item/transfer", "/api/mule/fill", "/api/stash/stack-quantity", "/api/character/quests/complete") and DATA_MANAGER.get_active_profile().get("id") == "all":
            self.send_json({"success": False, "error": "Select one save profile before editing."})
            return



        if path == "/api/profiles/select":
            pid = data.get("profile_id")
            if pid:
                DATA_MANAGER.set_active_profile(pid)
                self.send_json({"success": True, "active_id": DATA_MANAGER.active_profile_id})
                return

        if path == "/api/profiles/add":
            name = data.get("name", "Custom Profile")
            s_dir = data.get("save_dir", "")
            e_dir = data.get("excel_dir", "")
            if os.path.isdir(s_dir):
                pid = DATA_MANAGER.add_custom_profile(name, s_dir, e_dir)
                self.send_json({"success": True, "profile_id": pid})
                return
            else:
                self.send_json({"success": False, "error": f"Directory does not exist: {s_dir}"})
                return

        if path == "/api/scan":
            result = DATA_MANAGER.run_scan()
            self.send_json(result)
            return

        if path == "/api/mules/create":
            name = data.get("name", "").strip()
            char_class = data.get("class", "").strip()
            hardcore = bool(data.get("hardcore", False))
            active_p = DATA_MANAGER.get_active_profile()
            save_dir = active_p.get("save_dir")
            excel_dir = active_p.get("excel_dir")

            if save_dir == "all":
                non_all = [p for p in DATA_MANAGER.profiles if p.get("save_dir") != "all"]
                if non_all:
                    save_dir = non_all[0].get("save_dir")
                    excel_dir = non_all[0].get("excel_dir") or excel_dir

            if not name or not char_class:
                self.send_json({"success": False, "error": "Both character name and class are required."})
                return

            runner_type, runner_path = find_d2s_runner()
            if not runner_path:
                self.send_json({"success": False, "error": "d2sitems runner not found."})
                return

            cmd = runner_command(runner_type, runner_path) + ["create-mule", "--name", name, "--class", char_class, "--save-dir", save_dir]
            if hardcore:
                cmd.append("--hardcore")
            if excel_dir and os.path.isdir(excel_dir):
                cmd.extend(["--excel", excel_dir])

            proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True)
            if proc.returncode == 0:
                DATA_MANAGER.run_scan()
                self.send_json({"success": True, "message": proc.stdout.strip()})
            else:
                self.send_json({"success": False, "error": proc.stdout.strip() or proc.stderr.strip()})
            return

        if path == "/api/character/quests/complete":
            char_name = data.get("character", "").strip()
            difficulty = data.get("difficulty", "all").strip().lower()
            act = data.get("act")
            unlock_waypoints = bool(data.get("unlock_waypoints", True))
            grant_rewards = bool(data.get("grant_rewards", True))
            force_live = bool(data.get("force_live", False))

            if not char_name:
                self.send_json({"success": False, "error": "Character name is required."})
                return

            active_p = DATA_MANAGER.get_active_profile()
            save_dir = active_p.get("save_dir")
            excel_dir = active_p.get("excel_dir")

            if save_dir == "all":
                found_save_dir = None
                for prof in DATA_MANAGER.profiles:
                    if prof.get("save_dir") and prof["save_dir"] != "all":
                        candidate = os.path.join(prof["save_dir"], char_name + ".d2s" if not char_name.endswith(".d2s") else char_name)
                        if os.path.isfile(candidate):
                            found_save_dir = prof["save_dir"]
                            excel_dir = prof.get("excel_dir") or excel_dir
                            break
                if found_save_dir:
                    save_dir = found_save_dir
                else:
                    non_all = [p for p in DATA_MANAGER.profiles if p.get("save_dir") != "all"]
                    if non_all:
                        save_dir = non_all[0].get("save_dir")
                        excel_dir = non_all[0].get("excel_dir") or excel_dir

            runner_type, runner_path = find_d2s_runner()
            if not runner_path:
                self.send_json({"success": False, "error": "d2sitems runner not found."})
                return

            if not data.get("revision"):
                self.send_json({"success": False, "error": "Rescan the character before editing quests."})
                return
            cmd = runner_command(runner_type, runner_path) + ["complete-quests", "--char", char_name, "--diff", difficulty, "--save-dir", save_dir, "--revision", data["revision"]]
            if act is not None:
                if str(act) not in ("1", "2", "3", "4", "5"):
                    self.send_json({"success": False, "error": "Act must be from 1 to 5, or omitted for all acts."})
                    return
                cmd.extend(["--act", str(act)])
            if unlock_waypoints:
                cmd.append("--waypoints")
            else:
                cmd.append("--no-waypoints")
            if grant_rewards:
                cmd.append("--rewards")
            else:
                cmd.append("--no-rewards")
            if force_live:
                cmd.append("--force-live")
            if excel_dir and os.path.isdir(excel_dir):
                cmd.extend(["--excel", excel_dir])

            proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True)
            out = proc.stdout.strip() or proc.stderr.strip()
            if proc.returncode == 0:
                DATA_MANAGER.run_scan()
                self.send_json({"success": True, "message": out})
            elif proc.returncode == 2:
                # Safety guard refusal
                self.send_json({"success": False, "error": out, "is_protected": True})
            else:
                self.send_json({"success": False, "error": out})
            return

        if path == "/api/item/transfer":
            active_p = DATA_MANAGER.get_active_profile()
            save_dir = active_p.get("save_dir")
            excel_dir = active_p.get("excel_dir") or DEFAULT_D2R_EXCEL_DIR

            item_id = data.get("item_id")
            if item_id is not None:
                it = next((x for x in DATA_MANAGER.items if x.get("id") == item_id), None)
                if it:
                    if not data.get("source_file"):
                        data["source_file"] = it.get("sourceFile", "")
                    if not data.get("source_container"):
                        loc = it.get("location", "SharedStash")
                        data["source_container"] = "sharedstash" if it.get("isStash") else loc
                    if "source_tab" not in data:
                        data["source_tab"] = it.get("tabIndex", 0)
                    if "source_x" not in data:
                        data["source_x"] = it.get("invX", 0)
                    if "source_y" not in data:
                        data["source_y"] = it.get("invY", 0)
                    if not data.get("seed"):
                        data["seed"] = it.get("itemSeed")
                    if not data.get("code"):
                        data["code"] = it.get("itemCode")

            source_file = data.get("source_file", "").strip()
            source_container = data.get("source_container", "sharedstash").strip()
            source_tab = int(data.get("source_tab", 0))
            source_x = data.get("source_x")
            source_y = data.get("source_y")
            item_seed = data.get("seed")
            item_code = data.get("code")

            target_file = data.get("target_file", "").strip()
            target_char = data.get("target_character", "").strip()
            if not target_file and target_char:
                target_file = f"{target_char}.d2s"

            target_container = data.get("target_container", "inventory").strip()
            target_tab = int(data.get("target_tab", 0))
            target_x = data.get("target_x")
            target_y = data.get("target_y")
            force_live = bool(data.get("force_live", False))

            if save_dir == "all":
                for f_name in (source_file, target_file):
                    if f_name and not os.path.isabs(f_name):
                        for prof in DATA_MANAGER.profiles:
                            if prof.get("save_dir") and prof["save_dir"] != "all":
                                cand = os.path.join(prof["save_dir"], f_name)
                                if os.path.isfile(cand):
                                    save_dir = prof["save_dir"]
                                    excel_dir = prof.get("excel_dir") or excel_dir
                                    break

            if not os.path.isabs(source_file) and save_dir and save_dir != "all":
                source_file = os.path.join(save_dir, source_file)
            if not os.path.isabs(target_file) and save_dir and save_dir != "all":
                target_file = os.path.join(save_dir, target_file)

            runner_type, runner_path = find_d2s_runner()
            if not runner_path:
                self.send_json({"success": False, "error": "d2sitems runner not found."})
                return

            cmd = [
                *runner_command(runner_type, runner_path), "transfer-item",
                "--from-file", source_file,
                "--from-container", source_container,
                "--from-tab", str(source_tab),
                "--to-file", target_file,
                "--to-container", target_container,
                "--to-tab", str(target_tab),
                "--excel", excel_dir
            ]
            if not data.get("source_revision") or not data.get("target_revision"):
                self.send_json({"success": False, "error": "Rescan saves before transferring; save revisions are required."})
                return
            cmd.extend(["--source-revision", data["source_revision"], "--target-revision", data["target_revision"]])
            if source_x is not None and source_y is not None:
                cmd.extend(["--from-x", str(source_x), "--from-y", str(source_y)])
            if item_seed is not None:
                cmd.extend(["--seed", str(item_seed)])
            if item_code:
                cmd.extend(["--code", str(item_code)])
            if target_x is not None and target_y is not None:
                cmd.extend(["--to-x", str(target_x), "--to-y", str(target_y)])
            if force_live:
                cmd.append("--force-live")

            proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True)
            try:
                res = json.loads(proc.stdout)
                if proc.returncode != 0:
                    res["Success"] = False
                if res.get("Success"):
                    DATA_MANAGER.run_scan()
                self.send_json(res)
            except (ValueError, TypeError):
                self.send_json({"success": False, "error": "Invalid editor response: " + (proc.stderr.strip() or proc.stdout.strip())})
            return

        if path == "/api/mule/fill":
            active_p = DATA_MANAGER.get_active_profile()
            save_dir = active_p.get("save_dir")
            excel_dir = active_p.get("excel_dir") or DEFAULT_D2R_EXCEL_DIR

            stash_file = data.get("stash_file", "").strip()
            tab = int(data.get("tab", 0))
            char_file = data.get("char_file", "").strip()
            filter_type = data.get("filter", "all").strip()
            max_items = int(data.get("max_items", 50))
            force_live = bool(data.get("force_live", False))

            if save_dir == "all":
                for f_name in (stash_file, char_file):
                    if f_name and not os.path.isabs(f_name):
                        for prof in DATA_MANAGER.profiles:
                            if prof.get("save_dir") and prof["save_dir"] != "all":
                                cand = os.path.join(prof["save_dir"], f_name)
                                if os.path.isfile(cand):
                                    save_dir = prof["save_dir"]
                                    excel_dir = prof.get("excel_dir") or excel_dir
                                    break

            if not os.path.isabs(stash_file) and save_dir and save_dir != "all":
                stash_file = os.path.join(save_dir, stash_file)
            if not os.path.isabs(char_file) and save_dir and save_dir != "all":
                char_file = os.path.join(save_dir, char_file)

            runner_type, runner_path = find_d2s_runner()
            if not runner_path:
                self.send_json({"success": False, "error": "d2sitems runner not found."})
                return

            if not data.get("source_revision") or not data.get("target_revision"):
                self.send_json({"success": False, "error": "Rescan both saves before packing a mule."})
                return
            cmd = [
                *runner_command(runner_type, runner_path), "fill-mule",
                "--source-revision", data["source_revision"], "--target-revision", data["target_revision"],
                "--stash", stash_file,
                "--tab", str(tab),
                "--char", char_file,
                "--filter", filter_type,
                "--max", str(max_items),
                "--excel", excel_dir
            ]
            if force_live:
                cmd.append("--force-live")

            proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True)
            try:
                res = json.loads(proc.stdout)
                if proc.returncode != 0:
                    res["Success"] = False
                if res.get("Success"):
                    DATA_MANAGER.run_scan()
                self.send_json(res)
            except (ValueError, TypeError):
                self.send_json({"success": False, "error": "Invalid editor response: " + (proc.stderr.strip() or proc.stdout.strip())})
            return

        if path == "/api/stash/stack-quantity":
            active_p = DATA_MANAGER.get_active_profile()
            save_dir = active_p.get("save_dir")
            excel_dir = active_p.get("excel_dir") or DEFAULT_D2R_EXCEL_DIR

            stash_file = data.get("file", "").strip()
            tab_idx = int(data.get("tab", 5))
            item_code = data.get("code", "").strip()
            item_seed = data.get("seed")
            quantity = int(data.get("quantity", 0))

            if not item_code:
                self.send_json({"success": False, "error": "Item code is required."})
                return

            if not stash_file or item_seed is None or "tab" not in data:
                self.send_json({"success": False, "error": "Exact stash file, tab, and item seed are required."})
                return

            if save_dir == "all":
                for prof in DATA_MANAGER.profiles:
                    if prof.get("save_dir") and prof["save_dir"] != "all":
                        cand = os.path.join(prof["save_dir"], stash_file)
                        if os.path.isfile(cand):
                            save_dir = prof["save_dir"]
                            excel_dir = prof.get("excel_dir") or excel_dir
                            break

            if not os.path.isabs(stash_file) and save_dir and save_dir != "all":
                stash_file = os.path.join(save_dir, stash_file)

            runner_type, runner_path = find_d2s_runner()
            if not runner_path:
                self.send_json({"success": False, "error": "d2sitems runner not found."})
                return

            cmd = [
                *runner_command(runner_type, runner_path), "edit-stack",
                "--file", stash_file,
                "--tab", str(tab_idx),
                "--code", item_code,
                "--qty", str(quantity),
                "--excel", excel_dir
            ]
            if not data.get("revision"):
                self.send_json({"success": False, "error": "Rescan before editing a stack; its save revision is required."})
                return
            cmd.extend(["--revision", data["revision"]])
            if item_seed is not None:
                cmd.extend(["--seed", str(item_seed)])

            proc = subprocess.run(cmd, cwd=SCRIPT_DIR, capture_output=True, text=True)
            try:
                res = json.loads(proc.stdout)
                if proc.returncode != 0:
                    res["Success"] = False
                if res.get("Success"):
                    DATA_MANAGER.run_scan()
                self.send_json(res)
            except (ValueError, TypeError):
                self.send_json({"success": False, "error": "Invalid editor response: " + (proc.stderr.strip() or proc.stdout.strip())})
            return

        self.send_error(404)


    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

def run_server(port=5000, open_browser=True):
    class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    server_address = ("127.0.0.1", port)
    httpd = ThreadingServer(server_address, RequestHandler)
    url = f"http://localhost:{port}"
    print(f"\n=======================================================")
    print(f"  Diablo II Save & Item Explorer UI is running at:")
    print(f"  -> {url}")
    print(f"=======================================================\n")

    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="D2SItems Web UI Server")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on (default: 5000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open browser")
    args = parser.parse_args()

    run_server(port=args.port, open_browser=not args.no_browser)
