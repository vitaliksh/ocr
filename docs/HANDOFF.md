# Handoff — Rivhit document intake

**Updated:** 12 September 2026
**Repository:** https://github.com/vitaliksh/ocr
**Windows Hello functional release:** `cloudflare-production-2026-09-12-4` — Simplify one-time Windows Hello computer connection
**Working tree:** clean after the release.
**Primary user:** Vitalik. UI is intentionally Hebrew; do not convert it to English without a new explicit request.

## Product and non-negotiable boundaries

This is a local-first browser application for preparing Israeli Rivhit expense-journal imports. It is a bookkeeping aid, not accounting or tax advice.

1. The bookkeeper selects a local data root and a client declaration in Chrome/Edge on the PC.
2. The client sends invoice photos from an iPhone to the Telegram bot.
3. Gemini pass 1 extracts journal draft rows from the images.
4. The bookkeeper reviews and can edit every row before export.
5. Open monthly declarations can be exported repeatedly as PDF + Rivhit TXT.
6. Closing a declaration makes a final export, appends confirmed text-only history exactly once, and locks the table.
7. Gemini pass 2 can improve accounting judgement from relevant closed local history, but must never change source facts from the image.

Never add cloud persistence for client workspaces, declarations, source images, draft tables, PDFs, TXT files, exports, or history. These remain in the selected local folder.

## Live production components

| Component | Location | Purpose |
| --- | --- | --- |
| Browser UI | https://vitaliksh.github.io/ocr/ | Local files, workspaces, review table, exports, Windows Hello UI |
| Worker API | https://rivhit-telegram-transfer.vitaliksh.workers.dev | Telegram transport, temporary R2 images, Gemini pass 1/pass 2, passkey verification |
| Telegram bot | `@Vitalikshbot` | iPhone image intake and one-time passkey enrollment authorization |
| Production Worker release | tag `cloudflare-production-2026-09-12-4` | Worker version `ebd19b78-a590-4c63-a128-7129108ca0be` |

The static browser is published by GitHub Pages after pushing `main`. Worker changes require a separate Wrangler deploy.

## Security model

### Secrets

Never print, commit, request, or put into browser storage:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `ALLOWED_TELEGRAM_USER_ID`

They are Worker secrets and should also be held in an approved password manager. Cloudflare cannot reveal an existing secret value.

### Images and sessions

- Telegram upload sessions are random, short-lived Durable Objects.
- The browser receives a temporary image from R2, saves it locally, then ACKs it; R2 deletes it on ACK, Finish, or expiry.
- Only the allowed Telegram account may invoke Gemini.
- Session tokens and passkey grants are opaque random values; do not log them.

### Windows Hello for pass 2

The prior pass-2 QR requirement was intentionally replaced. Telegram is now needed only once to prove ownership while enrolling a PC's Windows Hello credential. This is a separate **חיבור המחשב לשיפור AI** action in the workspace settings; it requires a selected data root, but not a client or open declaration.

- The private key stays inside Windows Hello/the platform authenticator.
- The Worker Durable Object `DEVICE_REGISTRY` stores only public key material, signature counter, transport metadata, a short-lived challenge, and a five-minute authorization grant.
- Browser `localStorage` holds only the public credential identifier (`rivhit-passkey-credential-id-v1`), not a secret or private key.
- Later use of **שפר לפי היסטוריה** requests Windows Hello and does not create a Telegram session, QR code, or bot message. The obsolete Telegram `history-refinement` path was removed.
- A valid Windows Hello grant can be reused for five minutes, allowing several refinements without repeated system prompts. After expiry, Windows Hello is requested again.

The Relying Party is deliberately fixed to `vitaliksh.github.io`; WebAuthn works on the published GitHub Pages origin, not an arbitrary local host.

## Repository map

- `telegram-web/` — static browser application.
  - `app.js` — main UI, upload, review table, declaration actions, passkey client flow.
  - `workspace.js` — File System Access workspace/client/declaration drawer.
  - `declaration-core.js`, `declaration-store.js` — declaration lifecycle and local persistence.
  - `history-ranker.js` — text-only local history selection for pass 2.
  - `rivhit-export.js` — CP1255, mandatory 186-column Rivhit TXT creation and date normalization.
  - `pdf-report.js` — local PDF report generation.
- `cloudflare-worker/` — deployable Worker.
  - `src/index.js` — routes, Telegram transport, Gemini calls, `UploadSession` and `DeviceRegistry` Durable Objects.
  - `wrangler.toml` — bindings and Durable Object migrations (`v1` UploadSession, `v2` DeviceRegistry).
  - `DEPLOYMENT.md` — non-secret recovery and production-version record.
- `docs/RIVHIT_IMPORT_SPEC.md` — the 186-column import contract.
- `6111_to_Rivhit.xlsx` — approved 6111 → Rivhit mapping.
- `agent-prompts/gemini-pass-1.md` — readable version of the pass-1 prompt.

`docs/ARCHITECTURE.md` is older and is not authoritative where it conflicts with this file. The obsolete Python application and exploratory package flow were deliberately removed; do not restore them.

## Local data model

The selected data root is structured as follows:

