import test from "node:test";
import assert from "node:assert/strict";
import { closeDeclaration, createDraftTable, createOpenDeclaration, declarationMonth, normalizeDeclaration, normalizeDraftTable } from "../declaration-core.js";

const now = "2026-09-11T10:20:30.000Z";

test("создаёт открытую декларацию для календарного месяца", () => {
  const declaration = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  assert.equal(declaration.status, "open");
  assert.equal(declaration.month, "2026-09");
  assert.equal(declaration.closedAt, null);
});

test("месяц формируется по локальной дате и не принимает неверное значение", () => {
  assert.equal(declarationMonth(new Date(2026, 8, 1)), "2026-09");
  assert.equal(declarationMonth("2026-13"), null);
  assert.equal(declarationMonth("2026-09"), "2026-09");
});

test("отклоняет закрытую декларацию без следов финализации", () => {
  const result = normalizeDeclaration({ declarationId: "d", clientId: "c", month: "2026-09", status: "closed", createdAt: now, updatedAt: now });
  assert.equal(result.valid, false);
});

test("черновая таблица принадлежит только своей декларации", () => {
  const draft = createDraftTable({ declarationId: "d", rows: [{ values: [] }], now });
  assert.equal(normalizeDraftTable(draft, "d").valid, true);
  assert.equal(normalizeDraftTable(draft, "other").valid, false);
});

test("закрывает только открытую декларацию с финальным экспортом", () => {
  const open = createOpenDeclaration({ clientId: "client-1", month: "2026-09", declarationId: "declaration-1", now });
  const closed = closeDeclaration(open, { finalExport: "2026-09-12_11-00", now });
  assert.equal(closed.status, "closed"); assert.equal(closed.finalExport, "2026-09-12_11-00"); assert.throws(() => closeDeclaration(closed, { finalExport: "another", now }), /לסגור רק/);
});
