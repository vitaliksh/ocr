# Handoff — Rivhit document intake

**Updated:** 19 September 2026, 17:49 IDT

**Repository:** https://github.com/vitaliksh/ocr

**Latest browser source:** `a7053eb` — makes `812` mobile phone, adds `888` internet, and writes the selected declaration month to every Rivhit TXT record.

**Production Worker:** `86b109ae-2a27-4805-8d88-d58f0b2d7ab4` — backend version `2026.09.19.4 · 12:44 IDT`
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
| Branch | `main` | GitHub Pages source; current relevant commit `2067553` |
| Production Worker | `959f6607-7d76-4d1d-bdc2-c5e8879f94e8` | `/health` reports backend version; OCR currency-token guard enabled |

Push `main` for GitHub Pages. Worker source changes also require `npx wrangler deploy` from `cloudflare-worker/`.

The drawer shows separate cache-verifiable frontend and backend markers:

~~~text
גרסת ממשק: 2026.09.19.7 · 17:20 IDT
גרסת שרת: 2026.09.19.4 · 12:44 IDT
~~~

The backend marker is fetched from `/health`. Force refresh with `Ctrl+F5` and verify both markers before testing a recent change.

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
- Dates display as `DD/MM/YY`; export also accepts four-digit years and `-`, `/`, or `.` separators.
- Gross and net remain separate inputs; recalculate/save on Enter or blur, not while typing.
- Expense recognition controls recognised gross. VAT recognition independently controls deductible VAT; non-deductible VAT remains in the expense. Example: raw net/VAT `100/18` at 100% expense and 66.67% VAT becomes gross/net/VAT `118/106/12`.
- Changing taxable expense recognition aligns VAT recognition. VAT recognition includes 66.67%; Rivhit codes `806`, `807`, and `812` (`טלפון נייד`) default to 66.67% when source VAT is nonzero. Code `888` is `אינטרנט` and defaults to 100%.
- Exempt/0% groups keep gross=net and all VAT values zero. Mixed VAT invoices split by VAT group.
- Duplicates are review warnings and initially unchecked. Rows marked **לא מיועד לייצוא** are grey and skipped.
- Income reports are retained, assigned a locally-created next-free income code, and may export.
- Classification search filters by code or name while typing, but the compact selector displays the name without the numeric prefix. The local photo popup supports drag and wheel panning.
- Exports include `classification-codes.pdf`, highlighting local codes used by the declaration.
- Draft and final exports show a modal success/error result. On success it shows copyable paths for `invoices.pdf` and `import.txt`. Browser security exposes only a path relative to the selected data-root name, not the Windows drive letter.
- The journal heading shows the active client/declaration. The drawer heading shows the selected data-root name.

## TXT export contract and safeguards

TXT is CP1255/Windows-1255, CRLF, no header, and exactly 186 fields per active row.

The template supplies its mandatory short structural flags (such as `1`, `2`, `4`) and default `1.00` coefficient. Source-specific values are never copied: dates, amounts, identifiers, descriptions, Hebrew names, and negative balances are cleared before writing the documented fields from the current record.

The intended known fields include document-date parts, declaration-month fields (one-based columns 2 and 186, identical for every record), sequence, Rivhit code, gross, description, references, allocation number, classification name, recognition, net/VAT/VAT rate, and supplier ID. For one-based column 158, the exporter writes the source VAT rate multiplied by the deductible-VAT percentage: 18% at 66.67% is `12.00`; 18% at 25% is `4.50`; a genuinely zero-VAT row is `0.00`.

Accepted dates:

- `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`
- `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`
- `DD/MM/YY` and equivalent separators; two-digit years mean `20YY`

Before draft export or final close, the browser validates **all active rows** and opens a modal list if any fail. No export folder is created for an invalid set. Checks cover template width, approved classification, date, money, VAT reconciliation, valid nonzero VAT rate where VAT is nonzero, CP1255 encodability, and negative numeric fields. `buildRivhitImport` repeats this validation as a backstop.

Common typography unsupported by CP1255 is normalised during TXT generation: Hebrew geresh/gershayim, curly quotes, long dashes, non-breaking spaces, and ellipsis get safe equivalents; remaining unsupported glyphs become `?` instead of blocking export.

## Gemini and local code propagation

### Pass 1

Pass 1 receives the image, business activity, selected model, Form 6111 overrides, and local custom codes. It returns source facts, classification, confidence, explanation, and source-value boxes. It must distinguish taxable/exempt VAT, never invent source facts, Form 6111 codes, or Rivhit codes. Its runtime prompt explicitly treats `₪`, `ש״ח`, `NIS`, and attached currency signs as decoration, reads the full adjacent numeric token before stripping the sign, and uses `₪61,631.40 → 61631.40` as the regression example.

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
- The `test5 / 2026-09` draft export at `D:\ocr_test\clients\test5\declarations\2026-09\exports\2026-09-19_12-47` was audited: 30 TXT records, exactly 186 columns each, CP1255, CRLF, no BOM, no negative fields, and exact manifest agreement for mapped dates/codes/amounts/references/IDs. Totals are gross `126,024.35`, net `107,245.84`, VAT `18,778.51`. Both PDFs render correctly; the 30-page invoice report has no visible clipping.

Confirmed Rivhit import repair (19 September, browser version 2026.09.19.7):

- The original `test5` export `_12-47` failed because all rows put `0` in one-based column 158, including 27 taxable rows. The repair derives this field from the canonical template rule: source VAT rate × deductible-VAT percentage. The template's 18% × 66% example yields `11.88`; the application uses `12.00` for 66.67% and `4.50` for 25%.
- The initial column-158 repair still zeroed mandatory short structural flags from the Rivhit template. The final writer retains only safe short flags and default `1.00`, while clearing source-specific dates, amounts, IDs, and text.
- `D:\ocr_test\clients\test5\declarations\2026-09\exports\2026-09-19_17-22\import.txt` was verified: 30 records, 186 columns each, 27 taxable records with no zero VAT rate, and required template flags restored. Vitalik confirmed that Rivhit imports it correctly.
- Review the two active income rows (`61,631.40` and `56,934.40`, code `827`) for overlapping January-February revenue before final import. The latter uses report-generation date `02/03/26`.

Recommended short production check:

1. `Ctrl+F5`; open the drawer and verify frontend `2026.09.19.7 · 17:20 IDT` and backend `2026.09.19.4 · 12:44 IDT`.
2. Select `D:\ocr_test`; confirm its clients appear and the prior OneDrive declaration does not remain active.
3. Add a harmless custom code and process/rerun a document; confirm the code is available only as an approved option.
4. Import a PDF into a non-OneDrive declaration.
5. The `test5` import was confirmed successful; repeat the same 186-field, VAT-rate, structural-flag and no-leak checks for future template or exporter changes.

## Next decisions

1. Resolve whether the two `827` income reports overlap and which accounting date belongs in the second row.
2. Device recovery: add non-secret connected-device metadata and revocation after fresh Windows Hello.
3. Closed-declaration recovery: if needed, require a reason, immutable audit record, and preserved prior final export.

## Validation and deployment

Browser:

~~~powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check
~~~

Expected: **41 passing**.

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
