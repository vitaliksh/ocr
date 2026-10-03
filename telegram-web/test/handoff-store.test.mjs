import test from "node:test";
import assert from "node:assert/strict";
import { keyFromRecoveryCode, newRecoveryCode } from "../backup-store.js";
import { createDeclaration, finalizeDeclaration, loadDeclaration, saveDraft, saveSourceImage } from "../declaration-store.js";
import { importPackage, listPackages, markImported, readHandoffState, readPackage, writePackage } from "../handoff-store.js";
import { binaryDirectory, listPaths, putFile, readFileBytes } from "./memory-binary-directory.mjs";

const newKey = () => keyFromRecoveryCode(newRecoveryCode());
const jpeg = (seed, size = 3000) => Uint8Array.from({ length: size }, (_, i) => (i * 7 + seed) & 255);
const row = (id, imageIndex, imageFile) => ({ documentId: id, imageIndex, imageFile, values: ["2026-01-05", "203", id], active: true });
const at = (minute) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00.000Z`;

// A client folder with an open declaration holding the given rows; `images` maps file name -> bytes.
async function clientWith(month, rows, images = {}) {
  const client = binaryDirectory("client");
  const { directory, declaration } = await createDeclaration(client, { clientId: "c1", month });
  for (const [name, bytes] of Object.entries(images)) await saveSourceImage(directory, name, bytes);
  await saveDraft(directory, declaration, rows, at(0));
  return { client, directory, declaration };
}

async function sentPackage(key, folder = binaryDirectory("shared")) {
  const rows = [row("d1", 1, "001.jpg"), row("d1b", 1, "001.jpg"), row("d2", 2, "002.png"), row("x1", 0, "")];
  const { directory } = await clientWith("2026-01", rows, { "001.jpg": jpeg(1), "002.png": jpeg(2, 500) });
  const readImage = async (file) => new Uint8Array(await (await (await (await directory.getDirectoryHandle("images")).getFileHandle(file)).getFile()).arrayBuffer());
  const head = await writePackage({ folder, key, client: { clientName: "Synthetic" }, month: "2026-01", rows, readImage, now: at(1) });
  return { folder, head, rows };
}

test("package: rows and images survive the round trip and the head describes them", async () => {
  const key = await newKey();
  const { folder, head, rows } = await sentPackage(key);
  assert.deepEqual([head.rows, head.images, head.month, head.clientName], [4, 2, "2026-01", "Synthetic"]);
  assert.deepEqual(await listPackages(folder, key), [head]);
  const pkg = await readPackage(folder, key, head.id);
  assert.deepEqual(pkg.rows, rows);
  assert.deepEqual([...pkg.images.keys()], ["001.jpg", "002.png"]);
  assert.deepEqual(pkg.images.get("001.jpg"), jpeg(1));
  assert.deepEqual(pkg.images.get("002.png"), jpeg(2, 500));
});

test("package: nothing readable without the key and nothing in plain text", async () => {
  const key = await newKey();
  const { folder } = await sentPackage(key);
  await assert.rejects(listPackages(folder, await newKey()), { code: "PACKAGE_WRONG_KEY" });
  for (const path of await listPaths(folder)) {
    const text = new TextDecoder("latin1").decode(await readFileBytes(folder, path));
    assert.ok(!text.includes("Synthetic") && !text.includes("documentId"), path);
  }
  assert.deepEqual(await listPackages(binaryDirectory("empty"), key), []);
});

test("package: a head whose body has not arrived yet is reported as not ready, a damaged body as corrupt", async () => {
  const key = await newKey();
  const { folder, head } = await sentPackage(key);
  const saved = folder.children.get(`${head.id}.body`).bytes;
  folder.children.delete(`${head.id}.body`);
  await assert.rejects(readPackage(folder, key, head.id), { code: "PACKAGE_NOT_READY" });
  folder.children.set(`${head.id}.body`, { kind: "file", bytes: saved.map((b, i) => (i === 50 ? b ^ 0xff : b)) });
  await assert.rejects(readPackage(folder, key, head.id), { code: "PACKAGE_CORRUPT" });
});

test("package: an empty declaration is not sent", async () => {
  await assert.rejects(
    writePackage({ folder: binaryDirectory("s"), key: await newKey(), client: { clientName: "x" }, month: "2026-01", rows: [], readImage: async () => new Uint8Array() }),
    { code: "PACKAGE_EMPTY" },
  );
});

test("import: a missing declaration is created, rows and images land in it", async () => {
  const key = await newKey();
  const { folder, head, rows } = await sentPackage(key);
  const receiver = binaryDirectory("receiver");
  const result = await importPackage({ clientDirectory: receiver, clientId: "c9", pkg: await readPackage(folder, key, head.id), now: at(5) });
  assert.deepEqual([result.added, result.images, result.created], [4, 2, true]);
  const loaded = await loadDeclaration(receiver, "2026-01");
  assert.equal(loaded.declaration.status, "open");
  assert.deepEqual(loaded.draft.rows.map((r) => r.documentId), rows.map((r) => r.documentId));
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-01/images/001.jpg"), jpeg(1));
  assert.deepEqual(await readFileBytes(receiver, "declarations/2026-01/images/002.png"), jpeg(2, 500));
});

test("import: rows are appended after the existing ones and images continue the numbering without touching old files", async () => {
  const key = await newKey();
  const { folder, head } = await sentPackage(key);
  const own = [row("mine1", 1, "001.jpg"), row("mine2", 2, "002.jpg")];
  const { client } = await clientWith("2026-01", own, { "001.jpg": jpeg(50), "002.jpg": jpeg(51) });
  const result = await importPackage({ clientDirectory: client, clientId: "c1", pkg: await readPackage(folder, key, head.id), now: at(6) });
  assert.deepEqual([result.added, result.images, result.created], [4, 2, false]);
  const { draft } = await loadDeclaration(client, "2026-01");
  assert.deepEqual(draft.rows.map((r) => [r.documentId, r.imageIndex, r.imageFile]), [
    ["mine1", 1, "001.jpg"], ["mine2", 2, "002.jpg"],
    ["d1", 3, "003.jpg"], ["d1b", 3, "003.jpg"], ["d2", 4, "004.png"], ["x1", 0, ""],
  ]);
  assert.deepEqual(await readFileBytes(client, "declarations/2026-01/images/001.jpg"), jpeg(50));
  assert.deepEqual(await readFileBytes(client, "declarations/2026-01/images/003.jpg"), jpeg(1));
  assert.deepEqual(await readFileBytes(client, "declarations/2026-01/images/004.png"), jpeg(2, 500));
});

test("import: a locked declaration is refused and left as it was", async () => {
  const key = await newKey();
  const { folder, head } = await sentPackage(key);
  const { client, directory, declaration } = await clientWith("2026-01", [row("mine", 0, "")]);
  await finalizeDeclaration({ clientDirectory: client, declarationDirectory: directory, declaration, finalExport: "no-export", rows: [] });
  await assert.rejects(importPackage({ clientDirectory: client, clientId: "c1", pkg: await readPackage(folder, key, head.id) }), { code: "PACKAGE_LOCKED" });
  assert.equal((await loadDeclaration(client, "2026-01")).draft.rows.length, 1);
});

test("import: a package that lacks one of its images is refused before the draft is written", async () => {
  const key = await newKey();
  const { folder, head } = await sentPackage(key);
  const pkg = await readPackage(folder, key, head.id);
  pkg.images.delete("002.png");
  const { client } = await clientWith("2026-01", [row("mine", 0, "")]);
  await assert.rejects(importPackage({ clientDirectory: client, clientId: "c1", pkg }), { code: "PACKAGE_CORRUPT" });
  assert.equal((await loadDeclaration(client, "2026-01")).draft.rows.length, 1);
});

test("handoff state remembers what was imported", async () => {
  const root = binaryDirectory("root");
  await putFile(root, "common/ui-settings.json", "{}");
  assert.deepEqual((await readHandoffState(root)).imported, {});
  await markImported(root, "pkg-1", { at: at(1), month: "2026-01", rows: 4 });
  await markImported(root, "pkg-2", { at: at(2), month: "2026-02", rows: 1 });
  assert.deepEqual(Object.keys((await readHandoffState(root)).imported), ["pkg-1", "pkg-2"]);
});
