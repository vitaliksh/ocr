const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), documents = document.querySelector("#documents"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link");
let session = null, streamAbort = null, received = new Set();

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); documents.replaceChildren(); count.textContent = "Received: 0"; active.hidden = true; inactive.hidden = false; }

start.addEventListener("click", async () => {
  if (!api) return showError("The deployment is not configured yet. Set TELEGRAM_TRANSFER_API in config.js.");
  start.disabled = true; status.textContent = "";
  try {
    const response = await fetch(apiUrl("/v1/sessions"), { method: "POST" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create the upload session.");
    session = data; inactive.hidden = true; active.hidden = false; telegramLink.href = data.telegramUrl;
    new QRious({ element: document.querySelector("#qr"), value: data.telegramUrl, size: 260, level: "M" });
    openEvents();
  } catch (error) { showError(error.message); start.disabled = false; }
});

finish.addEventListener("click", async () => {
  if (!session) return;
  finish.disabled = true;
  try { await fetch(apiUrl(`/v1/sessions/${session.sessionId}/finish`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } }); }
  catch { showError("Could not close the session. It will expire automatically."); }
  reset(); start.disabled = false;
});

async function openEvents() {
  streamAbort = new AbortController();
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/events`), { headers: { "X-Upload-Token": session.clientToken }, signal: streamAbort.signal });
    if (!response.ok) throw new Error(response.status === 401 ? "Session expired." : "Internet connection lost.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
    while (session && !streamAbort.signal.aborted) { const { value, done } = await reader.read(); if (done) throw new Error("Internet connection lost."); pending += decoder.decode(value, { stream: true }); const messages = pending.split("\n\n"); pending = messages.pop(); for (const message of messages) consumeEvent(message); }
  } catch (error) { if (!streamAbort?.signal.aborted) showError(error.message); }
}

function consumeEvent(message) {
  const type = message.match(/^event: (.+)$/m)?.[1], text = message.match(/^data: (.+)$/m)?.[1]; if (!type || !text) return;
  const data = JSON.parse(text);
  if (type === "ready") { connection.textContent = data.connected ? "Telegram connected. Send document photos now." : "Waiting for Telegram connection…"; data.documents.forEach((item) => receiveDocument(item.documentId, item.receivedAt)); }
  if (type === "connected") connection.textContent = "Telegram connected. Send document photos now.";
  if (type === "document") receiveDocument(data.documentId, data.receivedAt);
  if (type === "finished") reset();
}

async function receiveDocument(documentId, receivedAt) {
  if (!session || received.has(documentId)) return;
  received.add(documentId);
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}`), { headers: { "X-Upload-Token": session.clientToken } });
    if (!response.ok) throw new Error("Photo download failed.");
    const blob = await response.blob(); const file = new File([blob], `telegram-${documentId}.jpg`, { type: blob.type || "image/jpeg", lastModified: receivedAt });
    const figure = document.createElement("figure"), image = document.createElement("img"), caption = document.createElement("figcaption"); figure.className = "document"; image.src = URL.createObjectURL(file); image.alt = `Document ${received.size}`; caption.textContent = `Document ${received.size} · ${new Date(receivedAt).toLocaleTimeString()}`; figure.append(image, caption); documents.append(figure); count.textContent = `Received: ${received.size}`;
    const ack = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}/ack`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } });
    if (!ack.ok) throw new Error("Receipt acknowledgement failed; the photo may be delivered again.");
  } catch (error) { received.delete(documentId); showError(error.message); }
}
