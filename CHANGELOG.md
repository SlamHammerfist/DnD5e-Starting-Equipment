# Changelog

## 1.0.2 (2026-11-19)
### Changed
- The dialog now matches the dnd5e system's look: its window style, gold-bordered cards for each class or background, and the system's fonts.
- The starting-gold amount and roll button now sit on the same line as "Take starting gold instead".

## 1.0.1 (2026-11-17)
### Changed
- The module title is now "D&D 5e Starting Equipment".

## 1.0.0 (2026-11-13)
### Added
- When a class or background is added to a level 1 character, a dialog offers its starting equipment and starting wealth.
- Fixed items are listed. "Choose one" groups are radio buttons. "Any weapon / armor / tool / focus" slots are dropdowns built from the system's base items, limited to proficient choices when the entry requires proficiency.
- Currency entries (such as the 2024 "or 50 GP" options) add coins.
- Each class or background can take a rolled starting-gold amount instead of its equipment. It rolls automatically, and you can reroll or type an amount.
- A class and background added together appear in one dialog. Packs are created with their contents.
- Removing a class or background deletes the items and takes back the coins it granted. Coins are only taken back up to what the character still has. A setting chooses Ask first, Always or Never.
- The dialog can also be opened from the item's right-click menu (**Starting Equipment…**) or with `game.modules.get("dnd5e-starting-equipment").api.open(actorOrItem)`.
