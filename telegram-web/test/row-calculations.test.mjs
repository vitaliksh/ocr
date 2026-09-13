import test from "node:test";
import assert from "node:assert/strict";
import { recognisedAmounts } from "../row-calculations.js";

test("25% расхода сначала выделяется из суммы с НДС", () => {
  const amounts = recognisedAmounts("610.17", "109.83", 25);
  assert.deepEqual(amounts, { gross: "180.00", net: "152.54", vat: "27.46" });
});
test("нулевой НДС не создаёт НДС при частичном признании", () => {
  assert.deepEqual(recognisedAmounts("200", "0", 25), { gross: "50.00", net: "50.00", vat: "0.00" });
});
