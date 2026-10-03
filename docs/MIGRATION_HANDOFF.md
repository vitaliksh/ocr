# Handoff — Rivhit → OCR migration, Excel import and reports

**Written:** 2 October 2026. **Updated:** 3 October 2026.
**Status:** steps 1–5 are implemented, tested, pushed to `main` and manually checked by Vitalik on the published page
(two rounds of fixes, 3 Oct). Step 6 (GUI redesign) is next and has not started. See "Status and what is left" at the end.
**Primary user:** Vitalik (Russian, informal). UI stays Hebrew. Read `AGENTS.md` first.

## Client request (three items)

1. Import invoices from Excel.
2. Produce financial reports in the Rivhit format (VAT, advances, P&L, classification ledger).
3. Improve the GUI aesthetically (do this **last**, after 1 and 2, so the new screens are styled once).

## Strategic change (decided)

The client is **abandoning Rivhit**. The Excel files are a **one-time migration** of the existing client database
from Rivhit into this app. Consequences:

- The app becomes the system of record, not a pre-Rivhit aid. Reports are computed from the app's own data.
- The Rivhit TXT export stays untouched (no deletion, no further development).
- Local-only storage is now the only copy of the data. **Backups are required but postponed to a later stage**
  (decided 2 Oct). Do not forget this risk.
- Reopening a closed declaration (with reason and audit) becomes more important; still undecided.

## Sample data (local only, never commit)

