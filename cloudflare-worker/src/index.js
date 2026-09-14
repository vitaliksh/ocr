import { RIVHIT_MAPPING } from "./rivhit-mapping.js";
import * as webauthn from "@simplewebauthn/server";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
const MAX_AI_IMAGE_BYTES = 12 * 1024 * 1024;
const GEMINI_MODELS = new Set(["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite"]);
const encoder = new TextEncoder();
const PASSKEY_TTL_MS = 5 * 60 * 1000;
const PASSKEY_RP_ID = "vitaliksh.github.io";
const PASSKEY_ORIGIN = "https://vitaliksh.github.io";

const GEMINI_SCHEMA = { type: "OBJECT", properties: { records: { type: "ARRAY", minItems: 1, items: { type: "OBJECT", properties: {
  document_kind: { type: "STRING" }, confidence: { type: "NUMBER" }, agent_opinion: { type: "STRING" }, date: { type: "STRING", nullable: true }, supplier_name: { type: "STRING", nullable: true }, supplier_vat_id: { type: "STRING", nullable: true }, invoice_number: { type: "STRING", nullable: true }, transaction_number: { type: "STRING", nullable: true }, allocation_number: { type: "STRING", nullable: true }, purpose: { type: "STRING", nullable: true }, total_amount: { type: "NUMBER", nullable: true }, currency: { type: "STRING", nullable: true }, form_6111_code: { type: "STRING", nullable: true }, rivhit_code: { type: "STRING", nullable: true }, recognized_percent: { type: "NUMBER", nullable: true }, vat_recognized_percent: { type: "NUMBER", nullable: true }, net_amount: { type: "NUMBER", nullable: true }, vat_amount: { type: "NUMBER", nullable: true }, vat_percent: { type: "NUMBER", nullable: true }, document_number_box: { type: "ARRAY", nullable: true, minItems: 4, maxItems: 4, items: { type: "NUMBER" } }, total_amount_box: { type: "ARRAY", nullable: true, minItems: 4, maxItems: 4, items: { type: "NUMBER" } }, vat_amount_box: { type: "ARRAY", nullable: true, minItems: 4, maxItems: 4, items: { type: "NUMBER" } }
}, required: ["document_kind", "confidence", "agent_opinion", "date", "supplier_name", "supplier_vat_id", "invoice_number", "transaction_number", "allocation_number", "purpose", "total_amount", "currency", "form_6111_code", "rivhit_code", "recognized_percent", "vat_recognized_percent", "net_amount", "vat_amount", "vat_percent", "document_number_box", "total_amount_box", "vat_amount_box"] } } }, required: ["records"] };

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders } });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).includes(origin) ? origin : null;
}

function cors(request, env) {
  const origin = allowedOrigin(request, env);
  return origin ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type, x-upload-token, x-business-activity, x-gemini-model, x-form-6111-mapping, x-custom-rivhit-codes, x-target-record, x-passkey-credential-id, x-passkey-token", "access-control-allow-methods": "GET, POST, OPTIONS" } : {};
}

function clientRequest(request, env) {
  if (!allowedOrigin(request, env)) return json({ error: "This browser origin is not allowed." }, 403);
  return null;
}

