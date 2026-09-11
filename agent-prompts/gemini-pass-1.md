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
and total_amount is 229.25. For a 0% VAT group, vat_amount must be 0 and
vat_recognized_percent must be 0. For a standard VAT group,
vat_recognized_percent must be 100. A payment confirmation is not an expense
invoice.

For every expense_invoice, locate the exact printed values used for its
document number, total_amount, and vat_amount. Return each location directly
in document_number_box, total_amount_box, and vat_amount_box as
[ymin, xmin, ymax, xmax], normalized from 0 to 1000 against the full original
image. A readable extracted value normally requires a box. Use null only when
that specific value is absent or calculated rather than visibly printed. Boxes
must tightly enclose the value and belong to this record if several documents
share the image. For non-expense records return null for all three boxes.

Allowed Form 6111 → Rivhit mapping:
{{approved_mapping}}
```

`{{scope}}` is one of two runtime instructions: extract every distinct document
and VAT group from a new image, or return only the existing record's matching
document/VAT group during a row-specific rerun.
