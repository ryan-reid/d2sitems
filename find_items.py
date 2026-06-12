#!/usr/bin/env python3
"""Search for items matching field/pattern combos across all d2sitems JSON files in a directory."""

import argparse
import json
import os
import re

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
        break  # use the first config file found
    return config

def numeric_match(value, expr):
    """Match a numeric value against an expression like '3', '>=4', '<=2', '>0', '<5', '1-3'."""
    expr = expr.strip()
    m = re.match(r'^(\d+)-(\d+)$', expr)
    if m:
        return int(m.group(1)) <= value <= int(m.group(2))
    m = re.match(r'^(>=|<=|>|<|=|==)?(\d+)$', expr)
    if m:
        op, num = m.group(1) or '==', int(m.group(2))
        if op in ('=', '=='): return value == num
        if op == '>=': return value >= num
        if op == '<=': return value <= num
        if op == '>': return value > num
        if op == '<': return value < num
    return False

RESIST_STAT_IDS = {
    "resistfire": "FireResist",
    "resistcold": "ColdResist",
    "resistlightning": "LightningResist",
    "resistpoison": "PoisonResist",
}

def get_stat_value(item, stat_id):
    """Sum all values for a given stat ID across stats, runewordStats, and set bonuses."""
    total = 0
    for stat_list in ("stats", "runewordStats"):
        for stat in item.get(stat_list, []):
            if stat.get("id") == stat_id:
                total += stat.get("value", 0)
    # Also check set bonus stats
    for i in range(1, 6):
        for stat in item.get(f"setBonus{i}", []):
            if stat.get("id") == stat_id:
                total += stat.get("value", 0)
    return total

def matches_field(item, field, pattern):
    """Check if an item matches the pattern in the specified field.
    pattern is a compiled regex for text fields, or a string for numeric fields."""
    if field == "socketCount":
        return numeric_match(item.get("socketCount", 0), pattern)
    if field == "openSockets":
        return numeric_match(item.get("openSockets", 0), pattern)
    if field == "itemLevel":
        return numeric_match(item.get("itemLevel", 0), pattern)
    if field in RESIST_STAT_IDS:
        return numeric_match(get_stat_value(item, RESIST_STAT_IDS[field]), pattern)
    if field == "resistall":
        return all(
            numeric_match(get_stat_value(item, sid), pattern)
            for sid in RESIST_STAT_IDS.values()
        )
    regex = pattern
    if field == "name":
        return regex.search(item.get("name", ""))
    elif field == "baseName":
        return regex.search(item.get("baseName", ""))
    elif field == "itemCode":
        return regex.search(item.get("itemCode", ""))
    elif field == "quality":
        return regex.search(item.get("quality", ""))
    elif field == "tier":
        return regex.search(item.get("tier") or "")
    elif field == "set":
        return regex.search(item.get("set") or "")
    elif field == "type":
        return regex.search(item.get("type") or "")
    elif field == "location":
        return regex.search(item.get("location", ""))
    elif field == "stat":
        for stat_list in ("stats", "runewordStats"):
            for stat in item.get(stat_list, []):
                if regex.search(stat.get("description", "")):
                    return True
        for bonus in item.get("socketBonuses", []):
            if regex.search(bonus):
                return True
        return False
    elif field == "flag":
        return any(regex.search(f) for f in item.get("flags", []))
    elif field == "sockets":
        return any(regex.search(s.get("name", "")) for s in item.get("sockets", []))
    else:
        # Search any string field or nested value
        val = item.get(field)
        if isinstance(val, str):
            return regex.search(val)
        elif isinstance(val, (int, float)):
            return regex.search(str(val))
        return False

def matches_all_filters(item, filters):
    """Check if an item matches ALL field/pattern filters.
    Each filter is (field, pattern, negate) where negate inverts the match.
    Unidentified items are always skipped."""
    if any("Unidentified" in f for f in item.get("flags", [])):
        return False
    for field, pattern, negate in filters:
        result = matches_field(item, field, pattern)
        if negate:
            result = not result
        if not result:
            return False
    return True

