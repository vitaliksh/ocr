export const RIVHIT_COLUMN_COUNT = 186;

export function firstNonEmptyLine(text) {
  return String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim() !== "") ?? null;
}

export function validateRivhitTemplateText(text) {
  const line = firstNonEmptyLine(text);
  if (line === null) return { valid: false, error: "התבנית ריקה." };
  const columns = line.split("\t").length;
  if (columns !== RIVHIT_COLUMN_COUNT) return { valid: false, error: `בשורה הלא-ריקה הראשונה יש ${columns} עמודות; נדרשות ${RIVHIT_COLUMN_COUNT}.`, columns };
  return { valid: true, columns };
}

// How often the client files its VAT return and its advances: every month or every two months.
export const REPORT_PERIODS = ["monthly", "bimonthly"];

export function normalizeWorkspaceConfig(value) {
  if (!value || typeof value !== "object") return { valid: false, error: "קובץ הגדרות הלקוח אינו תקין." };
  const clientName = String(value.clientName ?? "").trim();
  const businessActivity = String(value.businessActivity ?? "").trim();
  const businessKind = String(value.businessKind ?? "").trim();
  if (!clientName || !businessActivity || !["home", "office"].includes(businessKind)) return { valid: false, error: "בקובץ הגדרות הלקוח חסרים נתונים או שיש בו ערכים לא חוקיים." };
  const periods = Object.fromEntries(["vatPeriod", "advancesPeriod"].filter((key) => REPORT_PERIODS.includes(value[key])).map((key) => [key, value[key]]));
  return { valid: true, config: { schemaVersion: 1, clientId: String(value.clientId ?? ""), clientName, businessActivity, businessKind, archived: Boolean(value.archived), ...periods } };
}
