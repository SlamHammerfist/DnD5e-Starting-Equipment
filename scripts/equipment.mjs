import { MODULE_ID } from "./constants.mjs";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const localize = key => game.i18n.localize(key);
const format = (key, data) => game.i18n.format(key, data);
const cfgLabel = v => (v ? localize(typeof v === "string" ? v : v.label ?? "") : "");

/** Does this item carry anything for us to offer? */
export function hasStartingData(item) {
  return !!(item?.system?.startingEquipment?.length || wealthFormula(item));
}

/** The item's starting-wealth formula, if valid. */
export function wealthFormula(item) {
  const f = String(item?.system?.wealth ?? "").trim();
  if (!f) return null;
  try {
    return Roll.validate(f) ? f : null;
  } catch {
    return null;
  }
}

/** Roll a source's starting wealth, optionally posting it to chat. */
export async function rollWealth(actor, source) {
  const roll = new Roll(source.wealth, actor.getRollData());
  await roll.evaluate();
  if (game.settings.get(MODULE_ID, "postGoldRoll")) {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: format("STARTEQUIP.GoldFlavor", { source: source.name })
    });
  }
  return roll;
}

/**
 * Turn whatever a CONFIG.DND5E.*Ids entry holds into { pack, id }.
 * Handles full UUIDs, legacy "scope.pack.id" refs, and bare ids.
 */
function parseRef(ref) {
  let uuid = ref;
  try {
    const fn = globalThis.dnd5e?.documents?.Trait?.getBaseItemUUID;
    if (typeof fn === "function") uuid = fn(ref) ?? ref;
  } catch { /* fall through */ }
  const parts = String(uuid).split(".");
  if (parts[0] === "Compendium") return { pack: `${parts[1]}.${parts[2]}`, id: parts.at(-1) };
  if (parts.length > 1) return { pack: parts.slice(0, -1).join("."), id: parts.at(-1) };
  return { pack: CONFIG.DND5E.sourcePacks?.ITEMS ?? "dnd5e.items", id: uuid };
}

/** Cached base-item lists, per kind. */
const BASE_CACHE = new Map();

/**
 * Load the base items for a kind ("weapon" | "armor" | "tool" | "focus").
 * @returns {Promise<{id, uuid, name, type, category}[]>}
 */
async function baseItems(kind) {
  if (BASE_CACHE.has(kind)) return BASE_CACHE.get(kind);
  const C = CONFIG.DND5E;
  const refs = [];
  const add = (ids, extra = {}) => {
    for (const [id, ref] of Object.entries(ids ?? {})) refs.push({ id, ...parseRef(ref), ...extra });
  };
  switch (kind) {
    case "weapon": add(C.weaponIds); break;
    case "armor": add(C.armorIds); add(C.shieldIds, { category: "shl" }); break;
    case "tool": add(C.toolIds); break;
    case "focus":
      for (const [focus, cfg] of Object.entries(C.focusTypes ?? {})) {
        const ids = Array.isArray(cfg.itemIds)
          ? Object.fromEntries(cfg.itemIds.map(r => [parseRef(r).id, r]))
          : cfg.itemIds;
        add(ids, { type: focus, category: focus });
      }
      break;
  }

  const byPack = Map.groupBy ? Map.groupBy(refs, r => r.pack) : refs.reduce((m, r) => {
    if (!m.has(r.pack)) m.set(r.pack, []);
    m.get(r.pack).push(r);
    return m;
  }, new Map());

  const results = [];
  for (const [packId, list] of byPack) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["system.type.value", "system.type.baseItem"] });
    for (const r of list) {
      const entry = index.get(r.id);
      if (!entry) continue;
      const type = r.type ?? entry.system?.type?.value ?? "";
      let category = r.category;
      if (!category) {
        if (kind === "weapon") category = C.weaponProficienciesMap?.[type] ?? type;
        else if (kind === "armor") category = C.armorProficienciesMap?.[type] ?? type;
        else category = type;
      }
      results.push({
        id: r.id,
        uuid: entry.uuid ?? `Compendium.${packId}.Item.${r.id}`,
        name: entry.name,
        type,
        category: typeof category === "string" ? category : type
      });
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  BASE_CACHE.set(kind, results);
  return results;
}