function base64Encode(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function text(value) { return typeof value === "string" ? value.trim().slice(0, 500) || null : null; }
function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function percentage(value) { const result = number(value); return result === null ? null : Math.max(0, Math.min(100, result)); }
function box(value) { if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null; const [top, left, bottom, right] = value.map((item) => Math.max(0, Math.min(1000, Math.round(item)))); return bottom > top && right > left ? [top, left, bottom, right] : null; }
function highlights(raw) { return [["document_number", raw?.document_number_box], ["total_amount", raw?.total_amount_box], ["vat_amount", raw?.vat_amount_box]].map(([field, value]) => ({ field, box_2d: box(value) })).filter((item) => item.box_2d); }
function form6111Mapping(request) { let supplied = {}; try { const value = request.headers.get("x-form-6111-mapping"); if (value) supplied = JSON.parse(decodeURIComponent(value)); } catch {} const mapping = { ...RIVHIT_MAPPING }; for (const [form6111, value] of Object.entries(supplied)) { const [rivhit, name] = Array.isArray(value) ? value : []; if (RIVHIT_MAPPING[form6111] && /^\d{3}$/.test(rivhit || "") && typeof name === "string" && name.trim()) mapping[form6111] = [rivhit, name.trim().slice(0, 120)]; } return mapping; }
function customRivhitCodes(request) { let supplied = {}; try { const value = request.headers.get("x-custom-rivhit-codes"); if (value) supplied = JSON.parse(decodeURIComponent(value)); } catch {} const builtInCodes = new Set(Object.values(RIVHIT_MAPPING).map(([code]) => code)), codes = {}; for (const [code, name] of Object.entries(supplied).slice(0, 200)) if (/^\d{3}$/.test(code) && !builtInCodes.has(code) && typeof name === "string" && name.trim()) codes[code] = name.trim().replace(/[\t\r\n]+/g, " ").slice(0, 120); return codes; }
function mappingPrompt(mapping) { return Object.entries(mapping).map(([code, [rivhit, name]]) => `- Form 6111 ${code} → Rivhit ${rivhit}: ${name}`).join("\n"); }
function customCodesPrompt(codes) { const entries = Object.entries(codes); return entries.length ? entries.map(([code, name]) => `- Rivhit ${code}: ${name}`).join("\n") : "(none)"; }
function normalizeRecord(raw, mapping = RIVHIT_MAPPING, customCodes = {}) {
  const kind = ["expense_invoice", "payment_confirmation", "income_report", "other"].includes(raw?.document_kind) ? raw.document_kind : "other";
  const expense = kind === "expense_invoice", income = kind === "income_report", formCode = text(raw?.form_6111_code), formMapped = expense && formCode ? mapping[formCode] : null, rivhitCode = text(raw?.rivhit_code), customMapped = expense && !formMapped && rivhitCode && customCodes[rivhitCode] ? [rivhitCode, customCodes[rivhitCode]] : null, mapped = formMapped || customMapped;
  const record = { document_kind: kind, confidence: percentage(raw?.confidence) ?? 0, agent_opinion: text(raw?.agent_opinion) || "לא נמסר הסבר מהסוכן.", date: text(raw?.date), supplier_name: text(raw?.supplier_name), supplier_vat_id: text(raw?.supplier_vat_id), invoice_number: text(raw?.invoice_number), transaction_number: text(raw?.transaction_number), allocation_number: text(raw?.allocation_number), purpose: text(raw?.purpose), total_amount: number(raw?.total_amount), currency: text(raw?.currency), form_6111_code: formMapped ? formCode : null, rivhit_code: mapped?.[0] || null, classification_name: mapped?.[1] || null, recognized_percent: percentage(raw?.recognized_percent), vat_recognized_percent: percentage(raw?.vat_recognized_percent), net_amount: number(raw?.net_amount), vat_amount: number(raw?.vat_amount), vat_percent: percentage(raw?.vat_percent), highlight_regions: highlights(raw), include: Boolean(expense && mapped) };
  if (!expense && !income) Object.assign(record, { date: null, supplier_name: null, supplier_vat_id: null, invoice_number: null, transaction_number: null, allocation_number: null, purpose: null, total_amount: null, currency: null, form_6111_code: null, rivhit_code: null, classification_name: null, recognized_percent: null, vat_recognized_percent: null, net_amount: null, vat_amount: null, vat_percent: null, include: false });
  if (expense && !mapped) { record.include = false; record.agent_opinion += " קוד המיון שהוצע אינו נמצא במילון המאושר ולכן השורה אינה מיועדת לייצוא."; }
  return record;
}
async function recognizeWithGemini(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: "Gemini is not configured." }, 503);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
  if (!new Set(["image/jpeg", "image/jpg", "image/png"]).has(contentType)) return json({ error: "Only JPG and PNG images are supported." }, 415);
  const activity = decodeURIComponent(request.headers.get("x-business-activity") || "").trim();
  if (!activity || activity.length > 500) return json({ error: "Business activity is required." }, 400);
  const selectedModel = request.headers.get("x-gemini-model") || env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  if (!GEMINI_MODELS.has(selectedModel)) return json({ error: "Unsupported Gemini model." }, 400);
  let targetRecord = null;
  try { const rawTarget = request.headers.get("x-target-record"); if (rawTarget) targetRecord = JSON.parse(decodeURIComponent(rawTarget)); } catch { return json({ error: "Invalid target record." }, 400); }
  const image = await request.arrayBuffer(); if (!image.byteLength || image.byteLength > MAX_AI_IMAGE_BYTES) return json({ error: "Image must be 12 MB or smaller." }, 413);
  const mapping = form6111Mapping(request), customCodes = customRivhitCodes(request), scope = (targetRecord ? `Return exactly ONE record: the document and VAT-rate group matching this existing journal record. Do not return other documents or VAT groups from the same image. Existing record (it may contain user edits): ${JSON.stringify(targetRecord)}` : "Return one record for EACH spatially separate receipt, invoice, or payment document visible in the image. A partially visible but readable receipt still counts as a separate document; never omit it merely because other documents share the same photo.") + " For every returned source-value box: cover only the printed value characters (and an attached currency sign when printed), not its label, table cell, surrounding whitespace, or another value. Make the box tight on all four sides in top, left, bottom, right order. Verify that its contents exactly match the corresponding returned field; otherwise return null for that box.";
  const prompt = `Analyze this financial document image for an Israeli Rivhit journal. Business activity: ${activity}\n\n${scope}\n\ndocument_kind must be exactly expense_invoice, payment_confirmation, income_report, or other. A receipt is an expense_invoice when it documents a business purchase with a seller, date and amount even if the word “חשבונית” is absent; this includes fuel-station receipts. All non-expense documents must still get one record with a concise Hebrew agent_opinion explaining the decision. A full income report (for example “דיווח הכנסות” or “דיווח הכנסות תקופתי”) is income_report: extract its date, issuer, reference, purpose, gross, net and VAT values. Return a record only for a distinct physical financial document visible in the photo. For expense_invoice, choose one allowed full Form 6111 code; if no listed Form 6111 code fits, choose one allowed custom Rivhit code instead. Never invent either code. When using a Form 6111 code, set rivhit_code to null. When using a custom Rivhit code, set form_6111_code to null. confidence is one overall integer from 0 to 100. Monetary values must satisfy net_amount + vat_amount = total_amount after rounding. If VAT is included in the printed total but is not printed separately, calculate it from the visible VAT rate and leave vat_amount_box null. vat_recognized_percent is the percent of VAT recognized for this row. First decide explicitly whether each printed amount is חייב במע״מ (VAT-taxable) or לא חייב במע״מ / exempt. Never treat an exempt amount as a taxable total and divide it by a VAT rate. A group explicitly marked not liable for VAT, or whose printed rate is 0%, is a 0% group: vat_percent, vat_amount, and vat_recognized_percent must all be 0, while net_amount and total_amount are the same printed amount. A group marked liable for VAT must use only its printed VAT rate and figures. If a single invoice has both a VAT-exempt (0%) line and a taxable line, ALWAYS return two records: one combined 0% record and one combined taxable record. Use each group’s net, VAT and gross only; both records retain the same document reference. Also split separate taxable VAT-rate groups. A printed Hebrew line such as “מוצרים חייבים ב- 18% מע״מ 194.28” means net_amount is exactly 194.28, never divide it by 1.18. A payment confirmation is not an expense invoice.\n\nFor expense_invoice and income_report, locate the exact printed values used for its document number, total_amount, and vat_amount. Return each location directly in document_number_box, total_amount_box, and vat_amount_box as [ymin, xmin, ymax, xmax], normalized from 0 to 1000. Use null only when that value is absent or calculated.\n\nAllowed Form 6111 → Rivhit mapping:\n${mappingPrompt(mapping)}\n\nAllowed custom Rivhit codes:\n${customCodesPrompt(customCodes)}`;
  const payload = JSON.stringify({ system_instruction: { parts: [{ text: prompt }] }, contents: [{ role: "user", parts: [{ text: "Analyze this document and return the journal record." }, { inline_data: { mime_type: contentType, data: base64Encode(image) } }] }], generationConfig: { response_mime_type: "application/json", response_schema: GEMINI_SCHEMA, temperature: 0 } });
  let response, data;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: payload });
    try { data = await response.json(); } catch { data = null; }
    if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after")); await new Promise((resolve) => setTimeout(resolve, Math.min(16000, Math.max(2000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0))));
  }
  if (!response.ok) { console.error("Gemini request failed", response.status, data?.error?.message); const error = response.status === 429 ? "Gemini מוגבל זמנית. נסה שוב בעוד דקה או בחר מודל אחר." : response.status >= 500 ? "Gemini אינו זמין זמנית. נסה שוב." : "Gemini דחה את עיבוד המסמך."; return json({ error }, 502); }
  try { const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || ""), records = parsed.records.map((record) => normalizeRecord(record, mapping, customCodes)), hasExpense = records.some((record) => record.document_kind === "expense_invoice"); return json({ records: records.filter((record) => !(hasExpense && record.document_kind === "other" && record.total_amount === null && !record.supplier_name && !record.date)) }); }
  catch { return json({ error: "Gemini returned an invalid result." }, 502); }
}

