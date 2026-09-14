# Handoff — Rivhit document intake

**Updated:** 14 September 2026, 18:00 IDT

**Repository:** https://github.com/vitaliksh/ocr

**Latest browser source:** `40eceac` — sends local custom Rivhit codes to Gemini; build time moved into the title

**Production Worker:** `530e0514-0f81-4387-96bf-daa04d012dd3` — deployed 14 September 2026
**Primary user:** Vitalik. Address him in Russian, informally. The shipped UI is Hebrew; do not translate it without an explicit request.

## Product and hard boundaries

This is a local-first browser application for preparing Israeli Rivhit expense-journal imports. It is a bookkeeping aid, not accounting or tax advice.

1. The bookkeeper selects a local data root, client, and monthly declaration in Chrome/Edge on Windows.
2. Documents arrive from an iPhone through Telegram or are selected as a local PDF.
3. Gemini Pass 1 produces editable draft rows.
4. The bookkeeper reviews and edits every row.
5. Open declarations export repeatedly as PDF + Rivhit TXT.
6. Closing creates a final export, appends text-only closed history exactly once, then locks the table.
7. Gemini Pass 2 improves accounting judgement from relevant local closed history, but never source facts.

Never add cloud persistence for client workspaces, declarations, draft tables, source images, PDFs, TXT files, exports, or history. Those remain in the selected local folder. R2 only holds temporary Telegram images until the browser saves and ACKs them.

Use a local, non-synchronised active root. Do **not** use OneDrive as the active root: File System Access handles can become invalid when OneDrive changes a file, causing the Windows cached-interface-state error. A PDF may be selected from any local path; the failure is normally while the app writes its source PDF and rendered pages into the active root.

The intended test root is `D:\ocr_test` (not `D:\ocr\_test`). `D:\ocr_test` contains `test4` and `test5`. The latter path is an empty folder accidentally created during diagnosis and contains no project data.

## Production components

| Component | Location | Purpose |
| --- | --- | --- |
| Browser UI | https://vitaliksh.github.io/ocr/ | Local files, workspaces, journal, exports, PDF import, Windows Hello |
| Worker API | https://rivhit-telegram-transfer.vitaliksh.workers.dev | Telegram, temporary R2, Gemini Pass 1/2, passkeys |
| Telegram bot | `@Vitalikshbot` | iPhone intake and one-time computer enrollment |
| Branch | `main` | GitHub Pages source; current relevant commit `40eceac` |
| Production Worker | `530e0514-0f81-4387-96bf-daa04d012dd3` | Custom-code CORS and validation enabled |

Push `main` for GitHub Pages. Worker source changes also require `npx wrangler deploy` from `cloudflare-worker/`.

The UI shows a cache-verifiable marker next to the heading:

~~~text
קליטת מסמכים ל‑Rivhit  גרסת ממשק: 2026-09-14 18:00 IDT
~~~

Force refresh with `Ctrl+F5` and verify this marker before testing a recent UI change.

## Security

Never print, commit, request, or store in browser storage:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `ALLOWED_TELEGRAM_USER_ID`

They are Worker secrets. Sessions and grants are opaque values and must not be logged.

### Windows Hello / Pass 2

Telegram is needed once for **חיבור המחשב לשיפור AI**. Later **שפר לפי היסטוריה** uses Windows Hello only—no Telegram or QR.

- Private passkey material stays in the platform authenticator.
- `DEVICE_REGISTRY` contains public material, counter, transport metadata, short-lived challenge, and a five-minute grant only.
- Browser `localStorage` contains only `rivhit-passkey-credential-id-v1`.
- The in-memory grant lasts five minutes and is cleared by refresh.
- The RP is fixed to `vitaliksh.github.io`; test WebAuthn on published GitHub Pages, not arbitrary local HTTP.

## Repository map

- `telegram-web/`
  - `app.js` — UI, queues, journal, exports, Pass 2, custom-code request headers.
  - `workspace.js` — File System Access root/client/declaration drawer.
  - `declaration-core.js`, `declaration-store.js` — lifecycle and local persistence.
  - `custom-rivhit-mapping.js` — local custom codes and Form 6111 overrides.
  - `rivhit-export.js` — CP1255 186-column TXT builder and validation.
  - `pdf-import.js`, `pdf-report.js` — local PDF import and reports.
  - `history-ranker.js` — local, text-only Pass 2 history selection.
