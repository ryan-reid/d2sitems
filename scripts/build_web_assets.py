"""Build browser artifacts directly from the BK submodule (no source-data copies)."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from extract_item_sprites import build_image_mappings, decode_spa1_to_png


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def export_layout(source, destination):
    layout = json.loads(source.read_text(encoding="utf-8-sig"))
    # These are UI presentation coordinates, not a mirrored mod layout.
    result = {"hd_origin": {"x": 91, "y": 235}, "hd_scale": 32.0 / 98.0}
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
    browser_layout = {"origin": result["hd_origin"], "scale": result["hd_scale"],
                      **{key: result[key] for key in ("stackable_slots", "crafting_slots", "crafting_cube", "crafting_buttons")}}
    destination.with_name("d2_bank_layout.js").write_text(
        "// Generated from the BK submodule.\nwindow.D2R_BANK_LAYOUT = " +
        json.dumps(browser_layout, indent=2) + ";\n", encoding="utf-8")
    return result["revision"]


def prepare(root, mod):
    data = mod / "bkdiablo.mpq/data"
    web = root / "web"
    excel = data / "global/excel"
    strings_dir = data / "local/lng/strings"
    layout = data / "global/ui/layouts/bankexpansionlayouthd.json"
    for source in (excel / "uniqueitems.txt", strings_dir / "item-names.json", layout):
        if not source.is_file():
            raise FileNotFoundError(f"BK submodule input missing: {source}. Run git submodule update --init --recursive")
    layout_revision = export_layout(layout, web / "bank_expansion_layout.json")

    # Generated mod artwork is isolated from committed retail fallback artwork.
    items = web / "assets/items"
    mod_items = items / "bk"
    mod_items.mkdir(parents=True, exist_ok=True)
    # This dedicated ignored build directory owns only generated PNGs. Removing
    # old outputs makes upstream asset deletions take effect on incremental builds.
    for old in mod_items.glob("*.png"):
        old.unlink()
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
            (mod_items / filename).write_bytes(png)
            refreshed_artwork["bk/" + filename] = source.relative_to(root).as_posix()
    # Fail explicitly if upstream starts supplying classic overrides: these require
    # a retail palette, which isn't available on a clean GitHub Actions runner.
    if list((data / "global/items").glob("*.[dD][cC]6")):
        raise ValueError("BK now supplies classic sprites; configure a palette before deploying")
    mapping = build_image_mappings([str(data / "global/excel")], [str(data / "hd/items")],
                                   json_path=str(web / "item_images.json"), mod_artwork_prefix="bk/")
    # Avoid machine-specific absolute paths in public artifacts and fingerprints.
    mapping["inputHashes"] = {Path(path).relative_to(root).as_posix(): value
                              for path, value in mapping["inputHashes"].items()}
    for provenance in mapping["provenance"].values():
        provenance["definition"] = "mods/BKDiablo/bkdiablo.mpq/data/global/excel"
    mapping["artworkSources"] = {**{path.name: "committed retail fallback" for path in items.glob("*.png")},
                                 **refreshed_artwork}
    mapping["revision"] = digest(json.dumps(mapping["inputHashes"], sort_keys=True).encode())
    write_json(web / "item_images.json", mapping)
    panel_hashes = {}
    mod_panels = web / "assets/bk"
    mod_panels.mkdir(parents=True, exist_ok=True)
    for asset in ("stashpanel_bkd", "additionalstash/panel_additionalstash_all"):
        source = data / "hd/global/ui/panel/stash" / (asset + ".sprite")
        png = decode_spa1_to_png(str(source))
        if not png:
            raise ValueError(f"Unsupported BK panel sprite: {source}")
        (mod_panels / (Path(asset).name + ".png")).write_bytes(png)
        panel_hashes[asset] = digest(png)
    manifest = "".join(path.name.lower() + ":" + digest(path.read_bytes()).upper() + "\n"
                       for path in sorted(excel.glob("*.txt"), key=lambda p: p.name.lower()))
    definitions = digest(manifest.encode()).upper()
    # Include localized names in the combined revision as well as table/layout/art hashes.
    strings = digest(b"".join(p.read_bytes() for p in sorted(strings_dir.glob("*.json"))))
    write_json(web / "catalog_meta.json", {
        "catalogRevision": digest(f"{definitions}:{layout_revision}:{mapping['revision']}:{strings}:{json.dumps(panel_hashes, sort_keys=True)}".encode()).upper(),
        "definitionsRevision": definitions, "layoutRevision": layout_revision,
        "artworkRevision": mapping["revision"], "stringsRevision": strings,
        "panelHashes": panel_hashes, "excelDir": "mods/BKDiablo/bkdiablo.mpq/data/global/excel"})
    def revision(path):
        return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    write_json(web / "source-revisions.json", {"repository": revision(root), "BKDiablo": revision(mod),
        "artworkFallback": "committed retail web/assets/items", "supplement": "propertygroups.txt"})
    subprocess.run(["dotnet", "run", "--project", str(root / "d2sitems.csproj"), "-c", "Release", "--",
                    "export-unique-catalog", str(web / "unique_items_catalog.json"), "--excel", str(excel)],
                   cwd=root, check=True)
    print("Built browser artifacts directly from mods/BKDiablo")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    prepare(root, root / "mods/BKDiablo")