const PASS2_SCHEMA = { type: "OBJECT", properties: { form_6111_code: { type: "STRING", nullable: true }, rivhit_code: { type: "STRING", nullable: true }, recognized_percent: { type: "NUMBER" }, vat_recognized_percent: { type: "NUMBER" }, confidence: { type: "NUMBER" }, review_state: { type: "STRING" }, agent_opinion: { type: "STRING" } }, required: ["form_6111_code", "rivhit_code", "recognized_percent", "vat_recognized_percent", "confidence", "review_state", "agent_opinion"] };
async function refineWithHistory(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: "Gemini is not configured." }, 503);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid history-refinement request." }, 400); }
  const draft = input?.draft, history = Array.isArray(input?.history) ? input.history.slice(0, 8) : null;
  if (!draft || !history || !history.length) return json({ error: "A draft row and 1–8 history records are required." }, 400);
  const selectedModel = request.headers.get("x-gemini-model") || env.GEMINI_MODEL || "gemini-3.5-flash-lite", mapping = form6111Mapping(request), customCodes = customRivhitCodes(request);
  if (!GEMINI_MODELS.has(selectedModel)) return json({ error: "Unsupported Gemini model." }, 400);
  const prompt = `You are Gemini pass 2 for an Israeli Rivhit expense journal. Improve accounting judgement using a draft row and closed-history guidance. Never change, reinterpret, infer, or return any document source fact: date, supplier, supplier ID, document reference, allocation number, raw net, VAT, gross, or currency. History is guidance, not proof. Return only the allowed fields in the response schema. form_6111_code must be one of the approved mappings below or null. rivhit_code must be one of the approved custom codes below or null. Return only one of them, preferring a Form 6111 code when it fits. review_state must be ready or review. Give a concise Hebrew agent_opinion.\n\nDraft row:\n${JSON.stringify(draft)}\n\nRelevant closed history (text-only):\n${JSON.stringify(history)}\n\nApproved Form 6111 mapping:\n${mappingPrompt(mapping)}\n\nApproved custom Rivhit codes:\n${customCodesPrompt(customCodes)}`;
  const payload = JSON.stringify({ system_instruction: { parts: [{ text: prompt }] }, contents: [{ role: "user", parts: [{ text: "Refine this draft accounting judgement." }] }], generationConfig: { response_mime_type: "application/json", response_schema: PASS2_SCHEMA, temperature: 0 } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: payload }); let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) return json({ error: "Gemini could not refine this row." }, 502);
  try { const raw = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || ""), formCode = text(raw.form_6111_code), formMapped = formCode ? mapping[formCode] : null, rivhitCode = text(raw.rivhit_code), customMapped = !formMapped && rivhitCode && customCodes[rivhitCode] ? [rivhitCode, customCodes[rivhitCode]] : null, mapped = formMapped || customMapped; return json({ rivhit_code: mapped?.[0] || null, recognized_percent: percentage(raw.recognized_percent), vat_recognized_percent: percentage(raw.vat_recognized_percent), confidence: percentage(raw.confidence), review_state: raw.review_state === "ready" ? "ready" : "review", agent_opinion: text(raw.agent_opinion) || "לא נמסר הסבר מהסוכן." }); } catch { return json({ error: "Gemini returned an invalid refinement." }, 502); }
}

