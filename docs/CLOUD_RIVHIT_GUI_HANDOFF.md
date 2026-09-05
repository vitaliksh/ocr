# Cloud Rivhit GUI — handoff for the next dialog

Updated: 5 September 2026

Repository: https://github.com/vitaliksh/ocr  
Local checkout: D:\projects\ocr  
Current source commit: e1d5ae1 (Keep related VAT rows together)

This is the active handoff. The older TELEGRAM_TRANSFER_HANDOFF.md is retained
as history of the transfer-only stage.

## Live cloud components

| Component | Address / identity | Role |
| --- | --- | --- |
| User application | https://vitaliksh.github.io/ocr/ | Static Hebrew RTL web interface. User refreshes with Ctrl+F5 after deployment. |
| API and AI backend | https://rivhit-telegram-transfer.vitaliksh.workers.dev | Cloudflare Worker for Telegram transport and Gemini recognition. |
| Telegram bot | @Vitalikshbot | User sends document photos here. |
| Deployed Worker version | e803c859-d9a4-4bad-9500-62006280ee93 | Current at this handoff. |

The user deliberately chose this cloud design. Do not move the published
workflow back to a local executable or app.py without a new explicit request.

## Source layout and architecture

### Browser client: telegram-web

- index.html: Hebrew RTL page and table headers.
- app.js: session control, SSE, receiving images, recognition queue, table
  updates, calculations, cancellation/rerun controls and image viewer.
- styles.css: base visual styling and image viewer.
- table-layout.css: compact table proportions and resize-handle styling.
- table-columns.js: user-draggable table columns. Widths are saved in browser
  localStorage as rivhit-table-column-widths-v1.
- rivhit-mapping.js: approved classification dropdown mapping generated from
  6111_to_Rivhit.xlsx.
- config.js: public Worker API address only; contains no secrets.

Any committed telegram-web change pushed to main deploys through
.github/workflows/deploy-telegram-web.yml to GitHub Pages. The GitHub Actions
repository variable TELEGRAM_TRANSFER_API supplies the public API URL.

### Cloud backend: telegram-worker

- src/index.js: Worker HTTP endpoints, Telegram webhook, R2/session transport,
  Gemini call, validation, normalization and retry policy.
- src/rivhit-mapping.js: Form 6111 to Rivhit mapping used to validate the
  model classification.
- wrangler.toml: bindings and public configuration.

The Worker uses a Durable Object named UPLOAD_SESSION for temporary session
state, temporary R2 bucket rivhit-temporary-photos for photos before ACK, SSE
for notifications, and Gemini REST API for vision analysis.

The older local application in app.py and web is separate and is not used by
the cloud product.

## Security rules

Never expose, print, commit, or ask the user to provide these Worker secrets:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- GEMINI_API_KEY
- ALLOWED_TELEGRAM_USER_ID

ALLOWED_TELEGRAM_USER_ID prevents a visitor to the public page from using the
Gemini quota. Browser session tokens remain only in page memory and are sent in
the X-Upload-Token request header, never in a URL.

Worker CORS is based on origins only. The GitHub Pages value is
https://vitaliksh.github.io, without the /ocr/ path.

## Implemented user flow

1. User opens the hosted page, starts photo upload and scans the QR code.
2. Telegram connects to the temporary browser session.
3. User sends JPEG/PNG document photos to @Vitalikshbot.
4. Worker downloads Telegram's highest-resolution image to temporary R2.
5. Browser receives an SSE event, downloads it as an in-memory Blob/Object URL
   and sends ACK. R2 image is deleted after ACK, Finish or session expiry.
6. Each source photo has an image sequence number: תמונה #1, תמונה #2, etc.
   One photo may legitimately produce several records, all with the same image
   number.
7. Gemini analyzes each photo and creates journal records.

Transport supports JPEG/JPG and PNG, passes at most 12 MB to Gemini, uses a
30-minute rolling inactive-session timeout (four-hour maximum total lifetime),
and rejects videos. Rapid photo batches are serialized safely.

## Gemini and processing controls

- Default selected model: gemini-3.5-flash-lite.
- Other UI choices: gemini-3.6-flash, gemini-3.5-flash,
  gemini-3.1-pro-preview.
- The Worker retries Gemini 429 and 5xx responses up to four times with
  exponential waits of about 2, 4, 8 and 16 seconds.
- User can cancel processing. An unprocessed/cancelled row shows עבד; a
  completed row shows עבד מחדש.
- A rerun sends X-Target-Record and must update only that row, rather than
  recreate all records from the photo.

## Current journal UI

The table has 19 Hebrew columns:

#, תאריך, קוד מיון, פרטים, ספק, ע.מ./ת.ז, אסמכתא, מספר הקצאה,
כולל מע״מ, ללא מע״מ, מע״מ, % מוכר מע״מ, % מוכר כהוצאה, תמונה,
החלטת הסוכן, ביטחון, סטטוס, לייצוא, מחק.

Important behaviour:

- קוד מיון is a dropdown listing all approved codes from 6111_to_Rivhit.xlsx.
- Text wraps; the default widths avoid horizontal scroll in normal desktop use.
- לייצוא is intentionally narrow (checkbox only); מחק is wider for the button.
- User can drag header boundaries to resize columns. That preference is
  automatically restored in the same browser/computer through localStorage.
  A static GitHub Pages page cannot write a shared configuration file back to
  the Git repository. Clearing browser site data resets widths to defaults.