- `cloudflare-worker/`
  - `src/index.js` — routes, Gemini prompts/normalisation, CORS, Durable Objects.
  - `src/rivhit-mapping.js` — approved Form 6111 map.
  - `wrangler.toml`, `DEPLOYMENT.md` — Worker bindings/deployment record.
- `docs/RIVHIT_IMPORT_SPEC.md` — TXT contract.
- `6111_to_Rivhit.xlsx` — approved Form 6111 → Rivhit mapping.

Do not restore the deliberately removed Python application or exploratory package flow.

## Local data model

~~~text
<data-root>/
├─ common/
│  ├─ PKUDA_AI_TEST.TXT
│  └─ custom-rivhit-mapping.json
└─ clients/<client>/
   ├─ workspace.json
   ├─ history.jsonl
   └─ declarations/YYYY-MM/
      ├─ declaration.json
      ├─ draft-table.json
      ├─ images/
      └─ exports/YYYY-MM-DD_HH-mm[_NNN]/
         ├─ invoices.pdf
         ├─ classification-codes.pdf
         ├─ import.txt
         └─ manifest.json
~~~

The selected template is copied to `common/PKUDA_AI_TEST.TXT`; its first non-empty row must contain exactly 186 tab-separated fields.

`common/custom-rivhit-mapping.json` is schema 3. It stores local custom codes, creation metadata, and explicit Form 6111 overrides:

~~~json
{
  "schemaVersion": 3,
  "codes": { "828": "Example local code" },
  "metadata": { "828": { "createdAt": "2026-09-14T...Z" } },
  "form6111Mappings": { "3600": "807" }
}
~~~

Custom codes are root-local, available to every client in that root, exactly three digits, and cannot overwrite built-in codes.

## Workspaces, declarations, and PDF import

- **החלפת תיקיית נתונים** saves the old draft, clears the active client/declaration/table and its old directory handle, loads mappings from the new root, then requires explicit client/declaration selection there. It must never retain a OneDrive declaration handle after switching roots.
- A root can be empty; the app creates `common/` and `clients/`. Never silently copy/move/merge data between roots.
- Users can create, edit, archive, restore, and delete clients. Each client has `YYYY-MM` declarations.
- Open declarations are editable. Closed declarations stay visible, are read-only, and must not be silently reopened.
- Closing validates exportable rows, creates the final export, appends history once by `declarationId`, then locks the table.
- A Telegram-authorised session allows one local PDF. The app saves the original PDF locally, renders JPEG pages locally, saves them locally, then queues each page through the existing Pass 1 route.

`D:\projects\ocr\pdf examples\7-8.26.pdf` was checked: 34 A4 pages, 6.08 MB, unencrypted, valid. It was not the cause of the File System Access error.

## Journal behaviour already implemented

- Open-row fields, including dates, are editable.
- Gross and net remain separate inputs; recalculate/save on Enter or blur, not while typing.
- Recognition percentage is applied to gross first, then recognised gross is split to rounded net/VAT. Example: 720.00 × 25% = 180.00 gross, 152.54 net, 27.46 VAT.
- Changing taxable expense recognition aligns VAT recognition. VAT recognition includes 66.67%.
- Exempt/0% groups keep gross=net and all VAT values zero. Mixed VAT invoices split by VAT group.
- Duplicates are review warnings and initially unchecked. Rows marked **לא מיועד לייצוא** are grey and skipped.
- Income reports are retained, assigned a locally-created next-free income code, and may export.
- Classification search filters while typing. The local photo popup supports drag and wheel panning.
- Exports include `classification-codes.pdf`, highlighting local codes used by the declaration.

## TXT export contract and safeguards

TXT is CP1255/Windows-1255, CRLF, no header, and exactly 186 fields per active row.

The template validates **layout only**. No value is copied from it. Every generated row starts as 186 literal `0` fields, then writes documented fields from the current record. Unknown fields remain `0`. This resolves the filled-template regression that leaked old amounts, dates, identifiers, text, and negative balances.

