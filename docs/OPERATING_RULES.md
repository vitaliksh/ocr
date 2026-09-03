# Operating rules: photo → Rivhit TXT

## Purpose and scope

The application converts receipt and invoice photos into expense rows for a Rivhit import. One source image is sent to Gemini exactly once. The model receives the image, business activity, and the approved 6111→Rivhit mapping; it returns extraction and accounting decisions together. No second AI pass and no intermediate OCR JSON files are used.

The output is a bookkeeping aid. A qualified bookkeeper remains responsible for final tax treatment and the actual Rivhit import.

## Privacy and repository hygiene

Never commit or upload:

- `.env`, API keys, personal invoices, receipt photographs, customer/supplier identifiers, or generated TXT files;
- `processed_documents/`, `examples/`, or `examples - Copy/`;
- `PKUDA_AI_TEST.TXT`, because it is a local validated Rivhit template and can contain business-specific data.

The safe repository contains source code, non-secret configuration examples, documentation, and the approved `6111_to_Rivhit.xlsx` mapping only.

## Gemini instructions and decoding rules

The live system instruction is [ocr_instructions.md](../ocr_instructions.md). Keep it concise and aligned with `DIRECT_SCHEMA` in `app.py`.

For each distinct document in a photo, Gemini must:

1. identify the document kind: `expense_invoice`, `payment_confirmation`, `income_report`, or `other`;
2. extract date, issuer, issuer VAT ID, invoice and transaction references, gross total, allocation number, purchase purpose, and currency, with visible evidence for non-null source fields;
3. decide the most plausible full four-digit Form 6111 code from the supplied mapping, a matching Hebrew name, recognized-expense percentage, and VAT values;
4. set `requires_review` only as an informational note. It must still make the best accounting decision; a review note never excludes an expense row;
5. set VAT values so that net plus VAT equals the gross amount after cent rounding. When VAT treatment is genuinely unknown, use gross as net and zero VAT/rate.

Income reports and other non-expense documents are excluded from the expense TXT. A payment confirmation is retained only when no matching invoice is in the same batch. Local duplicate handling uses payment references such as `P-…`, supplier, document date, and total to keep the invoice and omit the duplicate confirmation.

## Currency conversion

ILS values are written unchanged. For another currency, the server retrieves the representative Bank of Israel rate for the receipt date. If that day has no published rate, it uses the latest published rate within the preceding seven days and reports the date. JPY is per 100 units and LBP per 10 units. If no official rate can be retrieved, the record is rejected rather than silently writing a foreign amount as ILS.

## Rivhit TXT contract

`PKUDA_AI_TEST.TXT` is the local canonical template. It must have exactly 186 TAB-separated columns in its first non-empty row. Every generated expense row starts as a copy of that row; all unspecified columns remain unchanged.

Output requirements:

- Windows-1255 encoding;
- CRLF between records, no header, and no empty record;
- exactly 186 TAB-separated columns per record;
- record numbering starts at 1 and is regenerated for selected export rows.

The application writes these 1-based columns:

| Columns | Value |
|---|---|
| 1, 185 | Tax year from document date |
| 2, 186 | Month from document date |
| 3 | Sequential row number |
| 4, 135 | Mapped three-digit Rivhit classification code |
| 7, 164 | Gross amount in ILS, two decimals |
| 8, 9 | Document date as `DD/MM/YY` |
| 10 | Short safe description; no TAB/CR/LF |
| 11 | Transaction reference, otherwise invoice reference; digits only, rightmost four |
| 12 | Allocation number; digits only |
| 136 | Hebrew classification name |
| 138 | Recognized-expense percentage, two decimals |
| 155, 156, 158 | Net, VAT, VAT rate; net plus VAT must equal gross |
| 178 | Supplier VAT ID digits only, or `0` |

The full Form 6111 code is never written directly to the TXT. `6111_to_Rivhit.xlsx` maps it to the approved three-digit Rivhit code. Never derive a Rivhit code by truncating a 6111 code.

## Verification before delivery or import

For every export, verify:

1. Each row has 186 columns.
2. Columns 4 and 135 match and are exactly three digits.
3. Year/month and both date columns agree.
4. Gross columns 7 and 164 agree.
5. Net plus VAT equals gross to the cent.
6. References and supplier ID contain digits only.
7. Windows-1255 encoding succeeds without replacement characters.
8. The selected rows do not include an income report or a detected payment-confirmation duplicate.

## Safe maintenance

Run `py -B -m py_compile app.py` after Python changes. Restart with `run.ps1`, then refresh the browser with `Ctrl+F5` after UI changes. Do not edit the local template or mapping without a Rivhit/bookkeeper validation.