def print_item(source, filename, item, is_mule=False):
    print(f"[Character: {source}] (file: {filename})")
    if is_mule:
        print(f"  **** MULE ****")
        print(f"  ****** You must fetch this character before you can use it by running ******")
        print(f"  ******** .\\fetch.py {source} ********")
    print(f"  Name: {item.get('name', '?')}")
    print(f"  Location: {item.get('location', '?')}")
    if "itemLevel" in item:
        print(f"  Item Level: {item['itemLevel']}")
    if "quality" in item:
        print(f"  Quality: {item['quality']}")
    if item.get("type"):
        print(f"  Type: {item['type']}")
    if item.get("tier"):
        print(f"  Tier: {item['tier']}")
    if item.get("set"):
        print(f"  Set: {item['set']}")
    if "perfectionScore" in item:
        print(f"  Perfection: {item['perfectionScore']}%")
    if "flags" in item:
        print(f"  Flags: {', '.join(item['flags'])}")
    if "defense" in item:
        defRange = item.get("baseDefenseRange")
        if defRange:
            print(f"  Defense: {item['defense']} (base: {defRange})")
        else:
            print(f"  Defense: {item['defense']}")
    for stat in item.get("runewordStats", []):
        print(f"  {stat['description']}")
    for stat in item.get("stats", []):
        print(f"  {stat['description']}")
    for bonus in item.get("socketBonuses", []):
        print(f"  {bonus}")
    if item.get("sockets"):
        socket_names = [s.get("name", "?") for s in item["sockets"]]
        print(f"  Sockets [{item.get('socketCount', '?')}]: {', '.join(socket_names)}")
    print()

def search_items(directory, filters, core_filter, gameversion_filter, is_mule=False):
    """Search for matching items. Returns list of (source, save_file, item, is_mule) tuples."""
    results = []
    if not os.path.isdir(directory):
        return results
    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".json"):
            continue
        filepath = os.path.join(directory, filename)
        with open(filepath) as f:
            data = json.load(f)

        # Filter by core and gameversion settings (skip shared stash since it has neither)
        char = data.get("character", {})
        if core_filter != "both":
            char_core = char.get("core", "")
            if char_core and char_core != core_filter:
                continue
        if gameversion_filter != "all":
            char_gv = char.get("gameVersion", "")
            if char_gv and char_gv.lower() != gameversion_filter.lower():
                continue

        source = data.get("character", {}).get("name", filename)
        if "type" in data and data["type"] == "SharedStash":
            source = "Shared Stash"
        save_file = data.get("file", filename)

        for item in data.get("items", []):
            if matches_all_filters(item, filters):
                results.append((source, save_file, item, is_mule))
    return results

def load_string_table(excel_dir):
    """Load Key -> enUS mapping from the localization files."""
    table = {}
    strings_dir = os.path.normpath(os.path.join(excel_dir, "..", "..", "local", "lng", "strings"))
    for filename in ("item-names.json", "item-runes.json"):
        path = os.path.join(strings_dir, filename)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8-sig") as f:
                entries = json.load(f)
            for entry in entries:
                key = entry.get("Key")
                en = entry.get("enUS")
                if key and en and key not in table:
                    table[key] = en
        except (json.JSONDecodeError, OSError):
            continue
    return table

