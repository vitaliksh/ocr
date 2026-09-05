const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), stop = document.querySelector("#stop-processing"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), records = document.querySelector("#records"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link"), emptyRow = document.querySelector("#empty-row"), photoWindow = document.querySelector("#photo-window"), dialogImage = document.querySelector("#dialog-image"), photoTitle = document.querySelector("#photo-title"), photoViewport = document.querySelector("#photo-viewport"), businessActivity = document.querySelector("#business-activity"), model = document.querySelector("#model");
let session = null, streamAbort = null, received = new Set(), recordCount = 0, imageCount = 0, pendingRecognitions = 0, recognitionQueue = Promise.resolve(), activeRecognitionController = null, stopRequested = false, drag = null, resize = null, imageDrag = null, zoom = 1, panX = 0, panY = 0;

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); active.hidden = true; inactive.hidden = false; start.disabled = false; }
function receivedAtText(value) { return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function emptyCell(text = "—", className = "") { const cell = document.createElement("td"); cell.textContent = text; if (className) cell.className = className; return cell; }
function display(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function editableCell(value) { const cell = emptyCell(display(value), "editable"); cell.contentEditable = "true"; cell.spellcheck = false; return cell; }
function refreshRows() { const rows = [...records.querySelectorAll("tr")]; recordCount = rows.length; rows.forEach((row, index) => { row.cells[0].textContent = String(index + 1); }); count.textContent = `שורות ביומן: ${recordCount}`; if (!recordCount) records.append(emptyRow); }
function setStatus(row, text, state = "") { const cell = row.cells[15]; cell.replaceChildren(document.createTextNode(text)); cell.className = `state ${state}`; }
function updateProcessingControls() { stop.hidden = !pendingRecognitions; stop.disabled = !pendingRecognitions; }
function updateImageTransform() { dialogImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; }
function openPhoto(imageUrl, imageIndex) { dialogImage.src = imageUrl; photoTitle.textContent = `תמונה #${imageIndex}`; zoom = 1; panX = 0; panY = 0; updateImageTransform(); photoWindow.hidden = false; if (!photoWindow.style.left) { photoWindow.style.left = `${Math.max(20, (window.innerWidth - photoWindow.offsetWidth) / 2)}px`; photoWindow.style.top = "60px"; } }

start.addEventListener("click", async () => {
  if (!api) return showError("הפרסום עדיין לא הוגדר.");
  start.disabled = true; status.textContent = "";
  try { const response = await fetch(apiUrl("/v1/sessions"), { method: "POST" }), data = await response.json(); if (!response.ok) throw new Error(data.error || "לא ניתן היה ליצור חיבור העלאה."); session = data; inactive.hidden = true; active.hidden = false; telegramLink.href = data.telegramUrl; new QRious({ element: document.querySelector("#qr"), value: data.telegramUrl, size: 260, level: "M" }); openEvents(); }
  catch (error) { showError(error.message); start.disabled = false; }
});
finish.addEventListener("click", async () => {
  if (!session) return;
  if (pendingRecognitions) return showError(`ממתינים לסיום עיבוד של ${pendingRecognitions} תמונות לפני סגירת ההעלאה.`);
  const closingSession = session, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000); finish.disabled = true;
  try { const response = await fetch(apiUrl(`/v1/sessions/${closingSession.sessionId}/finish`), { method: "POST", headers: { "X-Upload-Token": closingSession.clientToken }, signal: controller.signal }); if (!response.ok) throw new Error(); }
  catch { showError("לא ניתן לאשר את סיום החיבור. הגישה מ‑Telegram תפקע אוטומטית."); }
  finally { clearTimeout(timeout); reset(); }
});
stop.addEventListener("click", () => { stopRequested = true; activeRecognitionController?.abort(); status.textContent = "העיבוד נעצר. אפשר להפעיל מחדש שורה בודדת."; });

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
  if (!session || received.has(documentId)) return; received.add(documentId);
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}`), { headers: { "X-Upload-Token": session.clientToken } }); if (!response.ok) throw new Error("הורדת התמונה נכשלה.");
    const downloaded = await response.blob(), blob = new Blob([downloaded], { type: downloaded.type === "image/png" ? "image/png" : "image/jpeg" }), imageUrl = URL.createObjectURL(blob), imageIndex = ++imageCount, row = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex);
    row.runRecognition = () => enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex, true); row.runRecognition();
    const ack = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}/ack`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } }); if (!ack.ok) throw new Error("אישור קבלת התמונה נכשל; ייתכן שהיא תישלח שוב.");
  } catch (error) { received.delete(documentId); showError(error.message); }
}
function addPendingRecord(imageUrl, receivedAt, documentId, imageIndex) {
  emptyRow?.remove(); recordCount += 1; count.textContent = `שורות ביומן: ${recordCount}`;
  const row = document.createElement("tr"); row.dataset.documentId = documentId; row.dataset.imageIndex = String(imageIndex);
  row.append(emptyCell(String(recordCount)), emptyCell(receivedAtText(receivedAt)), emptyCell(), emptyCell("ממתין לעיבוד"), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell());
  const photo = document.createElement("td"), open = document.createElement("button"); open.type = "button"; open.className = "photo-button"; open.textContent = `תמונה #${imageIndex}`; open.addEventListener("click", () => openPhoto(imageUrl, imageIndex)); photo.append(open); row.append(photo);
  row.append(emptyCell("ממתין ל‑Gemini", "agent-opinion"), emptyCell(), emptyCell("התקבל", "state received"));
  const exportCell = document.createElement("td"), include = document.createElement("input"); include.type = "checkbox"; include.disabled = true; exportCell.append(include); row.append(exportCell);
  const deleteCell = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "delete"; remove.textContent = "מחק"; remove.addEventListener("click", () => { row.remove(); refreshRows(); }); deleteCell.append(remove); row.append(deleteCell); records.append(row); return row;
}
function enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex, restart = false) {
  if (restart) stopRequested = false;
  pendingRecognitions += 1; updateProcessingControls();
  recognitionQueue = recognitionQueue.then(() => recognize(row, blob, imageUrl, receivedAt, documentId, imageIndex)).catch(() => {}).finally(() => { pendingRecognitions -= 1; updateProcessingControls(); });
}
async function recognize(row, blob, imageUrl, receivedAt, documentId, imageIndex) {
  if (stopRequested) { setStatus(row, "בוטל", "review"); row.cells[13].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד מחדש"); return; }
  const activity = businessActivity.value.trim(); if (!activity) { setStatus(row, "חסרה פעילות העסק", "error"); row.cells[13].textContent = "יש למלא את סוג פעילות העסק ואז להפעיל מחדש."; return; }
  if (!session) { setStatus(row, "לא עובד", "error"); row.cells[13].textContent = "סשן ההעלאה נסגר לפני העיבוד."; return; }
  const controller = new AbortController(); activeRecognitionController = controller; setStatus(row, "מעבד…", "processing"); row.cells[3].textContent = "Gemini מעבד את התמונה…"; row.cells[13].textContent = "ממתין להחלטת הסוכן…";
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/recognize`), { method: "POST", signal: controller.signal, headers: { "Content-Type": blob.type || "image/jpeg", "X-Upload-Token": session.clientToken, "X-Business-Activity": encodeURIComponent(activity), "X-Gemini-Model": model.value }, body: blob }), result = await response.json();
    if (!response.ok) throw new Error(result.error || "העיבוד נכשל.");
    applyRecord(row, result.records[0]);
    for (const record of result.records.slice(1)) { const extra = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex); extra.runRecognition = () => enqueueRecognition(extra, blob, imageUrl, receivedAt, documentId, imageIndex, true); applyRecord(extra, record); }
  } catch (error) {
    if (controller.signal.aborted) { setStatus(row, "בוטל", "review"); row.cells[3].textContent = "—"; row.cells[13].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד מחדש"); }
    else { setStatus(row, "שגיאה בעיבוד", "error"); row.cells[3].textContent = "—"; row.cells[13].textContent = error.message; addRerunButton(row, "נסה שוב"); }
  } finally { if (activeRecognitionController === controller) activeRecognitionController = null; }
}
function addRerunButton(row, label = "עבד מחדש") { const button = document.createElement("button"); button.type = "button"; button.className = "retry"; button.textContent = label; button.addEventListener("click", () => row.runRecognition?.()); row.cells[15].append(document.createElement("br"), button); }
function applyRecord(row, record) {
  const values = [record.date, record.rivhit_code ? `${record.rivhit_code} — ${record.classification_name}` : null, record.purpose, record.supplier_name, record.supplier_vat_id, record.transaction_number || record.invoice_number, record.allocation_number, record.total_amount, record.net_amount, record.vat_amount, record.recognized_percent === null ? null : `${record.recognized_percent}%`];
  values.forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[13].textContent = record.agent_opinion; row.cells[13].className = "agent-opinion"; row.cells[14].textContent = `${record.confidence}%`;
  const include = row.cells[16].querySelector("input"); include.disabled = !record.include; include.checked = record.include;
  setStatus(row, record.include ? "מוכן לייצוא" : record.document_kind === "payment_confirmation" ? "אישור תשלום" : "לא מיועד לייצוא", record.include ? "ready" : "review"); addRerunButton(row);
}
document.querySelector("#close-photo").addEventListener("click", () => { photoWindow.hidden = true; });
document.querySelector("#zoom-in").addEventListener("click", () => { zoom = Math.min(4, zoom + 0.25); updateImageTransform(); });
document.querySelector("#zoom-out").addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.25); updateImageTransform(); });
document.querySelector("#photo-drag").addEventListener("pointerdown", (event) => { if (event.target.closest("button")) return; drag = { x: event.clientX - photoWindow.offsetLeft, y: event.clientY - photoWindow.offsetTop }; event.currentTarget.setPointerCapture(event.pointerId); });
document.querySelector("#photo-drag").addEventListener("pointermove", (event) => { if (!drag) return; photoWindow.style.left = `${Math.max(0, event.clientX - drag.x)}px`; photoWindow.style.top = `${Math.max(0, event.clientY - drag.y)}px`; });
document.querySelector("#photo-drag").addEventListener("pointerup", () => { drag = null; });
document.querySelector("#resize-handle").addEventListener("pointerdown", (event) => { resize = { x: event.clientX, y: event.clientY, width: photoWindow.offsetWidth, height: photoWindow.offsetHeight }; event.currentTarget.setPointerCapture(event.pointerId); });
document.querySelector("#resize-handle").addEventListener("pointermove", (event) => { if (!resize) return; photoWindow.style.width = `${Math.max(320, resize.width + event.clientX - resize.x)}px`; photoWindow.style.height = `${Math.max(250, resize.height + event.clientY - resize.y)}px`; });
document.querySelector("#resize-handle").addEventListener("pointerup", () => { resize = null; });
photoViewport.addEventListener("pointerdown", (event) => { imageDrag = { x: event.clientX, y: event.clientY, panX, panY }; photoViewport.setPointerCapture(event.pointerId); dialogImage.style.cursor = "grabbing"; });
photoViewport.addEventListener("pointermove", (event) => { if (!imageDrag) return; panX = imageDrag.panX + event.clientX - imageDrag.x; panY = imageDrag.panY + event.clientY - imageDrag.y; updateImageTransform(); });
photoViewport.addEventListener("pointerup", () => { imageDrag = null; dialogImage.style.cursor = "grab"; });
