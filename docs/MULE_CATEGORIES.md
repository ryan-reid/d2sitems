# BKDiablo Mule Categories

Bulk packing must always stay inside the selected Hardcore or Softcore mode. A shared stash is never a source for a character in the other mode. Packing operates on normal stash tabs; advanced-bank stacks and Chronicle tabs require separate, explicit operations.

## Primary mule types

These are the categories exposed to users:

- **Unique Items** — unique-quality equipment and BKDiablo unique variants.
- **Set Items** — set-quality equipment, grouped by set when useful.
- **Charms** — small, large, and grand charms, including unique charms such as Hellfire Torch and Gheed’s Fortune.
- **Jewelry** — rings and amulets, including jewels and Rainbow/Colossal/Defender facets. Facets must be classified as jewelry before generic unique handling.
- **Bases** — normal, superior, ethereal, socketed white or grey equipment suitable for runewords. Preserve ethereal state, sockets, and base identity in the assignment.

The planner should allow a mule to accept one category or a deliberate multi-category selection. “All” is permitted only as an explicit choice and must show a preview before staging.

## Protected items

Bulk packing excludes shared pre-buff equipment by default. This includes Call to Arms (CTA), Spectral Shard, and any item granting skills or class/skill-tab bonuses used before leaving town. The exclusion must be driven by parsed item properties, including `+All Skills`, `+Class Skills`, `+Skill Tab`, `+Single Skill`, and relevant aura or oskill properties—not only by item names. Users may review the protected list and explicitly opt into moving one item at a time.

## Additional categories to plan for

- **Runes, gems, and crafting materials** — these stay in their stacked stash tabs and are never moved by mule packing, even if a normal tab happens to contain one. Advanced-bank quantities keep their merge/split rules.
- **Runewords and crafted items** — these get their own mule categories. Classify by final item identity and quality, never by the white base underneath.
- **Quest, event, and utility items** — leave these in place by default. They are not automatically packed unless a future explicit category is added.
- **Unknown items** — never auto-pack. Put them in a review queue with their source file, tab, seed, and reason.
- **Corrupted items** — follow the underlying category: a corrupted unique goes to Unique Items, a corrupted set goes to Set Items, and so on. The corruption marker is retained; it does not create a separate category.

Mercenary gear is not a separate category because BKDiablo does not store it as an independent mule class.

## Staging and overflow rules

Assignments are mode-specific and stored per profile. The preview must list each destination, remaining items, protected items, skipped stacked/advanced tabs, and newly proposed mule names. Overflow mules are created only in Edit mode and become real files when the user presses Save. Every Save is one transaction with backups for the stash, existing mules, and newly created files.
