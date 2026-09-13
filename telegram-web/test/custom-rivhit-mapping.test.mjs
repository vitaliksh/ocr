import test from "node:test";
import assert from "node:assert/strict";
import { normaliseCustomMapping } from "../custom-rivhit-mapping.js";

test("сохраняет только новые трёхзначные пользовательские коды", () => {
  assert.deepEqual(normaliseCustomMapping({ codes: { "830": "טלפון נייד", "811": "Нельзя", "x": "Плохой", "831": "" } }, { "811": "הוצאות משרדיות" }), { "830": "טלפון נייד" });
});
