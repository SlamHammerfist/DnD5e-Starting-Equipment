export const MODULE_ID = "dnd5e-starting-equipment";
export const MODULE_PATH = `modules/${MODULE_ID}`;
export const TEMPLATES = {
  dialog: `${MODULE_PATH}/templates/dialog.hbs`,
  entry: `${MODULE_PATH}/templates/entry.hbs`
};
/** Item types that carry starting equipment / wealth. */
export const SOURCE_TYPES = ["class", "background"];
