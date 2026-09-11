# Architecture and product boundary

## Product goal

The app gives a bookkeeper a simple PC workflow: send invoice images from a
phone through Telegram, receive draft rows in a web journal, review them and
create a marked PDF plus a Rivhit import TXT. It does not replace accounting
judgement.

## Deployed components

| Component | Responsibility | Persistent client data |
| --- | --- | --- |
| GitHub Pages (`telegram-web/`) | Browser UI, review table and local file access | No |
| Cloudflare Worker (`cloudflare-worker/`) | Telegram transport, temporary image delivery and Gemini pass 1 | No |
| Windows workspace | Client profile, confirmed history and generated exports | Yes |

The Worker uses a Durable Object for a short-lived upload session and R2 only
until the browser acknowledges an image. Images are deleted after ACK, Finish
or session expiry. Gemini and Telegram secrets exist only as Cloudflare Worker
secrets; never put them in the browser, repository or workspace.

## Local workspace model

The product has client workspaces, not a cloud CRM. A compact right-side drawer
will create, select, archive or permanently delete a workspace. The drawer is
a flat client list; client folders are not a business hierarchy.

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

`workspace.json` holds the client/business name, activity, business type and
future short accounting notes. `history.jsonl` is an append-only sequence of
confirmed records, one JSON object per line. It is written only after a
successful Compile. The common Rivhit template is selected once and never
uploaded.

Browser IndexedDB may remember permission handles or an unfinished temporary
batch, but it is not the source of truth for client data.

## AI boundary

Pass 1 is deployed now. It receives the image, business activity and approved
mapping; it extracts source facts, makes an initial classification decision and
returns source-field boxes.

The future pass 2 receives a draft row and only 3–8 relevant confirmed history
records, without sending the image again. It may tune classification,
recognition percentages, confidence, review status and its explanation. It may
not alter document-source facts: date, supplier, supplier ID, references, raw
net/VAT/gross or currency. History is guidance, never proof.

## Delivery sequence

1. Replace the exploratory workspace dialog with the agreed workspace drawer
   and common data root.
2. Complete one safe Compile transaction: validate active rows, create PDF,
   TXT and manifest, then append confirmed history.
3. Add local history matching and the text-only pass 2.
4. Add recovery, archive/delete UX and regression coverage.

The current uncommitted workspace/PDF code is an exploratory foundation, not a
claim that steps 1–3 are complete. In particular, TXT creation, durable history
and pass 2 are not yet implemented.
