import test from "node:test";
import assert from "node:assert/strict";
import { REPORT_PERIODS, RIVHIT_COLUMN_COUNT, firstNonEmptyLine, normalizeWorkspaceConfig, validateRivhitTemplateText } from "../workspace-core.js";

test("выбирает первую непустую строку и убирает BOM", () => {
  assert.equal(firstNonEmptyLine("\uFEFF\r\n\r\nодин\tдва\r\n"), "один\tдва");
});
test("принимает шаблон с 186 колонками", () => {
  assert.deepEqual(validateRivhitTemplateText(Array(RIVHIT_COLUMN_COUNT).fill("x").join("\t")), { valid: true, columns: 186 });
});
test("отклоняет пустой и шаблон с неверным количеством колонок", () => {
  assert.equal(validateRivhitTemplateText(" \r\n").valid, false);
  const result = validateRivhitTemplateText("a\tb");
  assert.equal(result.valid, false); assert.equal(result.columns, 2);
});

test("нормализует корректную конфигурацию клиента", () => {
  const result = normalizeWorkspaceConfig({ clientId: "id", clientName: " Клиент ", businessActivity: " Спорт ", businessKind: "home" });
  assert.deepEqual(result, { valid: true, config: { schemaVersion: 1, clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home", archived: false } });
});

test("отклоняет конфигурацию без обязательных данных", () => {
  assert.equal(normalizeWorkspaceConfig({ clientName: "Клиент", businessActivity: "", businessKind: "home" }).valid, false);
  assert.equal(normalizeWorkspaceConfig({ clientName: "Клиент", businessActivity: "Спорт", businessKind: "invalid" }).valid, false);
});

test("свойства клиента хранят периоды НДС и авансов независимо; неверные значения отбрасываются", () => {
  const base = { clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home" };
  assert.deepEqual(REPORT_PERIODS, ["monthly", "bimonthly"]);
  const both = normalizeWorkspaceConfig({ ...base, vatPeriod: "bimonthly", advancesPeriod: "monthly" }).config;
  assert.deepEqual([both.vatPeriod, both.advancesPeriod], ["bimonthly", "monthly"]);
  const wrong = normalizeWorkspaceConfig({ ...base, vatPeriod: "weekly", advancesPeriod: 2 }).config;
  assert.deepEqual(Object.keys(wrong).filter((key) => key.endsWith("Period")), []);
  const kept = normalizeWorkspaceConfig({ ...both, clientName: "Другое имя" }).config;
  assert.deepEqual([kept.vatPeriod, kept.advancesPeriod], ["bimonthly", "monthly"]);
});