`D:\projects\ocr\new examples\` (git-ignored with `pdf examples/`): real client data, including the client's name and
tax ID. Do not copy names, IDs or amounts into code, tests, docs or commits. Tests must use synthetic fixtures.

Inputs: `1.xlsx 2.xlsx 4.xlsx 5.xlsx 6.xlsx 8.xlsx` (months 1, 2, 4, 5, 6, 8 of 2026; 220 rows).
Expected outputs (Rivhit-generated PDFs, the acceptance reference): classification ledger (`כרטסת`), VAT report
(`מעמ 8.26`), advances (`מקדמות 08.26`), profit and loss (`רווח והפסד 2026`).

## Excel format (always this one — confirmed)

Rivhit's printed journal "ספר תקבולים תשלומים – יומן קליטה", one file per declaration month.

- Sheet `גיליון2` holds the data; `גיליון1` is empty.
- Header: print date, page info, `לחודש M/YYYY` (cell K5 in the samples) = declaration month.
- Table header on row 10; data rows start on row 11 and occupy every second row (even rows are empty spacers).
- Columns (1-based): 1 status (`טיוטא` = draft), 2 VAT, 4 net, 5 gross, 6 reference 2, 7 reference 1, 9 details
  (short supplier name), 10 counter account (always `כרטיס כללי 0`), 12 classification **name**, 13 line number, 14 date.
- Footer after the data: `סה"כ מע"מ לחודש`, arithmetic sums, and aggregates for equipment (`ת.ציוד`), inputs
  (`תשומות`) and outputs (`עסקאות`), each with its VAT. Use these as checksums when parsing.
- **All cells are text**, except the date (a real date): `"(38.14)"`, `"1,325.42"`. Parentheses mean negative.
- Sign convention is mixed: normal expense = VAT in parentheses, net/gross positive; credit note = net/gross in
  parentheses, VAT positive; income = all positive. Decide expense vs income by classification (`הכנסות`), not by sign.
- Line numbers have gaps (deleted lines) — never use them as keys.
- Reference 1 may be empty (27 of 220). The TXT rule "last four digits" already handles this.
- Dates often fall outside the file's month (64 of 220). That is normal; the declaration month is independent of the
  document date, as the app already assumes.
- Missing compared with the app model: supplier ID (write `0`), allocation number, image, confidence, agent opinion,
  raw (pre-recognition) amounts.
- **Amounts are already recognised.** Vehicle expenses, cellular and EV charging carry VAT ≈ 11.3 % of net (the 66.67 %
  rule). Net + VAT = gross on every row.

## Decisions

1. **Parsing is deterministic** (no Gemini). One-off import wizard.
2. **Client and declaration are chosen by the user.** Excel has no client name or ID. The header month is only a
   suggestion.
3. **Import as open declaration by default**, with a "close immediately" option for old months (closed history feeds
   Pass 2).
4. **Store imported amounts as source values with expense 100 % and VAT 100 %.** Do **not** run the business rules
   (`applyBusinessRule`, codes 806/807/812, home-utility 25 %) on imported rows, or the VAT is reduced twice.
5. **Chart of accounts per client/root** (new concept): code, name, type. Types observed in the data:
   income; ordinary expense; expense outside the VAT input base (property tax, business insurance); equipment
   (separate VAT line, excluded from P&L). Seed it once from the ledger PDF (below), let the user confirm in the
   wizard and map unknown names manually. Store it next to `common/custom-rivhit-mapping.json`. New clients create their
   own codes as today. Codes 160, 2xx, 900 do not collide with built-in 800–888.
6. **Reporting period is separate from the declaration month.** Per-client setting monthly/bimonthly, overridable per
   declaration. The VAT report sums all declarations whose month falls in the period (as Rivhit did: months 1 and 2 were
   separate files feeding one report). Merging two months into one declaration (the bookkeeper does this when volume is
   low) works because document dates do not depend on the declaration month.
7. Rivhit report layout is acceptable. No prior-year comparison table is needed.
8. Backups: postponed.

### Seed chart of accounts (from the ledger PDF)

160 הכנסות · 202 משרדיות · 203 אחזקה · 204 חשמל · 205 ארנונה · 206 ביטוח עסק · 207 טלפון · 208 טלפון סלולרי ·
212 השתלמות וספרות · 213 כיבוד · 215 נסיעות · 216 מים · 217 רכב רשוי וביטוח · 218 אינטרנט · 219 הנה"ח ·
223 שרות מקצועי · 224 פרסום · 229 טעינת רכב · 230 הוצאות רכב · 234 חניה פנגו · 900 רכישת ציוד/רכוש קבוע
(shown as "לא משתתף"). Expense codes sit under the group "הוצאות הנהלה וכלליות". Codes 209–211, 214, 220–222,
225–228, 231–233 did not occur in the samples. Do not invent them.

## Reports to reproduce (acceptance reference)

All figures below are derived from the Excel rows; the PDFs are the expected values.

- **VAT report** (`דוח מס ערך מוסף`), per period: turnover (income net), output VAT (income VAT), input VAT (expense VAT,
  excluding equipment, which is its own line), VAT payable = output − input. Rivhit shows whole shekels.
  Output VAT rate shown as 18 %. Footer warns about draft ("not updated") transactions; keep an equivalent warning.
- **Advances** (`דוח מקדמות ע"פ מחזור`): turnover × advance percentage (client setting, 12 % in the sample), rounded.
- **P&L** (`דוח רווח והפסד`), ex-VAT: income; expenses per classification with percentage of sales; total expenses;
  profit. Equipment (900) is excluded.
- **Classification ledger** (`כרטסת קודי מיון`): grouped by code, rows with status, VAT, net, gross, references,
  details, date, counter account, line, month; subtotal per code; group totals; equipment shown as "not participating".
  Expenses are shown negative here.

Verified relations (use as the migration test): per-class sums from the Excel files equal the ledger totals for every
class except code 217 (one row without VAT that is in no provided file; months 3 and 7 were merged into other
declarations, so no file exists). Business insurance and property tax are excluded from the "inputs" aggregate while zero-VAT parking
rows are included — reproduce this through the type in the chart of accounts, and confirm with the footer checksums.

## Open questions

- Closed-declaration recovery: decided and done on 3 Oct (option A): locking is reversible, "פתיחה מחדש" requires a reason kept in `reopenLog`; no tamper-proof audit.
- Backups (postponed on 2 Oct, still the biggest risk: the local folder is the only copy).
- Equipment VAT line of the VAT report is not verified against a Rivhit report that has equipment (no sample).

