# Handoff — Rivhit → OCR migration, Excel import and reports

**Written:** 2 October 2026. **Status:** analysis and decisions only; no code written for this phase.
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
class except code 217 (one row without VAT that is in no provided file — probably month 3 or 7; ask the client for the
missing file). Business insurance and property tax are excluded from the "inputs" aggregate while zero-VAT parking
rows are included — reproduce this through the type in the chart of accounts, and confirm with the footer checksums.

## Open questions

- Missing month files (3 and 7) and the code-217 transaction.
- Does the report layout need a one-to-one visual match, or only the same figures? (Said "Rivhit format acceptable";
  confirm the extent before drawing PDFs.)
- Closed-declaration recovery (reason, immutable audit, preserve prior final export).
- Backups (postponed).
- ~~Excel library choice~~ Decided: SheetJS 0.20.3 (Apache-2.0) from its official CDN `cdn.sheetjs.com`, loaded on
  demand like pdf.js; `xlsx` from the same tarball is a dev dependency for tests. The npm registry copy is outdated.

## Proposed order of work

1. **Done:** Excel format spec [`EXCEL_IMPORT_SPEC.md`](EXCEL_IMPORT_SPEC.md) and synthetic fixtures (`telegram-web/test/excel-journal-fixture.mjs`). Real files only for a local, git-ignored check.
2. **Done:** pure parser `telegram-web/excel-journal.js` with tests. Checked locally on all six sample files: 220 rows, no errors, all footer checksums match.
3. **Done (storage, seed, matching; no UI):** `telegram-web/chart-of-accounts.js`. Root-level file `common/chart-of-accounts.json`, schema 1: `{ "accounts": { "203": { "name": "אחזקה", "type": "expense" } } }`. Verified locally: all class names of the six sample files resolve and checksum 5 matches with the seed types. **Left for step 4:** the wizard confirmation and manual mapping of unknown names (`matchClassNames`, `addAccount`).
4. **Done, awaiting manual check on the published page:** import wizard (`excel-import-flow.js`, `excel-import-ui.js`, button "ייבוא מ‑Excel" in the journal header). Imports into the selected client; month from the file header, editable; unknown class names get a code and type; optional close without export. Verified in the browser pane with synthetic data on real directory handles (origin-private FS) and the live SheetJS CDN; not yet with a user-picked folder.
5. Reports from the app's own data; compare to the four PDFs. **Calculations done** (`reports.js`, [`REPORTS_SPEC.md`](REPORTS_SPEC.md); figures match the PDFs except class 217, whose transaction is in no file). Still to do: data loading from the local root, PDF output, UI.
6. GUI polish.

## State of the repository at handoff

- `main` is pushed up to `9b16e4d` (app.js and Worker formatted, 60 frontend and 30 Worker tests green).
- **Uncommitted:** `.gitignore` (adds `pdf examples/` and `new examples/`) and this file. `CLAUDE.md` is untracked
  (left to the owner).
- `AGENTS.md` was rewritten for this project; keep to it (minimal diffs, one task per commit, tests and docs in the
  same commit, no new globals).
- Test harness for `app.js`: `telegram-web/test/app-harness.mjs` loads the real `index.html` and `app.js` in jsdom (esbuild
  bundles in memory and exposes selected functions), so no test hooks are needed in `app.js`. Run `npm ci` first.
- Known gaps in tests: income-report classification (needs File System Access), export buttons, Telegram webhook,
  `UploadSession`, 429 retry, `workspace.js` and other modules with very long lines.
