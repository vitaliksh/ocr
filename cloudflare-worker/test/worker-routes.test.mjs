import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import worker from "../src/index.js";
import { RIVHIT_MAPPING } from "../src/rivhit-mapping.js";

const ORIGIN = "https://vitaliksh.github.io";
const SESSION = "s".repeat(32);
const [FORM_CODE, [RIVHIT_CODE, RIVHIT_NAME]] = Object.entries(RIVHIT_MAPPING)[0];
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(handler) {
  return { idFromName: (name) => name, get: (id) => ({ fetch: (url, init) => handler(id, url, init) }) };
}
function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
    BACKEND_VERSION: "test-version",
    BOT_USERNAME: "TestBot",
    GEMINI_API_KEY: "test-gemini-key",
    UPLOAD_SESSION: stub(async () => new Response("{}", { status: 200 })),
    DEVICE_REGISTRY: stub(async () => new Response("{}", { status: 200 })),
    ...overrides,
  };
}
const call = (path, { method = "POST", origin = ORIGIN, headers = {}, body, env = makeEnv() } = {}) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      headers: { ...(origin ? { origin } : {}), ...headers },
      body: method === "GET" || method === "OPTIONS" ? undefined : body,
    }),
    env,
  );

function mockGemini(records, { status = 200, raw = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const text = raw ?? JSON.stringify({ records });
    return Response.json(status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: "boom" } }, { status });
  };
  return calls;
}
const recognize = (records, { headers = {}, env, body = new Uint8Array([1, 2, 3]) } = {}) =>
  call(`/v1/sessions/${SESSION}/recognize`, {
    env,
    body,
    headers: { "content-type": "image/jpeg", "x-business-activity": encodeURIComponent("graphic design"), ...headers },
  });
const invoice = (overrides = {}) => ({
  document_kind: "expense_invoice", confidence: 88, agent_opinion: "fine", date: "2026-09-03",
  supplier_name: "Supplier", supplier_vat_id: "514000001", invoice_number: "42", purpose: "work",
  total_amount: 118, currency: "ILS", form_6111_code: FORM_CODE, rivhit_code: null,
  net_amount: 100, vat_amount: 18, vat_percent: 18, recognized_percent: 100, vat_recognized_percent: 100,
  ...overrides,
});