- Image viewer window can be moved, resized from edges/corners, panned with
  held left mouse button, and zoomed via its on-screen controls. The title
  shows the image sequence number.
- Browser-reserved Ctrl-plus/minus cannot be reliably taken over by page
  JavaScript, so use the viewer buttons for image-only zoom.

## Activity and calculation rules

Page-level controls:

- סוג פעילות העסק defaults to שיעורי ספורט ופילאטיס פרטיים.
- סוג העסק defaults to עסק בבית פרטי; option עסק במשרד is also present.

Row controls:

- % מוכר כהוצאה offers 100% and 25%.
- % מוכר מע״מ supports 100%, 25% and 0%; the zero option is required for a
  zero-VAT record.

At home-business mode, codes 809 and 820 use 25% expense recognition. At
office mode they use 100%. Changing business type or classification
recalculates the rows.

The approved formula is:

    כולל מע״מ =
      (ללא מע״מ × % מוכר כהוצאה) +
      (מע״מ מהמסמך × % מוכר מע״מ)

The displayed כולל מע״מ is therefore calculated, not extracted as an
authoritative document value. Raw net and VAT values are stored in the row
dataset and drive recalculation.

## Mixed VAT invoices: latest important implementation

If one physical invoice explicitly prints distinct taxable amounts for more
than one VAT rate, Gemini must create one row for each VAT-rate group.

Example printed receipt:

    מוצרים חייבים ב- 18% מע״מ 194.28
    מוצרים חייבים ב- 0% מע״מ 70.90
    סה״כ מע״מ 34.97

Expected table records:

| group | ללא מע״מ | מע״מ | כולל מע״מ before recognition | % מוכר מע״מ |
| --- | ---: | ---: | ---: | ---: |
| 18% | 194.28 | 34.97 | 229.25 | 100% |
| 0% | 70.90 | 0 | 70.90 | 0% |

The grand total of the receipt is not a separate record.

Worker prompt safeguards now explicitly say:

- a printed line like מוצרים חייבים ב- 18% מע״מ 194.28 is the taxable net
  amount 194.28, not a VAT-inclusive amount; never divide it by 1.18;
- the only allowed reason to return more than one row for a physical invoice
  is an explicitly printed VAT-rate split;
- watermarks, logos, backgrounds, repeated/partial text and incidental
  fragments must never become records;
- a fieldless other record alongside a real expense record is filtered by the
  Worker as an artefact.

For mixed VAT results, the browser inserts extra rows immediately after the
same image's original row. Image index is assigned when its Telegram event
arrives (before async download), so batches retain arrival order. After an
insertion, all # sequence values are recalculated.

## Deployment procedure

### Browser-only changes

From the repository root:

    Set-Location D:\projects\ocr
    git add telegram-web
    git commit -m "Describe the change"
    git push origin main

GitHub Pages deploys automatically. Tell the user to wait for the build and
use Ctrl+F5.

### Worker changes

Validate and commit from repository root:

    Set-Location D:\projects\ocr
    node --check telegram-worker\src\index.js
    git add telegram-worker\src\index.js
    git commit -m "Describe the change"
    git push origin main

Then deploy from the Worker directory:

    Set-Location D:\projects\ocr\telegram-worker
    node node_modules\wrangler\bin\wrangler.js deploy

On this Windows computer npx is not on PATH. The node command above is the
known-good deployment command. A Git push does not deploy Worker code; it
publishes only the static web application.

Before committing, run as applicable:

    node --check telegram-web\app.js
    node --check telegram-web\table-columns.js
    node --check telegram-worker\src\index.js
    git diff --check

Use apply_patch for source changes. Do not reset or discard unrelated worktree
changes.

## Recent commits

- e1d5ae1: keeps related VAT rows together, preserves batch order and table
  numbering, filters obvious artefact records.
- a0dce85: preserves printed taxable amount in a standard-VAT group.
- 1170e8c: mixed-VAT split and 0% VAT recognition.
- a743239: resizable, browser-persisted table columns.
- 79db9ad: compact readable table proportions.
- 3bd20bb: code dropdown, business type and recognized-amount calculation.
- 3e489fd and 30c51e6: image viewer improvements and row-specific rerun.

Earlier Telegram transport history is in TELEGRAM_TRANSFER_HANDOFF.md.

## Recommended regression checks for future changes

1. Send two separate photos in one Telegram batch.
2. Include a mixed-VAT invoice.
3. Confirm image groups appear in arrival order and same-image rows are
   adjacent.
4. Confirm exactly two mixed-VAT records with correct values and 0% VAT
   recognition for the zero-rated group.
5. Confirm no blank/artefact row is added.
6. Test עבד מחדש on one row only.
7. Change business type, classification and percentages; confirm calculated
   כולל מע״מ updates.
8. Check cancellation, photo viewer and persisted column widths.

No further product expansion is currently authorized. Do not add exports,
long-term data storage, multi-user settings, shared cloud configuration or a
new OCR provider unless the user asks for it.