function sessionStub(env, sessionId) {
  return env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(sessionId));
}
function deviceRegistry(env) { return env.DEVICE_REGISTRY.get(env.DEVICE_REGISTRY.idFromName("passkeys")); }
async function passkeyAuthorized(request, env) {
  const credentialId = request.headers.get("X-Passkey-Credential-Id"), token = request.headers.get("X-Passkey-Token");
  if (!credentialId || !token) return null;
  const response = await deviceRegistry(env).fetch("https://passkeys/authorize", { method: "POST", body: JSON.stringify({ credentialId, token }) });
  return response.ok ? response : null;
}

async function telegramApi(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Telegram ${method} failed (${response.status}).`);
  return response.json();
}

async function webhook(request, env) {
  if (!timingSafeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) return new Response("Forbidden", { status: 403 });
  const update = await request.json();
  const message = update.message;
  if (!message) return new Response("ok");
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  if (!chatId || !userId) return new Response("ok");
  const startToken = message.text?.match(/^\/start\s+([A-Za-z0-9_-]{30,})\s*$/)?.[1];
  try {
    if (message.text?.trim() === "/whoami") {
      await telegramApi(env, "sendMessage", { chat_id: chatId, text: `Your Telegram user ID: ${userId}` });
    } else if (startToken) {
      const response = await sessionStub(env, startToken).fetch("https://session/telegram/connect", { method: "POST", body: JSON.stringify({ userId, chatId }) });
      const result = await response.json();
      const messageText = result.purpose === "passkey-enrollment" ? "Connected. Complete Windows Hello on your PC; do not send a photo." : "Connected. Send document photos now.";
      await telegramApi(env, "sendMessage", { chat_id: chatId, text: result.ok ? messageText : "No active upload session. Start a new upload session from the PC." });
    } else if (Array.isArray(message.photo) && message.photo.length) {
      // The session is discovered from the temporary Telegram-user binding, not a client-supplied id.
      const list = await env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(`telegram-user:${userId}`)).fetch("https://session/telegram/lookup", { method: "POST" });
      const sessionId = await list.text();
      if (!sessionId) {
        await telegramApi(env, "sendMessage", { chat_id: chatId, text: "No active upload session. Start a new upload session from the PC." });
      } else {
        const response = await sessionStub(env, sessionId).fetch("https://session/telegram/photo", { method: "POST", body: JSON.stringify({ userId, chatId, updateId: update.update_id, photos: message.photo }) });
        const result = await response.json();
        if (!result.ok) await telegramApi(env, "sendMessage", { chat_id: chatId, text: "No active upload session. Start a new upload session from the PC." });
      }
    } else if (message.video || message.video_note || message.animation) {
      const list = await env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(`telegram-user:${userId}`)).fetch("https://session/telegram/lookup", { method: "POST" });
      if (await list.text()) await telegramApi(env, "sendMessage", { chat_id: chatId, text: "Videos are not supported. Please send document photos." });
    }
  } catch (error) {
    console.error("Telegram webhook error", error);
    if (chatId) await telegramApi(env, "sendMessage", { chat_id: chatId, text: "Could not receive the photo. Please try again." }).catch(() => {});
  }
  return new Response("ok");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request, env) });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/telegram/webhook" && request.method === "POST") return webhook(request, env);
    const rejected = clientRequest(request, env);
    if (rejected) return rejected;
    if (url.pathname === "/v1/sessions" && request.method === "POST") {
      let purpose = "upload"; try { const requested = (await request.json())?.purpose; purpose = requested === "passkey-enrollment" ? requested : "upload"; } catch {}
      const sessionId = randomToken();
      const clientToken = randomToken();
      const response = await sessionStub(env, sessionId).fetch("https://session/create", { method: "POST", body: JSON.stringify({ sessionId, clientToken, purpose, now: Date.now() }) });
      if (!response.ok) return response;
      return json({ sessionId, clientToken, telegramUrl: `https://t.me/${env.BOT_USERNAME}?start=${sessionId}`, expiresAt: Date.now() + SESSION_TTL_MS }, 201, cors(request, env));
    }
    const recognizeMatch = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{30,})\/recognize$/);
    if (recognizeMatch) {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors(request, env));
      const authorization = await sessionStub(env, recognizeMatch[1]).fetch("https://session/client/ai-authorize", { method: "POST", headers: { "X-Upload-Token": request.headers.get("X-Upload-Token") || "" } });
      if (!authorization.ok) { const headers = new Headers(authorization.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(authorization.body, { status: authorization.status, headers }); }
      const result = await recognizeWithGemini(request, env), headers = new Headers(result.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(result.body, { status: result.status, headers });
    }
    if (url.pathname === "/v1/passkeys/refine-history") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors(request, env));
      const authorization = await passkeyAuthorized(request, env);
      if (!authorization) return json({ error: "Windows Hello authorization is required." }, 401, cors(request, env));
      const result = await refineWithHistory(request, env), headers = new Headers(result.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(result.body, { status: result.status, headers });
    }
    const registrationMatch = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{30,})\/passkeys\/(registration-options|register)$/);
    if (registrationMatch) {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors(request, env));
      const authorization = await sessionStub(env, registrationMatch[1]).fetch("https://session/client/ai-authorize", { method: "POST", headers: { "X-Upload-Token": request.headers.get("X-Upload-Token") || "" } });
      if (!authorization.ok) { const headers = new Headers(authorization.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(authorization.body, { status: authorization.status, headers }); }
      const endpoint = registrationMatch[2] === "registration-options" ? "begin-registration" : "finish-registration";
      const body = registrationMatch[2] === "register" ? await request.text() : "";
      const upstream = await deviceRegistry(env).fetch(`https://passkeys/${endpoint}`, { method: "POST", body });
      const headers = new Headers(upstream.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(upstream.body, { status: upstream.status, headers });
    }
    if (url.pathname === "/v1/passkeys/authentication-options" || url.pathname === "/v1/passkeys/authentication-verify") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors(request, env));
      const endpoint = url.pathname.endsWith("options") ? "begin-authentication" : "finish-authentication";
      const upstream = await deviceRegistry(env).fetch(`https://passkeys/${endpoint}`, { method: "POST", body: await request.text() });
      const headers = new Headers(upstream.headers); for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value); return new Response(upstream.body, { status: upstream.status, headers });
    }
    const match = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{30,})\/(events|finish|documents\/([0-9a-f-]{36})(?:\/ack)?)$/);
    if (!match) return json({ error: "Not found." }, 404, cors(request, env));
    const [, sessionId, action, documentId] = match;
    const method = action === "finish" || action.endsWith("/ack") ? "POST" : "GET";
    if (request.method !== method) return json({ error: "Method not allowed." }, 405, cors(request, env));
    const upstream = await sessionStub(env, sessionId).fetch(`https://session/client/${action}`, { method, headers: { "X-Upload-Token": request.headers.get("X-Upload-Token") || "" } });
    const headers = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(cors(request, env))) headers.set(key, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};