Closed: missing month files 3 and 7 (those months were merged into neighbouring declarations; no files exist);
visual 1:1 layout (decided: same figures and section layout, shown as HTML, PDF through the browser's print);
Excel library (SheetJS 0.20.3 from `cdn.sheetjs.com`, loaded on demand; `xlsx` from the same tarball is a dev
dependency for tests; the npm registry copy is outdated).

## Work done (in order)

Details of each module are in `docs/HANDOFF.md` (repository map); specs: [`EXCEL_IMPORT_SPEC.md`](EXCEL_IMPORT_SPEC.md),
[`REPORTS_SPEC.md`](REPORTS_SPEC.md).

1. Excel format spec and synthetic fixtures (`test/excel-journal-fixture.mjs`; real files only for local checks).
2. Pure parser `excel-journal.js`: deterministic, footer checksums, errors versus warnings.
3. Chart of accounts `chart-of-accounts.js`: `common/chart-of-accounts.json` (root level, schema 1), seed from the ledger.
4. Import wizard: `excel-import.js` (rows), `excel-import-store.js` (write, replace with backup, close without export),
   `excel-import-flow.js`, `excel-import-ui.js`, SheetJS adapter `excel-journal-reader.js`.
5. Reports: `reports.js`, `report-data.js`, `reports-view.js`, `reports-ui.js`, `reports.css`; "דוחות" dialog, print to PDF.

Usability work done after Vitalik's first manual tests (all in `main`):

- Import dialog shows the state of the chosen month (missing / empty / N rows / closed); replacing an open declaration
  with rows needs a checkbox and first copies the old table to `draft-table.before-import-<time>.json`.
- `app.js` detaches the open declaration (`onBeforeCommit`) before an import, otherwise `activateDeclaration`/autosave
  overwrote the imported rows.
- New client form has a month field; "+ הצהרה חדשה…" asks for the month in a dialog.
- All months are typed and shown as `MM/YYYY` (`month-format.js`); storage and folder names stay `YYYY-MM`.
- In-page dialogs (`confirm-dialog.js`) replace `window.confirm`/`prompt`; errors are shown in the status bar (`showError`; since stage 4 there is no
  overlay drawer to mirror them into).
- Reports default to the latest month that has data.
- After Vitalik's second manual pass (2026.10.03.2): new-declaration dialog uses month and year selects (a hidden
  `MM/YYYY` input still carries the value); creating a month keeps the drawer open (`keepDrawer`); the empty
  "no client / no declaration" header text and the intro paragraph are gone; the report "PDF" button opens the report in
  its own tab with print and close buttons (`openReportViewer`), falling back to in-page print if the popup is blocked.
  Reports are PDF files laid out like the Rivhit ones (`reports-pdf.js`: pure `layoutReport` + canvas renderer wrapped
  by `jpegPagesToPdf`, so raster pages without selectable text). "הצגה" opens a child window (`report-viewer.js`) with
  Close, "שמירת העתק בשם…" (Save As picker) and "שמירה" (writes `<client>/reports/<kind>_<MM-YYYY>_<MM-YYYY>.pdf`);
  "שמירת כל המסמכים" writes all four reports there (advances only with a valid percent). Inline HTML preview remains
  only when the popup is blocked. The Rivhit VAT/advances PDFs embed a scan of the tax form; we draw plain boxed lines
  instead. The client tax ID is not stored in the app, so the header shows the client name only.
  A month with no income rows legitimately shows turnover 0 (month 1 of the samples has none; its footer checksums agree).

## Embedded-browser limits (read before testing in the Claude desktop pane)

The built-in browser of the Claude desktop app cannot run the folder-based flows by itself:

- `showDirectoryPicker()` never resolves (no dialog), so a data root cannot be chosen there. Vitalik must test in Edge or
  Chrome.
- `window.confirm` returns `false` immediately and `prompt` is not shown (hence the in-page dialogs).
- The `close` event of `<dialog>` is not delivered; never rely on it (`dialogResult` resolves from the button press).

