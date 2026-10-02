// Steps of the Excel import wizard without any DOM: prepare (read + parse + match) and commit (write).
import {
  SEED_CHART_OF_ACCOUNTS,
  addAccount,
  classTypesFromChart,
  matchClassNames,
  normaliseChart,
  readChartOfAccounts,
  saveChartOfAccounts,
} from "./chart-of-accounts.js";
import { buildImportedRows, importWarnings } from "./excel-import.js";
import { importRowsIntoDeclaration } from "./excel-import-store.js";
import { parseJournalGrid } from "./excel-journal.js";
import { readJournalGrid } from "./excel-journal-reader.js";

const round2 = (value) => Math.round(value * 100) / 100;

// `reserved` holds codes the chart must not use (built-in and custom Rivhit codes).
export async function prepareImport(file, { dataRoot, reserved = {}, loadLibrary } = {}) {
  const existing = await readChartOfAccounts(dataRoot, reserved);
  const chart = existing ?? normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS }, reserved);
  const parsed = parseJournalGrid(await readJournalGrid(file, { loadLibrary }), { classTypes: classTypesFromChart(chart) });
  const { codes, unknown } = matchClassNames(parsed.rows.map((row) => row.classificationName), chart);
  const sum = (field) => round2(parsed.rows.reduce((total, row) => total + row[field], 0));
  const { month, year } = parsed.declarationMonth ?? {};
  return {
    chart,
    chartIsNew: existing === null,
    codes,
    unknown,
    rows: parsed.rows,
    errors: parsed.errors,
    warnings: [...parsed.warnings, ...importWarnings(parsed.rows)],
    suggestedMonth: month ? `${year}-${String(month).padStart(2, "0")}` : "",
    totals: { net: sum("net"), vat: sum("vat"), gross: sum("gross") },
  };
}

// `newAccounts` is [{ name, code, type }] for every name in prepared.unknown. The chart is saved first:
// imported rows refer to its codes, and an extended chart is harmless if the import then fails.
export async function commitImport(prepared, { newAccounts = [], month, closeNow, dataRoot, client, reserved = {}, now }) {
  if (prepared.errors.length) throw new Error("בקובץ יש שגיאות. לא ניתן לייבא.");
  let chart = prepared.chart;
  for (const account of newAccounts) chart = addAccount(chart, account, reserved);
  const { codes, unknown } = matchClassNames(prepared.rows.map((row) => row.classificationName), chart);
  if (unknown.length) throw new Error(`חסר קוד מיון עבור: ${unknown.join(", ")}`);
  const rows = buildImportedRows(prepared.rows, codes, { now });
  chart = await saveChartOfAccounts(dataRoot, chart, reserved);
  const declaration = await importRowsIntoDeclaration({
    clientDirectory: client.directory,
    clientId: client.config.clientId,
    month,
    rows,
    closeNow,
    now,
  });
  return { declaration, chart, rowCount: rows.length };
}
