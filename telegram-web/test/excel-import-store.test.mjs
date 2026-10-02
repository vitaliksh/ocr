import test from "node:test";
import assert from "node:assert/strict";
import { SEED_CHART_OF_ACCOUNTS, matchClassNames, normaliseChart } from "../chart-of-accounts.js";
import { buildImportedRows } from "../excel-import.js";
import { importRowsIntoDeclaration } from "../excel-import-store.js";
import { parseJournalGrid } from "../excel-journal.js";
import { createDeclaration, listDeclarations, loadDeclaration } from "../declaration-store.js";
import { buildJournalGrid } from "./excel-journal-fixture.mjs";

// In-memory File System Access directory tree: directories and text files.
function memoryDirectory(name = "root") {
  const children = new Map();
  const notFound = () => Object.assign(new Error(`missing ${name}`), { name: "NotFoundError" });
  return {
    kind: "directory",
    name,
    children,
    async getDirectoryHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, memoryDirectory(child));
      }
      return children.get(child);
    },
    async getFileHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, { kind: "file", text: "" });
      }
      const file = children.get(child);
      return {
        getFile: async () => ({ text: async () => file.text }),
        createWritable: async () => ({ write: async (text) => { file.text = text; }, close: async () => {} }),
      };
    },
    async *entries() {
      yield* children.entries();
    },
  };
}

const accounts = normaliseChart({ accounts: SEED_CHART_OF_ACCOUNTS });
const parsed = parseJournalGrid(buildJournalGrid()).rows;
const rows = () => buildImportedRows(parsed, matchClassNames(parsed.map((r) => r.classificationName), accounts).codes);
const now = "2026-10-02T10:00:00.000Z";

test("импорт в декларацию: новая открытая декларация получает строки черновика", async () => {
  const client = memoryDirectory("client");
  const declaration = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-01", rows: rows(), now });
  assert.equal(declaration.status, "open");
  const loaded = await loadDeclaration(client, "2026-01");
  assert.equal(loaded.draft.rows.length, 8);
  assert.equal(loaded.draft.rows[0].values[1], "203");
});

test("импорт в декларацию: пустая открытая декларация используется, а не создаётся заново", async () => {
  const client = memoryDirectory("client");
  const { declaration } = await createDeclaration(client, { clientId: "c1", month: "2026-02" });
  const result = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-02", rows: rows(), now });
  assert.equal(result.declarationId, declaration.declarationId);
  assert.equal((await loadDeclaration(client, "2026-02")).draft.rows.length, 8);
});

test("импорт в декларацию: «закрыть сразу» закрывает без папки экспорта и пишет историю один раз", async () => {
  const client = memoryDirectory("client");
  const closed = await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-03", rows: rows(), closeNow: true, now });
  assert.deepEqual([closed.status, closed.finalExport], ["closed", "excel-import"]);
  const history = client.children.get("history.jsonl").text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(history.length, 8);
  assert.ok(history.every((entry) => entry.declarationId === closed.declarationId && entry.declarationMonth === "2026-03"));
  assert.equal((await listDeclarations(client))[0].directory.children.get("exports").children.size, 0);
});

test("импорт в декларацию: непустая или закрытая декларация не перезаписывается", async () => {
  const client = memoryDirectory("client");
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-04", rows: rows(), now });
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-04", rows: rows(), now }),
    /כבר מכילה שורות/,
  );
  await importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), closeNow: true, now });
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: client, clientId: "c1", month: "2026-05", rows: rows(), now }),
    /סגורה/,
  );
  assert.equal((await loadDeclaration(client, "2026-04")).draft.rows.length, 8);
});

test("импорт в декларацию: пустой набор строк отвергается", async () => {
  await assert.rejects(
    importRowsIntoDeclaration({ clientDirectory: memoryDirectory("c"), clientId: "c1", month: "2026-06", rows: [], now }),
    /אין שורות/,
  );
});
