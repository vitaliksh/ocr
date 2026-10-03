// The hand-off dialog (#handoff-dialog): send the declaration open in the journal to a shared folder, or import a package from
// it into one of this PC's clients. The package itself is handoff-store.js; this file chooses, asks and shows results.
import { confirmDialog } from "./confirm-dialog.js";
import { BACKUP_KEY_NAME, readSetting, writeSetting } from "./backup-handles.js";
import { loadDeclaration, readSourceImage } from "./declaration-store.js";
import { importPackage, listPackages, markImported, readHandoffState, readPackage, writePackage } from "./handoff-store.js";
import { formatMonth } from "./month-format.js";

export const HANDOFF_FOLDER_KEY = "handoff-folder";
const PLATE_CLASS = { info: "plate-info", success: "plate-success", warning: "plate-warning", error: "plate-error" };
const formatTime = (iso) => new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// getCurrent() describes the declaration open in the journal: { client, clientDirectory, declaration } or null.
// getClients() returns this PC's active clients as the workspace lists them ({ id, clientName, directory, config, declarations }).
// saveCurrent() writes the open table to disk; beforeImport / afterImport let the host detach and reopen the target declaration.
export function setupHandoff({
  dialog,
  openButton,
  getDataRoot,
  getCurrent,
  getClients,
  saveCurrent = async () => {},
  beforeImport = async () => {},
  afterImport = async () => {},
  onError = () => {},
  store = { readSetting, writeSetting },
  pickDirectory = () => window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" }),
  now = () => new Date().toISOString(),
  confirm = confirmDialog,
}) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [plate, errorLine, folderLine, chooseButton, currentLine, sendButton, refreshButton, packageSelect, clientSelect, targetLine, importButton] = [
    "handoff-summary", "handoff-error", "handoff-folder", "handoff-choose", "handoff-current", "handoff-send", "handoff-refresh",
    "handoff-packages", "handoff-client", "handoff-target", "handoff-import",
  ].map(part);
  const doc = dialog.ownerDocument;
  let folder = null;
  let key = null;
  let heads = [];
  let imported = {};
  let running = false;
  let message = null;

  const option = (value, text) => Object.assign(doc.createElement("option"), { value, textContent: text });
  const setMessage = (kind, text) => { message = { kind, text }; render(); };
  const selectedHead = () => heads.find((head) => head.id === packageSelect.value) ?? null;
  const selectedClient = () => (getClients() ?? []).find((client) => client.id === clientSelect.value) ?? null;

  // What importing the selected package into the selected client would do.
  function targetInfo() {
    const head = selectedHead();
    const client = selectedClient();
    if (!head || !client) return { text: "", blocked: true };
    const found = (client.declarations ?? []).find((item) => item.declaration.month === head.month);
    if (!found) return { text: `ההצהרה ל-${formatMonth(head.month)} לא קיימת ותיווצר.`, blocked: false };
    if (found.declaration.status !== "open") return { text: `ההצהרה ל-${formatMonth(head.month)} נעולה, אי אפשר לייבא אליה.`, blocked: true };
    return { text: `השורות יתווספו להצהרה הפתוחה ל-${formatMonth(head.month)}.`, blocked: false };
  }

  function render() {
    const root = getDataRoot();
    const current = getCurrent();
    const shown = message ?? { kind: "info", text: root ? "בחר תיקיית העברה משותפת." : "יש לבחור תחילה תיקיית נתונים." };
    plate.className = `plate ${PLATE_CLASS[shown.kind]}`;
    plate.textContent = shown.text;
    folderLine.textContent = folder ? `תיקייה: ${folder.name}` : "לא נבחרה תיקייה.";
    currentLine.textContent = current
      ? `הצהרה פתוחה ביומן: «${current.client.clientName}» · ${formatMonth(current.declaration.month)}`
      : "כדי לשלוח, פתח הצהרה ביומן.";
    chooseButton.disabled = !root || running;
    sendButton.disabled = !root || !folder || !key || !current || running;
    refreshButton.disabled = !folder || !key || running;
    const info = targetInfo();
    targetLine.textContent = info.text;
    importButton.disabled = !root || !folder || !key || info.blocked || running;
  }

  function fillPackages() {
    packageSelect.replaceChildren(...heads.map((head) => option(
      head.id,
      `${head.clientName} · ${formatMonth(head.month)} · ${head.rows} שורות · ${formatTime(head.createdAt)}${imported[head.id] ? " · יובאה" : ""}`,
    )));
    fillClients();
  }

  // The client with the same name as in the package is preselected; otherwise the user must choose.
  function fillClients() {
    const head = selectedHead();
    const clients = getClients() ?? [];
    clientSelect.replaceChildren(option("", "בחר לקוח"), ...clients.map((client) => option(client.id, client.clientName)));
    const match = head && clients.find((client) => sameName(client.clientName, head.clientName));
    clientSelect.value = match ? match.id : "";
    render();
  }

  async function refresh() {
    const root = getDataRoot();
    folder = (await store.readSetting(HANDOFF_FOLDER_KEY).catch(() => null)) ?? null;
    key = (await store.readSetting(BACKUP_KEY_NAME).catch(() => null)) ?? null;
    imported = root ? (await readHandoffState(root).catch(() => ({ imported: {} }))).imported : {};
    fillClients();
  }

  async function usableFolder() {
    if (!folder) throw new Error("יש לבחור תיקיית העברה.");
    if (!key) throw new Error("יש ליצור או להזין קוד שחזור בחלון הגיבוי.");
    let permission = await folder.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") permission = await folder.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("לא ניתנה הרשאה לתיקייה.");
    return folder;
  }

  async function loadPackages() {
    heads = await listPackages(await usableFolder(), key);
    fillPackages();
    setMessage("info", heads.length ? `נמצאו ${heads.length} חבילות.` : "אין חבילות בתיקייה.");
  }

  const guarded = (action) => async () => {
    errorLine.textContent = "";
    try {
      await action();
    } catch (error) {
      if (error.name === "AbortError") return;
      errorLine.textContent = error.message;
      setMessage("error", error.message);
    }
  };

  chooseButton.addEventListener("click", guarded(async () => {
    const root = getDataRoot();
    const picked = await pickDirectory();
    if (typeof root?.resolve === "function" && (await root.resolve(picked))) throw new Error("תיקיית ההעברה אינה יכולה להיות בתוך תיקיית הנתונים.");
    await store.writeSetting(HANDOFF_FOLDER_KEY, picked);
    folder = picked;
    heads = [];
    fillPackages();
    setMessage("info", "התיקייה נבחרה.");
  }));

  sendButton.addEventListener("click", guarded(async () => {
    const current = getCurrent();
    if (!current) throw new Error("יש לפתוח הצהרה ביומן לפני השליחה.");
    const target = await usableFolder();
    running = true;
    render();
    try {
      await saveCurrent();
      const loaded = await loadDeclaration(current.clientDirectory, current.declaration.month);
      const head = await writePackage({
        folder: target,
        key,
        client: current.client,
        month: current.declaration.month,
        rows: loaded.draft.rows,
        readImage: async (file) => new Uint8Array(await (await readSourceImage(loaded.directory, file)).arrayBuffer()),
        now: now(),
      });
      message = { kind: "success", text: `נשלחה חבילה: ${head.rows} שורות, ${head.images} תמונות. אפשר לייבא אותה במחשב השני.` };
    } finally {
      running = false;
      render();
    }
  }));

  refreshButton.addEventListener("click", guarded(loadPackages));
  packageSelect.addEventListener("change", fillClients);
  clientSelect.addEventListener("change", render);

  importButton.addEventListener("click", guarded(async () => {
    const head = selectedHead();
    const client = selectedClient();
    if (!head) throw new Error("יש לבחור חבילה.");
    if (!client) throw new Error("יש לבחור לקוח.");
    if (imported[head.id] && !(await confirm(`החבילה כבר יובאה ב-${formatTime(imported[head.id].at)}. לייבא שוב? השורות יתווספו פעם נוספת.`, { title: "ייבוא חבילה", confirmLabel: "ייבוא" }))) return;
    const target = await usableFolder();
    running = true;
    render();
    try {
      const pkg = await readPackage(target, key, head.id);
      await beforeImport({ clientId: client.id, month: head.month });
      const result = await importPackage({ clientDirectory: client.directory, clientId: client.config?.clientId ?? client.id, pkg, now: now() });
      const root = getDataRoot();
      if (root) await markImported(root, head.id, { at: now(), month: head.month, rows: result.added });
      imported = root ? (await readHandoffState(root)).imported : imported;
      fillPackages();
      message = { kind: "success", text: `יובאו ${result.added} שורות ו-${result.images} תמונות להצהרה ${formatMonth(result.month)}${result.created ? " (נוצרה חדשה)" : ""}.` };
      await afterImport({ clientId: client.id, month: head.month });
    } finally {
      running = false;
      render();
    }
  }));

  openButton.addEventListener("click", async () => {
    errorLine.textContent = "";
    message = null;
    heads = [];
    await refresh();
    dialog.showModal();
    if (folder && key && (await folder.queryPermission({ mode: "readwrite" }).catch(() => "prompt")) === "granted") {
      await loadPackages().catch(() => {});
    }
  });

  render();
  return { refresh, getState: () => ({ folder, key: Boolean(key), heads: [...heads], running }) };
}
