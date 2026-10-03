import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { COLUMNS, PRESET_HIDDEN, columnIndex, columnPercents, normaliseHidden, stubCss, toggleHidden, weightsFromWidths } from "../table-column-model.js";
import { DEFAULT_UI_SETTINGS, normaliseUiSettings, readUiSettings, saveUiSettings } from "../ui-settings.js";
import { setupJournalColumns } from "../journal-columns.js";
import { memoryDirectory } from "./memory-directory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

test("the header cells carry the column keys in the model order", () => {
  const keys = [...html.matchAll(/<th data-col="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(keys, COLUMNS.map((column) => column.key));
});

test("the model has 19 columns, locked core columns and a minimum preset that hides only unlocked ones", () => {
  assert.equal(COLUMNS.length, 19);
  assert.equal(new Set(COLUMNS.map((column) => column.key)).size, 19);
  for (const key of PRESET_HIDDEN.minimum) assert.equal(COLUMNS[columnIndex(key)].locked, undefined);
  for (const key of ["code", "date", "gross", "net", "vat"]) assert.equal(COLUMNS[columnIndex(key)].locked, true);
});

test("normaliseHidden drops unknown and locked keys and keeps column order; toggling is symmetric", () => {
  assert.deepEqual(normaliseHidden(["agent", "code", "nope", "supplierId", "agent"]), ["supplierId", "agent"]);
  assert.deepEqual(normaliseHidden("x"), []);
  assert.deepEqual(toggleHidden([], "agent"), ["agent"]);
  assert.deepEqual(toggleHidden(["agent"], "agent"), []);
  assert.deepEqual(toggleHidden(["agent"], "code"), ["agent"]);
});

test("column percents sum to 100, stubs keep their share and a saved weight wins", () => {
  const hidden = PRESET_HIDDEN.minimum;
  const percents = columnPercents(hidden, { stubPercent: 1.5 });
  assert.ok(Math.abs(percents.reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  for (const key of hidden) assert.equal(percents[columnIndex(key)], 1.5);
  const wider = columnPercents(hidden, { stubPercent: 1.5, weights: { details: 40 } });
  assert.ok(wider[columnIndex("details")] > percents[columnIndex("details")]);
  assert.ok(Math.abs(wider.reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  assert.deepEqual(weightsFromWidths(["agent"], COLUMNS.map((_, index) => (index === 14 ? 50 : 10))).agent, undefined);
  assert.equal(weightsFromWidths([], COLUMNS.map(() => 10)).code, 10);
});

test("stub css targets the right cells", () => {
  const css = stubCss(["supplierId"], "#t");
  assert.match(css, /#t th:nth-child\(6\), #t td:nth-child\(6\)/);
  assert.match(css, /content: "\+"/);
  assert.equal(stubCss([], "#t"), "");
});

test("ui settings: defaults, normalisation and a round trip through the data root", async () => {
  assert.deepEqual(normaliseUiSettings(null).hiddenColumns, PRESET_HIDDEN.minimum);
  assert.deepEqual(normaliseUiSettings({ hiddenColumns: [] }).hiddenColumns, []);
  assert.deepEqual(normaliseUiSettings({ hiddenColumns: ["agent", "code"] }).hiddenColumns, ["agent"]);
  const dataRoot = memoryDirectory("root");
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, DEFAULT_UI_SETTINGS.hiddenColumns);
  await saveUiSettings(dataRoot, { hiddenColumns: ["confidence", "bogus"] });
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, ["confidence"]);
  await saveUiSettings(dataRoot, { hiddenColumns: [] });
  assert.deepEqual((await readUiSettings(dataRoot)).hiddenColumns, []);
});

function journal() {
  const dom = new JSDOM(html.replace(/<script\b[^>]*><\/script>/g, ""), { url: "https://vitaliksh.github.io/ocr/" });
  const { document } = dom.window;
  const changes = [];
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const table = document.querySelector("#journal-table");
  const columns = setupJournalColumns({ table, menu: document.querySelector("#columns-menu"), storage, onChange: (hidden) => changes.push(hidden) });
  return { dom, document, table, columns, changes, store };
}

test("the journal starts with the minimum preset: stubs for hidden columns and a colgroup that adds up", () => {
  const { table, document } = journal();
  const cols = [...table.querySelectorAll("colgroup col")];
  assert.equal(cols.length, 19);
  assert.ok(Math.abs(cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0) - 100) < 0.01);
  assert.equal(table.tHead.rows[0].cells[columnIndex("agent")].classList.contains("col-stub"), true);
  assert.equal(table.tHead.rows[0].cells[columnIndex("details")].classList.contains("col-stub"), false);
  assert.match(document.querySelector("#journal-columns-style").textContent, /nth-child\(15\)/);
});

test("clicking a stub restores the column, the hide button hides it again, and each change is reported", () => {
  const { table, columns, changes } = journal();
  const header = (key) => table.tHead.rows[0].cells[columnIndex(key)];
  header("agent").click();
  assert.equal(columns.getHidden().includes("agent"), false);
  header("agent").querySelector(".col-hide").click();
  assert.equal(columns.getHidden().includes("agent"), true);
  assert.equal(changes.length, 2);
  assert.equal(header("code").querySelector(".col-hide"), null);
});

test("the chooser lists every column, disables locked ones and applies presets", () => {
  const { document, columns, changes } = journal();
  const options = [...document.querySelectorAll("#columns-menu .columns-option input")];
  assert.equal(options.length, 19);
  assert.equal(options.filter((box) => box.disabled).length, COLUMNS.filter((column) => column.locked).length);
  const box = [...document.querySelectorAll("#columns-menu .columns-option")].find((label) => label.textContent === "החלטת הסוכן").querySelector("input");
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new document.defaultView.Event("change"));
  assert.equal(columns.getHidden().includes("agent"), false);
  [...document.querySelectorAll("#columns-menu .columns-presets button")].find((button) => button.textContent === "הכול").click();
  assert.deepEqual(columns.getHidden(), []);
  assert.equal(options.every((item) => item.checked), true);
  [...document.querySelectorAll("#columns-menu .columns-presets button")].find((button) => button.textContent === "מינימום").click();
  assert.deepEqual(columns.getHidden(), PRESET_HIDDEN.minimum);
  assert.equal(changes.length, 3);
});

test("setHidden without persist applies silently (used when a data root is loaded)", () => {
  const { columns, changes } = journal();
  columns.setHidden([], { persist: false });
  assert.deepEqual(columns.getHidden(), []);
  assert.equal(changes.length, 0);
});
