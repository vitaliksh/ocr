// Reports dialog: pick a report and period, show it in a child window, save it (or all reports) as PDF.
import { readChartOfAccounts } from "./chart-of-accounts.js";
import { formatMonth, parseMonthText } from "./month-format.js";
import { loadReportDeclarations, readReportSettings, saveReportSettings } from "./report-data.js";
import { advancesReport, classificationLedger, inPeriod, periodContaining, profitLoss, reportEntries, vatReport } from "./reports.js";
import { openReportWindow } from "./report-viewer.js";
import { layoutReport, renderReportPdf } from "./reports-pdf.js";
import { renderAdvancesReport, renderLedgerReport, renderProfitLossReport, renderVatReport } from "./reports-view.js";

const REPORT_FILES = { vat: "vat", advances: "advances", profitLoss: "profit-loss", ledger: "ledger" };
const PDF_TYPES = [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }];

// Default period: the reporting period of the latest declaration for VAT/advances, the year to date otherwise.
export function defaultPeriod(kind, latestMonth, vatPeriod) {
  if (!latestMonth) return { from: "", to: "" };
  if (kind === "vat" || kind === "advances") return periodContaining(latestMonth, vatPeriod);
  return { from: `${latestMonth.slice(0, 4)}-01`, to: latestMonth };
}

// getContext() returns { client, dataRoot, names } or null when no client is selected.
export function setupReports({ button, dialog, getContext, onError, openViewer = openReportWindow, renderPdf = renderReportPdf }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [kind, from, to, vatPeriod, percent, errorLine, statusLine, preview, show, saveAll] = [
    "reports-kind", "reports-from", "reports-to", "reports-vat-period", "reports-advance-percent", "reports-error",
    "reports-status", "reports-preview", "reports-show", "reports-save-all",
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

  // Validates the period and percent; returns null (with the message shown) when they are unusable.
  const readParameters = () => {
    errorLine.textContent = "";
    statusLine.textContent = "";
    const [fromIso, toIso] = [parseMonthText(from.value), parseMonthText(to.value)];
    if (!fromIso || !toIso || fromIso > toIso) {
      errorLine.textContent = "יש להזין תקופה תקינה בפורמט MM/YYYY (תחילה לא אחרי הסוף).";
      return null;
    }
    const advancePercent = percent.value === "" ? null : Number(percent.value);
    const validPercent = advancePercent !== null && advancePercent >= 0 && advancePercent <= 100;
    return { fromIso, toIso, advancePercent: validPercent ? advancePercent : null };
  };

  // The report data, its HTML (inline fallback) and its Rivhit-style pages for one kind and the chosen period.
  const buildReport = (reportKind, { fromIso, toIso, advancePercent }) => {
    const scope = inPeriod(entries, fromIso, toIso);
    const info = { clientName: context.client.config.clientName, from: formatMonth(fromIso), to: formatMonth(toIso) };
    const data = {
      vat: () => vatReport(scope),
      advances: () => advancesReport(scope, { percent: advancePercent }),
      profitLoss: () => profitLoss(scope),
      ledger: () => classificationLedger(scope),
    }[reportKind]();
    const html = {
      vat: renderVatReport, advances: renderAdvancesReport, profitLoss: renderProfitLossReport, ledger: renderLedgerReport,
    }[reportKind];
    const name = `${REPORT_FILES[reportKind]}_${info.from.replace("/", "-")}_${info.to.replace("/", "-")}.pdf`;
    return { scope, name, node: () => html(data, info), pages: () => layoutReport(reportKind, data, info) };
  };

  const saveToReports = async (name, blob) => {
    const directory = await context.client.directory.getDirectoryHandle("reports", { create: true });
    const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return `${context.client.directory.name}/reports/${name}`;
  };

  const saveCopyAs = async (win, name, blob) => {
    if (typeof win.showSaveFilePicker !== "function") {
      const link = win.document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      return `ההעתק ${name} הורד לתיקיית ההורדות.`;
    }
    const handle = await win.showSaveFilePicker({ suggestedName: name, types: PDF_TYPES });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return `ההעתק נשמר: ${handle.name}`;
  };

  // The window is opened before any await, while the click still counts as a user gesture.
  show.addEventListener("click", async () => {
    const parameters = readParameters();
    if (!parameters) return;
    if (kind.value === "advances" && parameters.advancePercent === null) {
      errorLine.textContent = "יש להזין אחוז מקדמות בין 0 ל-100.";
      return;
    }
    preview.replaceChildren();
    const viewer = openViewer();
    try {
      await saveReportSettings(context.client.directory, { vatPeriod: vatPeriod.value, advancePercent: parameters.advancePercent });
      const report = buildReport(kind.value, parameters);
      if (!report.scope.length) errorLine.textContent = "אין תנועות בתקופה שנבחרה.";
      if (!viewer) {
        preview.append(report.node());
        return;
      }
      const { pdf, images } = await renderPdf(report.pages());
      viewer.show({
        title: report.node().querySelector("h2")?.textContent ?? "דוח",
        pageUrls: images.map((image) => URL.createObjectURL(image)),
        save: async () => `הקובץ נשמר: ${await saveToReports(report.name, pdf)}`,
        saveAs: (win) => saveCopyAs(win, report.name, pdf),
      });
    } catch (error) {
      errorLine.textContent = error.message;
      viewer?.fail(error.message);
    }
  });

  saveAll.addEventListener("click", async () => {
    const parameters = readParameters();
    if (!parameters) return;
    saveAll.disabled = true;
    statusLine.textContent = "שומר את הדוחות…";
    try {
      await saveReportSettings(context.client.directory, { vatPeriod: vatPeriod.value, advancePercent: parameters.advancePercent });
      const saved = [];
      for (const reportKind of Object.keys(REPORT_FILES)) {
        if (reportKind === "advances" && parameters.advancePercent === null) continue;
        const report = buildReport(reportKind, parameters);
        saved.push(await saveToReports(report.name, (await renderPdf(report.pages())).pdf));
      }
      statusLine.textContent = `נשמרו ${saved.length} דוחות בתיקייה ${context.client.directory.name}/reports: ${saved.map((path) => path.split("/").pop()).join(", ")}`;
      if (parameters.advancePercent === null) errorLine.textContent = "דוח המקדמות לא נשמר: יש להזין אחוז מקדמות בין 0 ל-100.";
    } catch (error) {
      errorLine.textContent = "השמירה נכשלה: " + error.message;
    } finally {
      saveAll.disabled = false;
    }
  });
}
