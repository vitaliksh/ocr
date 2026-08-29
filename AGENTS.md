# Receipt / Invoice OCR prototype — continuation notes

## User and working context

- Address the user in Russian, informally, as **Виталик**, unless he explicitly asks for another language.
- Workspace: `D:\projects\ocr` on Windows 11 / PowerShell.
- This is an early local prototype only. Do **not** add expense classification, accounting logic, debit/credit decisions, `MOVEIN.DAT` generation, Rivhit integration, or a database unless explicitly requested.

## What has been built

- `app.py` is a dependency-free Python local web server.
- `web/index.html`, `web/app.js`, and `web/styles.css` provide: JPG/PNG selection, image preview, Recognize button, raw OCR text, editable fields, per-field confidence, and live final JSON.
- `GeminiProvider` implements the replaceable `OcrProvider` interface. Future OpenAI or other providers should implement the same `recognize(image, mime_type)` method.
- Gemini requests use structured JSON output and a schema covering the requested document fields plus `raw_text` and `confidence`.
- `normalize_result` validates dates, amounts, card last four, and confidence scores. Do not infer missing fields.
- API key handling: `.env` is Git-ignored. Copy `.env.example`; set `GEMINI_API_KEY`. The key must never be printed, committed, or placed in source.
- Current default Gemini model is `gemini-3.6-flash`. `gemini-2.5-flash` returned an API 404 for new users during testing.
- The provider retries temporary Gemini `429`/`5xx` responses three times.

## Starting the app

Use:

```powershell
py -B D:\projects\ocr\app.py
```

- `-B` avoids stale Python bytecode while iterating.
- The default port is **8010** (not 8000): open `http://127.0.0.1:8010/`.
- Health endpoint: `http://127.0.0.1:8010/api/health` returns version, key-configured boolean, and model; it never reveals the key.

## Important troubleshooting history

- Port **8000** behaved anomalously in this environment: even a new Python process showed current startup output but requests returned an old `SimpleHTTP` 404 handler. Do not spend more time diagnosing it unless asked; use port 8010 or set a different `PORT` environment variable.
- The prior browser message `Cannot reach the local server` was a generic client-side fetch error and obscured the actual server response. `web/app.js` now displays a more actionable local-request diagnostic.
- The old server originally returned before consuming a browser image upload when the key was missing; that can produce browser-level `Failed to fetch`. The upload is now read before the key check.
- Test of the current server on a temporary port verified `/api/health` returns HTTP 200 with `gemini_key_configured: true` for the saved `.env`.
- A live Gemini call accepted the configured key but at one point returned a temporary `503 high demand`; this is an upstream availability response, not evidence of a bad key.

## Files

- `app.py` — server, provider interface, Gemini implementation, validation, static/API serving.
- `.env.example` — non-secret configuration template.
- `.env` — local secret configuration, ignored by Git.
- `README.md` — setup and architecture notes.
- `examples/` — user-provided receipt photos and an unrelated `MOVEIN.DAT` example; do not use it for accounting features.

## Verification already performed

- `py -m py_compile app.py` passed.
- Validation behavior was unit-smoke-tested from Python.
- The explicitly routed server version passed an HTTP health check on port 8010.
- Full OCR output for a receipt was not retained in the conversation because Gemini availability was temporarily 503. Re-test through the UI once the service is available.
