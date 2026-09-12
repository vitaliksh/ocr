import { setupWorkspaceControls } from "./workspace.js";
import { writeFile } from "./document-package.js";
import { buildPdfReport } from "./pdf-report.js";
import { createDraftExportDirectory, finalizeDeclaration, readClosedHistory, readSourceImage, saveDraft, saveSourceImage } from "./declaration-store.js";
import { buildRivhitImport, draftExportManifest } from "./rivhit-export.js";
import { relevantHistory } from "./history-ranker.js";

const api = (window.TELEGRAM_TRANSFER_API || "").replace(/\/$/, "");
const inactive = document.querySelector("#inactive"), active = document.querySelector("#active"), start = document.querySelector("#start"), finish = document.querySelector("#finish"), stop = document.querySelector("#stop-processing"), status = document.querySelector("#status"), connection = document.querySelector("#connection"), records = document.querySelector("#records"), count = document.querySelector("#count"), telegramLink = document.querySelector("#telegram-link"), emptyRow = document.querySelector("#empty-row"), photoWindow = document.querySelector("#photo-window"), dialogImage = document.querySelector("#dialog-image"), photoTitle = document.querySelector("#photo-title"), photoViewport = document.querySelector("#photo-viewport"), businessActivity = document.querySelector("#business-activity"), businessKind = document.querySelector("#business-kind"), model = document.querySelector("#model"), workspaceSummary = document.querySelector("#workspace-summary"), currentClient = document.querySelector("#current-client"), createPdf = document.querySelector("#create-pdf"), closeDeclarationButton = document.querySelector("#close-declaration"), openPackage = document.querySelector("#open-package"), uploadModeDialog = document.querySelector("#upload-mode-dialog"), addToExisting = document.querySelector("#add-to-existing"), startNewTable = document.querySelector("#start-new-table"), uploadRequirements = document.querySelector("#upload-requirements"), workspacesDrawer = document.querySelector("#workspaces-drawer"), workspacesBackdrop = document.querySelector("#workspaces-backdrop"), openWorkspacesDrawer = document.querySelector("#open-workspaces-drawer"), closeWorkspacesDrawer = document.querySelector("#close-workspaces-drawer"), registerPasskey = document.querySelector("#register-passkey"), passkeySummary = document.querySelector("#passkey-summary"), passkeyEnrollmentDialog = document.querySelector("#passkey-enrollment-dialog"), passkeyEnrollmentStatus = document.querySelector("#passkey-enrollment-status"), passkeyTelegramLink = document.querySelector("#passkey-telegram-link"), continuePasskeyEnrollment = document.querySelector("#continue-passkey-enrollment"), cancelPasskeyEnrollment = document.querySelector("#cancel-passkey-enrollment"), cancelPasskeyEnrollmentAction = document.querySelector("#cancel-passkey-enrollment-action");
let dataRoot = null, workspace = null, committedWorkspace = null, currentDeclaration = null, currentDeclarationDirectory = null, canonicalTemplate = null, session = null, streamAbort = null, enrollmentSession = null, enrollmentAbort = null, enrollmentInProgress = false, received = new Set(), recordCount = 0, imageCount = 0, pendingRecognitions = 0, recognitionQueue = Promise.resolve(), activeRecognitionController = null, stopRequested = false, drag = null, resize = null, imageDrag = null, zoom = 1, panX = 0, panY = 0, tableLocked = false, draftSaveTimer = null, passkeyGrant = null;

