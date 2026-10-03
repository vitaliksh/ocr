// Reports dialog: pick a report and period, preview it, print it (browser "Save as PDF").
import { readChartOfAccounts } from "./chart-of-accounts.js";
import { formatMonth, parseMonthText } from "./month-format.js";
import { loadReportDeclarations, readReportSettings, saveReportSettings } from "./report-data.js";
import { advancesReport, classificationLedger, inPeriod, periodContaining, profitLoss, reportEntries, vatReport } from "./reports.js";
import { renderAdvancesReport, renderLedgerReport, renderProfitLossReport, renderVatReport } from "./reports-view.js";

// Default period: the reporting period of the latest declaration for VAT/advances, the year to date otherwise.
export function defaultPeriod(kind, latestMonth, vatPeriod) {
  if (!latestMonth) return { from: "", to: "" };
  if (kind === "vat" || kind === "advances") return periodContaining(latestMonth, vatPeriod);
  return { from: `${latestMonth.slice(0, 4)}-01`, to: latestMonth };
}

// Opens the report in its own tab with a toolbar (print / close), so the user is never stranded in the print preview.
// Returns false when the browser blocks the window.
export function openReportViewer(sheet, { open = () => window.open("", "_blank") } = {}) {
  const viewer = open();
  if (!viewer) return false;
  const { document: doc } = viewer;
  const css = new URL("reports.css", document.baseURI).href;
  doc.open();
  doc.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}">`
    + `<style>body{margin:0;font-family:Arial,"Noto Sans Hebrew",system-ui,sans-serif;background:#edf1f5}`
    + `.viewer-bar{position:sticky;top:0;display:flex;gap:10px;padding:10px 16px;background:#34566c}`
    + `.viewer-bar button{padding:7px 14px;font:inherit;font-weight:700;cursor:pointer}`
    + `@media screen{#report-print{display:block!important;max-width:900px;margin:16px auto;padding:20px;background:#fff}}`
    + `</style></head><body><header class="viewer-bar"><button id="viewer-print" type="button">הדפסה / שמירה כ‑PDF</button>`
    + `<button id="viewer-close" type="button">סגירה</button></header><div id="report-print"></div></body></html>`);
  doc.close();
  doc.title = sheet.querySelector("h2")?.textContent ?? "דוח";
  doc.querySelector("#report-print").append(doc.importNode(sheet, true));
  doc.querySelector("#viewer-print").onclick = () => viewer.print();
  doc.querySelector("#viewer-close").onclick = () => viewer.close();
  return true;
}

// getContext() returns { client, dataRoot, names } or null when no client is selected.
export function setupReports({ button, dialog, printRoot, getContext, onError, openViewer = openReportViewer }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [kind, from, to, vatPeriod, percent, errorLine, preview, show, print] = [
    "reports-kind", "reports-from", "reports-to", "reports-vat-period", "reports-advance-percent", "reports-error",
    "reports-preview", "reports-show", "reports-print",
  ].map(part);
  let context = null;
  let entries = [];
  let latestMonth = "";

  const applyDefaultPeriod = () => {
    const period = defaultPeriod(kind.value, latestMonth, vatPeriod.value);
    from.value = formatMonth(period.from);
    to.value = formatMonth(period.to);
  };

  button.addEventListener("click", async () => {
    context = getContext();
    if (!context) return onError("יש לבחור תחילה לקוח לפני הפקת דוחות.");
    try {
      const [declarations, chart, settings] = await Promise.all([
        loadReportDeclarations(context.client.directory),
        readChartOfAccounts(context.dataRoot),
        readReportSettings(context.client.directory),
      ]);
      entries = reportEntries(declarations, chart ?? {}, context.names);
      // Prefer the latest month that has active rows: a freshly created empty declaration must not hide the data.
      latestMonth = (declarations.findLast((item) => item.rows.some((row) => row.active)) ?? declarations.at(-1))?.month ?? "";
      vatPeriod.value = settings.vatPeriod;
      percent.value = settings.advancePercent ?? "";
      preview.replaceChildren();
      errorLine.textContent = declarations.length ? "" : "ללקוח אין הצהרות.";
      applyDefaultPeriod();
      dialog.showModal();
    } catch (error) {
      onError("לא ניתן לטעון נתונים לדוחות: " + error.message);
    }
  });
  kind.addEventListener("change", applyDefaultPeriod);
  vatPeriod.addEventListener("change", applyDefaultPeriod);

  show.addEventListener("click", async () => {
    errorLine.textContent = "";
    preview.replaceChildren();
    const [fromIso, toIso] = [parseMonthText(from.value), parseMonthText(to.value)];
    if (!fromIso || !toIso || fromIso > toIso) {
      errorLine.textContent = "יש להזין תקופה תקינה בפורמט MM/YYYY (תחילה לא אחרי הסוף).";
      return;
    }
    const advancePercent = percent.value === "" ? null : Number(percent.value);
    if (kind.value === "advances" && (advancePercent === null || !(advancePercent >= 0 && advancePercent <= 100))) {
      errorLine.textContent = "יש להזין אחוז מקדמות בין 0 ל-100.";
      return;
    }
    try {
      await saveReportSettings(context.client.directory, { vatPeriod: vatPeriod.value, advancePercent });
      const scope = inPeriod(entries, fromIso, toIso);
      const info = { clientName: context.client.config.clientName, from: formatMonth(fromIso), to: formatMonth(toIso) };
      const node = {
        vat: () => renderVatReport(vatReport(scope), info),
        advances: () => renderAdvancesReport(advancesReport(scope, { percent: advancePercent }), info),
        profitLoss: () => renderProfitLossReport(profitLoss(scope), info),
        ledger: () => renderLedgerReport(classificationLedger(scope), info),
      }[kind.value]();
      preview.append(node);
      if (!scope.length) errorLine.textContent = "אין תנועות בתקופה שנבחרה.";
    } catch (error) {
      errorLine.textContent = error.message;
    }
  });

  print.addEventListener("click", () => {
    if (!preview.firstElementChild) {
      errorLine.textContent = "יש להציג דוח לפני ההדפסה.";
      return;
    }
    if (openViewer(preview.firstElementChild)) return;
    printRoot.replaceChildren(preview.firstElementChild.cloneNode(true));
    window.print();
  });
}