~~~text
Rivhit data/
├─ common/
│  └─ PKUDA_AI_TEST.TXT                 # canonical 186-column Rivhit template
└─ clients/
   └─ <client>/
      ├─ workspace.json
      ├─ history.jsonl                  # text-only confirmed history
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
~~~

Select a valid 186-column Rivhit TXT template. The browser copies the chosen file to `common/PKUDA_AI_TEST.TXT`.

## Implemented behavior

### Workspaces and declarations

- Select a data root once using File System Access API; use Chrome or Edge.
- Create, archive, restore, edit, and permanently delete clients from the workspace drawer.
- The `…` client action opens a separate modal, not content inside the drawer.
- Each client can have monthly declarations (`YYYY-MM`).
- Selecting a declaration loads its persisted table and local source images.
- An open declaration accepts more uploads and allows edits and repeated exports.
- Closing validates the active rows, makes a final export, appends history once using `declarationId`, and locks the declaration.
- A closed declaration opens as a visible read-only table; it is not blank.
- The obsolete controls for opening an existing package / loading a saved table were removed from the active workflow.

### Export

- Draft export creates `invoices.pdf`, `import.txt`, and `manifest.json` under the declaration's timestamped `exports/` folder.
- Export does not require image markers when a row is intentionally eligible without them.
- TXT is Windows-1255 / CP1255 and has 186 columns.
- Dates accept `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, and `DD.MM.YYYY`; output is normalized to Rivhit format.
- Rows marked **לא מיועד לייצוא** are skipped by validation and export.

### Pass 1 and pass 2

- Pass 1 sends a temporary document image, business activity, and the approved mapping to Gemini. It returns source facts, classification, confidence, explanation, and source-value boxes.
- Pass 2 sends only the current draft row and 1–8 relevant closed-history records, all text-only.
- The local ranker favours matching supplier VAT ID/supplier, then classification/description. It excludes images, raw monetary values, and other prohibited source data from the history context.
- Pass 2 may change classification, recognition percentages, confidence, review state, and agent opinion. It must not change date, supplier, supplier ID, document references, allocation number, raw net/VAT/gross amounts, or currency.
- If no relevant closed history exists, the Improve button remains and the UI reports that fact. No QR or Windows Hello prompt is needed.
- Improve buttons remain after success or a no-history response, so the user can repeat pass 2 with another model.

## Windows Hello user test

This must be tested manually on the production page because it uses the user's authenticator and Telegram account.

1. Open https://vitaliksh.github.io/ocr/ and force refresh with `Ctrl+F5`.
2. Select a data root, then open **סביבות עבודה**.
3. Press **חיבור המחשב לשיפור AI**. A client or declaration is not required.
4. Scan the shown QR in Telegram and press Start. The bot should say that Windows Hello setup is required and that no photo should be sent.
5. Complete the Windows Hello prompt on the PC.
6. The drawer should now say that the computer is connected. The separate connection dialog closes automatically; no upload screen is opened.
7. Select a row that has relevant closed history and press **שפר לפי היסטוריה**.
8. Windows Hello should appear. There must be no QR and no Telegram message.
9. After approval, verify that only allowed pass-2 fields can change and the Improve button remains available.
10. Click Improve again: it may run without another Hello prompt for up to five minutes. After five minutes, Hello should be requested again.

If the browser says the credential is no longer registered, the UI clears the local identifier. Enrol Windows Hello again through the workspace drawer. If `navigator.credentials` is unavailable, use current Chrome or Edge on Windows 11.

## Known limitations / next logical work

1. **Manual end-to-end passkey test is still required.** Compilation and deployment passed, but only Vitalik can validate the real Windows Hello + Telegram interaction.
2. Add automated Worker tests for registration/authentication routes, counter updates, grant expiry, and rejection of invalid signatures. Current browser unit tests do not exercise WebAuthn hardware.
3. Update `docs/ARCHITECTURE.md` to reflect declarations, history and passkeys.
4. Evaluate whether an explicit, audited closed-declaration reopen process is needed. Do not silently unlock closed declarations.
5. Improve declaration lifecycle/UI only from user feedback; do not reintroduce removed package controls or change the Hebrew UI casually.

## Validation commands

After browser changes:

~~~powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check
~~~

Expected automated browser tests currently: **20 passing**.

After Worker changes:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm run check
~~~

This runs `wrangler deploy --dry-run` and must list both Durable Objects. Then manually test the changed production flow.

## Deployment procedure

Browser-only changes: commit and push `main`; wait for GitHub Pages, then request the page with a cache-busting query parameter to confirm the deployed asset contains the change.

Worker changes:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
npx wrangler deploy
~~~

After successful Worker deployment:

1. Record the returned Worker version in `cloudflare-worker/DEPLOYMENT.md`.
2. Run browser tests and Worker dry-run.
3. Commit the source and documentation.
4. Create and push a new annotated `cloudflare-production-YYYY-MM-DD-N` tag.
5. Confirm the browser and Worker manual flow on production.

Do not run destructive Git commands (`reset --hard`, broad checkout, etc.) in a dirty worktree. Preserve unrelated user changes.
