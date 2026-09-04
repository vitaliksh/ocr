# Direct photo-to-Rivhit converter

Local Windows application that sends each JPG/PNG financial document to Gemini once, creates Rivhit expense rows, and exports a Windows-1255 TXT file. It is a prototype for human-reviewed bookkeeping, not tax or accounting advice.

## Run

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
2. Keep a validated, business-specific 186-column Rivhit expense template named `PKUDA_AI_TEST.TXT` in the project root. This local file is deliberately Git-ignored because it may contain private accounting data.
3. Run `D:\projects\ocr\run.ps1`.
4. Open `http://127.0.0.1:8010/`, enter the business activity, select photos, review the generated rows, and create the TXT.

The Git repository intentionally contains no receipt photos, generated TXT files, API keys, or business-specific template data.

## Repository contents

- `app.py` — local HTTP server, Gemini client, validation, Rivhit generation, exchange-rate lookup.
- `web/` — browser UI.
- `6111_to_Rivhit.xlsx` — approved non-private mapping of full Form 6111 codes to three-digit Rivhit codes.
- `ocr_instructions.md` — runtime system instructions sent to Gemini.
- `docs/OPERATING_RULES.md` — architecture, import rules, privacy rules, and verification requirements.

See [operating rules](docs/OPERATING_RULES.md) before changing the import format or Gemini prompt.

## Telegram photo transfer (current development stage)

The independent temporary transfer client is in [`telegram-web/`](telegram-web/) and its Cloudflare Worker is in [`telegram-worker/`](telegram-worker/). It deliberately transfers photos only; it does not contain Gemini or Rivhit logic. Follow the Worker [setup guide](telegram-worker/README.md) to create the bot, configure the secrets, and deploy the browser page.