test("health reports the backend version with CORS for an allowed origin", async () => {
  const response = await call("/health", { method: "GET" });
  assert.deepEqual(await response.json(), { ok: true, version: "test-version" });
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("preflight allows the custom headers only for allowed origins", async () => {
  const allowed = await call("/v1/sessions", { method: "OPTIONS" });
  assert.match(allowed.headers.get("access-control-allow-headers"), /x-custom-rivhit-codes/);
  assert.match(allowed.headers.get("access-control-allow-headers"), /x-form-6111-mapping/);
  const denied = await call("/v1/sessions", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("API routes reject disallowed or missing origins", async () => {
  assert.equal((await call("/v1/sessions", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/v1/sessions", { origin: null })).status, 403);
});

test("unknown paths are 404 and wrong methods are 405", async () => {
  assert.equal((await call("/nope", { method: "GET" })).status, 404);
  assert.equal((await call(`/v1/sessions/${SESSION}/events`)).status, 405);
  assert.equal((await call(`/v1/sessions/${SESSION}/recognize`, { method: "GET" })).status, 405);
});

test("session creation returns opaque credentials and a Telegram deep link", async () => {
  const response = await call("/v1/sessions", { body: JSON.stringify({ purpose: "passkey-enrollment" }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.ok(body.sessionId.length >= 30 && body.clientToken.length >= 30);
  assert.equal(body.telegramUrl, `https://t.me/TestBot?start=${body.sessionId}`);
});

test("session creation forwards the purpose, defaulting to upload", async () => {
  const purposes = [];
  const env = makeEnv({
    UPLOAD_SESSION: stub(async (_id, _url, init) => {
      purposes.push(JSON.parse(init.body).purpose);
      return new Response("{}");
    }),
  });
  await call("/v1/sessions", { env, body: JSON.stringify({ purpose: "passkey-enrollment" }) });
  await call("/v1/sessions", { env, body: JSON.stringify({ purpose: "something else" }) });
  await call("/v1/sessions", { env, body: "not json" });
  assert.deepEqual(purposes, ["passkey-enrollment", "upload", "upload"]);
});

test("recognize passes the session authorisation failure through with CORS", async () => {
  const env = makeEnv({ UPLOAD_SESSION: stub(async () => Response.json({ error: "expired" }, { status: 401 })) });
  const response = await recognize([], { env });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
});

test("recognize validates configuration, content type, activity, model and size", async () => {
  mockGemini([]);
  assert.equal((await recognize([], { env: makeEnv({ GEMINI_API_KEY: "" }) })).status, 503);
  assert.equal((await recognize([], { headers: { "content-type": "image/gif" } })).status, 415);
  assert.equal((await recognize([], { headers: { "x-business-activity": "" } })).status, 400);
  assert.equal((await recognize([], { headers: { "x-gemini-model": "gpt-4" } })).status, 400);
  assert.equal((await recognize([], { headers: { "x-target-record": "{bad" } })).status, 400);
  assert.equal((await recognize([], { body: new Uint8Array(0) })).status, 413);
  assert.equal((await recognize([], { body: new Uint8Array(12 * 1024 * 1024 + 1) })).status, 413);
});

test("an approved Form 6111 code is mapped to its Rivhit code and included", async () => {
  mockGemini([invoice()]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.form_6111_code, FORM_CODE);
  assert.equal(record.rivhit_code, RIVHIT_CODE);
  assert.equal(record.classification_name, RIVHIT_NAME);
  assert.equal(record.include, true);
  assert.equal(record.net_amount, 100);
});

test("a Gemini request carries the API key in a header, never in the URL or the response", async () => {
  const calls = mockGemini([invoice()]);
  const response = await recognize();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-gemini-key");
  assert.ok(!calls[0].url.includes("test-gemini-key"));
  assert.ok(!(await response.text()).includes("test-gemini-key"));
});

test("an invented classification code is discarded and the row is not exported", async () => {
  mockGemini([invoice({ form_6111_code: "9999", rivhit_code: "555" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.rivhit_code, null);
  assert.equal(record.form_6111_code, null);
  assert.equal(record.include, false);
  assert.match(record.agent_opinion, /fine/);
  assert.ok(record.agent_opinion.length > "fine".length);
});

test("a supplied custom code is accepted, a built-in or unlisted one is not", async () => {
  mockGemini([invoice({ form_6111_code: null, rivhit_code: "950" })]);
  const custom = encodeURIComponent(JSON.stringify({ 950: "Local code", [RIVHIT_CODE]: "Hijack", "12": "short" }));
  const accepted = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(accepted.rivhit_code, "950");
  assert.equal(accepted.classification_name, "Local code");
  assert.equal(accepted.form_6111_code, null);
  assert.equal(accepted.include, true);

  mockGemini([invoice({ form_6111_code: null, rivhit_code: RIVHIT_CODE })]);
  const hijack = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(hijack.rivhit_code, null);
  assert.equal(hijack.include, false);

  mockGemini([invoice({ form_6111_code: null, rivhit_code: "951" })]);
  const unlisted = (await (await recognize([], { headers: { "x-custom-rivhit-codes": custom } })).json()).records[0];
  assert.equal(unlisted.rivhit_code, null);
});

test("custom codes are listed in the Gemini prompt", async () => {
  const calls = mockGemini([invoice()]);
  const custom = encodeURIComponent(JSON.stringify({ 950: "Local code" }));
  await recognize([], { headers: { "x-custom-rivhit-codes": custom } });
  assert.match(JSON.parse(calls[0].init.body).system_instruction.parts[0].text, /Rivhit 950: Local code/);
});

test("a Form 6111 override only replaces codes that already exist", async () => {
  const override = encodeURIComponent(JSON.stringify({ [FORM_CODE]: ["777", "Overridden"], "0001": ["778", "New"] }));
  mockGemini([invoice(), invoice({ form_6111_code: "0001" })]);
  const records = (await (await recognize([], { headers: { "x-form-6111-mapping": override } })).json()).records;
  assert.equal(records[0].rivhit_code, "777");
  assert.equal(records[0].classification_name, "Overridden");
  assert.equal(records[1].rivhit_code, null);
});

test("a payment confirmation keeps the facts read from it but gets no classification and is never exported", async () => {
  mockGemini([invoice({ document_kind: "payment_confirmation", period_from: "2026-10-01", period_to: "2027-09-30" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.document_kind, "payment_confirmation");
  assert.deepEqual(
    [record.supplier_name, record.date, record.invoice_number, record.total_amount, record.period_from, record.period_to],
    ["Supplier", "2026-09-03", "42", 118, "2026-10-01", "2027-09-30"],
  );
  for (const field of ["form_6111_code", "rivhit_code", "classification_name", "recognized_percent", "vat_recognized_percent"])
    assert.equal(record[field], null, field);
  assert.equal(record.include, false);
});

test("an 'other' document loses its facts and its period", async () => {
  mockGemini([invoice({ document_kind: "other", period_from: "2026-10-01", period_to: "2027-09-30", document_title: "x" })]);
  const [record] = (await (await recognize()).json()).records;
  for (const field of ["supplier_name", "date", "net_amount", "total_amount", "period_from", "period_to", "document_title"])
    assert.equal(record[field], null, field);
  assert.equal(record.include, false);
});

test("the period and the printed title are passed on; a period that is not YYYY-MM-DD is dropped", async () => {
  mockGemini([
    invoice({ period_from: "2026-10-01", period_to: "2027-09-30", document_title: "  אישור תשלום לפוליסה " }),
    invoice({ period_from: "01/10/2026", period_to: "2027-13-40" }),
    invoice(),
  ]);
  const records = (await (await recognize()).json()).records;
  assert.deepEqual([records[0].period_from, records[0].period_to, records[0].document_title], ["2026-10-01", "2027-09-30", "אישור תשלום לפוליסה"]);
  assert.deepEqual([records[1].period_from, records[1].period_to], [null, null]);
  assert.deepEqual([records[2].period_from, records[2].period_to, records[2].document_title], [null, null, null]);
});

test("the prompt carries today's date and does not tell the model to judge a payment confirmation", async () => {
  const calls = mockGemini([invoice()]);
  await recognize([]);
  const prompt = JSON.parse(calls[0].init.body).system_instruction.parts[0].text;
  assert.match(prompt, new RegExp(`Today is ${new Date().toISOString().slice(0, 10)}`));
  assert.doesNotMatch(prompt, /payment confirmation is not an expense invoice/i);
  assert.match(prompt, /period_from and period_to/);
});

test("income reports keep their source facts but get no classification", async () => {
  mockGemini([invoice({ document_kind: "income_report" })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.supplier_name, "Supplier");
  assert.equal(record.rivhit_code, null);
  assert.equal(record.include, false);
});

test("an unknown document kind becomes other", async () => {
  mockGemini([invoice({ document_kind: "poem" })]);
  assert.equal((await (await recognize()).json()).records[0].document_kind, "other");
});

test("an empty 'other' record is dropped when an expense invoice is present", async () => {
  mockGemini([invoice(), { document_kind: "other", confidence: 10 }]);
  const records = (await (await recognize()).json()).records;
  assert.deepEqual(records.map((record) => record.document_kind), ["expense_invoice"]);
});

test("source-value boxes are clamped, rounded and discarded when degenerate", async () => {
  mockGemini([
    invoice({
      document_number_box: [-5, 10.4, 50.6, 2000],
      total_amount_box: [100, 100, 100, 200],
      vat_amount_box: [1, 2, 3],
    }),
  ]);
  const [record] = (await (await recognize()).json()).records;
  assert.deepEqual(record.highlight_regions, [{ field: "document_number", box_2d: [0, 10, 51, 1000] }]);
});

test("percentages are clamped to 0-100 and text is trimmed to 500 characters", async () => {
  mockGemini([invoice({ confidence: 250, recognized_percent: -4, purpose: ` ${"x".repeat(900)} ` })]);
  const [record] = (await (await recognize()).json()).records;
  assert.equal(record.confidence, 100);
  assert.equal(record.recognized_percent, 0);
  assert.equal(record.purpose.length, 500);
});

test("Gemini client errors and malformed output become 502 with a safe message", async () => {
  mockGemini([], { status: 400 });
  const rejected = await recognize();
  assert.equal(rejected.status, 502);
  assert.ok(!JSON.stringify(await rejected.json()).includes("boom"));

  mockGemini([], { raw: "not json" });
  assert.equal((await recognize()).status, 502);
  mockGemini([], { raw: JSON.stringify({ nothing: true }) });
  assert.equal((await recognize()).status, 502);
});
