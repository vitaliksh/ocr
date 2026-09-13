import { RIVHIT_COLUMN_COUNT, firstNonEmptyLine } from "./workspace-core.js";

function clean(value) { return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim(); }
function digits(value) { return String(value ?? "").replace(/\D/g, ""); }
function money(value) { const amount = Number(value); if (!Number.isFinite(amount)) throw new Error("סכום אינו תקין."); return amount.toFixed(2); }
function dateParts(value, tableRow) {
  const input = clean(value), iso = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/), local = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/), match = iso ? [null, iso[1], iso[2], iso[3]] : local ? [null, local[3].length === 2 ? `20${local[3]}` : local[3], local[2], local[1]] : null;
  if (!match) throw new Error(`תאריך המסמך בשורה ${tableRow} אינו תקין.`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error(`תאריך המסמך בשורה ${tableRow} אינו תקין.`);
  return { year: String(year), month: String(month), display: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).slice(-2)}` };
}
function cp1255(text) {
  const output = [];
  for (const character of text) { const code = character.codePointAt(0); if (code === 9 || code === 10 || code === 13) output.push(code); else if (code >= 32 && code <= 126) output.push(code); else if (code >= 0x05d0 && code <= 0x05ea) output.push(0xe0 + code - 0x05d0); else if (code === 0x20aa) output.push(0xa4); else throw new Error(`הטקסט אינו ניתן לקידוד Windows-1255: ${character}`); }
  return new Uint8Array(output);
}
function emptyRivhitColumns() { return Array(RIVHIT_COLUMN_COUNT).fill("0"); }
function assertNoNegativeNumbers(columns, tableRow) {
  if (columns.some((value) => /^-\d+(?:\.\d+)?$/.test(clean(value)))) throw new Error(`בשורה ${tableRow} קיים מספר שלילי; לא נוצר קובץ TXT.`);
}
function validateTemplate(templateText) {
  const template = firstNonEmptyLine(templateText);
  if (!template || template.split("\t").length !== RIVHIT_COLUMN_COUNT) throw new Error("תבנית Rivhit אינה כוללת 186 עמודות.");
}
function buildColumns(row, index, mapping) {
  const tableRow = Number(row.tableRow) || index + 1;
  const values = row.values || [], code = clean(values[1]); if (!/^\d{3}$/.test(code) || !mapping?.[code]) throw new Error(`קוד המיון בשורה ${tableRow} אינו מאושר.`);
  const date = dateParts(values[0], tableRow), net = money(values[8] || row.rawNet), vat = money(values[9] || row.rawVat), gross = money(values[7] || Number(net) + Number(vat));
  if (Math.abs(Number(gross) - Number(net) - Number(vat)) > 0.009) throw new Error(`סכומי מע״מ בשורה ${tableRow} אינם תואמים.`);
  const columns = emptyRivhitColumns();
  columns[0] = columns[184] = date.year; columns[1] = columns[185] = date.month; columns[2] = String(index + 1); columns[3] = columns[134] = code;
  columns[6] = columns[163] = gross; columns[7] = columns[8] = date.display; columns[9] = clean(values[2]); columns[10] = digits(values[5]).slice(-4); columns[11] = digits(values[6]); columns[135] = clean(mapping[code]); columns[137] = money(values[11] || 100); columns[154] = net; columns[155] = vat; columns[157] = "0"; columns[177] = digits(values[4]) || "0";
  if (columns.length !== RIVHIT_COLUMN_COUNT) throw new Error("שגיאה במספר עמודות Rivhit.");
  assertNoNegativeNumbers(columns, tableRow);
  cp1255(columns.join("\t"));
  return columns;
}

export function validateRivhitImport({ templateText, rows, mapping }) {
  try { validateTemplate(templateText); } catch (error) { return [{ tableRow: null, message: error.message }]; }
  const activeRows = rows.filter((item) => item.active);
  if (!activeRows.length) return [{ tableRow: null, message: "יש לסמן לפחות שורה פעילה לייצוא." }];
  return activeRows.flatMap((row, index) => { try { buildColumns(row, index, mapping); return []; } catch (error) { return [{ tableRow: Number(row.tableRow) || index + 1, message: error.message }]; } });
}

export function buildRivhitImport({ templateText, rows, mapping }) {
  const issues = validateRivhitImport({ templateText, rows, mapping });
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join("\n"));
  const output = [];
  for (const [index, row] of rows.filter((item) => item.active).entries()) {
    const columns = buildColumns(row, index, mapping);
    output.push(columns.join("\t"));
  }
  if (!output.length) throw new Error("יש לסמן לפחות שורה פעילה לייצוא.");
  return cp1255(output.join("\r\n") + "\r\n");
}

export function draftExportManifest({ declaration, client, createdAt, rows, kind = "draft-export" }) {
  return { schemaVersion: 1, kind, createdAt: createdAt.toISOString(), declaration: { declarationId: declaration.declarationId, month: declaration.month, status: declaration.status }, client: { clientId: client.clientId, clientName: client.clientName }, rows: rows.filter((row) => row.active).map((row) => ({ documentId: row.documentId, imageFile: row.imageFile, values: row.values, rawNet: row.rawNet, rawVat: row.rawVat })) };
}
