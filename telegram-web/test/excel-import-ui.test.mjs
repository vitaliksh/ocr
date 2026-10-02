import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";
import { readChartOfAccounts } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { buildJournalGrid, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function xlsxFile(grid) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "journal.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}

// The UI module uses the browser globals document, window and Option, so bind them to a jsdom page first.
async function setup({ context = true, confirm = () => true } = {}) {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, window, Option: window.Option });
  window.confirm = confirm;
  const dialog = window.document.querySelector("#excel-import-dialog");
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  const calls = { errors: [], imported: [] };
  const { setupExcelImport } = await import("../excel-import-ui.js");
  setupExcelImport({
    button: window.document.querySelector("#import-excel"),
    dialog,
    getContext: () => (context ? { dataRoot, client, reserved: {} } : null),
    onImported: async (result, month) => { calls.imported.push({ result, month }); },
    onError: (message) => calls.errors.push(message),
    loadLibrary: async () => XLSX,
  });
  const pick = async (grid) => {
    const input = dialog.querySelector("#excel-import-file");
    Object.defineProperty(input, "files", { value: [xlsxFile(grid)], configurable: true });
    input.dispatchEvent(new window.Event("change"));
    for (let i = 0; i < 50 && dialog.querySelector("#excel-import-details").hidden; i += 1) await new Promise((r) => setTimeout(r, 10));
  };
  const q = (id) => dialog.querySelector(`#${id}`);
  return { window, dialog, dataRoot, client, calls, pick, q, open: () => window.document.querySelector("#import-excel").click() };
}

test("диалог импорта: без выбранного клиента показывает ошибку и не открывается", async () => {
  const { dialog, calls, open } = await setup({ context: false });
  open();
  assert.notEqual(dialog.open, true);
  assert.match(calls.errors[0], /תיקיית נתונים ולקוח/);
});

test("диалог импорта: файл разбирается, показывает итоги и месяц, импорт пишет декларацию", async () => {
  const { dialog, calls, pick, q, open, dataRoot, client } = await setup();
  open();
  assert.equal(dialog.open, true);
  await pick(buildJournalGrid({ month: 8 }));
  assert.match(q("excel-import-summary").textContent, new RegExp(`^${SAMPLE_ROWS.length} שורות`));
  assert.equal(q("excel-import-month").value, "2026-08");
  assert.equal(q("excel-import-run").disabled, false);
  q("excel-import-run").click();
  for (let i = 0; i < 100 && !calls.imported.length; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.imported[0].month, "2026-08");
  assert.equal(dialog.open, false);
  assert.equal((await loadDeclaration(client.directory, "2026-08")).draft.rows.length, SAMPLE_ROWS.length);
  assert.equal((await readChartOfAccounts(dataRoot))[203].name, "אחזקה");
});

test("диалог импорта: неизвестный класс получает предложенный код, ошибки файла блокируют импорт", async () => {
  const unknown = await setup();
  unknown.open();
  await unknown.pick(buildJournalGrid({ rows: SAMPLE_ROWS.map((row, i) => (i ? row : { ...row, cls: "ספרים" })) }));
  assert.equal(unknown.q("excel-import-unknown").hidden, false);
  assert.equal(unknown.q("excel-import-unknown-list").querySelector("input").value, "200");
  assert.equal(unknown.q("excel-import-run").disabled, false);
  const broken = await setup();
  broken.open();
  await broken.pick(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.equal(broken.q("excel-import-run").disabled, true);
  assert.match(broken.q("excel-import-problems").textContent, /שגיאה/);
});

test("диалог импорта: отказ от подтверждения закрытия сразу ничего не пишет", async () => {
  const { calls, pick, q, open, client } = await setup({ confirm: () => false });
  open();
  await pick(buildJournalGrid());
  q("excel-import-close").checked = true;
  q("excel-import-run").click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.imported.length, 0);
  assert.equal(client.directory.children.size, 0);
});

test("диалог импорта: предупреждения и ошибки показываются по-ивритски", async () => {
  const { pick, q, open } = await setup();
  open();
  await pick(buildJournalGrid());
  assert.match(q("excel-import-problems").textContent, /ל-8 שורות סטטוס «טיוטא»/);
  assert.doesNotMatch(q("excel-import-problems").textContent, /rows have/);
  const broken = await setup();
  broken.open();
  await broken.pick(buildJournalGrid({ footer: { totalVat: "1.00" } }));
  assert.match(broken.q("excel-import-problems").textContent, /אינו תואם לשורות/);
});
