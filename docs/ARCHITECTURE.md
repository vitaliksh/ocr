# Architecture and product boundary

## Product goal

Rivhit document intake is a local-first browser tool for preparing Israeli
expense-journal imports. A bookkeeper receives invoice photos through Telegram,
reviews AI-produced draft rows, and produces a marked PDF plus a Rivhit TXT
import. It assists bookkeeping; it does not replace accounting judgement.

## Deployed components

| Component | Responsibility | Persistent client data |
| --- | --- | --- |
| GitHub Pages (`telegram-web/`) | Hebrew browser UI, local files, review, exports and WebAuthn client flow | No |
| Cloudflare Worker (`cloudflare-worker/`) | Telegram transport, temporary image delivery, Gemini passes and passkey verification | No client workspace data |
| Cloudflare Durable Objects | Short-lived upload sessions and passkey public-key/grant state | No client workspace data |
| Windows workspace | Client profiles, declarations, local images, exports and confirmed history | Yes |

The Worker uses R2 only until the browser saves and ACKs an image. It deletes
the object on ACK, Finish, or session expiry. Telegram and Gemini secrets exist
only as Cloudflare Worker secrets; they never enter GitHub Pages, the repository
or the selected local workspace.

## Local workspace model

The product has client workspaces, not a cloud CRM. Chrome or Edge is required
because the bookkeeper selects the local data root using the File System Access
API. The workspace drawer creates, selects, archives, restores, edits and
permanently deletes clients.

```text
Rivhit data/
├─ common/
│  └─ PKUDA_AI_TEST.TXT                 # canonical 186-column Rivhit template
└─ clients/
   └─ <client>/
      ├─ workspace.json
      ├─ history.jsonl                  # confirmed text-only history
      └─ declarations/
         └─ YYYY-MM/
            ├─ declaration.json         # open/closed state and metadata
            ├─ draft-table.json          # persisted rows
            ├─ images/                   # local original images
            └─ exports/
               └─ YYYY-MM-DD_HH-mm/
                  ├─ invoices.pdf
                  ├─ import.txt
                  └─ manifest.json
```

The browser copies a validated 186-column template to `common/PKUDA_AI_TEST.TXT`.
`history.jsonl` is append-only and receives confirmed records once when a
declaration closes. Browser storage may remember permission handles but is not
the source of truth.

An open monthly declaration accepts uploads, edits and repeated exports. Closing
it validates active rows, creates the final export, appends history once using
`declarationId`, and makes the visible table read-only. Rows marked
**לא מיועד לייצוא** are excluded from validation and export.

## AI boundary

Pass 1 sends a temporary document image, business activity and approved mapping
to Gemini. It returns source facts, classification, confidence, explanation and
source-value boxes.

Pass 2 is implemented. It sends the current draft row and 1–8 locally ranked,
text-only closed-history records. It never sends images, raw monetary values or
other prohibited source information from history. It may adjust classification,
recognition percentages, confidence, review state and opinion. It must not
change date, supplier, supplier ID, document references, allocation number, raw
net/VAT/gross amounts or currency. History is guidance, never proof.

## Passkey authorization for pass 2

Telegram is required only once, to authorize enrolment of a PC's platform
authenticator from **חיבור המחשב לשיפור AI**. That action needs a selected data
root, not a client or open declaration. Browser policy requires the explicit
**המשך ל‑Windows Hello** click before the authenticator prompt.

- The private key stays with the platform authenticator; it never reaches the
  browser application or Worker.
- `DEVICE_REGISTRY` holds public-key material, signature counter, transport
  metadata, a short-lived challenge and a five-minute authorization grant.
- Browser `localStorage` holds only the public credential identifier. The grant
  itself lives in page memory, so refresh clears it.
- Later **שפר לפי היסטוריה** calls require Windows Hello only—no QR code,
  Telegram session or bot message.
- WebAuthn is bound to `https://vitaliksh.github.io` with RP ID
  `vitaliksh.github.io`; arbitrary local origins cannot perform this flow.

Worker tests cover registration/authentication state, counter updates, invalid
signatures and expired grants. The production release checklist also includes a
real Windows Hello check because hardware authenticators cannot be covered by
unit tests.

## Repository map

- `telegram-web/` — static browser application. `app.js` owns upload, table,
  declaration and passkey flows; `workspace.js` owns the workspace drawer;
  `declaration-core.js` and `declaration-store.js` own lifecycle and local
  persistence; `history-ranker.js` selects safe pass-2 history; `rivhit-export.js`
  produces the CP1255 186-column TXT; `pdf-report.js` produces the PDF.
- `cloudflare-worker/` — deployable Worker. `src/index.js` has routes, Telegram,
  Gemini, `UploadSession` and `DeviceRegistry` Durable Objects. `DEPLOYMENT.md`
  records the non-secret production baseline.
- `docs/RIVHIT_IMPORT_SPEC.md` — Rivhit import contract.
- `6111_to_Rivhit.xlsx` — approved mapping.

## Operational rules

Browser-only changes are published by pushing `main` and verifying the GitHub
Pages asset with a cache-busting query. Worker changes require `npx wrangler
deploy`, a new production version recorded in `cloudflare-worker/DEPLOYMENT.md`,
automated checks, an annotated production tag and a targeted manual production
test.

Do not restore the obsolete Python application, exploratory package workflow or
the old Telegram-based pass-2 authorization path. Do not introduce cloud
persistence for local client data.
