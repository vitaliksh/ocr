# Handoff — Rivhit document intake

**Updated:** 11 September 2026
**Repository:** https://github.com/vitaliksh/ocr
**Current committed source:** 3e09140 (Add current project handoff)
**Working tree:** intentionally contains uncommitted drawer/workspace changes in telegram-web/. They have passed the checks below and must be preserved.

## Product goal

Provide a simple PC workflow for Rivhit bookkeeping:

1. The bookkeeper works with a local client workspace in a browser.
2. The client sends invoice images from an iPhone through the Telegram bot.
3. Gemini pass 1 extracts draft journal rows.
4. The bookkeeper reviews and edits the rows.
5. The current month's declaration can be exported to PDF and Rivhit TXT repeatedly while it is still a draft.
6. A separate explicit action closes that monthly declaration. Only closing makes it final and appends confirmed rows to the client's local history.
7. A future text-only Gemini pass 2 uses relevant closed history records to improve accounting decisions, never source facts.

The product is a bookkeeping aid, not tax or accounting advice.

## Current deployed architecture

| Component | Location | Responsibility |
| --- | --- | --- |
| Browser UI | https://vitaliksh.github.io/ocr/ | UI, local file access, review table |
| Worker API | https://rivhit-telegram-transfer.vitaliksh.workers.dev | Telegram session, temporary R2 transport, Gemini pass 1 |
| Telegram bot | @Vitalikshbot | Smartphone image intake |
| Production Worker baseline | Git tag cloudflare-production-2026-09-12-3 | Worker version 9a7f31b5-1e7f-4042-95bc-c6082b22bdf5 |

The Worker source is cloudflare-worker/; the static browser client is telegram-web/. Browser-held images are deleted from Worker R2 after ACK, Finish, or expiry. Do not add cloud persistence for client data, declaration drafts, PDFs, TXT exports, or history. Windows Hello passkeys store only their public key, signature counter, and short-lived authorization grant in a Worker Durable Object; the private key never leaves the device.

## Security

Never print, commit, request, or put into browser storage:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- GEMINI_API_KEY
- ALLOWED_TELEGRAM_USER_ID

They are Cloudflare Worker secrets. Their values also belong in an approved password manager; Cloudflare cannot reveal them after creation.

## Repository map

- telegram-web/ — browser UI and current local workspace foundation.
- cloudflare-worker/ — Worker source, Wrangler configuration, setup, and deployment recovery instructions.
- agent-prompts/gemini-pass-1.md — human-readable current Gemini prompt.
- 6111_to_Rivhit.xlsx — approved 6111 → Rivhit mapping.
- docs/ARCHITECTURE.md — older architecture note. It still needs updating to the declaration model below.
- docs/RIVHIT_IMPORT_SPEC.md — mandatory 186-column TXT contract.
- docs/HANDOFF.md — this document; it is the current source of product and implementation context.

The obsolete local Python application, its old UI, duplicate handoff notes, and old OCR prompt were deliberately removed. Do not restore them.

## What works today

- Secure Telegram browser sessions, QR connection, temporary image transport, ACK deletion, and Worker-side Gemini pass 1.
- Review table: editable source fields, classification, recognition controls, image viewer, image ordering, and persisted column widths.
- Current exploratory PDF-package creation/reopening, with unit tests. This is not the final declaration format.
- Local root selection through the browser File System Access API:

  ~~~text
  Rivhit data/
  ├─ common/
  │  └─ PKUDA_AI_TEST.TXT
  └─ clients/
  ~~~

- A right-side drawer for workspaces:
  - round hamburger control in the upper-right corner;
  - flat active-client list read from the selected root's clients/ folder;
  - immediate activation when an active client is clicked;
  - create client inside clients/, no second folder picker;
  - open an old external client folder only as a transition path;
  - Gemini model and canonical template settings inside the drawer;
  - canonical template is copied to common/PKUDA_AI_TEST.TXT;
  - archived-client view, restoration, client activity/type editing, and permanent deletion confirmation;
  - refresh of filesystem permission and client list when the drawer opens after Ctrl-F5.

Current client management is implemented in telegram-web/workspace.js. The active list is intentionally derived from the filesystem, not IndexedDB. IndexedDB only remembers the local root handle and the common template handle.

## Important current UI behavior

- A data root must be selected once. Its picker hides after successful selection; the selected root name remains visible.
- A selected active client immediately becomes the current client and closes the drawer.
- An archived client cannot be made active. It must be restored through its ⋯ menu.
- Archiving leaves the drawer open and clears that client as active.
- A compact summary currently shows the selected client's count of closed history records and up to three recent export folder names.

The user has approved this behavior.

## Revised product model: monthly declarations

This supersedes the older target concept of independent timestamp batches.

