const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), records = document.querySelector("#records"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link"), emptyRow = document.querySelector("#empty-row"), photoDialog = document.querySelector("#photo-dialog"), dialogImage = document.querySelector("#dialog-image"), businessActivity = document.querySelector("#business-activity");
let session = null, streamAbort = null, received = new Set(), recordCount = 0, pendingRecognitions = 0, recognitionQueue = Promise.resolve();

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); active.hidden = true; inactive.hidden = false; start.disabled = false; }
function receivedAtText(value) { return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function emptyCell(text = "—", className = "") { const cell = document.createElement("td"); cell.textContent = text; if (className) cell.className = className; return cell; }
function refreshRows() { const rows = [...records.querySelectorAll("tr")]; recordCount = rows.length; rows.forEach((row, index) => { row.cells[0].textContent = String(index + 1); }); count.textContent = `שורות ביומן: ${recordCount}`; if (!recordCount) records.append(emptyRow); }
function display(value, suffix = "") { return value === null || value === undefined || value === "" ? "—" : `${value}${suffix}`; }
function editableCell(value, className = "") { const cell = emptyCell(display(value), `editable ${className}`.trim()); cell.contentEditable = "true"; cell.spellcheck = false; return cell; }
function setStatus(row, text, state = "") { const cell = row.cells[15]; cell.replaceChildren(document.createTextNode(text)); cell.className = `state ${state}`; }

start.addEventListener("click", async () => {
  if (!api) return showError("The deployment is not configured yet. Set TELEGRAM_TRANSFER_API in config.js.");
  start.disabled = true; status.textContent = "";
  try {
    const response = await fetch(apiUrl("/v1/sessions"), { method: "POST" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "לא ניתן היה ליצור חיבור העלאה.");
    session = data; inactive.hidden = true; active.hidden = false; telegramLink.href = data.telegramUrl;
    new QRious({ element: document.querySelector("#qr"), value: data.telegramUrl, size: 260, level: "M" });
    openEvents();
  } catch (error) { showError(error.message); start.disabled = false; }
});

finish.addEventListener("click", async () => {
  if (!session) return;
  if (pendingRecognitions) { showError(`ממתינים לסיום עיבוד של ${pendingRecognitions} תמונות לפני סגירת ההעלאה.`); return; }
  const closingSession = session, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  finish.disabled = true;
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${closingSession.sessionId}/finish`), { method: "POST", headers: { "X-Upload-Token": closingSession.clientToken }, signal: controller.signal });
    if (!response.ok) throw new Error("לא ניתן היה לסיים את החיבור.");
  } catch {
    showError("לא ניתן לאשר את סיום החיבור. הגישה מ‑Telegram תפקע אוטומטית.");
  } finally {
    clearTimeout(timeout); reset(); start.disabled = false;
  }
});

async function openEvents() {
  streamAbort = new AbortController();
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/events`), { headers: { "X-Upload-Token": session.clientToken }, signal: streamAbort.signal });
    if (!response.ok) throw new Error(response.status === 401 ? "תוקף החיבור פג." : "חיבור האינטרנט נותק.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
    while (session && !streamAbort.signal.aborted) { const { value, done } = await reader.read(); if (done) throw new Error("חיבור האינטרנט נותק."); pending += decoder.decode(value, { stream: true }); const messages = pending.split("\n\n"); pending = messages.pop(); for (const message of messages) consumeEvent(message); }
  } catch (error) { if (!streamAbort?.signal.aborted) showError(error.message); }
}

function consumeEvent(message) {
  const type = message.match(/^event: (.+)$/m)?.[1], text = message.match(/^data: (.+)$/m)?.[1]; if (!type || !text) return;
  const data = JSON.parse(text);
  if (type === "ready") { connection.textContent = data.connected ? "Telegram מחובר. אפשר לשלוח תמונות." : "ממתין לחיבור Telegram…"; data.documents.forEach((item) => receiveDocument(item.documentId, item.receivedAt)); }
  if (type === "connected") connection.textContent = "Telegram מחובר. אפשר לשלוח תמונות.";
  if (type === "document") receiveDocument(data.documentId, data.receivedAt);
  if (type === "finished") reset();
}

async function receiveDocument(documentId, receivedAt) {
  if (!session || received.has(documentId)) return;
  received.add(documentId);
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}`), { headers: { "X-Upload-Token": session.clientToken } });
    if (!response.ok) throw new Error("הורדת התמונה נכשלה.");
    const downloaded = await response.blob(), blob = new Blob([downloaded], { type: downloaded.type === "image/png" ? "image/png" : "image/jpeg" }), imageUrl = URL.createObjectURL(blob), row = addPendingRecord(imageUrl, receivedAt, documentId); queueRecognition(row, blob, imageUrl, receivedAt, documentId);
    const ack = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}/ack`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } });
    if (!ack.ok) throw new Error("אישור קבלת התמונה נכשל; ייתכן שהיא תישלח שוב.");
  } catch (error) { received.delete(documentId); showError(error.message); }
}