def load_grail_items(excel_dir, exclude=None):
    """Load all unique items, set items, and runewords from excel dir.
    Returns dict: category -> list of item names (localized)."""
    exclude = exclude or set()
    grail = {"Unique Items": [], "Set Items": [], "Runewords": []}
    strings = load_string_table(excel_dir)

    def localize(raw):
        return strings.get(raw, raw)

    def read_tsv(path):
        if not os.path.exists(path):
            return None
        with open(path) as f:
            lines = [line.rstrip("\n") for line in f]
        if len(lines) < 2:
            return None
        header = lines[0].split("\t")
        rows = [dict(zip(header, line.split("\t"))) for line in lines[1:]]
        return rows

    unique_item_bases = {}  # item_name -> base_name
    uniques = read_tsv(os.path.join(excel_dir, "uniqueitems.txt"))
    if uniques:
        seen = set()
        for row in uniques:
            name = localize(row.get("index", "").strip())
            base_code = row.get("code", "").strip()
            base_fallback = row.get("*ItemName", "").strip()
            base_name = strings.get(base_code, base_fallback)
            if name and name not in seen and name not in exclude:
                seen.add(name)
                grail["Unique Items"].append(name)
                unique_item_bases[name] = base_name
    grail["_uniqueItemBases"] = unique_item_bases

    # Set items: track each item's parent set name and base type so we can group later
    sets_by_set = {}  # set_name -> [(item_name, base_name), ...]
    set_order = []  # preserve insertion order
    set_item_bases = {}  # item_name -> base_name
    sets = read_tsv(os.path.join(excel_dir, "setitems.txt"))
    if sets:
        seen = set()
        for row in sets:
            name = localize(row.get("index", "").strip())
            set_name = localize(row.get("set", "").strip())
            base_code = row.get("item", "").strip()
            base_fallback = row.get("*ItemName", "").strip()
            base_name = strings.get(base_code, base_fallback)
            if name and name not in seen and name not in exclude:
                seen.add(name)
                grail["Set Items"].append(name)
                set_item_bases[name] = base_name
                if set_name:
                    if set_name not in sets_by_set:
                        sets_by_set[set_name] = []
                        set_order.append(set_name)
                    sets_by_set[set_name].append(name)
    grail["_setsByName"] = sets_by_set
    grail["_setOrder"] = set_order
    grail["_setItemBases"] = set_item_bases

    # Build rune code -> rune name map from misc.txt
    rune_names = {}
    misc = read_tsv(os.path.join(excel_dir, "misc.txt"))
    if misc:
        for row in misc:
            code = row.get("code", "").strip()
            name = row.get("name", "").strip()
            if re.match(r"^r\d+$", code) and name:
                # Prefer string-table translation if available
                rune_names[code] = strings.get(code, name)

    runeword_runes = {}  # runeword_name -> [rune name, ...]
    runewords = read_tsv(os.path.join(excel_dir, "runes.txt"))
    if runewords:
        seen = set()
        for row in runewords:
            if row.get("complete", "").strip() != "1":
                continue
            # Runewords use the "Name" column (e.g. "Runeword33") as the key, with "*Rune Name" as fallback
            raw_key = row.get("Name", "").strip()
            fallback = row.get("*Rune Name", "").strip()
            name = strings.get(raw_key, fallback)
            if name and name not in seen and name not in exclude:
                seen.add(name)
                grail["Runewords"].append(name)
                runes = []
                for i in range(1, 7):
                    rune = row.get(f"Rune{i}", "").strip()
                    if rune:
                        # Strip "Rune" suffix from display name for brevity
                        rn = rune_names.get(rune, rune)
                        rn = re.sub(r"\s+Rune$", "", rn)
                        runes.append(rn)
                runeword_runes[name] = runes
    grail["_runewordRunes"] = runeword_runes

    return grail

def collect_owned_item_names(directory, core_filter, gameversion_filter, mule_dir=None):
    """Return a dict mapping item base name -> list of (character, isMule) tuples."""
    owned = {}

    def scan(dir_path, is_mule):
        if not dir_path or not os.path.isdir(dir_path):
            return
        for filename in sorted(os.listdir(dir_path)):
            if not filename.endswith(".json"):
                continue
            with open(os.path.join(dir_path, filename)) as f:
                try:
                    data = json.load(f)
                except json.JSONDecodeError:
                    continue
            char = data.get("character", {})
            if core_filter != "both":
                cc = char.get("core", "")
                if cc and cc != core_filter:
                    continue
            if gameversion_filter != "all":
                cgv = char.get("gameVersion", "")
                if cgv and cgv.lower() != gameversion_filter.lower():
                    continue
            source = char.get("name", filename)
            if "type" in data and data["type"] == "SharedStash":
                source = "Shared Stash"
            for item in data.get("items", []):
                if any("Unidentified" in f for f in item.get("flags", [])):
                    continue
                name = item.get("name", "")
                # Match the leading "Display Name" part from "Display Name (Base)"
                m = re.match(r"^(.*?)\s*\(.*\)\s*$", name)
                key = m.group(1) if m else name
                owned.setdefault(key, []).append((source, is_mule))
        return

    scan(directory, False)
    scan(mule_dir, True)
    return owned

