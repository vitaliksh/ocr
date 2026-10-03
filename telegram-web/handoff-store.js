// Hand-off package: the draft rows of one declaration plus the images they use, sealed with the backup key and written once into
// a shared folder (a Google Drive folder both PCs sync). The sender checks the invoices, the receiver imports the rows into her own
// declaration. Two files per package, body first and head last (the commit point), so a half-synced package is never listed:
//   pkg-<stamp>-<rand>.head   sealed JSON { id, createdAt, clientName, month, rows, images, bytes }
//   pkg-<stamp>-<rand>.body   sealed [4-byte length][JSON { rows, images: [{ file, size }] }][image bytes in that order]
// Nothing is ever deleted; what was imported is remembered in common/handoff-state.json.
import { listFileNames, randomHex, readFileBytes, sealBytes, stampOf, unsealBytes, writeFileOnce } from "./backup-store.js";
import { createDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "./declaration-store.js";

export const PACKAGE_FORMAT = 1;
export const HANDOFF_STATE_FILE = "handoff-state.json";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AAD_HEAD = encoder.encode("annateria-package-head");
const AAD_BODY = encoder.encode("annateria-package-body");
const HEAD_NAME = /^pkg-[0-9TZ]+-[0-9a-f]+\.head$/;

const MESSAGES = {
  PACKAGE_EMPTY: "אין שורות לשליחה.",
  PACKAGE_WRONG_KEY: "קוד השחזור אינו מתאים לחבילות שבתיקייה.",
  PACKAGE_NOT_READY: "החבילה עדיין לא הגיעה במלואה (Google Drive מסנכרן). נסה שוב בעוד רגע.",
  PACKAGE_CORRUPT: "החבילה פגומה או חסרה.",
  PACKAGE_LOCKED: "ההצהרה לחודש זה נעולה. לא ניתן לייבא אליה.",
};

function packageError(code) {
  return Object.assign(new Error(MESSAGES[code]), { name: "PackageError", code });
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// `readImage(file)` returns the bytes of an image of the declaration. Returns the package head.
export async function writePackage({ folder, key, client, month, rows, readImage, now = new Date().toISOString(), delay }) {
  if (!rows.length) throw packageError("PACKAGE_EMPTY");
  const images = [];
  for (const file of new Set(rows.map((row) => row.imageFile).filter(Boolean))) images.push({ file, bytes: await readImage(file) });
  const meta = encoder.encode(JSON.stringify({ rows, images: images.map(({ file, bytes }) => ({ file, size: bytes.length })) }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, meta.length);
  const body = concat([length, meta, ...images.map((image) => image.bytes)]);
  const id = `pkg-${stampOf(now)}-${randomHex(3)}`;
  const head = { format: PACKAGE_FORMAT, id, createdAt: now, clientName: client.clientName, month, rows: rows.length, images: images.length, bytes: body.length };
  await writeFileOnce(folder, `${id}.body`, await sealBytes(key, body, AAD_BODY), delay);
  await writeFileOnce(folder, `${id}.head`, await sealBytes(key, encoder.encode(JSON.stringify(head)), AAD_HEAD), delay);
  return head;
}

// Heads of the packages in the folder, newest first. A folder whose packages all fail to open means the wrong key.
export async function listPackages(folder, key) {
  const heads = [];
  let unreadable = 0;
  for (const name of (await listFileNames(folder)).filter((item) => HEAD_NAME.test(item))) {
    try {
      heads.push(JSON.parse(decoder.decode(await unsealBytes(key, await readFileBytes(folder, name), AAD_HEAD, name))));
    } catch {
      unreadable += 1;
    }
  }
  if (!heads.length && unreadable) throw packageError("PACKAGE_WRONG_KEY");
  return heads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// { head, rows, images: Map(file -> bytes) }
export async function readPackage(folder, key, id) {
  let head;
  let sealedBody;
  try {
    head = JSON.parse(decoder.decode(await unsealBytes(key, await readFileBytes(folder, `${id}.head`), AAD_HEAD, id)));
    sealedBody = await readFileBytes(folder, `${id}.body`);
  } catch (error) {
    if (error.name === "NotFoundError") throw packageError("PACKAGE_NOT_READY");
    throw packageError("PACKAGE_CORRUPT");
  }
  let body;
  try {
    body = await unsealBytes(key, sealedBody, AAD_BODY, id);
  } catch {
    throw packageError("PACKAGE_CORRUPT");
  }
  const metaLength = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(decoder.decode(body.subarray(4, 4 + metaLength)));
  const images = new Map();
  let offset = 4 + metaLength;
  for (const { file, size } of meta.images) {
    images.set(file, body.slice(offset, offset + size));
    offset += size;
  }
  if (offset !== body.length || meta.rows.length !== head.rows) throw packageError("PACKAGE_CORRUPT");
  return { head, rows: meta.rows, images };
}

const imageName = (index, original) => `${String(index).padStart(3, "0")}${/\.[A-Za-z0-9]+$/.exec(original)?.[0] ?? ".jpg"}`;

// Appends the package rows to the open declaration of the package month (created when missing). Images get the next free
// numbers of that declaration (001.jpg, 002.jpg ... as the app names them), so nothing already there is touched.
export async function importPackage({ clientDirectory, clientId, pkg, now = new Date().toISOString() }) {
  const month = pkg.head.month;
  let loaded;
  let created = false;
  try {
    loaded = await loadDeclaration(clientDirectory, month);
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
    loaded = { ...(await createDeclaration(clientDirectory, { clientId, month })), draft: { rows: [] } };
    created = true;
  }
  if (loaded.declaration.status !== "open") throw packageError("PACKAGE_LOCKED");
  const existing = loaded.draft?.rows ?? [];
  let counter = Math.max(0, ...existing.map((row) => Number(row.imageIndex) || 0));
  const renamed = new Map();
  const rows = pkg.rows.map((row) => {
    if (!row.imageFile) return { ...row };
    if (!renamed.has(row.imageFile)) {
      counter += 1;
      renamed.set(row.imageFile, { index: counter, file: imageName(counter, row.imageFile) });
    }
    const { index, file } = renamed.get(row.imageFile);
    return { ...row, imageFile: file, imageIndex: index };
  });
  for (const [original, { file }] of renamed) {
    if (!pkg.images.has(original)) throw packageError("PACKAGE_CORRUPT");
    await saveSourceImage(loaded.directory, file, pkg.images.get(original));
  }
  await saveDraft(loaded.directory, loaded.declaration, [...existing, ...rows], now);
  return { month, added: rows.length, images: renamed.size, created };
}

// ---- what was imported here, so a package is not imported twice by accident ----

export function normaliseHandoffState(value) {
  const source = value?.imported && typeof value.imported === "object" ? value.imported : {};
  const imported = {};
  for (const [id, entry] of Object.entries(source)) {
    if (entry && typeof entry.at === "string") imported[id] = { at: entry.at, month: String(entry.month ?? ""), rows: Number(entry.rows) || 0 };
  }
  return { schemaVersion: 1, imported };
}

export async function readHandoffState(dataRoot) {
  try {
    const common = await dataRoot.getDirectoryHandle("common");
    const file = await (await common.getFileHandle(HANDOFF_STATE_FILE)).getFile();
    return normaliseHandoffState(JSON.parse(await file.text()));
  } catch (error) {
    if (error.name === "NotFoundError" || error instanceof SyntaxError) return normaliseHandoffState(null);
    throw error;
  }
}

export async function markImported(dataRoot, id, entry) {
  const state = await readHandoffState(dataRoot);
  state.imported[id] = entry;
  const common = await dataRoot.getDirectoryHandle("common", { create: true });
  const writable = await (await common.getFileHandle(HANDOFF_STATE_FILE, { create: true })).createWritable();
  try {
    await writable.write(JSON.stringify(normaliseHandoffState(state), null, 2));
  } finally {
    await writable.close();
  }
}
