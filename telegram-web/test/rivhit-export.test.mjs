import test from "node:test";
import assert from "node:assert/strict";
import { buildRivhitImport } from "../rivhit-export.js";

const template = Array(186).fill("x").join("\t"), mapping = { "811": "הוצאות משרדיות" }, row = { active: true, highlights: [{ field: "total_amount" }], rawNet: "100", rawVat: "18", values: ["2026-09-12", "811", "ציוד", "ספק", "123", "INV-9912", "77", "", "100", "18", "100", "100"] };
test("создаёт CP1255 Rivhit TXT с 186 колонками", () => { const text = new TextDecoder("windows-1255").decode(buildRivhitImport({ templateText: template, rows: [row], mapping })), columns = text.trimEnd().split("\t"); assert.equal(columns.length, 186); assert.equal(columns[3], "811"); assert.equal(columns[134], "811"); assert.equal(columns[6], "118.00"); assert.equal(columns[135], "הוצאות משרדיות"); });
test("нормализует дату DD/MM/YYYY для Rivhit", () => { const text = new TextDecoder("windows-1255").decode(buildRivhitImport({ templateText: template, rows: [{ ...row, values: ["28/08/2026", ...row.values.slice(1)] }], mapping })), columns = text.trimEnd().split("\t"); assert.equal(columns[7], "28/08/26"); assert.equal(columns[0], "2026"); assert.equal(columns[1], "8"); });
test("экспортирует строку без маркеров документа", () => { const result = buildRivhitImport({ templateText: template, rows: [{ ...row, highlights: [] }], mapping }); assert.ok(result.length > 0); });
