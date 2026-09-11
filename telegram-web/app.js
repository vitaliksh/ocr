import { setupWorkspaceControls } from "./workspace.js";
import { createPackageDirectory, makePackageManifest, makeSourceText, writeFile } from "./document-package.js";
import { buildPdfReport } from "./pdf-report.js";

const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), stop = document.querySelector("#stop-processing"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), records = document.querySelector("#records"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link"), emptyRow = document.querySelector("#empty-row"), photoWindow = document.querySelector("#photo-window"), dialogImage = document.querySelector("#dialog-image"), photoTitle = document.querySelector("#photo-title"), photoViewport = document.querySelector("#photo-viewport"), businessActivity = document.querySelector("#business-activity"), businessKind = document.querySelector("#business-kind"), model = document.querySelector("#model"), workspaceSummary = document.querySelector("#workspace-summary"), clientDialog = document.querySelector("#client-dialog"), systemSettingsDialog = document.querySelector("#system-settings-dialog"), currentClient = document.querySelector("#current-client"), createPdf = document.querySelector("#create-pdf"), openPackage = document.querySelector("#open-package"), uploadModeDialog = document.querySelector("#upload-mode-dialog"), addToExisting = document.querySelector("#add-to-existing"), startNewTable = document.querySelector("#start-new-table"), uploadRequirements = document.querySelector("#upload-requirements");
let workspace = null, committedWorkspace = null, canonicalTemplate = null, session = null, streamAbort = null, received = new Set(), recordCount = 0, imageCount = 0, pendingRecognitions = 0, recognitionQueue = Promise.resolve(), activeRecognitionController = null, stopRequested = false, drag = null, resize = null, imageDrag = null, zoom = 1, panX = 0, panY = 0, tableLocked = false;

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
function updateStartAvailability() { start.disabled = !committedWorkspace || !canonicalTemplate; uploadRequirements.textContent = !committedWorkspace ? "יש לבחור לקוח ולאשר את פרטיו לפני העלאת תמונות." : !canonicalTemplate ? "יש לבחור בהגדרות תבנית Rivhit כללית לפני העלאת תמונות." : ""; }
setupWorkspaceControls({
  select: document.querySelector("#workspace-select"), templateButton: document.querySelector("#select-template"), creationPanel: document.querySelector("#new-client-form"), createButton: document.querySelector("#create-client"), deleteButton: document.querySelector("#delete-client"), grantDeleteAccessButton: document.querySelector("#grant-delete-access"), clientNameInput: document.querySelector("#new-client-name"), clientActivityInput: document.querySelector("#new-client-activity"), summary: workspaceSummary, templateSummary: document.querySelector("#template-summary"),
  onWorkspace: (selected) => { workspace = selected; businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind; applyBusinessRules(); status.textContent = ""; },
  onTemplate: (selected) => { canonicalTemplate = selected; updateStartAvailability(); },
  onDeleted: (clientId) => { if (workspace?.config.clientId === clientId) workspace = null; if (committedWorkspace?.config.clientId === clientId) { committedWorkspace = null; currentClient.textContent = "לא נבחר לקוח"; updateStartAvailability(); } },
  onError: showError
});
updateStartAvailability();
document.querySelector("#open-client-dialog").addEventListener("click", () => { workspace = committedWorkspace; if (workspace) { businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind; } clientDialog.showModal(); });
document.querySelector("#open-settings-dialog").addEventListener("click", () => systemSettingsDialog.showModal());
document.querySelector("#confirm-client").addEventListener("click", async () => { try { if (!workspace) throw new Error("יש לבחור לקוח."); await workspace.saveSettings({ businessActivity: businessActivity.value.trim(), businessKind: businessKind.value }); workspace.config.businessActivity = businessActivity.value.trim(); workspace.config.businessKind = businessKind.value; committedWorkspace = workspace; currentClient.textContent = `לקוח: ${workspace.config.clientName}`; applyBusinessRules(); updateStartAvailability(); clientDialog.close(); } catch (error) { showError(`לא ניתן לשמור את הגדרות הלקוח: ${error.message}`); } });
clientDialog.addEventListener("close", () => { if (clientDialog.returnValue !== "confirmed") { workspace = committedWorkspace; if (workspace) { businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind; } } });
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); active.hidden = true; inactive.hidden = false; updateStartAvailability(); }
function receivedAtText(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value || "—") : new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(date); }
function emptyCell(text = "—", className = "") { const cell = document.createElement("td"); cell.textContent = text; if (className) cell.className = className; return cell; }
function display(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function editableCell(value) { const cell = emptyCell(display(value), "editable"); cell.contentEditable = "true"; cell.spellcheck = false; return cell; }
function setTableLocked(locked) { tableLocked = locked; records.classList.toggle("table-locked", locked); for (const cell of records.querySelectorAll(".editable")) cell.contentEditable = locked ? "false" : "true"; for (const control of records.querySelectorAll("select,input,.delete,.retry")) control.disabled = locked; }
function refreshRows() { const rows = [...records.querySelectorAll("tr")]; recordCount = rows.length; rows.forEach((row, index) => { row.cells[0].textContent = String(index + 1); }); count.textContent = `שורות ביומן: ${recordCount}`; if (!recordCount) records.append(emptyRow); }
function setStatus(row, text, state = "") { const cell = row.cells[16]; cell.replaceChildren(document.createTextNode(text)); cell.className = `state ${state}`; }
function percentSelect(value = 100, choices = [100, 25]) { const select = document.createElement("select"); for (const item of choices) { const option = new Option(`${item}%`, String(item), false, Number(value) === item); select.add(option); } select.addEventListener("change", () => recalculateRow(select.closest("tr"))); return select; }
function classificationSelect(code = "") { const select = document.createElement("select"); select.add(new Option("—", "")); for (const [value, label] of Object.entries(window.RIVHIT_MAPPING || {})) select.add(new Option(`${value} — ${label}`, value, false, value === code)); select.addEventListener("change", () => { applyBusinessRule(select.closest("tr")); }); return select; }
function recalculateRow(row) { const net = Number(row.dataset.rawNet || 0), vat = Number(row.dataset.rawVat || 0), vatPercent = Number(row.cells[11].querySelector("select")?.value || 100) / 100, expensePercent = Number(row.cells[12].querySelector("select")?.value || 100) / 100; row.cells[8].textContent = (net * expensePercent + vat * vatPercent).toFixed(2); }
function applyBusinessRule(row) { const code = row.cells[2].querySelector("select")?.value, homeUtility = businessKind.value === "home" && ["809", "820"].includes(code); const expense = row.cells[12].querySelector("select"); if (expense) expense.value = homeUtility ? "25" : "100"; recalculateRow(row); }
function applyBusinessRules() { for (const row of records.querySelectorAll("tr[data-document-id]")) applyBusinessRule(row); }
businessKind.addEventListener("change", applyBusinessRules);
function updateProcessingControls() { stop.hidden = !pendingRecognitions; stop.disabled = !pendingRecognitions; }
function updateImageTransform() { dialogImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; }
function openPhoto(imageUrl, imageIndex) { dialogImage.src = imageUrl; photoTitle.textContent = `תמונה #${imageIndex}`; zoom = 1; panX = 0; panY = 0; updateImageTransform(); photoWindow.hidden = false; if (!photoWindow.style.left) { photoWindow.style.left = `${Math.max(20, (window.innerWidth - photoWindow.offsetWidth) / 2)}px`; photoWindow.style.top = "60px"; } }

async function startUpload() {
  if (!workspace) return showError("יש לבחור תחילה סביבת עבודה מקומית ללקוח.");
  if (!api) return showError("הפרסום עדיין לא הוגדר.");
  start.disabled = true; status.textContent = "";
  try { const response = await fetch(apiUrl("/v1/sessions"), { method: "POST" }), data = await response.json(); if (!response.ok) throw new Error(data.error || "לא ניתן היה ליצור חיבור העלאה."); session = data; inactive.hidden = true; active.hidden = false; telegramLink.href = data.telegramUrl; new QRious({ element: document.querySelector("#qr"), value: data.telegramUrl, size: 260, level: "M" }); openEvents(); }
  catch (error) { showError(error.message); updateStartAvailability(); }
}
start.addEventListener("click", () => { if (tableLocked) { uploadModeDialog.showModal(); return; } startUpload(); });
addToExisting.addEventListener("click", () => { setTableLocked(false); uploadModeDialog.close(); startUpload(); });
startNewTable.addEventListener("click", () => { records.replaceChildren(); recordCount = 0; imageCount = 0; received = new Set(); refreshRows(); setTableLocked(false); uploadModeDialog.close(); startUpload(); });
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
  if (!session || received.has(documentId)) return; received.add(documentId); const imageIndex = ++imageCount;
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}`), { headers: { "X-Upload-Token": session.clientToken } }); if (!response.ok) throw new Error("הורדת התמונה נכשלה.");
    const downloaded = await response.blob(), blob = new Blob([downloaded], { type: downloaded.type === "image/png" ? "image/png" : "image/jpeg" }), imageUrl = URL.createObjectURL(blob), row = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, null, blob);
    row.runRecognition = (onlyThis = false) => enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex, true, onlyThis); enqueueRecognition(row, blob, imageUrl, receivedAt, documentId, imageIndex);
    const ack = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}/ack`), { method: "POST", headers: { "X-Upload-Token": session.clientToken } }); if (!ack.ok) throw new Error("אישור קבלת התמונה נכשל; ייתכן שהיא תישלח שוב.");
  } catch (error) { received.delete(documentId); showError(error.message); }
}
function addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, insertAfter = null, imageBlob = null) {
  emptyRow?.remove(); recordCount += 1; count.textContent = `שורות ביומן: ${recordCount}`;
  const row = document.createElement("tr"); row.dataset.documentId = documentId; row.dataset.imageIndex = String(imageIndex); row.dataset.receivedAt = String(receivedAt); row.documentImage = imageBlob;
  row.append(emptyCell(String(recordCount)), emptyCell(receivedAtText(receivedAt)), emptyCell(), emptyCell("ממתין לעיבוד"), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell(), emptyCell());
  const photo = document.createElement("td"), open = document.createElement("button"); open.type = "button"; open.className = "photo-button"; open.textContent = `תמונה #${imageIndex}`; open.addEventListener("click", () => openPhoto(imageUrl, imageIndex)); photo.append(open); row.append(photo);
  row.append(emptyCell("ממתין ל‑Gemini", "agent-opinion"), emptyCell(), emptyCell("התקבל", "state received"));
  const exportCell = document.createElement("td"), include = document.createElement("input"); include.type = "checkbox"; include.disabled = true; exportCell.append(include); row.append(exportCell);
  const deleteCell = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "delete"; remove.textContent = "מחק"; remove.addEventListener("click", () => { row.remove(); refreshRows(); }); deleteCell.append(remove); row.append(deleteCell); if (insertAfter?.parentNode === records) records.insertBefore(row, insertAfter.nextSibling); else records.append(row); refreshRows(); return row;
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
    if (!onlyThis) for (const record of result.records.slice(1)) { const lastForImage = [...records.querySelectorAll("tr")].filter((candidate) => candidate.dataset.documentId === documentId).at(-1); const extra = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, lastForImage, blob); extra.runRecognition = (single = false) => enqueueRecognition(extra, blob, imageUrl, receivedAt, documentId, imageIndex, true, single); applyRecord(extra, record); }
  } catch (error) {
    if (controller.signal.aborted) { setStatus(row, "בוטל", "review"); row.cells[3].textContent = "—"; row.cells[14].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד", false); }
    else { setStatus(row, "שגיאה בעיבוד", "error"); row.cells[3].textContent = "—"; row.cells[14].textContent = error.message; addRerunButton(row, "נסה שוב"); }
  } finally { if (activeRecognitionController === controller) activeRecognitionController = null; }
}
function addRerunButton(row, label = "עבד מחדש", onlyThis = true) { const button = document.createElement("button"); button.type = "button"; button.className = "retry"; button.textContent = label; button.addEventListener("click", () => row.runRecognition?.(onlyThis)); row.cells[16].append(document.createElement("br"), button); }
function applyRecord(row, record) {
  row.dataset.rawNet = String(record.net_amount || 0); row.dataset.rawVat = String(record.vat_amount || 0); row.highlights = Array.isArray(record.highlight_regions) ? record.highlight_regions : [];
  const values = [record.date, null, record.purpose, record.supplier_name, record.supplier_vat_id, record.transaction_number || record.invoice_number, record.allocation_number, null, record.net_amount, record.vat_amount];
  values.forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[2].replaceChildren(classificationSelect(record.rivhit_code || "")); row.cells[11].replaceChildren(percentSelect(record.vat_recognized_percent ?? 100, [100, 25, 0])); row.cells[12].replaceChildren(percentSelect(record.recognized_percent || 100)); applyBusinessRule(row);
  row.cells[14].textContent = record.agent_opinion; row.cells[14].className = "agent-opinion"; row.cells[15].textContent = String(record.confidence) + "%";
  const include = row.cells[17].querySelector("input"); include.disabled = false; include.checked = record.include;
  setStatus(row, record.include ? row.highlights.length ? "מוכן לייצוא" : "מוכן, חסרים סימונים" : record.document_kind === "payment_confirmation" ? "אישור תשלום" : "לא מיועד לייצוא", record.include && row.highlights.length ? "ready" : "review"); addRerunButton(row);
}
function cellValue(cell) { return cell.querySelector("select")?.value ?? cell.textContent.trim().replace(/^—$/, ""); }
function rowSnapshot(row) {
  return {
    documentId: row.dataset.documentId || "", imageIndex: Number(row.dataset.imageIndex || 0), receivedAt: row.dataset.receivedAt || new Date().toISOString(),
    values: Array.from({ length: 12 }, (_, index) => cellValue(row.cells[index + 1])), rawNet: row.dataset.rawNet || "0", rawVat: row.dataset.rawVat || "0", highlights: row.highlights || [],
    active: Boolean(row.cells[17].querySelector("input")?.checked), agentOpinion: row.cells[14].textContent.trim(), confidence: row.cells[15].textContent.trim(),
    statusText: row.cells[16].childNodes[0]?.textContent?.trim() || row.cells[16].textContent.trim(), statusClass: row.cells[16].className.replace(/^state\s*/, "")
  };
}
function restoreRow(saved, blob) {
  const imageUrl = URL.createObjectURL(blob), row = addPendingRecord(imageUrl, saved.receivedAt || new Date().toISOString(), saved.documentId || "saved", saved.imageIndex || 0, null, blob), values = Array.isArray(saved.values) ? saved.values : [];
  row.dataset.rawNet = String(saved.rawNet || 0); row.dataset.rawVat = String(saved.rawVat || 0); row.highlights = Array.isArray(saved.highlights) ? saved.highlights : [];
  values.slice(0, 12).forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[2].replaceChildren(classificationSelect(values[1] || "")); row.cells[11].replaceChildren(percentSelect(values[10] || 100, [100, 25, 0])); row.cells[12].replaceChildren(percentSelect(values[11] || 100));
  row.cells[14].textContent = saved.agentOpinion || "—"; row.cells[14].className = "agent-opinion"; row.cells[15].textContent = saved.confidence || "—";
  const include = row.cells[17].querySelector("input"); include.disabled = false; include.checked = Boolean(saved.active); setStatus(row, saved.active && !row.highlights.length ? "מוכן, חסרים סימונים" : saved.statusText || (saved.active ? "מוכן לייצוא" : "לא מיועד לייצוא"), saved.active && !row.highlights.length ? "review" : saved.statusClass || (saved.active ? "ready" : "review"));
  row.runRecognition = (onlyThis = true) => { if (!session) return showError("יש להתחיל העלאת תמונות כדי לעבד מחדש שורה מהארכיון."); enqueueRecognition(row, blob, imageUrl, saved.receivedAt || Date.now(), saved.documentId || "saved", saved.imageIndex || 0, true, onlyThis); }; addRerunButton(row);
}
createPdf.addEventListener("click", async () => {
  if (!committedWorkspace) return showError("יש לבחור תחילה לקוח.");
  const allRows = [...records.querySelectorAll("tr[data-document-id]")]; if (!allRows.length) return showError("אין שורות לשמירה.");
  const snapshots = allRows.map(rowSnapshot), activeRows = snapshots.filter((row) => row.active), reportRows = allRows.map((row, index) => ({ ...snapshots[index], imageBlob: row.documentImage, tableRow: index + 1 })).filter((row) => row.active); if (!activeRows.length) return showError("יש לסמן לפחות שורה פעילה אחת ל-PDF.");
  const missingMarkers = reportRows.filter((row) => !row.highlights?.length).map((row) => row.tableRow); if (missingMarkers.length) return showError(`לא ניתן ליצור PDF מסומן: חסרים סימונים בשורות הפעילות ${missingMarkers.join(", ")}. יש לבחור הוספה לטבלה הקיימת ולעבד שורות אלה מחדש.`);
  if (snapshots.some((_, index) => !allRows[index].documentImage)) return showError("לא נמצאה תמונה מקורית לאחת השורות; יש לעבד אותה מחדש לפני השמירה.");
  createPdf.disabled = true; status.textContent = "יוצר PDF ושומר חבילה מקומית…";
  try {
    const createdAt = new Date(), { directory, name } = await createPackageDirectory(committedWorkspace.directory, createdAt), images = await directory.getDirectoryHandle("images", { create: true }), imageFiles = new Map();
    for (let index = 0; index < allRows.length; index += 1) { const row = allRows[index], snapshot = snapshots[index], key = `${snapshot.imageIndex}-${row.documentImage.type}`; if (!imageFiles.has(key)) { const extension = row.documentImage.type === "image/png" ? "png" : "jpg", fileName = `${String(snapshot.imageIndex || imageFiles.size + 1).padStart(3, "0")}.${extension}`; await writeFile(images, fileName, row.documentImage); imageFiles.set(key, fileName); } snapshot.imageFile = imageFiles.get(key); snapshot.imageType = row.documentImage.type || "image/jpeg"; }
    const pdf = await buildPdfReport({ clientName: committedWorkspace.config.clientName, createdAt, rows: reportRows });
    await Promise.all([writeFile(directory, "source.txt", makeSourceText(snapshots)), writeFile(directory, "table.json", JSON.stringify(makePackageManifest({ client: committedWorkspace.config, createdAt, rows: snapshots }), null, 2)), writeFile(directory, "document.pdf", pdf)]);
    status.textContent = `החבילה נשמרה: ${name}`;
  } catch (error) { if (error.name !== "AbortError") showError(`לא ניתן ליצור את החבילה: ${error.message}`); }
  finally { createPdf.disabled = false; }
});
openPackage.addEventListener("click", async () => {
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" }), manifestFile = await (await directory.getFileHandle("table.json")).getFile(), manifest = JSON.parse(await manifestFile.text());
    if (!Array.isArray(manifest.rows) || !manifest.client) throw new Error("קובץ table.json אינו חבילת מסמכים תקינה.");
    if (records.querySelector("tr[data-document-id]") && !window.confirm("הטבלה הנוכחית תוחלף בחבילה השמורה. להמשיך?")) return;
    const images = await directory.getDirectoryHandle("images"), cache = new Map(); records.replaceChildren(); recordCount = 0; received = new Set(); imageCount = Math.max(0, ...manifest.rows.map((row) => Number(row.imageIndex) || 0));
    for (const saved of manifest.rows) { const fileName = String(saved.image?.file || "").split("/").pop(); if (!fileName) throw new Error("באחת השורות חסר קישור לתמונה."); if (!cache.has(fileName)) cache.set(fileName, await (await images.getFileHandle(fileName)).getFile()); restoreRow(saved, cache.get(fileName)); }
    refreshRows(); setTableLocked(true); status.textContent = `החבילה נטענה: ${directory.name}. הטבלה נעולה עד לבחירת מצב העלאה.`;
  } catch (error) { if (error.name !== "AbortError") showError(`לא ניתן לטעון את החבילה: ${error.message}`); }
});
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
