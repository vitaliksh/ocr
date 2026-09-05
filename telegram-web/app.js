const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), stop = document.querySelector("#stop-processing"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), records = document.querySelector("#records"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link"), emptyRow = document.querySelector("#empty-row"), photoWindow = document.querySelector("#photo-window"), dialogImage = document.querySelector("#dialog-image"), photoTitle = document.querySelector("#photo-title"), photoViewport = document.querySelector("#photo-viewport"), businessActivity = document.querySelector("#business-activity"), businessKind = document.querySelector("#business-kind"), model = document.querySelector("#model");
let session = null, streamAbort = null, received = new Set(), recordCount = 0, imageCount = 0, pendingRecognitions = 0, recognitionQueue = Promise.resolve(), activeRecognitionController = null, stopRequested = false, drag = null, resize = null, imageDrag = null, zoom = 1, panX = 0, panY = 0;

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); active.hidden = true; inactive.hidden = false; start.disabled = false; }
function receivedAtText(value) { return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function emptyCell(text = "—", className = "") { const cell = document.createElement("td"); cell.textContent = text; if (className) cell.className = className; return cell; }
function display(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function editableCell(value) { const cell = emptyCell(display(value), "editable"); cell.contentEditable = "true"; cell.spellcheck = false; return cell; }
function refreshRows() { const rows = [...records.querySelectorAll("tr")]; recordCount = rows.length; rows.forEach((row, index) => { row.cells[0].textContent = String(index + 1); }); count.textContent = `שורות ביומן: ${recordCount}`; if (!recordCount) records.append(emptyRow); }
function setStatus(row, text, state = "") { const cell = row.cells[16]; cell.replaceChildren(document.createTextNode(text)); cell.className = `state ${state}`; }
function percentSelect(value = 100, choices = [100, 25]) { const select = document.createElement("select"); for (const item of choices) { const option = new Option(`${item}%`, String(item), false, Number(value) === item); select.add(option); } select.addEventListener("change", () => recalculateRow(select.closest("tr"))); return select; }
function classificationSelect(code = "") { const select = document.createElement("select"); select.add(new Option("—", "")); for (const [value, label] of Object.entries(window.RIVHIT_MAPPING || {})) select.add(new Option(`${value} — ${label}`, value, false, value === code)); select.addEventListener("change", () => { applyBusinessRule(select.closest("tr")); }); return select; }
function recalculateRow(row) { const net = Number(row.dataset.rawNet || 0), vat = Number(row.dataset.rawVat || 0), vatPercent = Number(row.cells[11].querySelector("select")?.value || 100) / 100, expensePercent = Number(row.cells[12].querySelector("select")?.value || 100) / 100; row.cells[8].textContent = (net * expensePercent + vat * vatPercent).toFixed(2); }
function applyBusinessRule(row) { const code = row.cells[2].querySelector("select")?.value, homeUtility = businessKind.value === "home" && ["809", "820"].includes(code); const expense = row.cells[12].querySelector("select"); if (expense) expense.value = homeUtility ? "25" : "100"; recalculateRow(row); }
function applyBusinessRules() { for (const row of records.querySelectorAll("tr")) applyBusinessRule(row); }
businessKind.addEventListener("change", applyBusinessRules);
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
    row.runRecognition = (onlyThis = false) => enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex, true, onlyThis); enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex);
    const ack = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}/ack`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } }); if (!ack.ok) throw new Error("אישור קבלת התמונה נכשל; ייתכן שהיא תישלח שוב.");
  } catch (error) { received.delete(documentId); showError(error.message); }
}
function addPendingRecord(imageUrl, receivedAt, documentId, imageIndex) {
  emptyRow?.remove(); recordCount += 1; count.textContent = `שורות ביומן: ${recordCount}`;
  const row = document.createElement("tr"); row.dataset.documentId = documentId; row.dataset.imageIndex = String(imageIndex);
  row.append(emptyCell(String(recordCount)), emptyCell(receivedAtText(receivedAt)), emptyCell(), emptyCell("ממתין לעיבוד"), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell());
  const photo = document.createElement("td"), open = document.createElement("button"); open.type = "button"; open.className = "photo-button"; open.textContent = `תמונה #${imageIndex}`; open.addEventListener("click", () => openPhoto(imageUrl, imageIndex)); photo.append(open); row.append(photo);
  row.append(emptyCell("ממתין ל‑Gemini", "agent-opinion"), emptyCell(), emptyCell("התקבל", "state received"));
  const exportCell = document.createElement("td"), include = document.createElement("input"); include.type = "checkbox"; include.disabled = true; exportCell.append(include); row.append(exportCell);
  const deleteCell = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "delete"; remove.textContent = "מחק"; remove.addEventListener("click", () => { row.remove(); refreshRows(); }); deleteCell.append(remove); row.append(deleteCell); records.append(row); return row;
}
function enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex, restart = false, onlyThis = false) {
  if (restart) stopRequested = false;
  pendingRecognitions += 1; updateProcessingControls();
  recognitionQueue = recognitionQueue.then(() => recognize(row, blob, imageUrl, receivedAt, documentId, imageIndex, onlyThis)).catch(() => {}).finally(() => { pendingRecognitions -= 1; updateProcessingControls(); });
}
function recordTarget(row) { return { date: row.cells[1].textContent, classification: row.cells[2].textContent, purpose: row.cells[3].textContent, supplier: row.cells[4].textContent, reference: row.cells[6].textContent, gross: row.cells[8].textContent, net: row.cells[9].textContent, vat: row.cells[10].textContent }; }
async function recognize(row, blob, imageUrl, receivedAt, documentId, imageIndex, onlyThis = false) {
  if (stopRequested) { setStatus(row, "בוטל", "review"); row.cells[14].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד", false); return; }
  const activity = businessActivity.value.trim(); if (!activity) { setStatus(row, "חסרה פעילות העסק", "error"); row.cells[14].textContent = "יש למלא את סוג פעילות העסק ואז להפעיל מחדש."; return; }
  if (!session) { setStatus(row, "לא עובד", "error"); row.cells[14].textContent = "סשן ההעלאה נסגר לפני העיבוד."; return; }
  const controller = new AbortController(); activeRecognitionController = controller; setStatus(row, "מעבד…", "processing"); row.cells[3].textContent = "Gemini מעבד את התמונה…"; row.cells[14].textContent = "ממתין להחלטת הסוכן…";
  try {
    const headers = { "Content-Type": blob.type || "image/jpeg", "X-Upload-Token": session.clientToken, "X-Business-Activity": encodeURIComponent(activity), "X-Gemini-Model": model.value }; if (onlyThis) headers["X-Target-Record"] = encodeURIComponent(JSON.stringify(recordTarget(row)));
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/recognize`), { method: "POST", signal: controller.signal, headers, body: blob }), result = await response.json();
    if (!response.ok) throw new Error(result.error || "העיבוד נכשל.");
    applyRecord(row, result.records[0]);
    if (!onlyThis) for (const record of result.records.slice(1)) { const extra = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex); extra.runRecognition = (single = false) => enqueueRecognition(extra, blob, imageUrl, receivedAt, documentId, imageIndex, true, single); applyRecord(extra, record); }
  } catch (error) {
    if (controller.signal.aborted) { setStatus(row, "בוטל", "review"); row.cells[3].textContent = "—"; row.cells[14].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד", false); }
    else { setStatus(row, "שגיאה בעיבוד", "error"); row.cells[3].textContent = "—"; row.cells[14].textContent = error.message; addRerunButton(row, "נסה שוב"); }
  } finally { if (activeRecognitionController === controller) activeRecognitionController = null; }
}
function addRerunButton(row, label = "עבד מחדש", onlyThis = true) { const button = document.createElement("button"); button.type = "button"; button.className = "retry"; button.textContent = label; button.addEventListener("click", () => row.runRecognition?.(onlyThis)); row.cells[16].append(document.createElement("br"), button); }
function applyRecord(row, record) {
  row.dataset.rawNet = String(record.net_amount || 0); row.dataset.rawVat = String(record.vat_amount || 0);
  const values = [record.date, null, record.purpose, record.supplier_name, record.supplier_vat_id, record.transaction_number || record.invoice_number, record.allocation_number, null, record.net_amount, record.vat_amount];
  values.forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[2].replaceChildren(classificationSelect(record.rivhit_code || "")); row.cells[11].replaceChildren(percentSelect(record.vat_recognized_percent ?? 100, [100, 25, 0])); row.cells[12].replaceChildren(percentSelect(record.recognized_percent || 100)); applyBusinessRule(row);
  row.cells[14].textContent = record.agent_opinion; row.cells[14].className = "agent-opinion"; row.cells[15].textContent = String(record.confidence) + "%";
  const include = row.cells[17].querySelector("input"); include.disabled = !record.include; include.checked = record.include;
  setStatus(row, record.include ? "מוכן לייצוא" : record.document_kind === "payment_confirmation" ? "אישור תשלום" : "לא מיועד לייצוא", record.include ? "ready" : "review"); addRerunButton(row);
}
document.querySelector("#close-photo").addEventListener("click", () => { photoWindow.hidden = true; });
document.querySelector("#zoom-in").addEventListener("click", () => { zoom = Math.min(4, zoom + 0.25); updateImageTransform(); });
document.querySelector("#zoom-out").addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.25); updateImageTransform(); });
document.querySelector("#photo-drag").addEventListener("pointerdown", (event) => { if (event.target.closest("button")) return; drag = { x: event.clientX - photoWindow.offsetLeft, y: event.clientY - photoWindow.offsetTop }; event.currentTarget.setPointerCapture(event.pointerId); });
document.querySelector("#photo-drag").addEventListener("pointermove", (event) => { if (!drag) return; photoWindow.style.left = `${Math.max(0, event.clientX - drag.x)}px`; photoWindow.style.top = `${Math.max(0, event.clientY - drag.y)}px`; });
document.querySelector("#photo-drag").addEventListener("pointerup", () => { drag = null; });
function stopImageDrag() { imageDrag = null; dialogImage.style.cursor = "grab"; }
function startResize(event, direction) { event.preventDefault(); event.stopPropagation(); const box = photoWindow.getBoundingClientRect(); resize = { direction, x: event.clientX, y: event.clientY, width: box.width, height: box.height, left: box.left, top: box.top }; photoWindow.setPointerCapture(event.pointerId); }
function resizeWindow(event) { if (!resize) return; const dx = event.clientX - resize.x, dy = event.clientY - resize.y, west = resize.direction.includes("w"), north = resize.direction.includes("n"); const width = Math.max(320, resize.width + (west ? -dx : dx)), height = Math.max(250, resize.height + (north ? -dy : dy)); photoWindow.style.width = `${width}px`; photoWindow.style.height = `${height}px`; if (west) photoWindow.style.left = `${resize.left + resize.width - width}px`; if (north) photoWindow.style.top = `${resize.top + resize.height - height}px`; }
photoWindow.addEventListener("pointerdown", (event) => { const box = photoWindow.getBoundingClientRect(), edge = 9, x = event.clientX - box.left, y = event.clientY - box.top; const direction = `${y < edge ? "n" : y > box.height - edge ? "s" : ""}${x < edge ? "w" : x > box.width - edge ? "e" : ""}`; if (direction) startResize(event, direction); }, true);
photoWindow.addEventListener("pointermove", (event) => { if (resize) return resizeWindow(event); const box = photoWindow.getBoundingClientRect(), edge = 9, x = event.clientX - box.left, y = event.clientY - box.top; const direction = `${y < edge ? "n" : y > box.height - edge ? "s" : ""}${x < edge ? "w" : x > box.width - edge ? "e" : ""}`; photoWindow.style.cursor = ({ n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" })[direction] || ""; });
photoWindow.addEventListener("pointerup", () => { resize = null; }); photoWindow.addEventListener("pointercancel", () => { resize = null; });
document.querySelector("#resize-handle").addEventListener("pointerdown", (event) => startResize(event, "se"));
photoViewport.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; event.preventDefault(); imageDrag = { x: event.clientX, y: event.clientY, panX, panY }; dialogImage.style.cursor = "grabbing"; });
window.addEventListener("pointermove", (event) => { if (!imageDrag) return; panX = imageDrag.panX + event.clientX - imageDrag.x; panY = imageDrag.panY + event.clientY - imageDrag.y; updateImageTransform(); });
window.addEventListener("pointerup", stopImageDrag); window.addEventListener("pointercancel", stopImageDrag); dialogImage.addEventListener("dragstart", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => { if (!event.ctrlKey || !["Equal", "NumpadAdd", "Minus", "NumpadSubtract"].includes(event.code) || photoWindow.hidden) return; event.preventDefault(); event.stopPropagation(); zoom = ["Minus", "NumpadSubtract"].includes(event.code) ? Math.max(0.5, zoom - 0.25) : Math.min(4, zoom + 0.25); updateImageTransform(); }, true);
