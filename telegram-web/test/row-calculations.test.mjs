import test from "node:test";
import assert from "node:assert/strict";
import { recognisedAmounts, sourceAmountsFromGross, sourceAmountsFromNet } from "../row-calculations.js";

test("25% расхода сначала выделяется из суммы с НДС", () => {
  const amounts = recognisedAmounts("610.17", "109.83", 25);
  assert.deepEqual(amounts, { gross: "180.00", net: "152.54", vat: "27.46" });
});
test("нулевой НДС не создаёт НДС при частичном признании", () => {
  assert.deepEqual(recognisedAmounts("200", "0", 25), { gross: "50.00", net: "50.00", vat: "0.00" });
});
test("ручная сумма с НДС сразу разбивается по ставке", () => {
  assert.deepEqual(sourceAmountsFromGross("118", 18), { gross: "118.00", net: "100.00", vat: "18.00" });
});
test("ручная сумма без НДС сразу дополняется НДС", () => {
  assert.deepEqual(sourceAmountsFromNet("100", 18), { gross: "118.00", net: "100.00", vat: "18.00" });
});
