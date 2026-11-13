# DnD5e Starting Equipment

When you add a **class** or **background** to a level 1 character, this module reads the item's
`system.startingEquipment` and `system.wealth` and offers them in one dialog:

- **Fixed items** are listed (with quantities, e.g. `4× Javelin`).
- **"Choose one" (OR) groups** are radio buttons; unchosen branches are dimmed and ignored.
- **"Any martial weapon / tool / focus"** slots are dropdowns built from the system's base items
  (`CONFIG.DND5E.weaponIds`, `armorIds`, `shieldIds`, `toolIds`, `focusTypes`). If the entry is marked
  *requires proficiency*, only items the character is proficient with are listed (falls back to the
  full list if that would leave nothing).
- **Currency entries** (e.g. "or 50 GP" in 2024 data) are added to the character's coins.
- **Starting gold instead**: if the item has a wealth formula, you can switch that source to gold.
  It rolls automatically (or click the d20 to reroll, or type an amount). Background equipment stays
  separate, so you can take class gold and background gear together.

A class and background created together are shown in the same dialog. Containers such as
Explorer's Pack are created with their contents.

## Install

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/SlamHammerfist/DnD5e-Starting-Equipment/releases/latest/download/module.json
```

Then enable it in your world.

## Removing a class or background

Every item the dialog creates, including the contents of packs, is tagged with the class or
background it came from. When that class or background is deleted from the character, its items are
deleted too, and the coins it granted (starting gold or currency entries) are subtracted. Coins are only taken back up to what the character still has, so the total never goes below zero. You're asked first by default (see *Settings*).

## Other ways to open it

- Right-click a class or background on the character sheet → **Starting Equipment…**
- Macro: `game.modules.get("dnd5e-starting-equipment").api.open(actorOrItem)`

## Settings

- *Offer starting equipment automatically* (per user)
- *Post starting-gold rolls to chat* (world)
- *Remove granted equipment with its class*: Ask first / Always / Never (world)

## Requirements

Foundry VTT v12–v14, dnd5e 3.0+ (tested against dnd5e 6.1).
