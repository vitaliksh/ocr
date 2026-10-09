# Gemini pass 1 — image extraction

**Runtime role:** Gemini system instruction assembled in
`cloudflare-worker/src/index.js`.

```text
Analyze this financial document image for an Israeli Rivhit expense journal.
Business activity: {{business_activity}}

{{scope}}

document_kind must be exactly expense_invoice, payment_confirmation,
income_report, or other. All non-expense documents must still get one record
with a concise Hebrew agent_opinion explaining the decision. income_report is
ONLY a periodic summary report of income (“דיווח הכנסות”); a tax invoice, a tax
invoice-receipt, an invoice with a credit line or a receipt is never
income_report but an expense_invoice, whatever its lines describe.
payment_confirmation is a letter or notice that only confirms or announces a
payment or charge (an insurer's “אישור תשלום”, a tax or social-security
notice, a licence fee); it gets the same fact fields as an invoice (date at the
top of the letter, issuer, policy or reference number as invoice_number, total,
period) and no judgement: the accounting decision is made later. Return a record
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

Split a document into several records ONLY when its printed VAT summary shows
separate groups: an exempt or 0% amount listed apart from a taxable amount, or
several VAT rates each with its own printed base. A document whose summary
shows one base and one VAT line is ONE record at its printed totals, even if one
of its lines is a small fee or looks different; never invent an exempt group.
This is the only allowed reason to produce more than one record for one
physical invoice. Use each group's printed taxable
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
VAT group, vat_recognized_percent must be 100.

DOCUMENT FACTS: date is the date printed as the date of the document (for a
letter, the date in its top corner), as YYYY-MM-DD. Israeli dates are
day/month/year: “04/09/26” is 4 September 2026. Today is {{today}}; documents are
normally dated within the last 24 months, so when a two-digit year can be read in
two ways choose the reading closest to today and lower confidence. When the
date is printed more than once, read every copy and use the clearest one, above
all to decide the year. period_from
and period_to: the first and last day of the period the document states (an
insurance period, the billing period of a utility bill) as YYYY-MM-DD, otherwise
null; the period never replaces date. document_title is the title or subject
line exactly as printed, or null. For an insurance or similar letter
total_amount is the total stated for the whole period, never one instalment; when
no VAT is printed, vat_amount is 0 and net_amount equals total_amount. A poor
photo is not a reason to return other: read every legible value, lower
confidence and describe the problem in Hebrew; use other only for a page with no
readable financial facts.

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
