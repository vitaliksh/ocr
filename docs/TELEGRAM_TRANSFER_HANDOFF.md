# Telegram photo transfer — status and next stage

**Updated:** 4 September 2026

**Project:** `D:\projects\ocr`
**Specification:** [Technical_requirements.txt](../Technical_requirements.txt)

## 1. Goal of the completed stage

The first stage described in the technical requirements is complete: a user can use an iPhone with Telegram as a temporary wireless document camera for a browser on Windows.

The scope of this stage is **photo transfer only**. It deliberately does not run OCR, Gemini, Rivhit export, or any bookkeeping logic.

The tested user flow is:

1. Open the browser page.
2. Click **Upload photos**.
3. Scan the QR code with the phone.
4. Tap **Start** in the Telegram chat with `@Vitalikshbot`.
5. Send document photos.
6. See a thumbnail for every photo in the browser almost immediately.
7. Click **Finish**.
8. Send another photo to the bot and receive: `No active upload session. Start a new upload session from the PC.`

## 2. What is implemented

### Browser client

- Published page: <https://vitaliksh.github.io/ocr/>
- Source folder: [`telegram-web/`](../telegram-web/)
- The page is static and contains no secret values.
- It creates a session, renders a QR code and Telegram deep link, opens a Server-Sent Events (SSE) connection, downloads received photos as in-memory `File` objects, shows thumbnails, and sends an ACK for each file.
- The client holds the browser session token in page memory only. It is sent in the `X-Upload-Token` header, never in a URL.
- If the Finish request cannot be confirmed within 10 seconds, the browser returns to the inactive state instead of leaving the Finish button disabled forever. The server-side session then expires automatically.

### Cloudflare Worker

- Published Worker: <https://rivhit-telegram-transfer.vitaliksh.workers.dev>
- Source folder: [`telegram-worker/`](../telegram-worker/)
- Telegram bot: `@Vitalikshbot`
- Worker configuration: [`telegram-worker/wrangler.toml`](../telegram-worker/wrangler.toml)
- Temporary R2 bucket: `rivhit-temporary-photos`
- Session state: a Cloudflare Durable Object per temporary browser session.

The Worker:

- generates cryptographically random, separate Telegram session IDs and browser client tokens;
- validates Telegram webhook requests using `TELEGRAM_WEBHOOK_SECRET`;
- uses `TELEGRAM_BOT_TOKEN` only as a Cloudflare secret;
- maps a Telegram user to one active temporary session only;
- downloads the highest-resolution Telegram photo to R2;
- tells the browser about every photo through SSE;
- retains an R2 object until the browser sends `ACK(document_id)`;
- deletes the object after ACK, Finish, or expiry;
- applies a 30-minute rolling inactivity timeout, capped at four hours;
- serializes state changes within a session, so batches of quickly sent photos do not overwrite each other;
- rejects video/video-note/animation messages with `Videos are not supported. Please send document photos.`

### Hosting and deployment

- GitHub Pages workflow: [`.github/workflows/deploy-telegram-web.yml`](../.github/workflows/deploy-telegram-web.yml)
- GitHub Actions repository variable (public, not a secret):

  ```text
  TELEGRAM_TRANSFER_API=https://rivhit-telegram-transfer.vitaliksh.workers.dev
  ```

- Worker CORS allows local development and the Pages origin:

  ```text
  http://127.0.0.1:8000
  http://localhost:8000
  http://127.0.0.1:8010
  http://localhost:8010
  https://vitaliksh.github.io
  ```

Important: CORS uses the **origin** only. Do not add `/ocr/` to the GitHub Pages entry.

## 3. Secrets and safe operations

Configured only in Cloudflare Worker secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Never ask the user to paste, commit, display, or store either value in source code, GitHub Actions variables, browser JavaScript, or `.env` files.

The public Worker URL, bot username, R2 bucket name, and GitHub Pages URL are safe to keep in documentation and source configuration.

When Worker source or `wrangler.toml` changes, deploy it from the project machine:

```powershell
Set-Location D:\projects\ocr\telegram-worker
npx wrangler deploy
```

When only `telegram-web/` changes, commit and push to `main`; the GitHub Pages workflow publishes it automatically.

## 4. Tests already passed by the user

The following were tested successfully on Windows Edge and iPhone Telegram:

- QR code opens `@Vitalikshbot`;
- pressing Start connects the Telegram account to the browser session;
- one, two, and three photos appear in the browser;
- five photos sent quickly in one batch appear without `Photo download failed`;
- thumbnails and received counters are correct;
- Finish returns the browser to the **Upload photos** state;
- a photo sent after Finish is rejected as having no active session;
- the iPhone Telegram camera works;
- unsupported video no longer leaves Finish permanently disabled.

Recommended remaining acceptance checks (not yet formally recorded):

1. Leave an inactive session for 30 minutes, then verify Telegram rejects a subsequent photo.
2. Interrupt the browser network during a photo transfer, reconnect, and verify no duplicate thumbnail appears.
3. Confirm that a session with delivered photos leaves no objects in R2 after ACK/Finish using the Cloudflare dashboard if desired.

## 5. Relevant commits

The initial implementation and subsequent fixes are on `main`:

- `e94596b` — initial Telegram transfer Worker, browser client, deployment workflow, and requirements document;
- `620e2d5` — GitHub Pages workflow configuration;
- `9271bee` — GitHub Pages origin added to Worker CORS;
- `14dfbae` — serialized photo/ACK session mutations for rapid multi-photo delivery;
- `f96b337` — safe unsupported-video handling and resilient Finish button behavior.

## 6. Existing local OCR/Rivhit application

The existing application is intentionally separate from the transfer MVP:

- local server: [`app.py`](../app.py), normally at `http://127.0.0.1:8010/`;
- local browser UI: [`web/index.html`](../web/index.html) and [`web/app.js`](../web/app.js);
- local Gemini API key: `.env` (must remain local and uncommitted);
- OCR/accounting rules: [`docs/OPERATING_RULES.md`](OPERATING_RULES.md).

The local UI currently accepts files through its normal HTML file picker and sends them to the local `/api/recognize-rivhit` endpoint.

## 7. Next stage: Telegram photos → local OCR/Rivhit workflow

The next task is to integrate **the already working Worker transport** into the existing local OCR browser UI.

### Required outcome

When the accountant runs the existing local app and opens `http://127.0.0.1:8010/`:

1. They can choose files manually **or** click a Telegram upload button.
2. Telegram photos appear in the existing selected-document preview list as normal in-memory `File`/`Blob` objects.
3. The existing **process for review** action sends those files through the existing local Gemini/Rivhit pipeline unchanged.
4. No Gemini key, Rivhit template, receipt, or OCR request is sent to GitHub Pages or the Telegram Worker.

### Important architecture decision

Do **not** try to make the GitHub Pages page call the local `127.0.0.1:8010` OCR server. HTTPS GitHub Pages to local HTTP would be mixed content and is not a reliable design.

Instead:

- keep GitHub Pages as the independent, tested transfer-only page;
- add the same Worker-backed transfer controls to the locally served `web/` application;
- use the public Worker URL from a non-secret local/public configuration value;
- keep all OCR and Gemini requests between the local browser UI and local `app.py`.

### Suggested implementation plan

1. Review `web/index.html` and `web/app.js` before changing them.
2. Refactor the file-picker logic to use one internal collection of selected `File` objects rather than relying only on `input.files`.
3. Add a minimal **Upload photos from Telegram** button, QR panel, connection state, thumbnail status, and Finish action to the local UI.
4. Reuse the Worker protocol already used in `telegram-web/app.js`: create session, parse SSE, download image, make `File`, ACK, finish.
5. Merge Telegram `File` objects and manually selected files into the same preview and recognition queue.
6. Preserve the current OCR API routes and Rivhit generation code unless an integration defect requires a small change.
7. Test manual files, Telegram files, a mixed batch, cancellation, and Rivhit TXT export.

### What the user should test after integration

1. Start `D:\projects\ocr\run.ps1` and open `http://127.0.0.1:8010/`.
2. Receive two photos through the Telegram control.
3. Add one file through the standard picker.
4. Confirm all three appear in one document list.
5. Process them using the existing Gemini action.
6. Review the records and export the Rivhit TXT.
7. Confirm the GitHub Pages transfer-only page still works independently.

## 8. Instructions for the next agent/task

1. Read this handoff document and `Technical_requirements.txt` first.
2. Treat the Telegram transfer MVP as working production-like infrastructure; do not replace it or move secrets into the repository.
3. Preserve the separation between Telegram transport and OCR/Rivhit logic.
4. Make the local OCR UI integration in small, testable changes.
5. Run `py -B -m py_compile app.py` after Python changes, use `Ctrl+F5` after browser UI changes, and never commit receipts, `.env`, tokens, generated TXT files, `node_modules`, or `.wrangler`.
