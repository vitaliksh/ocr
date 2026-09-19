# Gemini pass 1 — image extraction

**Runtime role:** Gemini system instruction assembled in
`cloudflare-worker/src/index.js`.

```text
Analyze this financial document image for an Israeli Rivhit expense journal.
Business activity: {{business_activity}}

{{scope}}

document_kind must be exactly expense_invoice, payment_confirmation,
income_report, or other. All non-expense documents must still get one record
with a concise Hebrew agent_opinion explaining the decision. Return a record
only for a distinct physical financial document visible in the photo: never
create a record for a watermark, logo, background, repeated/partial text, an
incidental fragment, or ordinary text that is not itself a document.

For expense_invoice, extract only visible evidence, choose one allowed full
Form 6111 code, and make the best accounting decision. confidence is one
overall integer from 0 to 100. Monetary values must satisfy net_amount +
vat_amount = total_amount after rounding. vat_recognized_percent is the
percent of the VAT amount recognized for this row.

MONEY OCR — critical: Treat ₪, ש״ח, NIS, and a currency sign as decoration,
never as a digit and never as the start of the number. Read the complete
adjacent number token before removing a currency sign, including its first
digit even in right-to-left text. Do not drop a leading digit merely because
the sign touches or precedes it. Keep thousands separators only as formatting.
For example, the visible value "₪61,631.40" must produce 61631.40, never
1631.40. Independently re-read every high-value total and reconcile it to
printed subtotals, VAT, and grand total. If the digits cannot be read
confidently, do not guess: lower confidence and state the issue in Hebrew.

If an expense invoice explicitly has separate taxable amounts at more than one
VAT rate, return a separate record for each VAT-rate group, even though they
are on one physical invoice. This is the only allowed reason to produce more
than one record for one physical invoice. Use each group's printed taxable
amount as net_amount, that group's VAT as vat_amount, and their sum as
total_amount; never use the document grand total as a record in this case.

IMPORTANT: a printed Hebrew line such as "מוצרים חייבים ב- 18% מע״מ 194.28"
means net_amount is exactly 194.28. It is not a VAT-inclusive total: never
divide this printed taxable amount by 1.18. If the document separately prints
total VAT 34.97 and there is one 18% group, that group's vat_amount is 34.97
and total_amount is 229.25. First decide explicitly whether every printed
amount is **חייב במע״מ** (VAT-taxable) or **לא חייב במע״מ** / exempt. Never
treat an exempt amount as a taxable total and divide it by a VAT rate. A group
explicitly marked not liable for VAT, or whose printed rate is 0%, is a 0%
group: vat_percent, vat_amount, and vat_recognized_percent must all be 0,
while net_amount and total_amount are the same printed amount. A group marked
liable for VAT must use only its printed VAT rate and figures. For a standard
VAT group, vat_recognized_percent must be 100. A payment confirmation is not
an expense invoice.

For every expense_invoice, locate the exact printed values used for its
document number, total_amount, and vat_amount. Return each location directly
in document_number_box, total_amount_box, and vat_amount_box as
[ymin, xmin, ymax, xmax], normalized from 0 to 1000 against the full original
image. Each box must cover only the printed value characters (and an attached
currency sign when printed), not its label, table cell, surrounding whitespace,
or another value. The box must be tight on all four sides and the normalized
coordinate order is top, left, bottom, right. Verify that the text inside each
returned box is exactly the value used in the matching output field; if it
cannot be verified visually, return null. A readable extracted value normally
requires a box. Use null only when that specific value is absent or calculated
rather than visibly printed. Boxes must belong to this record if several
documents share the image. For non-expense records return null for all three boxes.

Allowed Form 6111 → Rivhit mapping:
{{approved_mapping}}
```

`{{scope}}` is one of two runtime instructions: extract every distinct document
and VAT group from a new image, or return only the existing record's matching
document/VAT group during a row-specific rerun.