def run_grail(excel_dir, save_dir, mule_dir, core_filter, gameversion_filter, exclude=None):
    grail = load_grail_items(excel_dir, exclude=exclude)
    owned = collect_owned_item_names(save_dir, core_filter, gameversion_filter, mule_dir)

    sets_by_set = grail.pop("_setsByName", {})
    set_order = grail.pop("_setOrder", [])
    set_item_bases = grail.pop("_setItemBases", {})
    unique_item_bases = grail.pop("_uniqueItemBases", {})
    runeword_runes = grail.pop("_runewordRunes", {})

    total_items = 0
    total_owned = 0
    for category, names in grail.items():
        print(f"\n── {category} ──")
        cat_owned = 0
        if category == "Set Items" and sets_by_set:
            # Group set items by parent set, sorted by set name
            for set_name in sorted(set_order):
                items_in_set = sets_by_set[set_name]
                set_owned = sum(1 for n in items_in_set if owned.get(n))
                pct = 100.0 * set_owned / len(items_in_set) if items_in_set else 0.0
                print(f"\n  {set_name}  [{set_owned}/{len(items_in_set)} - {pct:.0f}%]")
                for name in sorted(items_in_set):
                    base = set_item_bases.get(name, "")
                    base_str = f" ({base})" if base else ""
                    holders = owned.get(name, [])
                    if holders:
                        cat_owned += 1
                        unique_chars = sorted(set(h[0] for h in holders))
                        print(f"    [✓] {name}{base_str}")
                        print(f"        {', '.join(unique_chars)}")
                    else:
                        print(f"    [ ] {name}{base_str}")
        else:
            bases = unique_item_bases if category == "Unique Items" else {}
            runes = runeword_runes if category == "Runewords" else {}
            for name in sorted(names):
                base = bases.get(name, "")
                base_str = f" ({base})" if base else ""
                rune_list = runes.get(name, [])
                if rune_list:
                    base_str = f" [{' + '.join(rune_list)}]"
                holders = owned.get(name, [])
                if holders:
                    cat_owned += 1
                    unique_chars = sorted(set(h[0] for h in holders))
                    print(f"  [✓] {name}{base_str}")
                    print(f"      {', '.join(unique_chars)}")
                else:
                    print(f"  [ ] {name}{base_str}")
        print(f"  Subtotal: {cat_owned} / {len(names)} ({100.0 * cat_owned / len(names):.1f}%)" if names else "  Subtotal: 0 / 0")
        total_items += len(names)
        total_owned += cat_owned

    print(f"\n══════════════════════════════════════════")
    pct = 100.0 * total_owned / total_items if total_items else 0.0
    print(f"  Grail Total: {total_owned} / {total_items} ({pct:.2f}%)")
    print(f"══════════════════════════════════════════")

ALL_RESIST_ELEMENTS = ["fire", "cold", "lightning", "poison"]

def transform_stat_pattern(pattern):
    """Transform 'resist X' to match both 'resist X' and 'X resist'.
    'all resist' expands to check all four elements."""
    m = re.match(r'^(all\s+resist|resist\s+all)$', pattern, re.IGNORECASE)
    if m:
        return None  # sentinel: handled specially

    m = re.match(r'^resist\s+(.+)$', pattern, re.IGNORECASE)
    if m:
        word = re.escape(m.group(1))
        return f"({word}.*resist|resist.*{word})"
    return pattern

def is_all_resist_pattern(pattern):
    return bool(re.match(r'^(all\s+resist|resist\s+all)$', pattern, re.IGNORECASE))

NUMERIC_FIELDS = ["socketcount", "opensockets", "ilvl", "resistfire", "resistcold",
                   "resistlightning", "resistpoison", "resistall"]
TEXT_FIELDS = ["name", "base", "quality", "type", "tier", "set", "stat"]

# Map lowercase CLI arg names to internal field names used in matches_field
ARG_TO_FIELD = {
    "base": "baseName",
    "ilvl": "itemLevel",
    "socketcount": "socketCount",
    "opensockets": "openSockets",
}

