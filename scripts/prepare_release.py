"""Prepare portable Pages build inputs from the checked-out BK submodule."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from extract_item_sprites import build_image_mappings, decode_spa1_to_png


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def export_layout(source, destination):
    layout = json.loads(source.read_text(encoding="utf-8-sig"))
    # Keep presentation coordinates and background assets maintained by the UI.
    result = json.loads(destination.read_text(encoding="utf-8"))
    result.update(mod_path="mods/BKDiablo/bkdiablo.mpq/data/global/ui/layouts/" + source.name,
                  revision=digest(source.read_bytes()), stackable_slots=[], crafting_slots=[],
                  crafting_cube=None, crafting_buttons=[])
    groups = {"advancedstash_gems": "stackable_slots", "advancedstash_materials": "crafting_slots"}
    for child in layout.get("children", []):
        name = child.get("name")
        for slot in child.get("children", []):
            fields = slot.get("fields", {})
            rect = fields.get("rect", {})
            if name in groups:
                result[groups[name]].append({
                    "name": slot.get("name"), "itemCode": fields.get("itemCode", slot.get("name")),
                    "x": rect.get("x"), "y": rect.get("y"),
                    "width": rect.get("width", 98), "height": rect.get("height", 98)})
            elif name == "advancedstash_horadriccube":
                if slot.get("name") == "horadriccube_grid":
                    result["crafting_cube"] = {"x": rect.get("x"), "y": rect.get("y"),
                                               "cellCount": fields.get("cellCount", {"x": 6, "y": 6})}
                elif slot.get("name") in ("convert", "withdraw_button"):
                    result["crafting_buttons"].append({"name": slot["name"], "type": slot.get("type"),
                        "x": rect.get("x"), "y": rect.get("y"),
                        "text": "TRANSMUTE" if slot["name"] == "convert" else "Withdraw"})
    if not result["stackable_slots"] or not result["crafting_slots"] or not result["crafting_cube"]:
        raise ValueError("BK bank layout is missing required groups; refusing stale layout deployment")
    write_json(destination, result)
    return result["revision"]


def prepare(root, mod):
    data = mod / "bkdiablo.mpq/data"
    embedded = root / "src/D2SWasm/EmbeddedData"
    web = root / "web"
    copies = []
    # Only refresh engine inputs already supported by the application. propertygroups.txt
    # is an application supplement, not a file provided by the mod repository.
    for folder, source_folder in (("excel", "global/excel"), ("strings", "local/lng/strings")):
        for target in sorted((embedded / folder).iterdir()):
            if target.name == "propertygroups.txt":
                continue
            source = data / source_folder / target.name
            if not source.is_file():
                raise FileNotFoundError(f"Required BK input missing: {source}")
            copies.append((source, target))
    layout = data / "global/ui/layouts/bankexpansionlayouthd.json"
    if not layout.is_file():
        raise FileNotFoundError(layout)
    for source, target in copies:
        shutil.copyfile(source, target)
    shutil.copyfile(layout, embedded / "ui/layouts" / layout.name)
    layout_revision = export_layout(layout, web / "bank_expansion_layout.json")

    # The committed artwork supplies assets absent from the mod. Override every
    # supplied HD sprite before resolving mappings from current BK definitions.
    items = web / "assets/items"
    hd_root = data / "hd/global/ui/items"
    refreshed_artwork = {}
    for category in ("armor", "weapon", "misc"):
        for source in sorted((hd_root / category).rglob("*.sprite")):
            if source.name.endswith(".lowend.sprite"):
                continue
            asset = source.relative_to(hd_root / category).with_suffix("").as_posix().lower()
            png = decode_spa1_to_png(str(source))
            if not png:
                raise ValueError(f"Unsupported BK sprite: {source}")
            filename = "hd_" + asset.replace("/", "_") + ".png"
            (items / filename).write_bytes(png)
            refreshed_artwork[filename] = source.relative_to(root).as_posix()
    # Fail explicitly if upstream starts supplying classic overrides: these require
    # a retail palette, which isn't available on a clean GitHub Actions runner.
    if list((data / "global/items").glob("*.[dD][cC]6")):
        raise ValueError("BK now supplies classic sprites; configure a palette before deploying")
    mapping = build_image_mappings([str(data / "global/excel")], [str(data / "hd/items")],
                                   json_path=str(web / "item_images.json"))
    # Avoid machine-specific absolute paths in public artifacts and fingerprints.
    mapping["inputHashes"] = {Path(path).relative_to(root).as_posix(): value
                              for path, value in mapping["inputHashes"].items()}
    for provenance in mapping["provenance"].values():
        provenance["definition"] = "mods/BKDiablo/bkdiablo.mpq/data/global/excel"
    mapping["artworkSources"] = {path.name: refreshed_artwork.get(path.name, "committed artwork fallback")
                                 for path in items.glob("*.png")}
    mapping["revision"] = digest(json.dumps(mapping["inputHashes"], sort_keys=True).encode())
    write_json(web / "item_images.json", mapping)
    panel_hashes = {}
    for asset in ("stashpanel_bkd", "additionalstash/panel_additionalstash_all"):
        source = data / "hd/global/ui/panel/stash" / (asset + ".sprite")
        png = decode_spa1_to_png(str(source))
        if not png:
            raise ValueError(f"Unsupported BK panel sprite: {source}")
        (web / "assets" / (Path(asset).name + ".png")).write_bytes(png)
        panel_hashes[asset] = digest(png)
    manifest = "".join(path.name.lower() + ":" + digest(path.read_bytes()).upper() + "\n"
                       for path in sorted((embedded / "excel").glob("*.txt"), key=lambda p: p.name.lower()))
    definitions = digest(manifest.encode()).upper()
    # Include localized names in the combined revision as well as table/layout/art hashes.
    strings = digest(b"".join(p.read_bytes() for p in sorted((embedded / "strings").glob("*.json"))))
    write_json(web / "catalog_meta.json", {
        "catalogRevision": digest(f"{definitions}:{layout_revision}:{mapping['revision']}:{strings}:{json.dumps(panel_hashes, sort_keys=True)}".encode()).upper(),
        "definitionsRevision": definitions, "layoutRevision": layout_revision,
        "artworkRevision": mapping["revision"], "stringsRevision": strings,
        "panelHashes": panel_hashes, "excelDir": "src/D2SWasm/EmbeddedData/excel"})
    def revision(path):
        return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    write_json(web / "source-revisions.json", {"repository": revision(root), "BKDiablo": revision(mod),
        "artworkFallback": "committed web/assets/items", "supplement": "embedded propertygroups.txt"})
    print(f"Prepared {len(copies)} BK tables/strings and current layout/artwork")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    prepare(root, root / "mods/BKDiablo")
