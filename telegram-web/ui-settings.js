// Interface settings kept in the data root (common/ui-settings.json, schema 1). Today: the hidden journal columns.
import { PRESET_HIDDEN, normaliseHidden } from "./table-column-model.js";

export const UI_SETTINGS_FILE = "ui-settings.json";
export const UI_SETTINGS_SCHEMA = 1;

export const DEFAULT_UI_SETTINGS = Object.freeze({ schemaVersion: UI_SETTINGS_SCHEMA, hiddenColumns: PRESET_HIDDEN.minimum });

// Anything unreadable falls back to the defaults; a saved empty list means "show every column".
export function normaliseUiSettings(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.hiddenColumns)) return { ...DEFAULT_UI_SETTINGS, hiddenColumns: [...PRESET_HIDDEN.minimum] };
  return { schemaVersion: UI_SETTINGS_SCHEMA, hiddenColumns: normaliseHidden(value.hiddenColumns) };
}

export async function readUiSettings(dataRoot) {
  try {
    const common = await dataRoot.getDirectoryHandle("common");
    const file = await (await common.getFileHandle(UI_SETTINGS_FILE)).getFile();
    return normaliseUiSettings(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError" || error instanceof SyntaxError) return normaliseUiSettings(null);
    throw error;
  }
}

export async function saveUiSettings(dataRoot, settings) {
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(UI_SETTINGS_FILE, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(normaliseUiSettings(settings), null, 2));
  } finally {
    await writable.close();
  }
}
