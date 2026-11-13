import { MODULE_ID, SOURCE_TYPES, TEMPLATES } from "./constants.mjs";
import { hasStartingData, removeGranted } from "./equipment.mjs";
import { StartingEquipmentApp } from "./app.mjs";

/* -------------------------------------------------------------------------- */
/*  API                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Open the dialog.
 *   api.open(item)          – one class/background on a character
 *   api.open(actor)         – every class/background on the character
 *   api.open(actor, items)  – specific items
 */
function open(target, items) {
  const actor = target instanceof Actor ? target : target?.actor;
  if (!actor) return null;
  if (!items) {
    items = target instanceof Actor
      ? actor.items.filter(i => SOURCE_TYPES.includes(i.type))
      : [target];
  }
  return StartingEquipmentApp.open(actor, items);
}

/* -------------------------------------------------------------------------- */
/*  Init                                                                       */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoPrompt", {
    name: "STARTEQUIP.Settings.AutoPrompt.Name",
    hint: "STARTEQUIP.Settings.AutoPrompt.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "postGoldRoll", {
    name: "STARTEQUIP.Settings.PostGoldRoll.Name",
    hint: "STARTEQUIP.Settings.PostGoldRoll.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "removeOnDelete", {
    name: "STARTEQUIP.Settings.RemoveOnDelete.Name",
    hint: "STARTEQUIP.Settings.RemoveOnDelete.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      ask: "STARTEQUIP.Settings.RemoveOnDelete.Ask",
      always: "STARTEQUIP.Settings.RemoveOnDelete.Always",
      never: "STARTEQUIP.Settings.RemoveOnDelete.Never"
    },
    default: "ask"
  });

  const load = foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  load(Object.values(TEMPLATES));

  game.modules.get(MODULE_ID).api = { open, StartingEquipmentApp };
});

/* -------------------------------------------------------------------------- */
/*  Auto-prompt on creation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Items created together (e.g. class + background from one drop or one
 * advancement batch) are collected per actor and offered in one dialog.
 */
const pending = new Map();

Hooks.on("createItem", (item, options, userId) => {
  if (userId !== game.user.id) return;
  if (!SOURCE_TYPES.includes(item.type)) return;
  if (options?.[MODULE_ID]?.skip) return;
  if (!game.settings.get(MODULE_ID, "autoPrompt")) return;
  const actor = item.parent;
  if (actor?.type !== "character") return;

  let queue = pending.get(actor.uuid);
  if (!queue) pending.set(actor.uuid, queue = { actor, items: [] });
  queue.items.push(item);
  clearTimeout(queue.timer);
  // Let the advancement batch (proficiencies, other items) finish first.
  queue.timer = setTimeout(() => flush(actor.uuid), 400);
});

function flush(key) {
  const queue = pending.get(key);
  pending.delete(key);
  if (!queue) return;
  const { actor } = queue;
  if ((actor.system.details?.level ?? 0) > 1) return;
  const items = queue.items.filter(i => actor.items.has(i.id) && hasStartingData(i));
  if (items.length) StartingEquipmentApp.open(actor, items);
}

/* -------------------------------------------------------------------------- */
/*  Clean up when a class/background is removed                               */
/* -------------------------------------------------------------------------- */

Hooks.on("deleteItem", (item, options, userId) => {
  if (userId !== game.user.id) return;
  if (!SOURCE_TYPES.includes(item.type)) return;
  const actor = item.parent;
  if (actor?.type !== "character") return;
  removeGranted(actor, item);
});

/* -------------------------------------------------------------------------- */
/*  Manual entry point: item context menu on the character sheet               */
/* -------------------------------------------------------------------------- */

Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
  if (!SOURCE_TYPES.includes(item.type) || !item.isOwner) return;
  if (item.actor?.type !== "character" || !hasStartingData(item)) return;
  // v14+ uses label/onClick and a bare icon class; v12–13 use name/callback and icon HTML.
  const modern = (game.release?.generation ?? 12) >= 14;
  menuItems.push(modern
    ? { label: "STARTEQUIP.ContextMenu", icon: "fa-solid fa-sack", onClick: () => open(item) }
    : { name: "STARTEQUIP.ContextMenu", icon: '<i class="fas fa-sack"></i>', callback: () => open(item) });
});