function addPendingRecord(imageUrl, receivedAt, documentId) {
  emptyRow?.remove(); recordCount += 1; count.textContent = `שורות ביומן: ${recordCount}`;
  const row = document.createElement("tr"); row.dataset.documentId = documentId;
  row.append(emptyCell(String(recordCount)), emptyCell(receivedAtText(receivedAt)), emptyCell(), emptyCell("ממתין לעיבוד"), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell());
  const photo = document.createElement("td"), openPhoto = document.createElement("button"); openPhoto.type = "button"; openPhoto.className = "photo-button"; openPhoto.textContent = "פתח"; openPhoto.addEventListener("click", () => { dialogImage.src = imageUrl; photoDialog.showModal(); }); photo.append(openPhoto); row.append(photo);
  row.append(emptyCell("ממתין ל‑Gemini", "agent-opinion"), emptyCell(), emptyCell("התקבל", "state received"));
  const exportCell = document.createElement("td"), include = document.createElement("input"); include.type = "checkbox"; include.disabled = true; include.title = "הייצוא יופעל לאחר עיבוד התמונה"; exportCell.append(include); row.append(exportCell);
  const deleteCell = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "delete"; remove.textContent = "מחק"; remove.addEventListener("click", () => { row.remove(); refreshRows(); }); deleteCell.append(remove); row.append(deleteCell); records.append(row); return row;
}

function queueRecognition(row, blob, imageUrl, receivedAt, documentId) {
  pendingRecognitions += 1; recognitionQueue = recognitionQueue.then(() => recognize(row, blob, imageUrl, receivedAt, documentId)).catch(() => {}).finally(() => { pendingRecognitions -= 1; });
}
async function recognize(row, blob, imageUrl, receivedAt, documentId) {
  const activity = businessActivity.value.trim(); if (!activity) { setStatus(row, "חסרה פעילות העסק", "error"); row.cells[13].textContent = "יש למלא את סוג פעילות העסק ואז לנסות שוב."; return; }
  if (!session) { setStatus(row, "לא עובד", "error"); row.cells[13].textContent = "סשן ההעלאה נסגר לפני העיבוד."; return; }
  setStatus(row, "מעבד…", "processing"); row.cells[3].textContent = "Gemini מעבד את התמונה…"; row.cells[13].textContent = "ממתין להחלטת הסוכן…";
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/recognize`), { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg", "X-Upload-Token": session.clientToken, "X-Business-Activity": encodeURIComponent(activity) }, body: blob }); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "העיבוד נכשל.");
    applyRecord(row, result.records[0]);
    for (const record of result.records.slice(1)) { const extraRow = addPendingRecord(imageUrl, receivedAt, documentId); applyRecord(extraRow, record); }
  } catch (error) { setStatus(row, "שגיאה בעיבוד", "error"); row.cells[3].textContent = "—"; row.cells[13].textContent = error.message; }
}
function applyRecord(row, record) {
  const values = [record.date, record.rivhit_code ? `${record.rivhit_code} — ${record.classification_name}` : null, record.purpose, record.supplier_name, record.supplier_vat_id, record.transaction_number || record.invoice_number, record.allocation_number, record.total_amount, record.net_amount, record.vat_amount, record.recognized_percent === null ? null : `${record.recognized_percent}%`];
  values.forEach((value, index) => { const cell = editableCell(value); row.replaceChild(cell, row.cells[index + 1]); });
  row.cells[13].textContent = record.agent_opinion; row.cells[13].className = "agent-opinion"; row.cells[14].textContent = `${record.confidence}%`;
  const include = row.cells[16].querySelector("input"); include.disabled = !record.include; include.checked = record.include;
  setStatus(row, record.include ? "מוכן לייצוא" : record.document_kind === "payment_confirmation" ? "אישור תשלום" : "לא מיועד לייצוא", record.include ? "ready" : "review");
}
document.querySelector("#close-photo").addEventListener("click", () => photoDialog.close());
photoDialog.addEventListener("click", (event) => { if (event.target === photoDialog) photoDialog.close(); });
