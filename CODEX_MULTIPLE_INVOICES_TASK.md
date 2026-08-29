# Codex task: support multiple invoices in one image

Update the project to support one or more distinct financial documents in a single source image. Keep the implementation small and deterministic. Do not redesign unrelated code.

## Required result format

There must be exactly one JSON format everywhere, including the one-document case:

```json
{
  "invoices": [
    {
      "recipient_name": {"value": null, "evidence": null},
      "date": {"value": null, "evidence": null},
      "supplier_name": {"value": null, "evidence": null},
      "supplier_vat_id": {"value": null, "evidence": null},
      "invoice_number": {"value": null, "evidence": null},
      "total_amount": {"value": null, "evidence": null},
      "allocation_number": {"value": null, "evidence": null},
      "purpose": {"value": null, "evidence": null},
      "transaction_number": {"value": null, "evidence": null},
      "currency": {"value": null, "evidence": null},
      "language": {"value": null, "evidence": null}
    }
  ]
}
```

For one detected document, `invoices` has one element. For two documents, two elements, etc. Never return the old single-invoice top-level format.

## app.py changes

1. Keep the existing per-invoice field schema unchanged.
2. Wrap that schema in a top-level object with required property `invoices`, which is an ARRAY of invoice objects. Require at least one item if the Gemini schema supports `minItems`; otherwise validate it in Python.
3. Send this wrapped schema to Gemini as `responseSchema`.
4. Change normalization so it validates the top-level object and normalizes every item in `invoices` using the existing per-field rules. Do not merge invoice items.
5. `save()` must save one source image as one JSON file containing the complete `{ "invoices": [...] }` object. Do NOT create `_1.json`, `_2.json`, etc.
6. `/api/recognize` and `/api/save` must both accept/return the new wrapped format only.
7. Keep the existing quota handling/retry behavior and all unrelated extraction logic unchanged.
8. Bump `RESULT_FORMAT_VERSION` because this is a breaking JSON-format change. Bump `APP_VERSION` too.

## OCR instructions

Use the supplied updated `ocr_instructions.md` as the system instruction. Do not invent another prompt or duplicate its field rules inside Python.

The important multiple-document behavior is:
- identify all distinct financial documents in the image first;
- produce one invoice object per distinct document;
- never mix fields/evidence between documents;
- always return the top-level `invoices` array, even for one document.

## Web UI

Update the UI only as much as necessary to handle `invoices[]`.

- For one invoice, behavior should remain visually equivalent to today.
- For multiple invoices, show/edit each invoice separately (for example, clearly numbered sections/cards).
- Saving edited data must send the same top-level `{ "invoices": [...] }` format to `/api/save`.
- Do not silently display only `invoices[0]`.

## Compatibility / cleanup

Do not add dual-format compatibility unless it is strictly required for startup. The running application should produce and use only the new format. Existing old JSON files on disk do not need to be migrated unless the current UI automatically loads them; if so, report that separately rather than complicating the recognition path.

## Verification

Before finishing:

1. Run Python syntax/compile checks.
2. Test normalization with an object containing one invoice.
3. Test normalization with an object containing two invoices and verify both survive unchanged as separate entries.
4. Test that the old top-level single-invoice format is rejected rather than silently accepted.
5. Confirm `/api/health` reports the new app/result-format versions.
6. Report exactly which files were changed and the tests run.

Do not make unrelated refactors.
