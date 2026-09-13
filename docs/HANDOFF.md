# Handoff — Rivhit document intake

**Updated:** 13 September 2026
**Repository:** https://github.com/vitaliksh/ocr
**Production release:** `cloudflare-production-2026-09-13-2` — review-regression fixes, amount editing and explicit taxable/exempt VAT extraction
**Working tree:** September 13 review-regression release published. Local PDF examples remain intentionally untracked.
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

Use a local, non-synchronised folder (for example `C:\Rivhit data`) as the active data root. Do not keep the active root under OneDrive: during a test in `OneDrive\Documents`, OneDrive changed a file while Edge held its File System Access handle, causing Edge's cached-state warning and leaving an unreferenced zero-byte first image. Later uploads, exports, declaration close/reopen, and history refinement still completed correctly. Copy closed declarations to cloud storage only as a backup after the browser has finished writing them.

## Live production components

| Component | Location | Purpose |
| --- | --- | --- |
| Browser UI | https://vitaliksh.github.io/ocr/ | Local files, workspaces, review table, exports, Windows Hello UI |
| Worker API | https://rivhit-telegram-transfer.vitaliksh.workers.dev | Telegram transport, temporary R2 images, Gemini pass 1/pass 2, passkey verification |
| Telegram bot | `@Vitalikshbot` | iPhone image intake and one-time passkey enrollment authorization |
| Production Worker release | tag `cloudflare-production-2026-09-13-2` | Worker version `e0cbee01-b079-4693-9597-56eac7a5a0d9` |

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

- The private key never reaches the browser application or Worker. It is held by the selected platform authenticator; on Vitalik's PC, Edge created it in Microsoft Password Manager, which may securely sync it according to that account's passkey settings.
- The Worker Durable Object `DEVICE_REGISTRY` stores only public key material, signature counter, transport metadata, a short-lived challenge, and a five-minute authorization grant.
- Browser `localStorage` holds only the public credential identifier (`rivhit-passkey-credential-id-v1`), not a secret or private key.
- Later use of **שפר לפי היסטוריה** requests Windows Hello and does not create a Telegram session, QR code, or bot message. The obsolete Telegram `history-refinement` path was removed.
- A valid Windows Hello grant is held only in page memory for five minutes, allowing several refinements without repeated system prompts. A page refresh clears that grant and requests Hello again; after five minutes without a refresh, Hello is also requested again.

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

`docs/ARCHITECTURE.md` describes the same shipped architecture. This handoff remains the release and operational record. The obsolete Python application and exploratory package flow were deliberately removed; do not restore them.

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
            ├─ images/                   # local original images and imported source PDFs
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
- Creating a client immediately creates and shows its current-month open draft declaration in the same expanded drawer.
- The `…` client action opens a separate modal, not content inside the drawer.
- Each client can have monthly declarations (`YYYY-MM`).
- Selecting a declaration loads its persisted table and local source images.
- An open declaration accepts more uploads and allows edits and repeated exports.
- An active Telegram-authorized upload session also accepts one manually selected local PDF at a time. Its original PDF and rendered JPEG pages remain in the local declaration; each page follows the existing pass-1 image path.
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
- The PDF report draws the document-number box in yellow and total/VAT boxes in green, using transparent padded fills without borders so the source text stays readable even when a source box is imperfect.
- Pass 2 sends only the current draft row and 1–8 relevant closed-history records, all text-only.
- The local ranker favours matching supplier VAT ID/supplier, then classification/description. It excludes images, raw monetary values, and other prohibited source data from the history context.
- Pass 2 may change classification, recognition percentages, confidence, review state, and agent opinion. It must not change date, supplier, supplier ID, document references, allocation number, raw net/VAT/gross amounts, or currency.
- If no relevant closed history exists, the Improve button remains and the UI reports that fact. No QR or Windows Hello prompt is needed.
- Improve buttons remain after success or a no-history response, so the user can repeat pass 2 with another model.

## Windows Hello production test — completed

Vitalik completed this flow on the production page on 12 September 2026 in Edge/Windows 11. Telegram connected successfully, Microsoft Password Manager created and saved the passkey, and pass-2 prompted for Hello once after a page refresh, then reused the in-memory grant for further refinements.

After Worker release `cloudflare-production-2026-09-12-6`, Vitalik repeated the pass-2 production check: Edge accepted the Windows Hello PIN, reused the grant for the expected five-minute period, prompted once again after six minutes, prompted again after a page refresh, and preserved every pass-2-protected source field. The passkey authorization flow is therefore manually accepted alongside its automated Worker tests.

Vitalik also completed a real declaration lifecycle with client `test3`: uploaded invoices from Telegram, changed a `כיבודים` VAT-recognition value to 25%, made draft Rivhit TXT/PDF exports, closed the September declaration, reopened the client after restarting Edge, created the next monthly declaration, and confirmed that Pass 2 used the closed history to improve a new `כיבודים` row to 25% while preserving source fields.

1. Open https://vitaliksh.github.io/ocr/ and force refresh with `Ctrl+F5`.
2. Select a data root, then open **סביבות עבודה**.
3. Press **חיבור המחשב לשיפור AI**. A client or declaration is not required.
4. Scan the shown QR in Telegram and press Start. The bot should say that Windows Hello setup is required and that no photo should be sent.
5. In the browser, press **המשך ל‑Windows Hello**, then complete the Windows Hello prompt on the PC. This explicit click is required by the browser before it may open the authenticator.
6. The drawer should now say that the computer is connected. The separate connection dialog closes automatically; no upload screen is opened.
7. Select a row that has relevant closed history and press **שפר לפי היסטוריה**.
8. Windows Hello should appear. There must be no QR and no Telegram message.
9. After approval, verify that only allowed pass-2 fields can change and the Improve button remains available.
10. Click Improve again: it may run without another Hello prompt for up to five minutes. After five minutes, Hello should be requested again.

