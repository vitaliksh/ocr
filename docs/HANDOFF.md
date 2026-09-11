# Handoff — Rivhit document intake

**Updated:** 11 September 2026

**Repository:** `https://github.com/vitaliksh/ocr`
**Current source commit:** `4e596e2` (`Document Cloudflare production recovery`)

## Goal

Provide a simple PC interface for Rivhit bookkeeping:

1. The user selects a local client workspace in the browser.
2. They send invoice images from an iPhone through the Telegram bot.
3. The browser receives each image and Gemini pass 1 extracts draft journal
   records.
4. The user reviews and edits the table.
5. A future text-only Gemini pass 2 uses a few relevant confirmed records to
   improve the accounting decision, never document-source facts.
6. **Compile** creates a marked PDF and a Rivhit TXT, then records confirmed
   rows in the client's local history.

The product is a bookkeeping aid, not tax or accounting advice.

## Current deployed architecture

| Component | Location | Role |
| --- | --- | --- |
| Browser UI | `https://vitaliksh.github.io/ocr/` | Static GitHub Pages frontend |
| Worker API | `https://rivhit-telegram-transfer.vitaliksh.workers.dev` | Telegram sessions, temporary R2 transport and Gemini pass 1 |
| Telegram bot | `@Vitalikshbot` | Smartphone image intake |
| Production Worker baseline | Git tag `cloudflare-production-2026-09-05` | Worker version `e803c859-d9a4-4bad-9500-62006280ee93` |

The worker source is in `cloudflare-worker/`; the static client is in
`telegram-web/`. The browser holds received images in memory. Worker R2 objects
are temporary and deleted after browser ACK, Finish or expiry. Do not add cloud
persistence for client history, PDFs or TXT files.

## Security

Never print, commit or request these values:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `ALLOWED_TELEGRAM_USER_ID`

They are Cloudflare Worker secrets. Their values must also exist in an approved
password manager; Cloudflare cannot reveal them after creation. Public URL,
Worker name, R2 bucket and GitHub Pages URL are safe to document.

## Repository map

- `telegram-web/` — browser UI; contains the currently tested exploratory
  workspace/PDF-package foundation.
- `cloudflare-worker/` — Worker source, Wrangler configuration, setup guide and
  production recovery checklist.
- `agent-prompts/gemini-pass-1.md` — human-readable current Gemini prompt.
- `6111_to_Rivhit.xlsx` — approved 6111 → Rivhit mapping.
- `docs/ARCHITECTURE.md` — approved product boundary and target workspace model.
- `docs/RIVHIT_IMPORT_SPEC.md` — mandatory 186-column TXT contract.

The obsolete local Python application, its old UI, duplicate handoff notes and
old OCR prompt were removed deliberately. Do not restore them.

## What exists now

- Secure Telegram browser session, QR connection, temporary image transport and
  ACK deletion.
- Gemini pass 1 with Israeli Rivhit mapping, mixed/zero VAT handling,
  row-specific rerun and normalized boxes for document number, total and VAT.
- Review table, editable fields, classification and recognition controls,
  image viewer, image-order handling and persisted column widths.
- An exploratory local workspace dialog, template validation, marked PDF
  package creation and package reopening. It has unit tests.

## What is not done

- The agreed right-side client/workspace drawer and common local data root.
- Durable `history.jsonl` and relevant-record search.
- Gemini pass 2.
- Rivhit `import.txt` generation and the atomic Compile transaction.
- Archive/delete UX, recovery of interrupted work and full regression coverage.

Do not describe the existing PDF-package prototype as the final workspace
format. It saves `document.pdf`, `source.txt`, `table.json` and copied images;
the agreed final structure is below.

## Agreed local workspace model

```text
Rivhit data/
├─ common/
│  └─ PKUDA_AI_TEST.TXT
└─ clients/
   └─ <client>/
      ├─ workspace.json
      ├─ history.jsonl
      └─ batches/
         └─ YYYY-MM-DD_HH-mm/
            ├─ invoices.pdf
            ├─ import.txt
            └─ manifest.json
```

The common canonical template is selected once and is never uploaded. A client
workspace stores business name, activity, business type and future concise
accounting notes. `history.jsonl` is append-only: one confirmed record per JSON
line, written only after a successful Compile.

The client UI should be a compact hidden right-side drawer with a flat client
list and actions to create, select, archive and permanently delete. It is not a
CRM and must not become a file manager or a nested client tree.

## Next implementation order

1. Replace the exploratory workspace dialog with the right-side drawer and one
   common data-root selection.
2. Implement safe **Compile**: validate active completed rows; create PDF, TXT
   and manifest; only then append confirmed rows to `history.jsonl`.
3. Implement local history ranking and pass 2. Send only 3–8 concise relevant
   confirmed cases, without the image.
4. Add archive/delete, recovery and the required regression coverage.

Pass 2 may change classification, recognized percentages, confidence, review
status and explanation. It must not change date, supplier, supplier ID,
document references, raw net/VAT/gross amounts or currency.

## Validation and deployment

```powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check

Set-Location D:\projects\ocr\cloudflare-worker
npm run check
```

Browser changes are published by the GitHub Pages workflow after a push to
`main`. Worker code is **not** automatically deployed. To deploy it after a
reviewed release:

```powershell
Set-Location D:\projects\ocr\cloudflare-worker
node node_modules\wrangler\bin\wrangler.js deploy
```

After any Worker release, update `cloudflare-worker/DEPLOYMENT.md`, create a
new annotated `cloudflare-production-YYYY-MM-DD` tag and push it. The detailed
non-secret recovery procedure is in that file.