/** Is the actor proficient with this base item? */
function isProficient(actor, kind, opt) {
  const traits = actor.system.traits ?? {};
  const has = (trait, ...keys) => {
    const v = traits[trait]?.value;
    const set = v instanceof Set ? v : new Set(v ?? []);
    return keys.some(k => k && set.has(k));
  };
  switch (kind) {
    case "weapon": return has("weaponProf", opt.category, opt.type, opt.id);
    case "armor": return has("armorProf", opt.category, opt.id);
    case "tool": return !!actor.system.tools?.[opt.id] || has("toolProf", opt.id, opt.type);
    default: return true;
  }
}

/** Human label for a category key, e.g. "mar" → "Martial Weapons". */
function categoryLabel(kind, key) {
  const C = CONFIG.DND5E;
  if (!key) return localize(`STARTEQUIP.Any.${kind}`);
  const tables = {
    weapon: [C.weaponProficiencies, C.weaponTypes],
    armor: [C.armorProficiencies, C.armorTypes],
    tool: [C.toolTypes, C.toolProficiencies],
    focus: [C.focusTypes]
  }[kind] ?? [];
  for (const t of tables) {
    const label = cfgLabel(t?.[key]);
    if (label) return format("STARTEQUIP.ChooseFrom", { category: label });
  }
  return format("STARTEQUIP.ChooseFrom", { category: key });
}