export class UploadSession {
  constructor(state, env) { this.state = state; this.env = env; this.streams = new Set(); this.mutations = Promise.resolve(); }
  serialize(operation) {
    const result = this.mutations.then(operation, operation);
    // Keep the queue usable after a failed Telegram download or R2 operation.
    this.mutations = result.catch(() => {});
    return result;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/bind") { const sessionId = await request.text(); return this.serialize(async () => { await this.state.storage.put("telegramSessionId", sessionId); return new Response("ok"); }); }
    if (url.pathname === "/unbind") { const sessionId = await request.text(); return this.serialize(async () => { if ((await this.state.storage.get("telegramSessionId")) === sessionId) await this.state.storage.delete("telegramSessionId"); return new Response("ok"); }); }
    if (url.pathname === "/create") { const payload = await request.json(); return this.serialize(() => this.create(payload)); }
    if (url.pathname === "/telegram/connect") { const payload = await request.json(); return this.serialize(() => this.connectTelegram(payload)); }
    if (url.pathname === "/telegram/photo") { const payload = await request.json(); return this.serialize(() => this.receivePhoto(payload)); }
    if (url.pathname === "/telegram/lookup") return new Response((await this.state.storage.get("telegramSessionId")) || "");
    if (!url.pathname.startsWith("/client/")) return json({ error: "Not found." }, 404);
    const clientToken = request.headers.get("X-Upload-Token");
    const session = await this.activeSession(clientToken);
    if (!session) return json({ error: "Session expired or unauthorized." }, 401);
    const action = url.pathname.slice("/client/".length);
    if (action === "events") return this.events(session);
    if (action === "ai-authorize") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!this.env.ALLOWED_TELEGRAM_USER_ID) return json({ error: "AI access is not configured." }, 503);
      return session.telegramUserId && timingSafeEqual(String(session.telegramUserId), String(this.env.ALLOWED_TELEGRAM_USER_ID)) ? json({ ok: true }) : json({ error: "AI access is unauthorized." }, 403);
    }
    if (action === "finish") return this.serialize(async () => {
      const current = await this.activeSession(clientToken);
      return current ? this.finish(current) : json({ error: "Session expired or unauthorized." }, 401);
    });
    const match = action.match(/^documents\/([0-9a-f-]{36})(\/ack)?$/);
    if (!match) return json({ error: "Not found." }, 404);
    if (match[2]) return this.serialize(async () => {
      const current = await this.activeSession(clientToken);
      return current ? this.ack(current, match[1]) : json({ error: "Session expired or unauthorized." }, 401);
    });
    return this.download(session, match[1]);
  }
  async create({ sessionId, clientToken, purpose = "upload", now }) {
    if (await this.state.storage.get("session")) return json({ error: "Session already exists." }, 409);
    const session = { sessionId, clientToken, purpose, createdAt: now, expiresAt: now + SESSION_TTL_MS, maxExpiresAt: now + MAX_SESSION_MS, telegramUserId: null, telegramChatId: null, documents: [] };
    await this.state.storage.put("session", session);
    await this.state.storage.setAlarm(session.expiresAt);
    return json({ ok: true }, 201);
  }
  async activeSession(clientToken = null) {
    const session = await this.state.storage.get("session");
    if (!session || Date.now() >= session.expiresAt) { if (session) await this.destroy(session); return null; }
    if (clientToken !== null && !timingSafeEqual(clientToken, session.clientToken)) return null;
    return session;
  }
  async connectTelegram({ userId, chatId }) {
    const session = await this.activeSession();
    if (!session || (session.telegramUserId && session.telegramUserId !== userId)) return json({ ok: false });
    session.telegramUserId = userId; session.telegramChatId = chatId;
    await this.state.storage.put("session", session);
    const userStub = this.env.UPLOAD_SESSION.get(this.env.UPLOAD_SESSION.idFromName(`telegram-user:${userId}`));
    await userStub.fetch("https://session/bind", { method: "POST", body: session.sessionId });
    this.broadcast({ type: "connected" });
    return json({ ok: true, purpose: session.purpose });
  }
  async receivePhoto({ userId, updateId, photos }) {
    const session = await this.activeSession();
    if (!session || session.telegramUserId !== userId) return json({ ok: false });
    if (session.documents.some((document) => document.updateId === updateId)) return json({ ok: true, duplicate: true });
    const photo = photos.reduce((largest, item) => (item.file_size || item.width * item.height) > (largest.file_size || largest.width * largest.height) ? item : largest);
    const file = await telegramApi(this.env, "getFile", { file_id: photo.file_id });
    const image = await fetch(`https://api.telegram.org/file/bot${this.env.TELEGRAM_BOT_TOKEN}/${file.result.file_path}`);
    if (!image.ok) throw new Error("Telegram image download failed.");
    const documentId = crypto.randomUUID(); const objectKey = `${session.sessionId}/${documentId}.jpg`;
    await this.env.UPLOAD_PHOTOS.put(objectKey, image.body, { httpMetadata: { contentType: image.headers.get("content-type") || "image/jpeg" }, customMetadata: { sessionId: session.sessionId } });
    const document = { id: documentId, objectKey, receivedAt: Date.now(), updateId, contentType: image.headers.get("content-type") || "image/jpeg" };
    session.documents.push(document);
    session.expiresAt = Math.min(Date.now() + SESSION_TTL_MS, session.maxExpiresAt);
    await this.state.storage.put("session", session); await this.state.storage.setAlarm(session.expiresAt);
    this.broadcast({ type: "document", documentId, receivedAt: document.receivedAt });
    return json({ ok: true });
  }
  async events(session) {
    let item;
    const stream = new ReadableStream({ start: (controller) => { item = { controller }; this.streams.add(item); controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ connected: Boolean(session.telegramUserId), documents: session.documents.map(({ id, receivedAt }) => ({ documentId: id, receivedAt })) })}\n\n`)); }, cancel: () => this.streams.delete(item) });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  }
  async download(session, documentId) {
    const document = session.documents.find((item) => item.id === documentId);
    if (!document) return json({ error: "Document unavailable." }, 404);
    const object = await this.env.UPLOAD_PHOTOS.get(document.objectKey);
    if (!object) return json({ error: "Document unavailable." }, 404);
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || document.contentType, "cache-control": "no-store", "content-disposition": `inline; filename="telegram-${documentId}.jpg"` } });
  }
  async ack(session, documentId) {
    const documentIndex = session.documents.findIndex((item) => item.id === documentId);
    if (documentIndex < 0) return json({ ok: true, duplicate: true });
    const [document] = session.documents.splice(documentIndex, 1);
    await this.env.UPLOAD_PHOTOS.delete(document.objectKey); await this.state.storage.put("session", session);
    return json({ ok: true });
  }
  async finish(session) { await this.destroy(session); this.broadcast({ type: "finished" }); return json({ ok: true }); }
  broadcast(payload) { const message = encoder.encode(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`); for (const stream of this.streams) { try { stream.controller.enqueue(message); } catch { this.streams.delete(stream); } } }
  async destroy(session) {
    await Promise.all(session.documents.map((document) => this.env.UPLOAD_PHOTOS.delete(document.objectKey)));
    if (session.telegramUserId) { const userStub = this.env.UPLOAD_SESSION.get(this.env.UPLOAD_SESSION.idFromName(`telegram-user:${session.telegramUserId}`)); await userStub.fetch("https://session/unbind", { method: "POST", body: session.sessionId }); }
    await this.state.storage.deleteAll();
  }
  async alarm() { const session = await this.state.storage.get("session"); if (session && Date.now() >= session.expiresAt) await this.destroy(session); }
}