FIELD_HELP = {
    "base": 'item base, ie "Mage Plate" or "Phase Blade"',
    "quality": 'item quality, ie Normal, Superior, Magic, Rare, Set, Unique',
    "tier": 'item tier, ie Normal, Exceptional, Elite',
    "type": 'item type, ie Axe, Sword, Shield, Ring',
    "set": 'the set that an item belongs to.  can be a partial match, ie "trang"',
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Search for items matching field/pattern combos across d2sitems JSON files.",
        epilog="Examples:\n"
               "  find_items.py --name Infinity                       # search by name\n"
               "  find_items.py --stat Teleport                       # search in stats\n"
               '  find_items.py --quality Unique --resistall ">20"    # Unique items resist all greater than 20%\n'
               "  find_items.py --name Torch --stat Warlock           # Warlock Torches\n"
               '  find_items.py --socketcount ">=3" --quality Unique     # Unique items with 3+ sockets\n'
               "  find_items.py --tier Elite --quality Unique           # Elite Unique items\n"
               "  find_items.py --ethereal --opensockets 4 --tier Elite --type Armor --quality Superior\n"
               "                                                       # Superior Ethereal Elite Armors with 4 open sockets\n"
               '  find_items.py --set "Tal Rasha"                      # items in Tal Rasha\'s set\n'
               "  find_items.py --base \"Small Charm\" --resistall 5  # small charms with 5 all resist\n"
               '  find_items.py --base Amulet --ilvl ">=90" --quality Magic   # Amulets for crafting\n',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    config = load_config()
    save_dir = config.get("save_dir",
        os.path.join(os.path.expanduser("~"), "Saved Games", "Diablo II Resurrected"))

    parser.add_argument("pattern", nargs="?", default=None,
                        help="regex pattern to match item names (shorthand for --name)")

    # Add a named argument for each searchable field
    for field in TEXT_FIELDS:
        parser.add_argument(f"--{field}", metavar="PATTERN",
                            help=FIELD_HELP.get(field, f"regex pattern to match in the {field} field"))
    for field in NUMERIC_FIELDS:
        parser.add_argument(f"--{field}", metavar="EXPR",
                            help=f"numeric expression for {field} (e.g. 3, >=4, 1-3)")

    # Shorthand boolean flags
    parser.add_argument("--ethereal", action="store_true", help="only Ethereal items")
    parser.add_argument("--notethereal", action="store_true", help="only non-Ethereal items")
    parser.add_argument("--core", choices=["hard", "soft", "both"], default=None,
                        help="filter by hardcore/softcore (overrides config, default: both)")
    parser.add_argument("--gameversion", default=None,
                        help="filter by game version: Classic, Expansion, ReignOfTheWarlock, or all (overrides config, default: all)")
    parser.add_argument("--json", action="store_true",
                        help="output results as JSON instead of human-readable text")
    parser.add_argument("--grail", action="store_true",
                        help="show a grail report: for every unique/set/runeword in the excel dir, indicate whether we already have one")

    args = parser.parse_args()

    # Build filter list from all specified field arguments
    filters = []
    for arg in TEXT_FIELDS:
        val = getattr(args, arg, None)
        if val is not None:
            field = ARG_TO_FIELD.get(arg, arg)
            if field == "stat" and is_all_resist_pattern(val):
                for element in ALL_RESIST_ELEMENTS:
                    pat = f"({element}.*resist|resist.*{element})"
                    filters.append((field, re.compile(pat, re.IGNORECASE), False))
            else:
                if field == "stat":
                    val = transform_stat_pattern(val)
                filters.append((field, re.compile(val, re.IGNORECASE), False))
    for arg in NUMERIC_FIELDS:
        val = getattr(args, arg, None)
        if val is not None:
            field = ARG_TO_FIELD.get(arg, arg)
            filters.append((field, val, False))
    if args.ethereal:
        filters.append(("flags", re.compile(r"Ethereal", re.IGNORECASE), False))
    if args.notethereal:
        filters.append(("flags", re.compile(r"Ethereal", re.IGNORECASE), True))
    if args.pattern:
        filters.append(("name", re.compile(args.pattern, re.IGNORECASE), False))
    if not filters:
        filters.append(("name", re.compile("Infinity", re.IGNORECASE), False))

    core_filter = args.core or config.get("core", "both")
    gameversion_filter = args.gameversion or config.get("game_version", "all")

    if args.grail:
        excel_dir = config.get("excel_dir", "")
        if not excel_dir or not os.path.isdir(excel_dir):
            print(f"Error: excel_dir not configured or not found: {excel_dir}")
            exit(1)
        exclude = set(n.strip() for n in config.get("exclude_items", "").split(",") if n.strip())
        run_grail(excel_dir, save_dir, config.get("mule_dir"), core_filter, gameversion_filter, exclude=exclude)
        exit(0)

    results = search_items(save_dir, filters, core_filter, gameversion_filter)
    mule_dir = config.get("mule_dir")
    if mule_dir and os.path.isdir(mule_dir):
        results += search_items(mule_dir, filters, core_filter, gameversion_filter, is_mule=True)

    if args.json:
        json_results = []
        for source, save_file, item, is_mule in results:
            entry = dict(item)
            entry["character"] = source
            entry["file"] = save_file
            entry["isMule"] = is_mule
            json_results.append(entry)
        print(json.dumps(json_results, indent=2, ensure_ascii=False))
    else:
        for source, save_file, item, is_mule in results:
            print_item(source, save_file, item, is_mule)
