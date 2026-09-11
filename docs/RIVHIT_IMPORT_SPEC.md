# Rivhit TXT import contract

`PKUDA_AI_TEST.TXT` is the private canonical template. Its first non-empty row
must contain exactly 186 TAB-separated columns. Each generated expense row
starts as a copy of that row, so unspecified fields retain the approved values.

The generated file must use Windows-1255 and CRLF. It has no header and no
empty records. Record numbers are regenerated from 1 for the active export
rows.

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
excluded income record or duplicate payment confirmation. A full Form 6111
code is never written directly: the approved mapping determines the Rivhit
code.
