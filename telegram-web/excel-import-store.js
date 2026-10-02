// Writes imported draft rows into a declaration; never merges into a declaration that already has rows.
import { IMPORT_FINAL_EXPORT } from "./excel-import.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft } from "./declaration-store.js";

async function openTarget(clientDirectory, clientId, month) {
  let loaded;
  try {
    loaded = await loadDeclaration(clientDirectory, month);
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    return createDeclaration(clientDirectory, { clientId, month });
  }
  if (loaded.declaration.status !== "open") throw new Error("ההצהרה לחודש זה סגורה. לא ניתן לייבא אליה.");
  if (loaded.draft.rows.length) throw new Error("ההצהרה לחודש זה כבר מכילה שורות. לא ניתן לייבא אליה.");
  return loaded;
}

// `rows` come from buildImportedRows. With closeNow the declaration is closed without an export folder.
export async function importRowsIntoDeclaration({ clientDirectory, clientId, month, rows, closeNow = false, now }) {
  if (!rows.length) throw new Error("אין שורות לייבוא.");
  const { directory, declaration } = await openTarget(clientDirectory, clientId, month);
  await saveDraft(directory, declaration, rows, now);
  if (!closeNow) return declaration;
  return finalizeDeclaration({
    clientDirectory,
    declarationDirectory: directory,
    declaration,
    finalExport: IMPORT_FINAL_EXPORT,
    rows,
    now,
  });
}
