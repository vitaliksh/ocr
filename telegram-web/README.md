# Telegram browser client

This is a static, secret-free browser client intended for GitHub Pages. It opens the secure temporary connection to the Cloudflare Worker and keeps received images only in page memory.

For a local visual check, start it from the repository root:

```powershell
py -m http.server 8000 --directory telegram-web
```

Before the test, place the public Worker URL in `config.js`. Also ensure `http://127.0.0.1:8000` is in the Worker's `ALLOWED_ORIGINS` setting.

For GitHub Pages, set `TELEGRAM_TRANSFER_API` as a repository Actions variable to the public Worker URL. The deployment workflow copies that non-secret value into the published artifact. Add the final Pages URL to `ALLOWED_ORIGINS` and redeploy the Worker.