function apiUrl(path) { return `${api}${path}`; }
function showError(message) { status.textContent = message; }
const passkeyStorageKey = "rivhit-passkey-credential-id-v1";
function passkeyCredentialId() { return localStorage.getItem(passkeyStorageKey) || ""; }
function updatePasskeySummary() { const configured = Boolean(passkeyCredentialId()); passkeySummary.textContent = configured ? "המחשב מחובר. שיפור AI יבקש אישור Windows Hello בלבד, ללא Telegram." : "המחשב טרם חובר. נדרש חיבור Telegram חד־פעמי בלבד."; registerPasskey.textContent = configured ? "חיבור מחדש של מחשב זה" : "חיבור המחשב לשיפור AI"; }
function fromBase64Url(value) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4), binary = atob(padded), bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes.buffer; }
function publicKeyOptions(options, kind) { const output = structuredClone(options); output.challenge = fromBase64Url(output.challenge); if (kind === "create") { output.user.id = fromBase64Url(output.user.id); for (const credential of output.excludeCredentials || []) credential.id = fromBase64Url(credential.id); } else for (const credential of output.allowCredentials || []) credential.id = fromBase64Url(credential.id); return output; }
function credentialJson(credential) { if (credential.toJSON) return credential.toJSON(); const response = credential.response, encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: { clientDataJSON: encode(response.clientDataJSON), ...(response.attestationObject ? { attestationObject: encode(response.attestationObject) } : { authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : undefined }) }, clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment || undefined };
}
function hasCanonicalTemplate() { return workspaceControls?.hasCanonicalTemplate?.() || Boolean(canonicalTemplate); }
function updateStartAvailability() { const open = currentDeclaration?.status === "open"; start.disabled = !dataRoot || !open || !hasCanonicalTemplate(); closeDeclarationButton.disabled = !open || !committedWorkspace || !hasCanonicalTemplate(); uploadRequirements.textContent = !dataRoot ? "יש לבחור תחילה תיקיית נתונים בסביבות העבודה." : !currentDeclaration ? "יש לבחור הצהרה לפני העלאת תמונות." : !open ? "ההצהרה סגורה ואי אפשר להוסיף אליה תמונות." : !hasCanonicalTemplate() ? "יש לבחור בסביבות העבודה תבנית Rivhit כללית לפני העלאת תמונות." : ""; }
async function activateDeclaration(selected) {
  if (currentDeclaration && currentDeclaration.declarationId !== selected.declaration.declarationId && records.querySelector("tr[data-document-id]") && !window.confirm("לעבור להצהרה אחרת? הטיוטה הנוכחית תישמר מקומית.")) return false;
  await saveCurrentDraft();
  workspace = committedWorkspace = selected.workspace; currentDeclaration = selected.declaration; currentDeclarationDirectory = selected.directory; businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind;
  records.replaceChildren(); recordCount = 0; imageCount = 0; received = new Set();
  for (const saved of selected.draft?.rows || []) { try { restoreRow(saved, await readSourceImage(selected.directory, saved.imageFile)); } catch (error) { throw new Error(`לא ניתן לשחזר תמונה ${saved.imageFile || ""}: ${error.message}`); } }
  refreshRows(); setTableLocked(currentDeclaration.status !== "open"); currentClient.textContent = `לקוח: ${workspace.config.clientName} · הצהרה: ${currentDeclaration.month}`; applyBusinessRules(); status.textContent = currentDeclaration.status === "open" ? "" : "ההצהרה סגורה לקריאה בלבד."; updateStartAvailability(); setWorkspacesDrawer(false); return true;
}
function updateWorkspace(selected) { if (workspace?.config.clientId === selected.config.clientId) workspace = { ...workspace, config: selected.config }; if (committedWorkspace?.config.clientId === selected.config.clientId) { committedWorkspace = { ...committedWorkspace, config: selected.config }; businessActivity.value = selected.config.businessActivity; businessKind.value = selected.config.businessKind; applyBusinessRules(); } }
function clearActiveClient(clientId) { if (workspace?.config.clientId === clientId) workspace = null; if (committedWorkspace?.config.clientId === clientId) { committedWorkspace = null; currentDeclaration = null; currentClient.textContent = "לא נבחרה הצהרה"; updateStartAvailability(); } }
const workspaceControls = setupWorkspaceControls({
  clientList: document.querySelector("#client-list"), showNewButton: document.querySelector("#show-new-client"), openExistingButton: document.querySelector("#open-existing-client"), archivedToggle: document.querySelector("#toggle-archived-clients"), dataRootButton: document.querySelector("#select-data-root"), dataRootSummary: document.querySelector("#data-root-summary"), templateButton: document.querySelector("#select-template"), creationPanel: document.querySelector("#new-client-form"), createButton: document.querySelector("#create-client"), deleteButton: document.querySelector("#delete-client"), archiveButton: document.querySelector("#archive-client"), restoreButton: document.querySelector("#restore-client"), saveClientButton: document.querySelector("#save-client-settings"), clientMenu: document.querySelector("#client-menu"), clientMenuName: document.querySelector("#client-menu-name"), clientNameInput: document.querySelector("#new-client-name"), clientActivityInput: document.querySelector("#new-client-activity"), clientKindInput: document.querySelector("#new-client-kind"), businessActivityInput: businessActivity, businessKindInput: businessKind, summary: workspaceSummary, templateSummary: document.querySelector("#template-summary"),
  onDataRoot: (selected) => { dataRoot = selected; updateStartAvailability(); },
  onDeclaration: activateDeclaration,
  onUpdated: updateWorkspace,
  onArchived: (selected) => { clearActiveClient(selected.config.clientId); },
  onTemplate: (selected) => { canonicalTemplate = selected; updateStartAvailability(); },
  onDeleted: clearActiveClient,
  onError: showError
});
updateStartAvailability();
updatePasskeySummary();
registerPasskey.addEventListener("click", async () => {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) return showError("דפדפן זה אינו תומך ב‑Windows Hello.");
  if (!dataRoot) return showError("יש לבחור תחילה תיקיית נתונים בסביבות העבודה.");
  if (!api) return showError("הפרסום עדיין לא הוגדר.");
  if (enrollmentSession) return;
  registerPasskey.disabled = true;
  try {
    const response = await fetch(apiUrl("/v1/sessions"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: "passkey-enrollment" }) }), data = await response.json();
    if (!response.ok) throw new Error(data.error || "לא ניתן להתחיל חיבור מחשב.");
    enrollmentSession = data; passkeyEnrollmentStatus.textContent = "סרוק את הקוד ב‑Telegram כדי לאשר את חיבור המחשב."; passkeyTelegramLink.href = data.telegramUrl; continuePasskeyEnrollment.disabled = true;
    new QRious({ element: document.querySelector("#passkey-qr"), value: data.telegramUrl, size: 260, level: "M" });
    passkeyEnrollmentDialog.showModal(); openEnrollmentEvents(data);
  } catch (error) { showError(error.message); registerPasskey.disabled = false; }
});
function setWorkspacesDrawer(open) {
  if (!open) { workspace = committedWorkspace; workspaceControls?.clearPending(); if (workspace) { businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind; } }
  if (open) { workspacesDrawer.hidden = false; workspacesBackdrop.hidden = false; requestAnimationFrame(() => { workspacesDrawer.classList.add("is-open"); workspacesBackdrop.classList.add("is-open"); }); }
  else { workspacesDrawer.classList.remove("is-open"); workspacesBackdrop.classList.remove("is-open"); }
  workspacesDrawer.setAttribute("aria-hidden", String(!open)); openWorkspacesDrawer.setAttribute("aria-expanded", String(open)); document.body.classList.toggle("drawer-open", open);
  if (open) closeWorkspacesDrawer.focus(); else { window.setTimeout(() => { if (!workspacesDrawer.classList.contains("is-open")) { workspacesDrawer.hidden = true; workspacesBackdrop.hidden = true; } }, 200); openWorkspacesDrawer.focus(); }
}
openWorkspacesDrawer.addEventListener("click", async () => { workspace = committedWorkspace; workspaceControls?.showActiveClients(); if (workspace) { businessActivity.value = workspace.config.businessActivity; businessKind.value = workspace.config.businessKind; } setWorkspacesDrawer(true); try { await workspaceControls?.refreshFromUserAction(); } catch (error) { showError("לא ניתן לרענן את רשימת הלקוחות: " + error.message); } });
closeWorkspacesDrawer.addEventListener("click", () => setWorkspacesDrawer(false));
workspacesBackdrop.addEventListener("click", () => setWorkspacesDrawer(false));
window.addEventListener("keydown", (event) => { if (event.key === "Escape" && workspacesDrawer.classList.contains("is-open")) { event.preventDefault(); setWorkspacesDrawer(false); } });
function reset() { streamAbort?.abort(); streamAbort = null; session = null; received = new Set(); active.hidden = true; inactive.hidden = false; updateStartAvailability(); }
async function finishEnrollmentSession() {
  const closingSession = enrollmentSession;
  enrollmentAbort?.abort(); enrollmentAbort = null; enrollmentSession = null;
  if (!closingSession) return;
  try { await fetch(apiUrl(`/v1/sessions/${closingSession.sessionId}/finish`), { method: "POST", headers: { "X-Upload-Token": closingSession.clientToken } }); } catch {}
}
async function cancelEnrollment() {
  await finishEnrollmentSession();
  enrollmentInProgress = false;
  passkeyEnrollmentDialog.close(); registerPasskey.disabled = false;
  status.textContent = "חיבור המחשב בוטל. אפשר להתחיל שוב בכל עת.";
}
async function saveCurrentDraft() { if (!currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return; clearTimeout(draftSaveTimer); try { await saveDraft(currentDeclarationDirectory, currentDeclaration, [...records.querySelectorAll("tr[data-document-id]")].map(rowSnapshot)); } catch (error) { showError("לא ניתן לשמור טיוטה מקומית: " + error.message); throw error; } }
function queueDraftSave() { if (!currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return; clearTimeout(draftSaveTimer); draftSaveTimer = setTimeout(() => { saveCurrentDraft().catch(() => {}); }, 250); }
function receivedAtText(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value || "—") : new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(date); }
function emptyCell(text = "—", className = "") { const cell = document.createElement("td"); cell.textContent = text; if (className) cell.className = className; return cell; }
function display(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function editableCell(value) { const cell = emptyCell(display(value), "editable"); cell.contentEditable = "true"; cell.spellcheck = false; return cell; }
function setTableLocked(locked) { tableLocked = locked; records.classList.toggle("table-locked", locked); for (const cell of records.querySelectorAll(".editable")) cell.contentEditable = locked ? "false" : "true"; for (const control of records.querySelectorAll("select,input,.delete,.retry")) control.disabled = locked; }
function refreshRows() { const rows = [...records.querySelectorAll("tr[data-document-id]")]; recordCount = rows.length; rows.forEach((row, index) => { row.cells[0].textContent = String(index + 1); }); count.textContent = `שורות ביומן: ${recordCount}`; if (!recordCount) records.append(emptyRow); }
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

async function startUpload(purpose = "upload") {
  if (!currentDeclaration || currentDeclaration.status !== "open") return showError("יש לבחור תחילה הצהרה פתוחה.");
  if (!api) return showError("הפרסום עדיין לא הוגדר.");
  start.disabled = true; status.textContent = "";
  try { const response = await fetch(apiUrl("/v1/sessions"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose }) }), data = await response.json(); if (!response.ok) throw new Error(data.error || "לא ניתן היה ליצור חיבור העלאה."); session = data; inactive.hidden = true; active.hidden = false; telegramLink.href = data.telegramUrl; new QRious({ element: document.querySelector("#qr"), value: data.telegramUrl, size: 260, level: "M" }); openEvents(); }
  catch (error) { showError(error.message); updateStartAvailability(); }
}
start.addEventListener("click", () => { if (tableLocked) { uploadModeDialog.showModal(); return; } startUpload(); });
addToExisting.addEventListener("click", () => { setTableLocked(false); uploadModeDialog.close(); startUpload(); });
startNewTable.addEventListener("click", () => { uploadModeDialog.close(); showError("בהצהרה חודשית אין טבלה חדשה: בחר הצהרה אחרת בסביבות העבודה."); });
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
async function openEnrollmentEvents(targetSession) {
  enrollmentAbort?.abort(); enrollmentAbort = new AbortController();
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${targetSession.sessionId}/events`), { headers: { "X-Upload-Token": targetSession.clientToken }, signal: enrollmentAbort.signal });
    if (!response.ok || !response.body) throw new Error("לא ניתן להמתין לחיבור Telegram.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
    while (enrollmentSession === targetSession) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const messages = buffer.split("\n\n"); buffer = messages.pop() || ""; messages.forEach((message) => consumeEnrollmentEvent(message, targetSession)); }
  } catch (error) { if (!enrollmentAbort?.signal.aborted && enrollmentSession === targetSession) passkeyEnrollmentStatus.textContent = "החיבור נותק. אפשר לבטל ולנסות שוב."; }
}
function consumeEnrollmentEvent(message, targetSession) {
  const type = message.match(/^event: (.+)$/m)?.[1], text = message.match(/^data: (.+)$/m)?.[1]; if (!type || !text || enrollmentSession !== targetSession) return;
  const data = JSON.parse(text);
  if ((type === "ready" && data.connected) || type === "connected") { passkeyEnrollmentStatus.textContent = "Telegram מחובר. לחץ על 'המשך ל‑Windows Hello' כדי לאשר במחשב."; continuePasskeyEnrollment.disabled = false; }
}
async function receiveDocument(documentId, receivedAt) {
  if (!session || received.has(documentId)) return; received.add(documentId); const imageIndex = ++imageCount;
  try {
    const response = await fetch(apiUrl(`/v1/sessions/${session.sessionId}/documents/${documentId}`), { headers: { "X-Upload-Token": session.clientToken } }); if (!response.ok) throw new Error("הורדת התמונה נכשלה.");
    const downloaded = await response.blob(), blob = new Blob([downloaded], { type: downloaded.type === "image/png" ? "image/png" : "image/jpeg" }), extension = blob.type === "image/png" ? "png" : "jpg", imageFile = `${String(imageIndex).padStart(3, "0")}.${extension}`, imageUrl = URL.createObjectURL(blob);
    await saveSourceImage(currentDeclarationDirectory, imageFile, blob); const row = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, null, blob); row.dataset.imageFile = imageFile; queueDraftSave();
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
  const deleteCell = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "delete"; remove.textContent = "מחק"; remove.addEventListener("click", () => { row.remove(); refreshRows(); queueDraftSave(); }); deleteCell.append(remove); row.append(deleteCell); if (insertAfter?.parentNode === records) records.insertBefore(row, insertAfter.nextSibling); else records.append(row); refreshRows(); return row;
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
    if (!onlyThis) for (const record of result.records.slice(1)) { const lastForImage = [...records.querySelectorAll("tr")].filter((candidate) => candidate.dataset.documentId === documentId).at(-1); const extra = addPendingRecord(imageUrl, receivedAt, documentId, imageIndex, lastForImage, blob); extra.dataset.imageFile = row.dataset.imageFile || ""; extra.runRecognition = (single = false) => enqueueRecognition(extra, blob, imageUrl, receivedAt, documentId, imageIndex, true, single); applyRecord(extra, record); }
  } catch (error) {
    if (controller.signal.aborted) { setStatus(row, "בוטל", "review"); row.cells[3].textContent = "—"; row.cells[14].textContent = "העיבוד נעצר על ידי המשתמש."; addRerunButton(row, "עבד", false); }
    else { setStatus(row, "שגיאה בעיבוד", "error"); row.cells[3].textContent = "—"; row.cells[14].textContent = error.message; addRerunButton(row, "נסה שוב"); }
  } finally { if (activeRecognitionController === controller) activeRecognitionController = null; }
}
function addRerunButton(row, label = "עבד מחדש", onlyThis = true) { const button = document.createElement("button"); button.type = "button"; button.className = "retry"; button.textContent = label; button.addEventListener("click", () => row.runRecognition?.(onlyThis)); row.cells[16].append(document.createElement("br"), button); }
async function completePasskeyEnrollment(targetSession = enrollmentSession) {
  if (!targetSession || enrollmentSession !== targetSession || enrollmentInProgress) return;
  enrollmentInProgress = true;
  continuePasskeyEnrollment.disabled = true;
  passkeyEnrollmentStatus.textContent = "Telegram מחובר. אשר ב‑Windows Hello במחשב.";
  try {
    const optionsResponse = await fetch(apiUrl(`/v1/sessions/${targetSession.sessionId}/passkeys/registration-options`), { method: "POST", headers: { "X-Upload-Token": targetSession.clientToken } }), options = await optionsResponse.json();
    if (!optionsResponse.ok) throw new Error(options.error || "לא ניתן להתחיל הגדרת Windows Hello.");
    const credential = await navigator.credentials.create({ publicKey: publicKeyOptions(options, "create") });
    if (!credential) throw new Error("Windows Hello לא הושלם.");
    const response = await fetch(apiUrl(`/v1/sessions/${targetSession.sessionId}/passkeys/register`), { method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Token": targetSession.clientToken }, body: JSON.stringify(credentialJson(credential)) }), result = await response.json();
    if (!response.ok) throw new Error(result.error || "לא ניתן לשמור את Windows Hello.");
    localStorage.setItem(passkeyStorageKey, result.credentialId); updatePasskeySummary(); await finishEnrollmentSession(); passkeyEnrollmentDialog.close(); status.textContent = "המחשב חובר. שיפור AI יבקש Windows Hello בלבד, ללא Telegram.";
  } catch (error) { passkeyEnrollmentStatus.textContent = "Windows Hello לא הושלם. אפשר לנסות שוב או לבטל."; showError("לא ניתן לחבר את המחשב: " + error.message); continuePasskeyEnrollment.disabled = false; }
  finally { enrollmentInProgress = false; if (!enrollmentSession) registerPasskey.disabled = false; }
}
continuePasskeyEnrollment.addEventListener("click", () => completePasskeyEnrollment());
passkeyEnrollmentDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelEnrollment(); });
cancelPasskeyEnrollment.addEventListener("click", (event) => { event.preventDefault(); cancelEnrollment(); });
cancelPasskeyEnrollmentAction.addEventListener("click", (event) => { event.preventDefault(); cancelEnrollment(); });
async function authorizePasskey() {
  const credentialId = passkeyCredentialId();
  if (!credentialId) throw new Error("יש להגדיר תחילה Windows Hello בסביבות העבודה. Telegram נדרש שם פעם אחת בלבד.");
  if (!window.PublicKeyCredential || !navigator.credentials?.get) throw new Error("דפדפן זה אינו תומך ב‑Windows Hello.");
  if (passkeyGrant?.expiresAt > Date.now() + 5000 && passkeyGrant.credentialId === credentialId) return passkeyGrant;
  const optionsResponse = await fetch(apiUrl("/v1/passkeys/authentication-options"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialId }) }), options = await optionsResponse.json();
  if (!optionsResponse.ok) { if (optionsResponse.status === 404) { localStorage.removeItem(passkeyStorageKey); updatePasskeySummary(); } throw new Error(options.error || "לא ניתן להתחיל אימות Windows Hello."); }
  const credential = await navigator.credentials.get({ publicKey: publicKeyOptions(options, "get") });
  if (!credential) throw new Error("Windows Hello לא אושר.");
  const response = await fetch(apiUrl("/v1/passkeys/authentication-verify"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialId, response: credentialJson(credential) }) }), result = await response.json();
  if (!response.ok) throw new Error(result.error || "Windows Hello לא אומת.");
  passkeyGrant = { credentialId, token: result.token, expiresAt: result.expiresAt }; return passkeyGrant;
}
async function refineWithHistory(row) {
  if (!committedWorkspace || !currentDeclaration || currentDeclaration.status !== "open") return showError("יש לבחור הצהרה פתוחה לפני שיפור לפי היסטוריה.");
  const history = relevantHistory(rowSnapshot(row), await readClosedHistory(committedWorkspace.directory));
  if (!history.length) { addHistoryButton(row); return showError("אין היסטוריה סגורה ורלוונטית לשורה זו."); }
  try {
    const grant = await authorizePasskey();
    const response = await fetch(apiUrl("/v1/passkeys/refine-history"), { method: "POST", headers: { "Content-Type": "application/json", "X-Passkey-Credential-Id": grant.credentialId, "X-Passkey-Token": grant.token, "X-Gemini-Model": model.value }, body: JSON.stringify({ draft: rowSnapshot(row), history }) }), result = await response.json(); if (!response.ok) throw new Error(result.error || "השיפור נכשל.");
    if (result.rivhit_code) row.cells[2].querySelector("select").value = result.rivhit_code; if (result.vat_recognized_percent !== null) row.cells[11].querySelector("select").value = String(result.vat_recognized_percent); if (result.recognized_percent !== null) row.cells[12].querySelector("select").value = String(result.recognized_percent); applyBusinessRule(row); row.cells[14].textContent = result.agent_opinion; row.cells[15].textContent = String(result.confidence) + "%"; setStatus(row, result.review_state === "ready" ? "מוכן לייצוא" : "נדרש עיון", result.review_state); addHistoryButton(row); queueDraftSave();
  } catch (error) { showError("לא ניתן לשפר לפי היסטוריה: " + error.message); }
}
function addHistoryButton(row) { if (row.cells[16].querySelector(".history-refine")) return; const button = document.createElement("button"); button.type = "button"; button.className = "retry history-refine"; button.textContent = "שפר לפי היסטוריה"; button.addEventListener("click", () => refineWithHistory(row)); row.cells[16].append(document.createElement("br"), button); }
function applyRecord(row, record) {
  row.dataset.rawNet = String(record.net_amount || 0); row.dataset.rawVat = String(record.vat_amount || 0); row.highlights = Array.isArray(record.highlight_regions) ? record.highlight_regions : [];
  const values = [record.date, null, record.purpose, record.supplier_name, record.supplier_vat_id, record.transaction_number || record.invoice_number, record.allocation_number, null, record.net_amount, record.vat_amount];
  values.forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[2].replaceChildren(classificationSelect(record.rivhit_code || "")); row.cells[11].replaceChildren(percentSelect(record.vat_recognized_percent ?? 100, [100, 25, 0])); row.cells[12].replaceChildren(percentSelect(record.recognized_percent || 100)); applyBusinessRule(row);
  row.cells[14].textContent = record.agent_opinion; row.cells[14].className = "agent-opinion"; row.cells[15].textContent = String(record.confidence) + "%";
  const include = row.cells[17].querySelector("input"); include.disabled = false; include.checked = record.include;
  setStatus(row, record.include ? row.highlights.length ? "מוכן לייצוא" : "מוכן, חסרים סימונים" : record.document_kind === "payment_confirmation" ? "אישור תשלום" : "לא מיועד לייצוא", record.include && row.highlights.length ? "ready" : "review"); addRerunButton(row); addHistoryButton(row); queueDraftSave();
}
function cellValue(cell) { return cell.querySelector("select")?.value ?? cell.textContent.trim().replace(/^—$/, ""); }
function rowSnapshot(row) {
  return {
    documentId: row.dataset.documentId || "", imageIndex: Number(row.dataset.imageIndex || 0), imageFile: row.dataset.imageFile || "", receivedAt: row.dataset.receivedAt || new Date().toISOString(),
    values: Array.from({ length: 12 }, (_, index) => cellValue(row.cells[index + 1])), rawNet: row.dataset.rawNet || "0", rawVat: row.dataset.rawVat || "0", highlights: row.highlights || [],
    active: Boolean(row.cells[17].querySelector("input")?.checked), agentOpinion: row.cells[14].textContent.trim(), confidence: row.cells[15].textContent.trim(),
    statusText: row.cells[16].childNodes[0]?.textContent?.trim() || row.cells[16].textContent.trim(), statusClass: row.cells[16].className.replace(/^state\s*/, "")
  };
}
function restoreRow(saved, blob) {
  const imageUrl = URL.createObjectURL(blob), row = addPendingRecord(imageUrl, saved.receivedAt || new Date().toISOString(), saved.documentId || "saved", saved.imageIndex || 0, null, blob), values = Array.isArray(saved.values) ? saved.values : [];
  row.dataset.imageFile = saved.imageFile || ""; row.dataset.rawNet = String(saved.rawNet || 0); row.dataset.rawVat = String(saved.rawVat || 0); row.highlights = Array.isArray(saved.highlights) ? saved.highlights : [];
  values.slice(0, 12).forEach((value, index) => row.replaceChild(editableCell(value), row.cells[index + 1]));
  row.cells[2].replaceChildren(classificationSelect(values[1] || "")); row.cells[11].replaceChildren(percentSelect(values[10] || 100, [100, 25, 0])); row.cells[12].replaceChildren(percentSelect(values[11] || 100));
  row.cells[14].textContent = saved.agentOpinion || "—"; row.cells[14].className = "agent-opinion"; row.cells[15].textContent = saved.confidence || "—";
  const include = row.cells[17].querySelector("input"); include.disabled = false; include.checked = Boolean(saved.active); setStatus(row, saved.active && !row.highlights.length ? "מוכן, חסרים סימונים" : saved.statusText || (saved.active ? "מוכן לייצוא" : "לא מיועד לייצוא"), saved.active && !row.highlights.length ? "review" : saved.statusClass || (saved.active ? "ready" : "review"));
  row.runRecognition = (onlyThis = true) => { if (!session) return showError("יש להתחיל העלאת תמונות כדי לעבד מחדש שורה מהארכיון."); enqueueRecognition(row, blob, imageUrl, saved.receivedAt || Date.now(), saved.documentId || "saved", saved.imageIndex || 0, true, onlyThis); }; addRerunButton(row); addHistoryButton(row);
}
records.addEventListener("input", queueDraftSave);
records.addEventListener("change", queueDraftSave);
createPdf.addEventListener("click", async () => {
  if (!committedWorkspace || !currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return showError("יש לבחור הצהרה פתוחה לפני הייצוא.");
  const allRows = [...records.querySelectorAll("tr[data-document-id]")]; if (!allRows.length) return showError("אין שורות לייצוא.");
  const snapshots = allRows.map((row, index) => ({ ...rowSnapshot(row), tableRow: index + 1 })), reportRows = allRows.map((row, index) => ({ ...snapshots[index], imageBlob: row.documentImage })).filter((row) => row.active);
  if (!reportRows.length) return showError("יש לסמן לפחות שורה פעילה לייצוא.");
  const missingImage = reportRows.find((row) => !row.imageBlob); if (missingImage) return showError("לא נמצאה תמונה מקורית לאחת השורות הפעילות.");
  createPdf.disabled = true; status.textContent = "יוצר ייצוא טיוטה…";
  try {
    await saveCurrentDraft(); const createdAt = new Date(), templateText = new TextDecoder("windows-1255").decode(await (await canonicalTemplate.getFile()).arrayBuffer()), importText = buildRivhitImport({ templateText, rows: snapshots, mapping: window.RIVHIT_MAPPING }), pdf = await buildPdfReport({ clientName: committedWorkspace.config.clientName, createdAt, rows: reportRows }), { directory, name } = await createDraftExportDirectory(currentDeclarationDirectory, createdAt), manifest = draftExportManifest({ declaration: currentDeclaration, client: committedWorkspace.config, createdAt, rows: snapshots });
    await Promise.all([writeFile(directory, "invoices.pdf", pdf), writeFile(directory, "import.txt", importText), writeFile(directory, "manifest.json", JSON.stringify(manifest, null, 2))]);
    status.textContent = `ייצוא טיוטה נשמר: ${name}`;
  } catch (error) { if (error.name !== "AbortError") showError(`לא ניתן ליצור ייצוא טיוטה: ${error.message}`); }
  finally { createPdf.disabled = false; }
});
closeDeclarationButton.addEventListener("click", async () => {
  if (!committedWorkspace || !currentDeclaration || currentDeclaration.status !== "open" || !currentDeclarationDirectory) return showError("יש לבחור הצהרה פתוחה לפני הסגירה.");
  const allRows = [...records.querySelectorAll("tr[data-document-id]")], snapshots = allRows.map((row, index) => ({ ...rowSnapshot(row), tableRow: index + 1 })), reportRows = allRows.map((row, index) => ({ ...snapshots[index], imageBlob: row.documentImage })).filter((row) => row.active);
  if (!reportRows.length) return showError("יש לסמן לפחות שורה פעילה לפני סגירת ההצהרה.");
  if (!window.confirm("לסגור את ההצהרה? הפעולה תיצור ייצוא סופי, תעדכן את ההיסטוריה ותנעל את הטבלה.")) return;
  closeDeclarationButton.disabled = true; status.textContent = "סוגר הצהרה…";
  try {
    await saveCurrentDraft(); const createdAt = new Date(), templateText = new TextDecoder("windows-1255").decode(await (await canonicalTemplate.getFile()).arrayBuffer()), importText = buildRivhitImport({ templateText, rows: snapshots, mapping: window.RIVHIT_MAPPING }), pdf = await buildPdfReport({ clientName: committedWorkspace.config.clientName, createdAt, rows: reportRows }), { directory, name } = await createDraftExportDirectory(currentDeclarationDirectory, createdAt), manifest = draftExportManifest({ declaration: currentDeclaration, client: committedWorkspace.config, createdAt, rows: snapshots, kind: "final-export" });
    await Promise.all([writeFile(directory, "invoices.pdf", pdf), writeFile(directory, "import.txt", importText), writeFile(directory, "manifest.json", JSON.stringify(manifest, null, 2))]);
    currentDeclaration = await finalizeDeclaration({ clientDirectory: committedWorkspace.directory, declarationDirectory: currentDeclarationDirectory, declaration: currentDeclaration, finalExport: name, rows: snapshots }); setTableLocked(true); updateStartAvailability(); status.textContent = `ההצהרה נסגרה. הייצוא הסופי נשמר: ${name}`;
  } catch (error) { if (error.name !== "AbortError") showError(`לא ניתן לסגור את ההצהרה: ${error.message}`); updateStartAvailability(); }
});
openPackage?.addEventListener("click", async () => {
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
