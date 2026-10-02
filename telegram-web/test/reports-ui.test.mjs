import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart, saveChartOfAccounts } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { readReportSettings } from "../report-data.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const now = "2026-10-02T10:00:00.000Z";

async function setup({ declarations = ["2026-01", "2026-02"], context = true } = {}) {
  const { window } = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#reports-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1", clientName: "Test Client" } };
  const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
  await saveChartOfAccounts(dataRoot, accounts);
  const parsed = parseJournalGrid(buildJournalGrid()).rows;
  const rows = buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
  for (const month of declarations) await importRowsIntoDeclaration({ clientDirectory: client.directory, clientId: "c1", month, rows, now });
  const errors = [];
  let printed = 0;
  window.print = () => { printed += 1; };
  const { setupReports } = await import("../reports-ui.js");
  setupReports({
    button: window.document.querySelector("#open-reports"),
    dialog,
    printRoot: window.document.querySelector("#report-print"),
    getContext: () => (context ? { client, dataRoot, names: {} } : null),
    onError: (message) => errors.push(message),
  });
  const q = (id) => dialog.querySelector(`#${id}`);
  const open = async () => { window.document.querySelector("#open-reports").click(); await new Promise((r) => setTimeout(r, 80)); };
  const click = async (id) => { q(id).click(); await new Promise((r) => setTimeout(r, 80)); };
  return { window, dialog, client, errors, q, open, click, printed: () => printed, printRoot: window.document.querySelector("#report-print") };
}

test("диалог отчётов: без клиента показывает ошибку", async () => {
  const { dialog, errors, open } = await setup({ context: false });
  await open();
  assert.notEqual(dialog.open, true);
  assert.match(errors[0], /לקוח/);
});

test("диалог отчётов: период по умолчанию — месяц последней декларации или с начала года", async () => {
  const { q, open } = await setup();
  await open();
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["2026-02", "2026-02"]);
  q("reports-vat-period").value = "bimonthly";
  q("reports-vat-period").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["2026-01", "2026-02"]);
  q("reports-kind").value = "profitLoss";
  q("reports-kind").dispatchEvent(new globalThis.window.Event("change"));
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["2026-01", "2026-02"]);
});

test("диалог отчётов: пустая последняя декларация не скрывает период с данными", async () => {
  const { q, open, click, client } = await setup({ declarations: ["2026-01"] });
  const { createDeclaration } = await import("../declaration-store.js");
  await createDeclaration(client.directory, { clientId: "c1", month: "2026-10" });
  await open();
  assert.deepEqual([q("reports-from").value, q("reports-to").value], ["2026-01", "2026-01"]);
  q("reports-from").value = "2026-10";
  q("reports-to").value = "2026-10";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /אין תנועות/);
});

test("диалог отчётов: показ отчёта НДС за два месяца, настройки сохраняются, печать копирует отчёт", async () => {
  const { q, open, click, client, printRoot, printed } = await setup();
  await open();
  q("reports-vat-period").value = "bimonthly";
  q("reports-vat-period").dispatchEvent(new globalThis.window.Event("change"));
  q("reports-advance-percent").value = "12";
  await click("reports-show");
  assert.equal(q("reports-error").textContent, "");
  assert.match(q("reports-preview").textContent, /דוח מס ערך מוסף/);
  assert.match(q("reports-preview").textContent, /20,000/);
  assert.deepEqual(await readReportSettings(client.directory), { vatPeriod: "bimonthly", advancePercent: 12 });
  await click("reports-print");
  assert.equal(printed(), 1);
  assert.match(printRoot.textContent, /דוח מס ערך מוסף/);
});

test("диалог отчётов: авансы требуют процент, неверный период отклоняется, печать без отчёта", async () => {
  const { q, open, click, printed } = await setup();
  await open();
  q("reports-kind").value = "advances";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /אחוז מקדמות/);
  q("reports-from").value = "2026-03";
  q("reports-to").value = "2026-01";
  await click("reports-show");
  assert.match(q("reports-error").textContent, /תקופה תקינה/);
  await click("reports-print");
  assert.equal(printed(), 0);
  assert.match(q("reports-error").textContent, /להציג דוח/);
});

test("диалог отчётов: все четыре вида отчётов строятся", async () => {
  const { q, open, click } = await setup();
  await open();
  q("reports-advance-percent").value = "12";
  for (const [kind, title] of [["advances", "דוח מקדמות"], ["profitLoss", "דוח רווח והפסד"], ["ledger", "כרטסת קודי מיון"]]) {
    q("reports-kind").value = kind;
    q("reports-from").value = "2026-01";
    q("reports-to").value = "2026-02";
    await click("reports-show");
    assert.match(q("reports-preview").textContent, new RegExp(title));
  }
});
