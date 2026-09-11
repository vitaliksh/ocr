# Browser client

This is the static, secret-free GitHub Pages application. It creates a
temporary Telegram upload session, receives images from the Cloudflare Worker,
sends them to Gemini pass 1 and presents the resulting journal rows for review.

The browser currently contains an exploratory local-workspace and PDF-package
foundation. It can select a local folder, validate a shared Rivhit template,
create a marked PDF package and reopen that package. It does **not** yet create
the Rivhit TXT, retain durable client history, run the second AI pass, or
implement the agreed right-side workspace drawer. Do not treat the exploratory
package format as the final workspace contract; see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

No image, PDF, TXT or client history is sent from this client to GitHub Pages.
The Worker receives images only for temporary delivery and Gemini processing.

## Local check

From the repository root:

```powershell
py -m http.server 8000 --directory telegram-web
```

Before the test, place the public Worker URL in `config.js` and ensure
`http://127.0.0.1:8000` is in the Worker's `ALLOWED_ORIGINS` setting.

For GitHub Pages, set `TELEGRAM_TRANSFER_API` as a repository Actions variable
to the public Worker URL. The workflow writes that non-secret value into the
published artifact. Add the Pages origin to `ALLOWED_ORIGINS` and redeploy the
Worker.

## Checks

```powershell
npm test
npm run check
```