A scripted end-to-end run in the pane is possible by stubbing the picker with an origin-private folder:
`window.showDirectoryPicker = async () => await (await navigator.storage.getDirectory()).getDirectoryHandle("e2e", { create: true })`.
This tests the logic on real `FileSystemDirectoryHandle`s but not a user-picked disk folder. Serve `telegram-web/` with a
static server that sends `text/javascript` for `.mjs` (Python's `http.server` does not).

## Status and what is left

- `main` contains everything above. Frontend marker at this handoff: `2026.10.03.19 · 13:23 IDT`. Tests: **215** frontend,
  **30** Worker. `npm test` and `npm run check` in `telegram-web/` are green; the Worker was not touched.
- `CLAUDE.md` stays untracked (owner's file): never `git add -A` without checking `git status`.
- **Verified by Vitalik on the published page (3 Oct):** real disk folder, import of the sample files, the new-declaration
  dialog, the drawer staying open, the reports dialog, the viewer window and saving PDFs. Not explicitly reported as checked:
  replace and close-immediately on a real folder, all four reports against the Rivhit PDFs figure by figure, and the
  in-page confirm dialogs for delete / archive / close declaration.
- Expected figures with the six sample files (Vitalik's own data, not in the repo): VAT July–August turnover 46,490, output
  VAT 8,368, input VAT 1,598, payable 6,770; advances at 12 % 5,579; P&L year income 172,046; every figure matches the Rivhit
  PDFs except class 217 (8,693), whose single transaction is in none of the files.
- Known limitations: imported rows have no source image, so `invoices.pdf` export fails for them (Rivhit TXT export is
  not supported for imported rows; Rivhit is abandoned); closing a regular declaration is unchanged and still needs the
  TXT template; month names in the ledger are Hebrew, amounts in the ledger keep agorot while other reports use whole
  shekels.
- GUI redesign is under way: see `GUI_REDESIGN_PLAN.md` (stages 2 shell/tokens, 3 clients home/card and 4 sidebar and 5 journal table, 6 dialogs / Excel wizard and 7 reports page are in; stage 8 clean-up is next). Earlier note: **step 6, GUI redesign**, in a fresh session. Ask Vitalik for references or a list of annoyances first; do not
  guess a style. Screens to restyle: main page and journal table, side panel (drawer: clients, declarations, settings),
  import dialog, reports dialog and the report viewer window (`report-viewer.js` has its own inline CSS), the dialogs in
  `index.html` (`workspace.css`), the PDF look is deliberately Rivhit-like and is not part of the redesign.
- UX preferences Vitalik has voiced so far (apply them to the redesign): no placeholder text on the front page; a dialog
  must not change size or turn into something else when a button is pressed; results of an action must be visible next to
  the button (status lines are green/red boxes); new things open in a separate child window, not a browser tab; he
  never wants to be stranded in a print preview.
- Constraints for the redesign: UI text stays Hebrew and RTL; do not rename existing element ids (tests and `app.js`
  query them; `test/app-harness.mjs` loads the real `index.html`); styles are spread over `styles.css`, `workspace.css`,
  `table-layout.css`, `reports.css` (some are single-line minified); a bump of the frontend marker is needed per push.
- Later, when he decides: backups (biggest risk, local folder is the only copy) and closed-declaration recovery.
- Not done on purpose: client tax ID (עוסק מורשה) is not stored, so the report PDFs show only the client name; the
  ledger PDF lacks line number / value date / counter account / reference 2 columns (no such data in the app).

## Working agreements (from `CLAUDE.md`, `AGENTS.md` and Vitalik's instructions)

- Answer Vitalik in Russian, informally, briefly; code, comments and commits in English.
- Minimal diffs, new behaviour through optional parameters, list changes to existing functions in the report.
- Since 3 Oct Vitalik wants **commit and push after every finished task that he is asked to test** (no separate
  "push it"); one task per commit; tests and docs in the same commit;
  bump the frontend marker in `index.html` (and `docs/HANDOFF.md`) before a push that changes `telegram-web/`.
- Real client data (`new examples/`) never goes into code, tests, docs or commits.
- Test harness for `app.js`: `telegram-web/test/app-harness.mjs` (jsdom + esbuild in memory). Run `npm ci` first.
