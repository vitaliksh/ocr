# Rivhit document intake

Browser application for receiving invoice images through Telegram, extracting
draft expense records with Gemini, reviewing them in a Rivhit journal and
creating local accounting artefacts. It is a bookkeeping aid; a qualified
bookkeeper remains responsible for the final tax treatment and Rivhit import.

The live browser UI is hosted on GitHub Pages. Telegram transport and Gemini
vision processing run in a Cloudflare Worker. Client data, completed PDFs,
Rivhit TXT files and history stay on the Windows PC in local workspaces.

## Project map

- `telegram-web/` — static GitHub Pages application.
- `cloudflare-worker/` — deployable Cloudflare Worker, Durable Object and R2
  configuration.
- `agent-prompts/` — human-readable prompts that the deployed agents use.
- `6111_to_Rivhit.xlsx` — approved public mapping from full Form 6111 codes to
  three-digit Rivhit codes.
- `docs/ARCHITECTURE.md` — product boundary, data ownership and current status.
- `docs/RIVHIT_IMPORT_SPEC.md` — non-negotiable TXT import contract.

Secrets and real accounting data are deliberately not committed. In particular,
do not commit Telegram tokens, Gemini keys, invoice images, generated exports,
or the private canonical Rivhit template.

## Development checks

```powershell
Set-Location D:\projects\ocr\telegram-web
npm test
npm run check

Set-Location D:\projects\ocr\cloudflare-worker
npm run check
```

See the [architecture](docs/ARCHITECTURE.md) before changing data flow, prompts
or export behaviour. Worker setup and deployment are documented in
[`cloudflare-worker/README.md`](cloudflare-worker/README.md).
