import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { readChartOfAccounts } from "../chart-of-accounts.js";
import { loadDeclaration } from "../declaration-store.js";
import { commitImport, prepareImport } from "../excel-import-flow.js";
import { buildJournalGrid, SAMPLE_ROWS } from "./excel-journal-fixture.mjs";
import { memoryDirectory } from "./memory-directory.mjs";

const loadLibrary = async () => XLSX;
const now = "2026-10-02T10:00:00.000Z";

function xlsxFile(grid) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), "גיליון2");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return { name: "journal.xlsx", size: bytes.byteLength, arrayBuffer: async () => bytes };
}

function setup() {
  const dataRoot = memoryDirectory("root");
  const client = { directory: memoryDirectory("client"), config: { clientId: "c1" } };
  return { dataRoot, client };
}

test("мастер импорта: подготовка даёт строки, итоги, месяц и предложение начального плана", async () => {
  const { dataRoot } = setup();
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ month: 8 })), { dataRoot, loadLibrary });
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.rows.length, SAMPLE_ROWS.length);
  assert.equal(prepared.suggestedMonth, "2026-08");
  assert.equal(prepared.chartIsNew, true);
  assert.deepEqual(prepared.unknown, []);
  assert.deepEqual(prepared.totals, { net: 13520.5, vat: 1280.31, gross: 15840.19 });
});

test("мастер импорта: неизвестное имя класса требует счёта, импорт без него отвергается", async () => {
  const { dataRoot, client } = setup();
  const rows = SAMPLE_ROWS.map((row, i) => (i === 0 ? { ...row, cls: "ספרים" } : row));
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ rows })), { dataRoot, loadLibrary });
  assert.deepEqual(prepared.unknown, ["ספרים"]);
  const options = { month: "2026-01", closeNow: false, dataRoot, client, now };
  await assert.rejects(commitImport(prepared, options), /חסר קוד מיון/);
  assert.equal(await readChartOfAccounts(dataRoot), null);
  const result = await commitImport(prepared, { ...options, newAccounts: [{ name: "ספרים", code: "240", type: "expense" }] });
  assert.equal(result.rowCount, SAMPLE_ROWS.length);
  assert.equal((await readChartOfAccounts(dataRoot))[240].name, "ספרים");
  assert.equal((await loadDeclaration(client.directory, "2026-01")).draft.rows[0].values[1], "240");
});

test("мастер импорта: файл с ошибками не импортируется, ничего не записывается", async () => {
  const { dataRoot, client } = setup();
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ footer: { totalVat: "1.00" } })), { dataRoot, loadLibrary });
  assert.ok(prepared.errors.length);
  await assert.rejects(commitImport(prepared, { month: "2026-01", dataRoot, client, now }), /שגיאות/);
  assert.equal(await readChartOfAccounts(dataRoot), null);
  assert.equal(client.directory.children.size, 0);
});

test("мастер импорта: существующий план корня используется вместо начального, закрытие сразу", async () => {
  const { dataRoot, client } = setup();
  const first = await prepareImport(xlsxFile(buildJournalGrid()), { dataRoot, loadLibrary });
  await commitImport(first, { month: "2026-01", closeNow: true, dataRoot, client, now });
  const second = await prepareImport(xlsxFile(buildJournalGrid()), { dataRoot, loadLibrary });
  assert.equal(second.chartIsNew, false);
  const loaded = await loadDeclaration(client.directory, "2026-01");
  assert.equal(loaded.declaration.status, "closed");
});

test("мастер импорта: зарезервированный код нового счёта отвергается", async () => {
  const { dataRoot, client } = setup();
  const rows = SAMPLE_ROWS.map((row, i) => (i === 0 ? { ...row, cls: "ספרים" } : row));
  const prepared = await prepareImport(xlsxFile(buildJournalGrid({ rows })), { dataRoot, loadLibrary });
  const newAccounts = [{ name: "ספרים", code: "812", type: "expense" }];
  await assert.rejects(
    commitImport(prepared, { newAccounts, month: "2026-01", dataRoot, client, reserved: { 812: "x" }, now }),
    /אינם תקינים/,
  );
});
