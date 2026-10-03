// Journal columns: the fixed order of the 19 cells (app.js addresses cells by index, so cells are never removed or
// reordered), which columns the user can hide, the presets and the width arithmetic. Pure; no DOM.

export const COLUMNS = [
  { key: "index", group: "core", locked: true, weight: 3 },
  { key: "code", group: "core", locked: true, weight: 12 },
  { key: "date", group: "core", locked: true, weight: 9 },
  { key: "details", group: "core", locked: true, weight: 14 },
  { key: "supplier", group: "core", locked: true, weight: 11 },
  { key: "supplierId", group: "tax", weight: 7 },
  { key: "reference", group: "tax", weight: 7 },
  { key: "allocation", group: "tax", weight: 7 },
  { key: "gross", group: "core", locked: true, weight: 10 },
  { key: "net", group: "core", locked: true, weight: 10 },
  { key: "vat", group: "core", locked: true, weight: 8 },
  { key: "vatPercent", group: "tax", weight: 6 },
  { key: "expensePercent", group: "tax", weight: 6 },
  { key: "image", group: "service", weight: 9 },
  { key: "agent", group: "ai", weight: 16 },
  { key: "confidence", group: "ai", weight: 5 },
  { key: "status", group: "service", weight: 9 },
  { key: "export", group: "service", weight: 5 },
  { key: "delete", group: "service", weight: 8 },
];

export const GROUP_LABELS = { core: "עיקריות", tax: "מס", ai: "AI", service: "שירות" };

export const PRESET_HIDDEN = {
  minimum: ["supplierId", "allocation", "vatPercent", "expensePercent", "agent", "confidence"],
  full: [],
};

export const STUB_PX = 18;

const keys = COLUMNS.map((column) => column.key);
const byKey = new Map(COLUMNS.map((column, index) => [column.key, { ...column, index }]));

export const columnIndex = (key) => byKey.get(key)?.index ?? -1;
export const isLocked = (key) => Boolean(byKey.get(key)?.locked);

// Unknown and locked keys are dropped; the result is unique and in column order.
export function normaliseHidden(list) {
  const wanted = new Set(Array.isArray(list) ? list : []);
  return keys.filter((key) => wanted.has(key) && !isLocked(key));
}

export function toggleHidden(hidden, key) {
  if (isLocked(key) || !byKey.has(key)) return normaliseHidden(hidden);
  const set = new Set(hidden);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return normaliseHidden([...set]);
}

// Widths in percent of the table, in column order. A hidden column keeps a narrow stub (stubPercent) so it can be
// restored in place; the visible columns share the rest by weight (a saved weight overrides the default).
export function columnPercents(hidden, { stubPercent = 2, weights = {} } = {}) {
  const hiddenSet = new Set(hidden);
  const stubTotal = hiddenSet.size * stubPercent;
  const weightOf = (column) => (Number.isFinite(weights[column.key]) && weights[column.key] > 0 ? weights[column.key] : column.weight);
  const visibleWeight = COLUMNS.filter((column) => !hiddenSet.has(column.key)).reduce((sum, column) => sum + weightOf(column), 0);
  const room = Math.max(0, 100 - stubTotal);
  return COLUMNS.map((column) => (hiddenSet.has(column.key) ? stubPercent : (weightOf(column) / visibleWeight) * room));
}

// Weights for the visible columns derived from pixel widths measured after a drag.
export function weightsFromWidths(hidden, widths) {
  const hiddenSet = new Set(hidden);
  const result = {};
  COLUMNS.forEach((column, index) => {
    if (!hiddenSet.has(column.key) && Number.isFinite(widths[index]) && widths[index] > 0) result[column.key] = widths[index];
  });
  return result;
}

// CSS that turns hidden columns into stubs (cells keep their place, content is hidden).
export function stubCss(hidden, tableSelector) {
  return hidden
    .map((key) => {
      const n = columnIndex(key) + 1;
      return [
        `${tableSelector} th:nth-child(${n}), ${tableSelector} td:nth-child(${n}) { padding: 0; overflow: hidden; font-size: 0; }`,
        `${tableSelector} td:nth-child(${n}) > * { display: none; }`,
        `${tableSelector} th:nth-child(${n}) { cursor: pointer; }`,
        `${tableSelector} th:nth-child(${n}) > * { display: none; }`,
        `${tableSelector} th:nth-child(${n})::before { content: "+"; font-size: 15px; line-height: 1; }`,
      ].join("\n");
    })
    .join("\n");
}