export class DeviceRegistry {
  // The optional third argument is a test seam. Cloudflare constructs Durable
  // Objects with the first two arguments, so production always uses the real
  // SimpleWebAuthn implementation.
  constructor(state, env, webauthnApi = webauthn) { this.state = state; this.webauthn = webauthnApi; }
  async fetch(request) {
    // Calls to a Durable Object use https://passkeys/<action>: "passkeys" is
    // the hostname, not part of pathname. Accept the prefixed form as well
    // so internal routing cannot turn begin-registration into an unknown action.
    const action = new URL(request.url).pathname.replace(/^\/(?:passkeys\/)?/, "");
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    try {
      if (action === "begin-registration") return await this.beginRegistration();
      const input = await request.json();
      if (action === "finish-registration") return await this.finishRegistration(input);
      if (action === "begin-authentication") return await this.beginAuthentication(input);
      if (action === "finish-authentication") return await this.finishAuthentication(input);
      if (action === "authorize") return await this.authorize(input);
      return json({ error: "Not found." }, 404);
    } catch { console.error("Passkey verification failed."); return json({ error: "Windows Hello verification failed." }, 400); }
  }
  async beginRegistration() {
    const options = await this.webauthn.generateRegistrationOptions({ rpName: "Rivhit document journal", rpID: PASSKEY_RP_ID, userName: `rivhit-${randomToken().slice(0, 12)}`, attestationType: "none", authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" } });
    await this.state.storage.put("registration", { challenge: options.challenge, expiresAt: Date.now() + PASSKEY_TTL_MS });
    return json(options);
  }
  async finishRegistration(response) {
    const pending = await this.state.storage.get("registration");
    if (!pending || Date.now() >= pending.expiresAt) return json({ error: "Windows Hello setup expired. Start it again." }, 401);
    const verification = await this.webauthn.verifyRegistrationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) return json({ error: "Windows Hello setup was not verified." }, 400);
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await this.state.storage.put(`credential:${credential.id}`, { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports || [], deviceType: credentialDeviceType, backedUp: credentialBackedUp, createdAt: Date.now() });
    await this.state.storage.delete("registration");
    return json({ ok: true, credentialId: credential.id });
  }
  async beginAuthentication({ credentialId }) {
    if (typeof credentialId !== "string" || credentialId.length < 16) return json({ error: "Windows Hello is not configured on this browser." }, 400);
    const credential = await this.state.storage.get(`credential:${credentialId}`);
    if (!credential) return json({ error: "This Windows Hello credential is no longer registered." }, 404);
    const options = await this.webauthn.generateAuthenticationOptions({ rpID: PASSKEY_RP_ID, userVerification: "required", allowCredentials: [{ id: credential.id, transports: credential.transports }] });
    await this.state.storage.put(`authentication:${credential.id}`, { challenge: options.challenge, expiresAt: Date.now() + PASSKEY_TTL_MS });
    return json(options);
  }
  async finishAuthentication({ credentialId, response }) {
    const credential = await this.state.storage.get(`credential:${credentialId}`), pending = await this.state.storage.get(`authentication:${credentialId}`);
    if (!credential || !pending || Date.now() >= pending.expiresAt) return json({ error: "Windows Hello request expired. Try again." }, 401);
    const verification = await this.webauthn.verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, credential, requireUserVerification: true });
    if (!verification.verified) return json({ error: "Windows Hello was not verified." }, 403);
    credential.counter = verification.authenticationInfo.newCounter;
    const token = randomToken();
    await this.state.storage.put(`credential:${credentialId}`, credential);
    await this.state.storage.put(`token:${credentialId}`, { token, expiresAt: Date.now() + PASSKEY_TTL_MS });
    await this.state.storage.delete(`authentication:${credentialId}`);
    return json({ ok: true, token, expiresAt: Date.now() + PASSKEY_TTL_MS });
  }
  async authorize({ credentialId, token }) {
    const grant = await this.state.storage.get(`token:${credentialId}`);
    if (!grant || Date.now() >= grant.expiresAt || !timingSafeEqual(token, grant.token)) return json({ error: "Windows Hello authorization expired." }, 401);
    return json({ ok: true });
  }
}