Each client has exactly one declaration for each calendar month. While the declaration is open:

- Images may arrive through Telegram any number of times.
- All images and rows accumulate in the same monthly declaration table.
- PDF and TXT may be generated as many times as needed.
- Generating an export does not close the declaration and does not append to history.

Closing a declaration is a separate, explicit, dangerous business action:

- it finalizes the latest declaration state;
- it appends confirmed records to history.jsonl exactly once;
- it prevents additions and edits;
- reopening it later requires a separate special approval flow, not a silent edit.

The browser must persist an open declaration locally, including its draft table and source images, so it survives browser restarts. No draft content goes to the cloud.

### Intended local data layout

~~~text
Rivhit data/
├─ common/
│  └─ PKUDA_AI_TEST.TXT
└─ clients/
   └─ <client>/
      ├─ workspace.json
      ├─ history.jsonl
      └─ declarations/
         └─ YYYY-MM/
            ├─ declaration.json       # draft or closed; metadata and state
            ├─ draft-table.json       # only while open; persisted table state
            ├─ images/                # only while open; local source images
            └─ exports/
               └─ YYYY-MM-DD_HH-mm/
                  ├─ invoices.pdf
                  ├─ import.txt
                  └─ manifest.json
~~~

The exact temporary-draft cleanup rule after closing should be implemented deliberately. The final export and manifest must remain. Do not delete source data until recovery/audit needs have been decided.

### Intended drawer behavior

The current flat list is a working transitional UI. The next declaration UI must be tree-like:

~~~text
Rivhit data
└─ Client A
   ├─ Declaration · 2026-09 · draft
   ├─ Declaration · 2026-08 · closed
   └─ Declaration · 2026-07 · closed
~~~

Clicking a client should expand its declarations rather than immediately activate it. Selection of a declaration should open its table. The current-client activation behavior will need to be revised along with the declaration model; do not merely add visual nesting over the old client-only workflow.

## Data and AI boundaries

Pass 1 receives an image, business activity, and the approved mapping. It extracts source facts, makes an initial classification decision, and returns source-field boxes.

Pass 2 will receive a draft row and only 3–8 relevant closed history records, without the image. It may tune classification, recognised percentages, confidence, review state, and explanation. It must not alter document-source facts:

- date;
- supplier;
- supplier ID;
- document references;
- raw net, VAT, and gross amounts;
- currency.

History is guidance, never proof.

## What is not done

- Monthly declaration storage, draft persistence, recovery, and the declaration tree UI.
- Repeated draft exports in declarations/YYYY-MM/exports/.
- Separate close-declaration transaction and safe special reopen flow.
- Final Rivhit import.txt generation from the mandatory 186-column contract.
- Atomic finalization: validate closed declaration → create final export/manifest → append history.jsonl exactly once → mark closed.
- Gemini pass 2 and local relevant-history ranking.
- Regression coverage for File System Access and declaration lifecycle.
- Full migration/removal of the exploratory package format.

## Required implementation order

1. Replace the current client-only selection flow with the monthly declaration model and tree UI.
   - Add declaration.json, draft-table.json, draft image persistence, and month identity YYYY-MM.
   - A client can have one open declaration per month.
   - Opening a client reveals declarations; selecting a declaration opens its persisted table.
2. Implement repeatable draft export for an open declaration.
   - Every export is a timestamped directory inside exports/.
   - It produces invoices.pdf, import.txt, and manifest.json.
   - It never appends history and never closes the declaration.
3. Implement explicit close-declaration transaction and protected reopen policy.
   - Validate active rows.
   - Make the final export.
   - Append confirmed rows to history.jsonl exactly once.
   - Mark declaration closed only after all preceding writes succeed.
4. Add local history ranking and Gemini pass 2.
5. Add interrupted-draft recovery, comprehensive regression tests, and only then retire the obsolete exploratory package format.

## Existing exploratory package warning

The old buttons and code paths named PDF package / package reopening create a prototype containing document.pdf, source.txt, table.json, and copied images. It is not the final declaration format and must not be described as complete Compile support.

When replacing it, preserve useful code only where it fits the new declaration model. In particular, do not keep writing final data into ad hoc batches/ directories.

## Validation and deployment

Run after browser changes:

~~~powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check
~~~

Current automated test count: 10.

Run after Worker changes:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm run check
~~~

GitHub Pages publishes browser changes after a push to main. Worker code is not automatically deployed. For a reviewed Worker release:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
node node_modules\wrangler\bin\wrangler.js deploy
~~~

After every Worker deployment:

1. Update cloudflare-worker/DEPLOYMENT.md.
2. Create a new annotated cloudflare-production-YYYY-MM-DD tag.
3. Push the tag.

Use cloudflare-worker/DEPLOYMENT.md for the non-secret recovery procedure.
