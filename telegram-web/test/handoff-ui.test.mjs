import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { keyFromRecoveryCode, newRecoveryCode } from "../backup-store.js";
import { BACKUP_KEY_NAME } from "../backup-handles.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { HANDOFF_FOLDER_KEY } from "../handoff-ui.js";
import { binaryDirectory, listPaths } from "./memory-binary-directory.mjs";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };
const jpeg = (seed) => Uint8Array.from({ length: 2000 }, (_, i) => (i * 5 + seed) & 255);
const row = (id, index, file) => ({ documentId: id, imageIndex: index, imageFile: file, values: ["2026-01-05", "203", id], active: true });

function withPermission(directory, { isRoot = false } = {}) {
  const handle = Object.assign(directory, { queryPermission: async () => "granted", requestPermission: async () => "granted" });
  if (isRoot) handle.resolve = async (other) => (other === handle ? [] : null);
  return handle;
}

// A client folder with an open (or locked) declaration for 2026-01 holding rows and images.
async function clientFolder({ rows = [], images = {}, locked = false } = {}) {
  const client = binaryDirectory("client");
  const { directory, declaration } = await createDeclaration(client, { clientId: "c1", month: "2026-01" });
  for (const [name, bytes] of Object.entries(images)) await saveSourceImage(directory, name, bytes);
  await saveDraft(directory, declaration, rows);
  if (locked) await finalizeDeclaration({ clientDirectory: client, declarationDirectory: directory, declaration, finalExport: "no-export", rows: [] });
  return { client, declaration: (await loadDeclaration(client, "2026-01")).declaration };
}

async function setup({ key, shared, current = null, clients = [], confirmAnswer = true }) {
  const dom = new JSDOM(html, { url: "https://vitaliksh.github.io/ocr/" });
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, window });
  const dialog = window.document.querySelector("#handoff-dialog");
  dialog.showModal = () => { dialog.open = true; };
  const root = withPermission(binaryDirectory("data"), { isRoot: true });
  await root.getDirectoryHandle("common", { create: true });
  const stored = new Map();
  if (key) stored.set(BACKUP_KEY_NAME, key);
  if (shared) stored.set(HANDOFF_FOLDER_KEY, shared);
  const store = { readSetting: async (k) => stored.get(k), writeSetting: async (k, v) => { stored.set(k, v); } };
  const picks = [];
  const calls = { before: [], after: [], confirms: [] };
  const { setupHandoff } = await import("../handoff-ui.js");
  setupHandoff({
    dialog,
    openButton: window.document.querySelector("#open-handoff"),
    getDataRoot: () => root,
    getCurrent: () => current,
    getClients: () => clients,
    beforeImport: async (info) => { calls.before.push(info); },
    afterImport: async (info) => { calls.after.push(info); },
    store,
    pickDirectory: async () => {
      if (!picks.length) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return picks.shift();
    },
    now: () => "2026-10-03T12:00:00.000Z",
    confirm: async (...args) => { calls.confirms.push(args); return confirmAnswer; },
  });
  const q = (selector) => dialog.querySelector(selector);
  const click = async (button) => { button.click(); await settle(); };
  const open = () => click(window.document.querySelector("#open-handoff"));
  return { window, dialog, root, stored, picks, calls, q, click, open, plate: () => q("#handoff-summary").textContent, error: () => q("#handoff-error").textContent };
}

async function sender(key, shared) {
  const { client, declaration } = await clientFolder({ rows: [row("d1", 1, "001.jpg"), row("d2", 2, "002.jpg")], images: { "001.jpg": jpeg(1), "002.jpg": jpeg(2) } });
  const current = { client: { clientName: "Synthetic" }, clientDirectory: client, declaration };
  const ui = await setup({ key, shared, current });
  await ui.open();
  await ui.click(ui.q("#handoff-send"));
  return ui;
}

