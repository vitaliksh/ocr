export const DECLARATION_SCHEMA_VERSION = 1;
export const DRAFT_TABLE_SCHEMA_VERSION = 1;

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function error(message) { return { valid: false, error: message }; }
function text(value) { return String(value ?? "").trim(); }
function validTimestamp(value) { return isoDatePattern.test(value) && !Number.isNaN(Date.parse(value)); }

export function declarationMonth(value) {
  if (typeof value === "string" && monthPattern.test(value)) return value;
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function createOpenDeclaration({ clientId, month = declarationMonth(new Date()), declarationId = crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  const result = normalizeDeclaration({ schemaVersion: DECLARATION_SCHEMA_VERSION, declarationId, clientId, month, status: "open", createdAt: now, updatedAt: now, closedAt: null, finalExport: null, historyAppendedAt: null });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}

export function normalizeDeclaration(value) {
  if (!value || typeof value !== "object") return error("קובץ ההצהרה אינו תקין.");
  const declarationId = text(value.declarationId), clientId = text(value.clientId), month = text(value.month), status = text(value.status), createdAt = text(value.createdAt), updatedAt = text(value.updatedAt);
  if (!declarationId || !clientId || !declarationMonth(month) || !["open", "closed"].includes(status) || !validTimestamp(createdAt) || !validTimestamp(updatedAt)) return error("בקובץ ההצהרה חסרים נתונים או שיש בו ערכים לא חוקיים.");
  const closedAt = value.closedAt === null || value.closedAt === undefined || value.closedAt === "" ? null : text(value.closedAt);
  const finalExport = value.finalExport === null || value.finalExport === undefined || value.finalExport === "" ? null : text(value.finalExport);
  const historyAppendedAt = value.historyAppendedAt === null || value.historyAppendedAt === undefined || value.historyAppendedAt === "" ? null : text(value.historyAppendedAt);
  if (closedAt !== null && !validTimestamp(closedAt)) return error("תאריך סגירת ההצהרה אינו תקין.");
  if (historyAppendedAt !== null && !validTimestamp(historyAppendedAt)) return error("תאריך כתיבת ההיסטוריה אינו תקין.");
  if (status === "open" && (closedAt || finalExport || historyAppendedAt)) return error("להצהרה פתוחה אסור להכיל נתוני סגירה.");
  if (status === "closed" && (!closedAt || !finalExport || !historyAppendedAt)) return error("להצהרה סגורה חסרים נתוני סגירה.");
  return { valid: true, declaration: { schemaVersion: DECLARATION_SCHEMA_VERSION, declarationId, clientId, month, status, createdAt, updatedAt, closedAt, finalExport, historyAppendedAt } };
}

export function normalizeDraftTable(value, declarationId) {
  if (!value || typeof value !== "object") return error("קובץ טיוטת הטבלה אינו תקין.");
  const savedDeclarationId = text(value.declarationId), savedAt = text(value.savedAt);
  if (!savedDeclarationId || savedDeclarationId !== text(declarationId) || !validTimestamp(savedAt) || !Array.isArray(value.rows)) return error("טיוטת הטבלה אינה תואמת להצהרה או שאינה תקינה.");
  return { valid: true, draft: { schemaVersion: DRAFT_TABLE_SCHEMA_VERSION, declarationId: savedDeclarationId, savedAt, rows: value.rows } };
}

export function createDraftTable({ declarationId, rows = [], now = new Date().toISOString() } = {}) {
  const result = normalizeDraftTable({ schemaVersion: DRAFT_TABLE_SCHEMA_VERSION, declarationId, savedAt: now, rows }, declarationId);
  if (!result.valid) throw new Error(result.error);
  return result.draft;
}

export function closeDeclaration(declaration, { finalExport, now = new Date().toISOString() } = {}) {
  const current = normalizeDeclaration(declaration);
  if (!current.valid) throw new Error(current.error);
  if (current.declaration.status !== "open") throw new Error("אפשר לסגור רק הצהרה פתוחה.");
  const result = normalizeDeclaration({ ...current.declaration, status: "closed", updatedAt: now, closedAt: now, finalExport, historyAppendedAt: now });
  if (!result.valid) throw new Error(result.error);
  return result.declaration;
}
