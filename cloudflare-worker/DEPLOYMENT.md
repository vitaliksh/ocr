# Production recovery checklist

This document records non-secret information needed to identify, verify or
redeploy the Cloudflare component. It is safe to keep in Git.

## Known production baseline

| Item | Value |
| --- | --- |
| Worker name | `rivhit-telegram-transfer` |
| Public URL | `https://rivhit-telegram-transfer.vitaliksh.workers.dev` |
| Cloudflare version ID | `e803c859-d9a4-4bad-9500-62006280ee93` |
| Source commit | `e1d5ae157886bcca3be535353280f1d053d067cb` |
| Git tag | `cloudflare-production-2026-09-05` |
| Durable Object | `UPLOAD_SESSION` / `UploadSession` |
| R2 bucket | `rivhit-temporary-photos` |

The Git tag identifies the source used for this known production baseline. The
current `main` branch can be newer and must not be deployed merely to make a
backup.

## Required Cloudflare secrets

Set these names as Worker secrets in Cloudflare. Their values must live in an
approved password manager, not in this repository or a workspace.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `ALLOWED_TELEGRAM_USER_ID`

`wrangler.toml` contains non-secret values: `BOT_USERNAME` and
`ALLOWED_ORIGINS`. Confirm both before deploying. The GitHub Actions repository
variable `TELEGRAM_TRANSFER_API` must equal the public Worker URL.

## Verify or restore

```powershell
Set-Location D:\projects\ocr\cloudflare-worker
npm install
npm run check
node node_modules\wrangler\bin\wrangler.js deployments list
```

To inspect the exact production source locally, use:

```powershell
git switch --detach cloudflare-production-2026-09-05
```

Do not deploy from that detached checkout. Return to `main`, review the
intended release, run the checks above, then deploy deliberately:

```powershell
node node_modules\wrangler\bin\wrangler.js deploy
```

After a deployment, record its Cloudflare version ID and source commit here,
create a new annotated `cloudflare-production-YYYY-MM-DD` tag, and push the
tag to GitHub. Test: create a browser upload session, connect Telegram, send a
photo, confirm it reaches the journal, then Finish and confirm the bot rejects
a later photo.