Known fields include date parts, sequence, Rivhit code, gross, description, references, allocation number, classification name, recognition, net/VAT/VAT rate, and supplier ID.

Accepted dates:

- `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`
- `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`
- `DD/MM/YY` and equivalent separators; two-digit years mean `20YY`

Before draft export or final close, the browser validates **all active rows** and opens a modal list if any fail. No export folder is created for an invalid set. Checks cover template width, approved classification, date, money, VAT reconciliation, CP1255 encodability, and negative numeric fields. `buildRivhitImport` repeats this validation as a backstop.

## Gemini and local code propagation

### Pass 1

Pass 1 receives the image, business activity, selected model, Form 6111 overrides, and local custom codes. It returns source facts, classification, confidence, explanation, and source-value boxes. It must distinguish taxable/exempt VAT, never invent source facts, Form 6111 codes, or Rivhit codes.

When **הוספת קוד מיון חדש…** succeeds:

1. `saveCustomRivhitMapping` immediately writes it to `<root>/common/custom-rivhit-mapping.json`.
2. Browser memory updates the selector and export mapping immediately.
3. Future Pass 1 and Pass 2 requests send `X-Custom-Rivhit-Codes` with the current root-local custom map.
4. Worker validates at most 200 safe three-digit non-built-in codes and includes them in the Gemini prompt.
5. Worker accepts a direct custom code only if it is in that supplied list; invented codes are discarded.

`X-Form-6111-Mapping` remains separate and carries explicit Form 6111 → Rivhit overrides.

For an expense invoice, Gemini must prefer a fitting approved Form 6111 code. If none fits, it may select a supplied local custom code. The schema carries both `form_6111_code` and `rivhit_code`; exactly one should be non-null, and Worker normalisation validates either result.

### Pass 2

Pass 2 receives only the active draft row and 1–8 relevant closed-history records, all text-only. The ranker prefers supplier ID/name, then classification/description, and excludes images/raw monetary values from history context.

Pass 2 may change classification, recognition percentages, confidence, review state, and agent opinion. It must not alter date, supplier, supplier ID, references, allocation number, raw net/VAT/gross, or currency. It receives the same Form 6111 and custom-code context as Pass 1.

## Confirmed state and remaining manual checks

Completed:

- Windows Hello production flow was accepted in Edge/Windows 11; five-minute grants and source-field protection behave correctly.
- The Form 6111 CORS regression was repaired and ordinary processing was manually confirmed.
- Filled-template TXT leakage is fixed.
- `test3 / 2027-01` was built in memory after date normalisation: 36 active rows, no validation issues, no negative output fields.
- `19/08/26` now normalises to 2026 instead of blocking export.
- Root switching clears the old declaration handle.
- Local code persistence was confirmed in `D:\ocr_test\common\custom-rivhit-mapping.json`; `40eceac` fixes the previous omission from Gemini context.

Recommended short production check:

1. `Ctrl+F5`; verify `2026-09-14 18:00 IDT` by the title.
2. Select `D:\ocr_test`; confirm its clients appear and the prior OneDrive declaration does not remain active.
3. Add a harmless custom code and process/rerun a document; confirm the code is available only as an approved option.
4. Import a PDF into a non-OneDrive declaration.
5. Create a TXT export and inspect 186 fields, no old template values, no negative numbers.

## Next decisions

1. Device recovery: add non-secret connected-device metadata and revocation after fresh Windows Hello.
2. Closed-declaration recovery: if needed, require a reason, immutable audit record, and preserved prior final export.
3. Gather bookkeeper feedback before a broad UI redesign.

## Validation and deployment

Browser:

~~~powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check
~~~

Expected: **36 passing**.

Worker:

~~~powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm test
npm run check
npx wrangler deploy
~~~

Expected: **5 passing**. `npm run check` is `wrangler deploy --dry-run` and must list both Durable Objects.

After a browser-only change, push `main`, wait for Pages, force-refresh, and verify the visible build marker. After a Worker change, record the returned version in `cloudflare-worker/DEPLOYMENT.md`, commit/push source and docs, and manually test the changed production flow.

Do not use destructive Git commands in a dirty worktree. Preserve unrelated user changes. At this handoff `pdf examples/` is intentionally untracked.
