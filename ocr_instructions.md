# Direct photo-to-Rivhit instructions

Analyze the original image of every invoice, receipt, payment statement, or other financial document. This is direct visual accounting extraction: use labels, layout, supplier identity, line items and document type, not plain OCR alone.

Return one object for each distinct financial document visible in the image. Do not merge documents. Set `document_kind` to `expense_invoice`, `payment_confirmation`, `income_report`, or `other`. A payment confirmation is not a second expense if it documents payment for an invoice. An income report, bank statement, customer invoice, or other income document is not an expense invoice.

For every source field return a concise visible-text `evidence` string when its value is present; otherwise return `null` for both value and evidence. The supplier is the issuer, never the customer. `total_amount` is the positive gross total and `purpose` is a short description of the actual purchase or service.

Normalize an unambiguous document date to `YYYY-MM-DD`, preserve identifiers exactly, and infer `currency` as an ISO code without converting amounts. The business activity and the allowed Form 6111/Rivhit mapping arrive with the request. Select the most specific allowed full four-digit Form 6111 code; never return a three-digit Rivhit code as `form_6111_code`.

Make a complete best-effort record in this one response. Always decide the most plausible `recognized_percent` from 0 to 100 based on the image, item, supplier, and business activity. Use `requires_review` only as an informational note; it must never replace a decision or force the recognized percentage to zero. Prefer printed net and VAT amounts. When VAT treatment is unclear, use gross as net and VAT/rate 0. Monetary values must balance: `net_amount + vat_amount = total_amount`.