If the browser says the credential is no longer registered, the UI clears the local identifier. Enrol Windows Hello again through the workspace drawer. If `navigator.credentials` is unavailable, use current Chrome or Edge on Windows 11.

## Known limitations / next logical work

1. Keep the automated Worker passkey tests current: they cover registration/authentication state, counter updates, grant expiry, and invalid signatures. A real platform authenticator remains a short production release check.
2. Evaluate whether an explicit, audited closed-declaration reopen process is needed. Do not silently unlock closed declarations.
3. Improve declaration lifecycle/UI only from user feedback; do not reintroduce removed package controls or change the Hebrew UI casually.

## Bookkeeper feedback — implemented locally, pending next release

- The recognised expense percentage is now applied to the original VAT-inclusive amount first. The recognised gross amount is then split into net and VAT; all three visible amounts, saved rows, PDF reports and Rivhit TXT use the same rounded values. For example, a 720.00 invoice at 25% produces 180.00 gross, 152.54 net and 27.46 VAT.
- `% מוכר כהוצאה` is wider in the journal. Changing it on a taxable row also aligns `% מוכר מע״מ` with it, so a 25% expense cannot retain 100% VAT by accident.
- The document viewer has a `↗` control that opens the current local image in a separate browser window, which can be moved to another display. The embedded viewer remains available.
- `קוד מיון` has a final `הוספת קוד מיון חדש…` entry. It stores a three-digit code and Hebrew label in the selected data root at `common/custom-rivhit-mapping.json`; codes are local to that root, available to every client there, and are accepted by PDF/TXT export. Standard codes cannot be overwritten. User-defined codes are selected manually; Gemini does not invent them.
- `% מוכר מע״מ` now includes 66.67%. Editing either gross (`כולל מע״מ`) or net (`ללא מע״מ`) recalculates the other source amounts immediately at the row VAT rate.
- Duplicate references are shown as a review warning and their export checkbox starts unchecked; the bookkeeper can explicitly include one after review.
- Income reports are retained as rows, assigned a locally-created next-free `הכנסות` code, and may be exported. A mixed zero-VAT/taxable invoice produces one row for each VAT group with the same reference.
- The photo viewer opens the local image in a dedicated movable browser popup and initially contains the entire document.
- Draft and final exports also include `classification-codes.pdf`, listing used classification codes and highlighting locally added codes from the current declaration.
- The local image popup again supports left-button drag reliably: native browser image dragging is disabled, pointer capture is used for the pan, and the mouse wheel pans vertically. The legacy in-page viewer has the same wheel behaviour.
- Typing in `קוד מיון` now expands the filtered result list immediately (up to six results). Arrow Down moves into that list; Escape closes it.
- Any code path that clears `לייצוא`, including automatic duplicate detection, uses the same helper that adds the full-row grey `not-for-export` state. This covers a checkbox changed by the agent, duplicate detection, and restored drafts.
- `כולל מע״מ` and `ללא מע״מ` remain separate editable fields. Their input is no longer reformatted while the user types; recalculation and draft save happen only on Enter or when the field loses focus. Their accessible labels distinguish gross from net.
- Pass 1 now explicitly distinguishes `חייב במע״מ` from `לא חייב במע״מ`: a printed exempt/0% group preserves its printed total as net, with VAT rate, amount, and recognised percent all set to zero. The Worker prompt and readable prompt source have matching wording.
- A manual code change on a row with a recognised Form 6111 now saves a shared `Form 6111 → קוד מיון` override in `common/custom-rivhit-mapping.json`. It is available to every client in that data root and is passed to Gemini on the next Pass 1 rerun and Pass 2 history refinement. Gemini still cannot invent a Form 6111 or a code: only known Form 6111 entries and codes already present in the common book are sent.

Worker version `e0cbee01-b079-4693-9597-56eac7a5a0d9` was deployed on 13 September 2026. Before accepting the release, manually test left-button and wheel image panning, classification search, both manual amount fields (including decimal entry), an agent-disabled/duplicate row, and taxable, exempt, and mixed-VAT documents.

## Proposed next steps

1. **Make device recovery explicit.** Add a compact management view for connected computers: show non-secret metadata (creation date, authenticator type and last successful use where available), let Vitalik revoke a lost/retired computer after a fresh Windows Hello approval, and make “connect this computer again” clearly create a replacement credential. Do not expose credential IDs, tokens or keys in the UI.
2. **Decide closed-declaration recovery before building it.** If reopening is needed, require an explicit reason, create an immutable audit entry and preserve the former final export. Never silently make a closed declaration editable.
3. **Collect real bookkeeping feedback before larger UI work.** Prioritise only observed friction in client selection, monthly declaration switching, review and export; retain the local-first and Hebrew UI constraints.

## Validation commands

After browser changes:

~~~powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check
~~~

Expected automated browser tests currently: **32 passing**.

After Worker changes:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm test
npm run check
~~~

The five Worker tests exercise Durable Object passkey state with a mocked verifier; `npm run check` runs `wrangler deploy --dry-run` and must list both Durable Objects. Then manually test the changed production flow.

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