test("the page has the hand-off dialog and its sidebar item", () => {
  for (const id of ["open-handoff", "handoff-dialog", "handoff-summary", "handoff-error", "handoff-folder", "handoff-choose", "handoff-current", "handoff-send", "handoff-refresh", "handoff-packages", "handoff-client", "handoff-target", "handoff-import", "backup-enter-code", "backup-use-code"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("send needs a folder, a key and a declaration open in the journal", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const noCurrent = await setup({ key, shared: withPermission(binaryDirectory("shared")) });
  await noCurrent.open();
  assert.equal(noCurrent.q("#handoff-send").disabled, true);
  assert.match(noCurrent.q("#handoff-current").textContent, /פתח הצהרה ביומן/);
  const noKey = await setup({ shared: withPermission(binaryDirectory("shared")), current: { client: { clientName: "x" }, clientDirectory: binaryDirectory("c"), declaration: { month: "2026-01" } } });
  await noKey.open();
  assert.equal(noKey.q("#handoff-send").disabled, true);
});

test("send then receive: the package is listed, the same-named client is preselected, rows and images arrive, a second import asks first", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const shared = withPermission(binaryDirectory("shared"));
  const sent = await sender(key, shared);
  assert.match(sent.plate(), /נשלחה חבילה: 2 שורות, 2 תמונות/);
  assert.deepEqual((await listPaths(shared)).map((p) => p.split(".").pop()).sort(), ["body", "head"]);

  const { client: receiver } = { client: binaryDirectory("receiver") };
  const clients = [{ id: "c9", clientName: " synthetic ", directory: receiver, config: { clientId: "c9" }, declarations: [] }, { id: "c8", clientName: "Other", directory: binaryDirectory("o"), config: { clientId: "c8" }, declarations: [] }];
  const ui = await setup({ key, shared, clients });
  await ui.open();
  assert.equal(ui.q("#handoff-packages").options.length, 1, "listed automatically when the folder is already allowed");
  assert.equal(ui.q("#handoff-client").value, "c9");
  assert.match(ui.q("#handoff-target").textContent, /תיווצר/);
  await ui.click(ui.q("#handoff-import"));
  assert.match(ui.plate(), /יובאו 2 שורות ו-2 תמונות/);
  assert.deepEqual(ui.calls.after, [{ clientId: "c9", month: "2026-01" }]);
  assert.equal((await loadDeclaration(receiver, "2026-01")).draft.rows.length, 2);
  assert.match(ui.q("#handoff-packages").options[0].textContent, /יובאה/);

  await ui.click(ui.q("#handoff-import"));
  assert.equal(ui.calls.confirms.length, 1);
  assert.equal((await loadDeclaration(receiver, "2026-01")).draft.rows.length, 4);
});

test("a declined second import changes nothing", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const shared = withPermission(binaryDirectory("shared"));
  await sender(key, shared);
  const receiver = binaryDirectory("receiver");
  const clients = [{ id: "c9", clientName: "Synthetic", directory: receiver, config: { clientId: "c9" }, declarations: [] }];
  const ui = await setup({ key, shared, clients, confirmAnswer: false });
  await ui.open();
  await ui.click(ui.q("#handoff-import"));
  assert.equal((await loadDeclaration(receiver, "2026-01")).draft.rows.length, 2);
  await ui.click(ui.q("#handoff-import"));
  assert.equal(ui.calls.confirms.length, 1);
  assert.equal((await loadDeclaration(receiver, "2026-01")).draft.rows.length, 2);
});

test("a client with another name must be chosen by hand; a locked declaration blocks the import", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const shared = withPermission(binaryDirectory("shared"));
  await sender(key, shared);
  const locked = await clientFolder({ locked: true });
  const clients = [{ id: "c1", clientName: "Different", directory: locked.client, config: { clientId: "c1" }, declarations: [{ declaration: locked.declaration }] }];
  const ui = await setup({ key, shared, clients });
  await ui.open();
  assert.equal(ui.q("#handoff-client").value, "");
  assert.equal(ui.q("#handoff-import").disabled, true);
  ui.q("#handoff-client").value = "c1";
  ui.q("#handoff-client").dispatchEvent(new ui.window.Event("change"));
  assert.match(ui.q("#handoff-target").textContent, /נעולה/);
  assert.equal(ui.q("#handoff-import").disabled, true);
});

test("the folder is chosen once and remembered; a folder inside the data root is refused", async () => {
  const key = await keyFromRecoveryCode(newRecoveryCode());
  const ui = await setup({ key });
  await ui.open();
  ui.picks.push(ui.root);
  await ui.click(ui.q("#handoff-choose"));
  assert.match(ui.error(), /בתוך תיקיית הנתונים/);
  assert.equal(ui.stored.has(HANDOFF_FOLDER_KEY), false);
  const folder = withPermission(binaryDirectory("shared"));
  ui.picks.push(folder);
  await ui.click(ui.q("#handoff-choose"));
  assert.equal(ui.stored.get(HANDOFF_FOLDER_KEY), folder);
  assert.match(ui.q("#handoff-folder").textContent, /shared/);
});

test("a package from another key is reported on the plate", async () => {
  const shared = withPermission(binaryDirectory("shared"));
  await sender(await keyFromRecoveryCode(newRecoveryCode()), shared);
  const ui = await setup({ key: await keyFromRecoveryCode(newRecoveryCode()), shared });
  await ui.open();
  await ui.click(ui.q("#handoff-refresh"));
  assert.match(ui.error(), /קוד השחזור אינו מתאים/);
  assert.match(ui.plate(), /קוד השחזור אינו מתאים/);
});
