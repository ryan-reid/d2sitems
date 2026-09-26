#!/usr/bin/env python3
"""
D2SItems Web UI Server
Provides a local web interface to explore, search, and inspect Diablo II save files,
characters, shared stashes, and Holy Grail progression.
"""

import argparse
import glob
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(SCRIPT_DIR, "web")
CONF_FILE = os.path.join(SCRIPT_DIR, "d2sitems.conf")

# Default paths
DEFAULT_USER_HOME = os.path.expanduser("~")
DEFAULT_D2R_SAVE_DIR = os.path.join(DEFAULT_USER_HOME, "Saved Games", "Diablo II Resurrected")
DEFAULT_D2R_EXCEL_DIR = r"E:\Games\Diablo II Resurrected\Data\global\excel"
FALLBACK_EXCEL_DIR = r"C:\Program Files (x86)\Diablo II Resurrected\data\global\excel"

# Find d2sitems executable or dotnet project
D2S_EXE_CANDIDATES = [
    os.path.join(SCRIPT_DIR, "bin", "Release", "net10.0", "win-x64", "publish", "d2sitems.exe"),
    os.path.join(SCRIPT_DIR, "bin", "Debug", "net10.0", "d2sitems.exe"),
    os.path.join(SCRIPT_DIR, "d2sitems.exe"),
]

def find_d2s_runner():
    """Returns (runner_type, path/command)."""
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

