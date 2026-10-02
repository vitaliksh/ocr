// Pure parser for the Rivhit journal grid; the layout is described in docs/EXCEL_IMPORT_SPEC.md.
const COL = { status: 0, vat: 1, net: 3, gross: 4, ref2: 5, ref1: 6, details: 8, cls: 11, line: 12, date: 13 };
const INCOME_CLASS = "הכנסות";
export const DEFAULT_CLASS_TYPES = {
  income: [INCOME_CLASS],
  equipment: ["רכישת ציוד/רכוש קבוע"],
  outsideVatBase: ["ביטוח עסק", "ארנונה"],
};
const MONEY_TEXT = /^\(?[\d,]+(?:\.\d+)?\)?$/;
const TOLERANCE = 0.011;

const round2 = (value) => Math.round(value * 100) / 100;
const clean = (cell) => String(cell ?? "").replace(/[‎‏ ]/g, " ").trim();

function parseMoney(cell) {
  const text = clean(cell);
  if (!MONEY_TEXT.test(text)) return null;
  const value = Number(text.replace(/[(),]/g, ""));
  return round2(text.startsWith("(") ? -value : value);
}

function parseDate(cell) {
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000).toISOString().slice(0, 10);
  }
  const text = clean(cell);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseDeclarationMonth(rows, headerIndex) {
  for (const cells of rows.slice(0, headerIndex)) {
    for (const cell of cells) {
      const match = clean(cell).match(/^לחודש\s+(\d{1,2})\/(\d{4})$/);
      if (match) return { month: Number(match[1]), year: Number(match[2]) };
    }
  }
  return null;
}

function parseFooter(rows, from) {
  const footer = {};
  const labels = [
    [/^סיכום אריטמטי ללא מע"מ לביקורת$/, "arithmeticNet"],
    [/^סיכום אריטמטי כולל מע"מ לביקורת$/, "arithmeticGross"],
    [/^ת\.ציוד כולל$/, "equipmentGross"],
    [/^תשומות כולל$/, "inputsGross"],
    [/^עסקאות כולל$/, "outputsGross"],
    [/^מע"מ ת\.ציוד$/, "equipmentVat"],
    [/^מע"מ תשומות$/, "inputsVat"],
    [/^מע"מ עסקאות$/, "outputsVat"],
  ];
  for (const cells of rows.slice(from)) {
    cells.forEach((cell, col) => {
      const text = clean(cell).replace(/''/g, '"');
      if (text === ':סה"כ מע"מ לחודש') footer.totalVat = parseMoney(cells[col - 3]);
      const match = text.match(/^(.+?)\s*:\s*([\d,.()]+)$/);
      const entry = match && labels.find(([pattern]) => pattern.test(match[1].replace(/\s+/g, " ")));
      if (entry) footer[entry[1]] = parseMoney(match[2]);
    });
  }
  return footer;
}

function parseRow(cells, rowNumber, errors) {
  const fail = (code, message) => errors.push({ code, message, row: rowNumber });
  const [vat, net, gross] = [COL.vat, COL.net, COL.gross].map((col) => parseMoney(cells[col]));
  const date = parseDate(cells[COL.date]);
  const classificationName = clean(cells[COL.cls]);
  if ([vat, net, gross].includes(null)) fail("bad-money", "VAT, net or gross is not a number");
  else if (Math.abs(Math.abs(net) + Math.abs(vat) - Math.abs(gross)) > TOLERANCE) {
    fail("amount-mismatch", "net plus VAT does not equal gross");
  }
  if (!date) fail("bad-date", "document date is missing or not a date");
  if (!classificationName) fail("no-classification", "classification name is empty");
  const kind = classificationName === INCOME_CLASS ? "income" : net < 0 || gross < 0 ? "credit" : "expense";
  return {
    status: clean(cells[COL.status]),
    vat,
    net,
    gross,
    reference1: clean(cells[COL.ref1]),
    reference2: clean(cells[COL.ref2]),
    details: clean(cells[COL.details]),
    classificationName,
    line: clean(cells[COL.line]),
    date,
    kind,
    sourceRow: rowNumber,
  };
}

function sumBy(rows, field, sign = 1) {
  return round2(rows.reduce((total, row) => total + sign * row[field], 0));
}

function checkFooter(rows, footer, classTypes, errors) {
  const group = (names) => rows.filter((row) => names.includes(row.classificationName));
  const equipment = group(classTypes.equipment);
  const outputs = rows.filter((row) => row.kind === "income" || classTypes.income.includes(row.classificationName));
  const inputs = rows.filter(
    (row) => !outputs.includes(row) && !equipment.includes(row) && !classTypes.outsideVatBase.includes(row.classificationName),
  );
  // Expense VAT is negative in the file while the footer shows it as a positive magnitude.
  const expected = {
    totalVat: sumBy(rows, "vat"),
    arithmeticNet: sumBy(rows, "net"),
    arithmeticGross: sumBy(rows, "gross"),
    outputsGross: sumBy(outputs, "gross"),
    outputsVat: sumBy(outputs, "vat"),
    equipmentGross: sumBy(equipment, "gross"),
    equipmentVat: sumBy(equipment, "vat", -1),
    inputsGross: sumBy(inputs, "gross"),
    inputsVat: sumBy(inputs, "vat", -1),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (footer[key] == null) errors.push({ code: "footer-missing", message: `footer value ${key} not found`, key });
    else if (Math.abs(footer[key] - value) > TOLERANCE) {
      errors.push({ code: "footer-mismatch", message: `footer ${key} ${footer[key]} differs from rows ${value}`, key });
    }
  }
  const balance = round2(footer.outputsVat - footer.inputsVat - footer.equipmentVat);
  if (footer.totalVat != null && Math.abs(footer.totalVat - balance) > TOLERANCE) {
    errors.push({ code: "footer-mismatch", message: `total VAT ${footer.totalVat} differs from ${balance}`, key: "balance" });
  }
}

// `rows` is a 0-based grid of cells; dates may be Excel serial numbers or ISO strings.
export function parseJournalGrid(rows, { classTypes = DEFAULT_CLASS_TYPES } = {}) {
  const errors = [];
  const warnings = [];
  const headerIndex = rows.findIndex((cells) => clean(cells[COL.status]) === "סטטוס");
  if (headerIndex < 0) {
    errors.push({ code: "no-header", message: "journal header row (סטטוס) not found" });
    return { declarationMonth: null, rows: [], footer: {}, errors, warnings };
  }
  const parsed = [];
  let last = headerIndex;
  rows.forEach((cells, index) => {
    if (index <= headerIndex || clean(cells[COL.date]) === "") return;
    parsed.push(parseRow(cells, index + 1, errors));
    last = index;
  });
  if (!parsed.length) errors.push({ code: "no-rows", message: "no transaction rows found" });
  const footer = parseFooter(rows, last + 1);
  if (parsed.length && !errors.some((error) => error.row)) checkFooter(parsed, footer, classTypes, errors);
  const declarationMonth = parseDeclarationMonth(rows, headerIndex);
  if (!declarationMonth) warnings.push({ code: "no-month", message: "declaration month not found in the header" });
  const drafts = parsed.filter((row) => row.status === "טיוטא").length;
  if (drafts) warnings.push({ code: "draft-rows", message: `${drafts} rows have draft status (not final in the source)`, count: drafts });
  const others = parsed.filter((row) => row.status !== "טיוטא").length;
  if (others) warnings.push({ code: "other-status", message: `${others} rows have a status other than draft`, count: others });
  return { declarationMonth, rows: parsed, footer, errors, warnings };
}
