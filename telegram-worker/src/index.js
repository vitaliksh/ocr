const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
const encoder = new TextEncoder();

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
  return origin ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type, x-upload-token", "access-control-allow-methods": "GET, POST, OPTIONS" } : {};
}

function clientRequest(request, env) {
  if (!allowedOrigin(request, env)) return json({ error: "This browser origin is not allowed." }, 403);
  return null;
}

function sessionStub(env, sessionId) {
  return env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(sessionId));
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
    if (startToken) {
      const response = await sessionStub(env, startToken).fetch("https://session/telegram/connect", { method: "POST", body: JSON.stringify({ userId, chatId }) });
      const result = await response.json();
      await telegramApi(env, "sendMessage", { chat_id: chatId, text: result.ok ? "Connected. Send document photos now." : "No active upload session. Start a new upload session from the PC." });
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
      const sessionId = randomToken();
      const clientToken = randomToken();
      const response = await sessionStub(env, sessionId).fetch("https://session/create", { method: "POST", body: JSON.stringify({ sessionId, clientToken, now: Date.now() }) });
      if (!response.ok) return response;
      return json({ sessionId, clientToken, telegramUrl: `https://t.me/${env.BOT_USERNAME}?start=${sessionId}`, expiresAt: Date.now() + SESSION_TTL_MS }, 201, cors(request, env));
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
  async create({ sessionId, clientToken, now }) {
    if (await this.state.storage.get("session")) return json({ error: "Session already exists." }, 409);
    const session = { sessionId, clientToken, createdAt: now, expiresAt: now + SESSION_TTL_MS, maxExpiresAt: now + MAX_SESSION_MS, telegramUserId: null, telegramChatId: null, documents: [] };
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
    return json({ ok: true });
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