def detect_profiles():
    """Detect available save profiles (Vanilla/RotW, mods, etc.)."""
    profiles = []
    conf = load_conf()
    conf_save = conf.get("save_dir", DEFAULT_D2R_SAVE_DIR)
    conf_excel = conf.get("excel_dir", DEFAULT_D2R_EXCEL_DIR if os.path.isdir(DEFAULT_D2R_EXCEL_DIR) else FALLBACK_EXCEL_DIR)

    # 1. Base D2R Save Directory
    if os.path.isdir(conf_save):
        profiles.append({
            "id": "default",
            "name": "Standard / Reign of the Warlock",
            "save_dir": conf_save,
            "excel_dir": conf_excel if os.path.isdir(conf_excel) else DEFAULT_D2R_EXCEL_DIR,
            "is_default": True
        })

    # 2. Check Mods directory under D2R Saved Games
    mods_save_dir = os.path.join(DEFAULT_D2R_SAVE_DIR, "Mods")
    if os.path.isdir(mods_save_dir):
        for entry in os.listdir(mods_save_dir):
            subpath = os.path.join(mods_save_dir, entry)
            if os.path.isdir(subpath) and not entry.startswith("."):
                # See if there are save files
                d2s_count = len(glob.glob(os.path.join(subpath, "*.d2s"))) + len(glob.glob(os.path.join(subpath, "*.d2i")))
                if d2s_count > 0:
                    # Try to find corresponding excel directory in game install mods
                    mod_excel = None
                    candidate_roots = [
                        r"E:\Games\Diablo II Resurrected\Mods",
                        r"C:\Program Files (x86)\Diablo II Resurrected\Mods"
                    ]
                    entry_clean = re.sub(r'(Three|Ladder|Slam|[-_].*)$', '', entry, flags=re.I).strip()
                    search_patterns = [entry]
                    if entry_clean and entry_clean.lower() != entry.lower():
                        search_patterns.append(entry_clean)

                    for cr in candidate_roots:
                        if os.path.isdir(cr):
                            for sp in search_patterns:
                                # Check for MPQ data global excel
                                for mpq_match in glob.glob(os.path.join(cr, f"*{sp}*", "*.mpq", "data", "global", "excel")):
                                    if os.path.isdir(mpq_match) and "backup" not in mpq_match.lower():
                                        mod_excel = mpq_match
                                        break
                                if mod_excel: break
                                for direct_match in glob.glob(os.path.join(cr, f"*{sp}*", "data", "global", "excel")):
                                    if os.path.isdir(direct_match) and "backup" not in direct_match.lower():
                                        mod_excel = direct_match
                                        break
                                if mod_excel: break
                            if mod_excel: break
                    if not mod_excel:
                        mod_excel = conf_excel

                    profiles.append({
                        "id": f"mod-{entry.lower()}",
                        "name": f"Mod: {entry}",
                        "save_dir": subpath,
                        "excel_dir": mod_excel,
                        "is_default": False
                    })

    # Add an "All Saves Combined" profile if multiple exist
    if len(profiles) > 1:
        profiles.insert(0, {
            "id": "all",
            "name": "All Detected Profiles (Combined)",
            "save_dir": "all",
            "excel_dir": conf_excel,
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

            loaded_saves = []
            loaded_items = []
            item_id_counter = 1

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
                        it_norm["isStash"] = is_stash

                        # Helper flags
                        flags = it_norm.get("flags") or []
                        it_norm["isEthereal"] = any("ethereal" in str(f).lower() for f in flags)
                        it_norm["isRuneword"] = any("runeword" in str(f).lower() for f in flags)
                        it_norm["isCorrupted"] = bool(it_norm.get("isCorrupted")) or any("corrupt" in str(f).lower() for f in flags) or any(s.get("id") == "corrupted" for s in it_norm.get("stats", []))

                        # Extract clean display name
                        raw_name = it_norm.get("name") or it_norm.get("baseName") or "Unknown Item"
                        it_norm["displayName"] = raw_name

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
                        it_norm["isOutOfDate"] = bool(it.get("isOutOfDate", False))
                        it_norm["outOfDateIssues"] = it.get("outOfDateIssues") or []

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
                logs.append(f"Scanning {save_dir} with excel {excel_dir}...\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
            except Exception as e:
                logs.append(f"Error running scan on {save_dir}: {str(e)}")

        self.reload()
        return {"success": True, "log": "\n---\n".join(logs), "saves_count": len(self.saves), "items_count": len(self.items)}

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
            if out_of_date == "no" and it.get("isOutOfDate"):
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

    def get_character_detail(self, char_name):
        """Find character and group their items into paperdoll slots & inventory."""
        target_char = None
        for s in self.saves:
            if not s.get("is_stash") and s["name"].lower() == char_name.lower():
                target_char = s
                break

        if not target_char:
            return None

        char_items = [it for it in self.items if it["sourceName"].lower() == char_name.lower()]

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
            if loc in equipped_slots:
                equipped_slots[loc] = it
            elif loc == "Inventory":
                inventory.append(it)
            elif loc == "Stash":
                stash.append(it)
            elif loc == "Cube":
                cube.append(it)
            elif loc == "Belt":
                belt_slots.append(it)
            elif "Merc" in loc or "Hireling" in loc:
                mercenary.append(it)
            else:
                other.append(it)

        return {
            "character": target_char,
            "equipped": equipped_slots,
            "inventory": inventory,
            "stash": stash,
            "cube": cube,
            "belt": belt_slots,
            "mercenary": mercenary,
            "other": other,
            "total_items": len(char_items)
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
            up_to_date_items = [it for it in eligible_items if not it.get("isOutOfDate")]

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

                status = "ok"
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
                "issues": it.get("outOfDateIssues", [])
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
                "items": items[:500] # Return up to 500 items per search query
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

        if path.startswith("/api/character/"):
            char_name = urllib.parse.unquote(path[len("/api/character/"):])
            detail = DATA_MANAGER.get_character_detail(char_name)
            if detail:
                self.send_json(detail)
            else:
                self.send_error(404, "Character not found")
            return

        if path == "/api/grail":
            report = DATA_MANAGER.get_grail_report()
            self.send_json(report)
            return

        # Static assets
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len) if content_len > 0 else b""
        data = json.loads(body.decode("utf-8")) if body else {}

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
