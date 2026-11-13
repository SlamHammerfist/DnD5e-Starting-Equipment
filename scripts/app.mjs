import { TEMPLATES } from "./constants.mjs";
import { buildSource, collect, grant, rollWealth } from "./equipment.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * One dialog offering the starting equipment / wealth of one or more
 * class & background items to a character.
 */
export class StartingEquipmentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {Actor} actor
   * @param {object[]} sources  Models from buildSource().
   */
  constructor(actor, sources, options = {}) {
    super(options);
    this.actor = actor;
    this.sources = sources;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dnd5e-starting-equipment"],
    tag: "form",
    window: { icon: "fas fa-sack", resizable: true },
    position: { width: 540, height: "auto" },
    form: { handler: StartingEquipmentApp.#onSubmit, closeOnSubmit: true },
    actions: {
      rollGold: StartingEquipmentApp.#onRollGold,
      skip: StartingEquipmentApp.#onSkip
    }
  };

  static PARTS = {
    form: { template: TEMPLATES.dialog, scrollable: [".se-body"] }
  };

  /**
   * Build and show the dialog for some items on an actor.
   * @returns {Promise<StartingEquipmentApp|null>}
   */
  static async open(actor, items) {
    const sources = (await Promise.all(items.map(i => buildSource(actor, i)))).filter(Boolean);
    if (!sources.length) {
      ui.notifications.info(game.i18n.format("STARTEQUIP.NothingToOffer", { name: actor.name }));
      return null;
    }
    const app = new this(actor, sources);
    await app.render(true);
    return app;
  }

  get title() {
    return game.i18n.format("STARTEQUIP.Title", { name: this.actor.name });
  }

  async _prepareContext(options) {
    return { actor: this.actor, sources: this.sources };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", this.#onChange.bind(this));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#refresh();
  }

  /* ------------------------------------------------------------------------ */

  #section(id) {
    return this.element.querySelector(`.se-source[data-source="${id}"]`);
  }

  async #onChange(event) {
    const el = event.target;
    this.#refresh();
    // Switching a source to gold with no amount yet → roll it.
    if (el.matches?.("input[type=radio][data-mode]") && el.value === "gold") {
      const input = this.#section(el.dataset.mode)?.querySelector(".se-gold");
      if (input && input.value === "") await this.#roll(el.dataset.mode);
    }
  }

  /** Dim and disable whatever the current choices exclude. */
  #refresh() {
    const form = this.element;
    for (const sec of form.querySelectorAll(".se-source")) {
      const id = sec.dataset.source;
      const mode = sec.querySelector(`input[name="mode-${id}"]:checked`)?.value ?? "equipment";
      const equip = sec.querySelector(".se-equipment");
      if (equip) {
        equip.dataset.off = String(mode === "gold");
        equip.classList.toggle("inactive", mode === "gold");
      }
      const gold = sec.querySelector(".se-gold-row");
      gold?.classList.toggle("inactive", mode !== "gold");
      const goldInput = sec.querySelector(".se-gold");
      if (goldInput) goldInput.disabled = mode !== "gold";
    }
    for (const choice of form.querySelectorAll(".se-choice")) {
      const radio = choice.querySelector(":scope > .se-choice-head input[type=radio]");
      choice.classList.toggle("inactive", !radio?.checked);
    }
    for (const el of form.querySelectorAll(".se-equipment input, .se-equipment select")) {
      el.disabled = StartingEquipmentApp.#isInactive(el);
    }
  }

  static #isInactive(el) {
    let node = el.closest(".se-choice, .se-equipment");
    while (node) {
      if (node.classList.contains("se-choice")) {
        const radio = node.querySelector(":scope > .se-choice-head input[type=radio]");
        if (radio && radio !== el && !radio.checked) return true;
      } else if (node.dataset.off === "true") return true;
      node = node.parentElement?.closest(".se-choice, .se-equipment");
    }
    return false;
  }

  async #roll(id) {
    const source = this.sources.find(s => s.id === id);
    const sec = this.#section(id);
    if (!source?.wealth || !sec) return null;
    const radio = sec.querySelector(`input[name="mode-${id}"][value="gold"]`);
    if (radio && !radio.checked) {
      radio.checked = true;
      this.#refresh();
    }
    const roll = await rollWealth(this.actor, source);
    const input = sec.querySelector(".se-gold");
    if (input) input.value = roll.total;
    return roll;
  }

  /* ------------------------------------------------------------------------ */

  static async #onRollGold(event, target) {
    await this.#roll(target.dataset.source);
  }

  static async #onSkip() {
    await this.close();
  }

  static async #onSubmit(event, form, formData) {
    const fd = formData.object;
    const totalCoins = {};
    let count = 0;

    // Grant per source so each item remembers which class/background it came from.
    for (const src of this.sources) {
      const picks = new Map();
      const currency = {};
      const mode = fd[`mode-${src.id}`] ?? "equipment";
      if (mode === "gold" && src.wealth) {
        const raw = fd[`gold-${src.id}`];
        let gp = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
        if (!Number.isFinite(gp)) gp = (await rollWealth(this.actor, src)).total;
        currency.gp = Math.max(0, Math.floor(gp));
      } else {
        collect(src.root, fd, picks, currency);
      }
      count += await grant(this.actor, picks, currency, src.item);
      for (const [k, v] of Object.entries(currency)) totalCoins[k] = (totalCoins[k] ?? 0) + v;
    }

    const coins = Object.entries(totalCoins).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ");
    ui.notifications.info(game.i18n.format("STARTEQUIP.Granted", {
      items: count,
      name: this.actor.name,
      coins: coins ? ` (+${coins})` : ""
    }));
  }
}