async function nameFor(uuid) {
  try {
    const d = fromUuidSync(uuid);
    if (d?.name) return d.name;
  } catch { /* not in an index */ }
  try {
    return (await fromUuid(uuid))?.name ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  View-model construction                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a single option (leaf) node.
 * Kinds: item (fixed), select (dropdown), currency, missing.
 */
async function buildOption(entry, actor, srcId) {
  const count = Math.max(1, Number(entry.count) || 1);
  const base = { id: entry._id, count, multi: count > 1 };
  const missing = label => ({ ...base, kind: "missing", isMissing: true, label });

  switch (entry.type) {
    case "linked": {
      const name = await nameFor(entry.key);
      return name
        ? { ...base, kind: "item", isItem: true, uuid: entry.key, label: name }
        : missing(format("STARTEQUIP.Missing", { key: entry.key }));
    }

    case "currency": {
      const denom = entry.key || "gp";
      const cfg = CONFIG.DND5E.currencies?.[denom];
      const abbr = cfg ? localize(cfg.abbreviation ?? cfg.label) : denom;
      return { ...base, multi: false, kind: "currency", isCurrency: true, denom, amount: count, label: `${count} ${abbr}` };
    }

    case "weapon":
    case "armor":
    case "tool":
    case "focus": {
      const all = await baseItems(entry.type);
      const key = entry.key ?? "";
      const exact = key ? all.find(o => o.id === key) : null;
      if (exact) return { ...base, kind: "item", isItem: true, uuid: exact.uuid, label: exact.name };

      let choices = key ? all.filter(o => o.category === key || o.type === key) : all;
      if (entry.requiresProficiency) {
        const prof = choices.filter(o => isProficient(actor, entry.type, o));
        if (prof.length) choices = prof;
      }
      const label = categoryLabel(entry.type, key);
      if (!choices.length) return missing(label);
      if (choices.length === 1) return { ...base, kind: "item", isItem: true, uuid: choices[0].uuid, label: choices[0].name };
      return {
        ...base,
        kind: "select",
        isSelect: true,
        name: `pick-${srcId}-${entry._id}`,
        label,
        proficientOnly: !!entry.requiresProficiency,
        choices: choices.map((o, i) => ({ value: o.uuid, label: o.name, selected: i === 0 }))
      };
    }

    default:
      return missing(format("STARTEQUIP.Missing", { key: `${entry.type}:${entry.key ?? ""}` }));
  }
}

/** Build the full choice tree for one source item. */
async function buildTree(item, actor) {
  const srcId = item.id;
  const raw = Array.from(item.system.startingEquipment ?? []);
  const entries = raw.map(e => (typeof e.toObject === "function" ? e.toObject() : { ...e }));
  const ids = new Set(entries.map(e => e._id));
  const byParent = new Map();
  for (const e of entries) {
    const parent = e.group && ids.has(e.group) ? e.group : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(e);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  const build = async entry => {
    if (entry.type === "AND" || entry.type === "OR") {
      const kids = (await Promise.all((byParent.get(entry._id) ?? []).map(build))).filter(Boolean);
      if (!kids.length) return null;
      if (entry.type === "AND") return { id: entry._id, kind: "and", isAnd: true, children: kids };
      return {
        id: entry._id,
        kind: "or",
        isOr: true,
        name: `or-${srcId}-${entry._id}`,
        children: kids.map((view, i) => ({
          id: view.id,
          letter: String.fromCharCode(97 + i),
          checked: i === 0,
          view
        }))
      };
    }
    return buildOption(entry, actor, srcId);
  };

  const top = (await Promise.all((byParent.get(null) ?? []).map(build))).filter(Boolean);
  if (!top.length) return null;
  if (top.length === 1 && top[0].isAnd) return top[0];
  return { id: "root", kind: "and", isAnd: true, children: top };
}

/** Build the dialog model for one class/background item. */
export async function buildSource(actor, item) {
  if (!hasStartingData(item)) return null;
  const root = await buildTree(item, actor);
  const wealth = wealthFormula(item);
  return {
    id: item.id,
    item,
    name: item.name,
    img: item.img,
    typeLabel: cfgLabel(CONFIG.Item.typeLabels?.[item.type]) || item.type,
    description: item.system.startingEquipmentDescription ?? "",
    alreadyGranted: !!item.getFlag(MODULE_ID, "granted"),
    root,
    wealth,
    hasWealth: !!wealth
  };
}

/* -------------------------------------------------------------------------- */
/*  Resolving the submitted form                                               */
/* -------------------------------------------------------------------------- */

/**
 * Walk the tree following the user's choices.
 * @param {object} node
 * @param {object} fd                 Flat form data.
 * @param {Map<string, number>} picks uuid → count
 * @param {Record<string, number>} currency
 */
export function collect(node, fd, picks, currency) {
  if (!node) return;
  const addPick = (uuid, count) => uuid && picks.set(uuid, (picks.get(uuid) ?? 0) + count);
  switch (node.kind) {
    case "and":
      for (const c of node.children) collect(c, fd, picks, currency);
      break;
    case "or": {
      const chosen = node.children.find(c => c.id === fd[node.name]) ?? node.children[0];
      if (chosen) collect(chosen.view, fd, picks, currency);
      break;
    }
    case "item":
      addPick(node.uuid, node.count);
      break;
    case "select": {
      const value = fd[node.name];
      const valid = node.choices.some(c => c.value === value);
      addPick(valid ? value : node.choices[0]?.value, node.count);
      break;
    }
    case "currency":
      currency[node.denom] = (currency[node.denom] ?? 0) + node.amount;
      break;
  }
}

/* -------------------------------------------------------------------------- */
/*  Granting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create the chosen items (with container contents) and add currency.
 * @returns {Promise<number>} Number of top-level items created.
 */
export async function grant(actor, picks, currency, sourceItem) {
  const ItemCls = CONFIG.Item.documentClass;
  const toCreate = [];
  let topLevel = 0;

  for (const [uuid, count] of picks) {
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui.notifications.warn(format("STARTEQUIP.Missing", { key: uuid }));
      continue;
    }
    let data = typeof ItemCls.createWithContents === "function"
      ? await ItemCls.createWithContents([doc])
      : [doc.toObject()];
    data = data.map(d => (typeof d?.toObject === "function" ? d.toObject() : foundry.utils.deepClone(d)));
    if (!data.length) continue;

    // Fresh ids for everything, keeping container links intact.
    const remap = new Map();
    for (const d of data) {
      const id = foundry.utils.randomID();
      if (d._id) remap.set(d._id, id);
      d._id = id;
    }
    for (const d of data) {
      delete d.folder;
      delete d.sort;
      delete d.ownership;
      if (d.system?.container && remap.has(d.system.container)) d.system.container = remap.get(d.system.container);
      // Tag every created item (pack contents included) with the class/background it came from.
      foundry.utils.setProperty(d, `flags.${MODULE_ID}.source`, sourceItem.id);
    }

    const first = data[0];
    first.system ??= {};
    first.system.quantity = (Number(first.system.quantity) || 1) * count;
    if (doc.pack) foundry.utils.setProperty(first, "_stats.compendiumSource", doc.uuid);
    foundry.utils.setProperty(first, `flags.${MODULE_ID}.granted`, true);
    toCreate.push(...data);
    topLevel++;
  }

  const update = {};
  for (const [denom, amount] of Object.entries(currency)) {
    if (!amount) continue;
    update[`system.currency.${denom}`] = (Number(actor.system.currency?.[denom]) || 0) + amount;
  }
  if (!foundry.utils.isEmpty(update)) await actor.update(update);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate, { keepId: true });
  // Remember the coins on the source item so they can be taken back if it's removed.
  const coins = { ...(sourceItem.getFlag(MODULE_ID, "currency") ?? {}) };
  for (const [denom, amount] of Object.entries(currency)) {
    if (amount) coins[denom] = (Number(coins[denom]) || 0) + amount;
  }
  await sourceItem.update({ [`flags.${MODULE_ID}`]: { granted: true, currency: coins } });
  return topLevel;
}

/* -------------------------------------------------------------------------- */
/*  Removal                                                                    */
/* -------------------------------------------------------------------------- */

/** Items on the actor that were granted by the given class/background id. */
export function grantedBy(actor, sourceId) {
  return actor.items.filter(i => i.getFlag(MODULE_ID, "source") === sourceId);
}

/**
 * Delete the items a removed class/background granted, honouring the
 * "removeOnDelete" setting (ask | always | never).
 */
export async function removeGranted(actor, sourceItem) {
  const mode = game.settings.get(MODULE_ID, "removeOnDelete");
  if (mode === "never") return;
  const items = grantedBy(actor, sourceItem.id);

  // Coins to take back: what was granted, capped at what the character still has.
  const granted = sourceItem.getFlag(MODULE_ID, "currency") ?? {};
  const coins = {};
  for (const [denom, amount] of Object.entries(granted)) {
    const have = Number(actor.system.currency?.[denom]) || 0;
    const take = Math.min(have, Number(amount) || 0);
    if (take > 0) coins[denom] = take;
  }
  const coinText = Object.entries(coins).map(([k, v]) => `${v} ${k}`).join(", ");
  if (!items.length && !coinText) return;

  if (mode === "ask") {
    const rows = items.map(i => {
      const qty = Number(i.system.quantity) > 1 ? ` ×${i.system.quantity}` : "";
      return `<li>${foundry.utils.escapeHTML?.(i.name) ?? i.name}${qty}</li>`;
    });
    if (coinText) rows.push(`<li><i class="fa-solid fa-coins"></i> ${coinText}</li>`);
    const list = rows.join("");
    const DialogV2 = foundry.applications.api.DialogV2;
    const ok = await DialogV2.confirm({
      window: { title: format("STARTEQUIP.Remove.Title", { source: sourceItem.name }), icon: "fa-solid fa-trash" },
      content: `<p>${format("STARTEQUIP.Remove.Prompt", { source: sourceItem.name })}</p><ul>${list}</ul>`,
      rejectClose: false
    });
    if (!ok) return;
  }

  if (coinText) {
    const update = {};
    for (const [denom, take] of Object.entries(coins)) {
      update[`system.currency.${denom}`] = (Number(actor.system.currency?.[denom]) || 0) - take;
    }
    await actor.update(update);
  }
  const ids = items.map(i => i.id).filter(id => actor.items.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  ui.notifications.info(format("STARTEQUIP.Remove.Done", {
    count: ids.length,
    source: sourceItem.name,
    coins: coinText ? ` (−${coinText})` : ""
  }));
}
