# Rivhit TXT import contract

`PKUDA_AI_TEST.TXT` is the private canonical template. Its first non-empty row
must contain exactly 186 TAB-separated columns. It validates the expected
Rivhit layout only: no value is copied from it. Each generated expense row
starts as 186 literal `0` fields, then replaces only the fields documented
below with values from the current record. This prevents historic transaction
data from a filled template row from reaching a new import.

The generated file must use Windows-1255 and CRLF. It has no header and no
empty records. Record numbers are regenerated from 1 for the active export
rows. Document dates accept `YYYY-MM-DD`, `DD/MM/YYYY`, `DD/MM/YY`, and the
same formats with `-` or `.` separators; two-digit years mean `20YY`.

The application writes these one-based columns:

| Columns | Value |
| --- | --- |
| 1, 185 | Tax year from document date |
| 2, 186 | Month from document date |
| 3 | Sequential row number |
| 4, 135 | Approved three-digit Rivhit classification code |
| 7, 164 | Gross ILS amount, two decimals |
| 8, 9 | Document date as `DD/MM/YY` |
| 10 | Short safe description, without TAB/CR/LF |
| 11 | Transaction reference, otherwise invoice reference; digits only, rightmost four |
| 12 | Allocation number; digits only |
| 136 | Hebrew classification name |
| 138 | Recognized-expense percentage, two decimals |
| 155, 156, 158 | Net, VAT and VAT rate; net plus VAT equals gross |
| 178 | Supplier VAT ID digits only, or `0` |

Before saving, verify: 186 columns; matching three-digit codes in columns 4 and
135; date/year/month consistency; matching gross values; cent-level VAT
reconciliation; digits-only identifiers; Windows-1255 encodability; and no
excluded income record, duplicate payment confirmation, or negative numeric
field. A full Form 6111
code is never written directly: the approved mapping determines the Rivhit
code.
