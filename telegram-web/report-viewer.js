// Child window that shows the rendered report pages with Close / Save a copy as / Save buttons.
// openReportWindow returns null when the browser blocks the window; the caller then falls back to an inline preview.
const WINDOW_NAME = "reportViewer";
const WINDOW_FEATURES = "popup=yes,width=980,height=900";

const STYLE = `body{margin:0;font-family:Arial,"Noto Sans Hebrew",system-ui,sans-serif;background:#d9e0e6}
.bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:#34566c;color:#fff}
.bar button{padding:7px 16px;border:1px solid #1d5f86;border-radius:3px;background:#2877a7;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.bar button.secondary{background:#f4f7fa;color:#17384d}.bar button:disabled{opacity:.55;cursor:not-allowed}
.bar .title{flex:1;font-weight:700}.status{padding:6px 16px;min-height:1.4em;background:#fff;color:#17623c}.status.error{color:#a61b1b}
main{padding:16px}main img{display:block;width:100%;max-width:900px;margin:0 auto 16px;background:#fff;box-shadow:0 1px 6px #0004}
.message{text-align:center;padding:40px;color:#34566c}`;

export function openReportWindow({ open = () => window.open("", WINDOW_NAME, WINDOW_FEATURES) } = {}) {
  const win = open();
  if (!win) return null;
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח</title><style>${STYLE}</style></head>`
    + `<body><header class="bar"><span class="title" id="title">טוען דוח…</span>`
    + `<button id="save" type="button" disabled>שמירה</button>`
    + `<button id="save-as" type="button" class="secondary" disabled>שמירת העתק בשם…</button>`
    + `<button id="close" type="button" class="secondary">סגירה</button></header>`
    + `<div class="status" id="status" role="status"></div><main id="pages"><p class="message">מכין את הדוח…</p></main></body></html>`);
  doc.close();
  const part = (id) => doc.querySelector(`#${id}`);
  const status = part("status");
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };
  part("close").onclick = () => win.close();
  // Runs a save action and reports its result; the user cancelling the Save As dialog is not an error.
  const guarded = (action) => async () => {
    setStatus("");
    try {
      setStatus(await action());
    } catch (error) {
      if (error?.name !== "AbortError") setStatus("השמירה נכשלה: " + error.message, true);
    }
  };
  return {
    win,
    setStatus,
    close: () => win.close(),
    // pageUrls: image URLs of the pages; save() and saveAs(win) resolve to a message shown in the status line.
    show({ title, pageUrls, save, saveAs }) {
      doc.title = title;
      part("title").textContent = title;
      part("pages").replaceChildren(...pageUrls.map((url, index) => {
        const image = doc.createElement("img");
        image.src = url;
        image.alt = `${title} · ${index + 1}`;
        return image;
      }));
      part("save").onclick = guarded(save);
      part("save-as").onclick = guarded(() => saveAs(win));
      part("save").disabled = part("save-as").disabled = false;
    },
    fail(message) {
      part("title").textContent = "הדוח לא נוצר";
      part("pages").replaceChildren();
      setStatus(message, true);
    },
  };
}
