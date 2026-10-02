# Reports computed from the app's own data

Implemented in `telegram-web/reports.js` (pure functions). Layout is the Rivhit one; the figures were checked
against the four Rivhit PDFs of the migrated client on 2 October 2026 (real data, local only, never committed).

## Inputs

- `reportEntries(declarations, accounts, names)`: every **active** draft-table row of the declarations in scope.
  Amounts are the recognised values of the row (`values[7..9]`: gross, net, VAT); for Excel-imported rows they equal
  the source values. The kind comes from the chart of accounts (`income`, `expense`, `outsideVatBase`, `equipment`);
  a code outside the chart is `income` if its name is `הכנסות`, otherwise `expense`.
- `inPeriod(entries, from, to)` keeps entries whose **declaration month** is in the period. The document date plays
  no role (dates often fall outside the declaration month).
- Reporting period: `periodContaining(month, "monthly" | "bimonthly")`; bimonthly pairs are 1-2, 3-4, ..., 11-12.

## Formulas

All rounding is half-up to whole shekels unless noted.

| Report | Figure | Definition |
| --- | --- | --- |
| VAT | turnover | Σ net of income |
| VAT | output VAT | Σ VAT of income |
| VAT | input VAT | Σ VAT of expense and `outsideVatBase` classes (credit notes subtract); equipment excluded |
| VAT | equipment VAT | Σ VAT of equipment (separate line, assumption: not yet compared with a Rivhit report that has equipment) |
| VAT | payable | output − input − equipment, **of the rounded lines** (as on the VAT form) |
| VAT | warning | number of active entries in declarations that are not closed (Rivhit: "N non-updated transactions") |
| Advances | advance | round(rounded turnover × percent / 100); total = advance − deductions (deductions default 0) |
| P&L | income, expenses | Σ net per class, ordered by code; equipment excluded; `outsideVatBase` classes (property tax, business insurance) **are** expenses |
| P&L | totals, profit | sums of exact amounts, then rounded; percentages (2 decimals) are of total income |
| Ledger | rows | grouped by code, ordered by declaration month then import order; expenses are negative, credit notes positive |
| Ledger | subtotals | per code, per section (income; "הוצאות הנהלה וכלליות"; equipment "לא משתתף"), and the report total (all sections) |

Not reproduced in the ledger: Rivhit's sheet line number and counter account (not stored in the app).

## Verification (real data, local)

Using the six sample files imported with the seed chart: VAT for July-August (turnover, output VAT, input VAT, payable),
the advances figure, P&L income, every ledger section total (income, equipment) and the VAT column of the expense
section equal the PDFs. Expense net and gross differ by exactly one class, `217` (`רכב רשוי וביטוח`), whose single
transaction is in none of the files (probably the July file; Rivhit counts 59 non-updated transactions for July-August
and the August file has 58). With that class added, P&L expenses, ledger section and ledger totals match too.

## Open questions

- Month 3 and 7 files and the code-217 transaction (ask the client).
- Rounding choices (payable from rounded lines; P&L totals from exact sums) agree with the PDFs on this sample but
  could differ by one shekel elsewhere.
- Equipment VAT in the VAT report: separate line here; confirm against a Rivhit VAT report of a month with equipment
  (April has one).
