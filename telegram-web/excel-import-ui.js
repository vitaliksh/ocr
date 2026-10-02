// Dialog for the one-time Excel migration. All logic lives in excel-import-flow.js; this file only renders.
import { ACCOUNT_TYPES } from "./chart-of-accounts.js";
import { commitImport, prepareImport } from "./excel-import-flow.js";

const TYPE_LABELS = {
  income: "הכנסה",
  expense: "הוצאה",
  outsideVatBase: "הוצאה מחוץ לבסיס מע״מ",
  equipment: "ציוד",
};
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Hebrew texts for the parser's English diagnostics; unknown codes fall back to the original message.
const PROBLEM_TEXTS = {
  "draft-rows": (item) => `ל-${item.count} שורות סטטוס «טיוטא» במקור (לא סופי ב-Rivhit)`,
  "other-status": (item) => `ל-${item.count} שורות סטטוס שונה מ«טיוטא»`,
  "no-month": () => "חודש ההצהרה לא נמצא בכותרת הקובץ",
  "reference2-dropped": (item) => `ל-${item.count} שורות יש אסמכתא 2, והיא לא מיובאת`,
  "no-header": () => "לא נמצאה שורת הכותרת של היומן (סטטוס)",
  "no-rows": () => "לא נמצאו שורות תנועה",
  "bad-money": () => "סכום מע״מ, נטו או ברוטו אינו מספר",
  "amount-mismatch": () => "נטו + מע״מ אינם שווים לברוטו",
  "bad-date": () => "תאריך המסמך חסר או אינו תקין",
  "no-classification": () => "שם קוד המיון ריק",
  "footer-missing": (item) => `ערך ${item.key} לא נמצא בסוף הקובץ`,
  "footer-mismatch": (item) => `סכום ${item.key} בסוף הקובץ אינו תואם לשורות`,
};
export const problemText = (item) => PROBLEM_TEXTS[item.code]?.(item) ?? item.message;

// First free three-digit code from 200 up, skipping codes already used or reserved.
export function suggestCode(used) {
  for (let code = 200; code <= 999; code += 1) if (!used[String(code)]) return String(code);
  return "";
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// getContext() returns { dataRoot, client, reserved } or null when no data root or client is selected.
export function setupExcelImport({ button, dialog, getContext, onImported, onError, loadLibrary }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [file, details, summary, problems, month, unknownBox, unknownList, closeNow, errorLine, run] = [
    "excel-import-file", "excel-import-details", "excel-import-summary", "excel-import-problems", "excel-import-month",
    "excel-import-unknown", "excel-import-unknown-list", "excel-import-close", "excel-import-error", "excel-import-run",
  ].map(part);
  let prepared = null;
  let context = null;

  const reset = () => {
    prepared = null;
    file.value = "";
    details.hidden = true;
    errorLine.textContent = "";
    run.disabled = true;
    closeNow.checked = false;
  };
  const unknownInputs = () => [...unknownList.querySelectorAll("[data-name]")].map((row) => ({
    name: row.dataset.name,
    code: row.querySelector("input").value.trim(),
    type: row.querySelector("select").value,
  }));

  const render = () => {
    const { rows, errors, warnings, totals, unknown, chart } = prepared;
    summary.textContent = `${rows.length} שורות · נטו ${money(totals.net)} · מע״מ נטו ${money(totals.vat)} · ברוטו ${money(totals.gross)}`;
    problems.replaceChildren(
      ...errors.map((item) => element("li", `שגיאה${item.row ? ` בשורה ${item.row}` : ""}: ${problemText(item)}`, "problem-error")),
      ...warnings.map((item) => element("li", `אזהרה: ${problemText(item)}`)),
    );
    month.value = prepared.suggestedMonth;
    unknownBox.hidden = !unknown.length;
    const used = { ...context.reserved, ...chart };
    unknownList.replaceChildren(...unknown.map((name) => {
      const row = element("div", undefined, "unknown-account");
      row.dataset.name = name;
      const code = element("input");
      code.value = suggestCode(used);
      used[code.value] = true;
      code.maxLength = 3;
      code.setAttribute("aria-label", `קוד עבור ${name}`);
      const type = element("select");
      for (const value of ACCOUNT_TYPES) type.add(new Option(TYPE_LABELS[value], value));
      type.value = "expense";
      row.append(element("strong", name), code, type);
      return row;
    }));
    details.hidden = false;
    run.disabled = Boolean(errors.length || !rows.length);
  };

  button.addEventListener("click", () => {
    context = getContext();
    if (!context) return onError("יש לבחור תחילה תיקיית נתונים ולקוח לפני ייבוא מ-Excel.");
    reset();
    dialog.showModal();
  });

  file.addEventListener("change", async () => {
    errorLine.textContent = "";
    details.hidden = true;
    run.disabled = true;
    if (!file.files?.length) return;
    try {
      prepared = await prepareImport(file.files[0], { dataRoot: context.dataRoot, reserved: context.reserved, loadLibrary });
      render();
    } catch (error) {
      prepared = null;
      errorLine.textContent = error.message;
    }
  });

  run.addEventListener("click", async () => {
    if (!prepared || !/^\d{4}-\d{2}$/.test(month.value)) {
      errorLine.textContent = "יש לבחור חודש הצהרה.";
      return;
    }
    if (closeNow.checked && !window.confirm("לסגור את ההצהרה מיד אחרי הייבוא? לא ייווצר ייצוא PDF/TXT.")) return;
    run.disabled = true;
    errorLine.textContent = "";
    try {
      const result = await commitImport(prepared, {
        newAccounts: unknownInputs(),
        month: month.value,
        closeNow: closeNow.checked,
        dataRoot: context.dataRoot,
        client: context.client,
        reserved: context.reserved,
      });
      dialog.close();
      await onImported(result, month.value);
    } catch (error) {
      errorLine.textContent = error.message;
      run.disabled = false;
    }
  });
}
