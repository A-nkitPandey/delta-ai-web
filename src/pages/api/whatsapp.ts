/**
 * /api/whatsapp — WhatsApp Cloud API webhook. "Delta" answers every message
 * sent to the business number, using the same knowledge as the website chat.
 *
 * GET  — Meta's one-time verification (hub.mode / hub.verify_token / hub.challenge).
 * POST — incoming messages. The X-Hub-Signature-256 header (HMAC-SHA256 of the raw
 *        body with the app secret) is checked before anything is read. We answer
 *        200 at once and reply in the background, because Meta retries anything
 *        slower or non-200 (and can deliver the same message twice).
 *
 * Secrets (set with `npx wrangler secret put …`, never in code):
 *   WHATSAPP_TOKEN            permanent system-user access token
 *   WHATSAPP_APP_SECRET       the Meta app's secret, for the signature check
 *   WHATSAPP_VERIFY_TOKEN     any long random string, also typed into Meta's webhook form
 *   WHATSAPP_PHONE_NUMBER_ID  the business number's id from WhatsApp Manager
 *
 * The bot stays silent until all four are set.
 */
import type { APIRoute } from "astro";
import { env, waitUntil } from "cloudflare:workers";
import { askDelta, type ChatMessage } from "@/lib/assistant";

export const prerender = false;

const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_BODY_BYTES = 256 * 1024;
/** Messages remembered per person, and for how long. */
const HISTORY_TURNS = 6;
const HISTORY_WINDOW_S = 24 * 60 * 60;
/** Stored chats are deleted after this many days. */
const RETENTION_DAYS = 30;
const HANDOFF = /\b(call me|human|agent|real person|talk to (a |the )?(person|team|someone|human))\b|baat karni|call kar/i;

type WaEnv = {
  WHATSAPP_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  CHAT_LIMITER?: RateLimit;
  DB?: D1Database;
  EMAIL?: SendEmail;
  CONTACT_SENDER?: string;
  CONTACT_NOTIFY_TO?: string;
};
const cfg = env as unknown as WaEnv;

type InboundMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
};
type Change = {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    contacts?: { profile?: { name?: string }; wa_id?: string }[];
    messages?: InboundMessage[];
  };
};
type Payload = { object?: string; entry?: { changes?: Change[] }[] };

const ok = () => new Response("OK", { status: 200, headers: { "Cache-Control": "no-store" } });

/* ---------- Meta verification ---------- */

export const GET: APIRoute = ({ url }) => {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = cfg.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && timingSafeEqual(token, expected) && /^[\w-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
};

/* ---------- Incoming messages ---------- */

export const POST: APIRoute = async ({ request }) => {
  const { WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID } = cfg;
  if (!WHATSAPP_TOKEN || !WHATSAPP_APP_SECRET || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn("whatsapp: secrets not set; ignoring webhook");
    return ok();
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  const signature = request.headers.get("X-Hub-Signature-256") ?? "";
  if (!(await validSignature(raw, signature, WHATSAPP_APP_SECRET))) {
    console.warn("whatsapp: bad signature");
    return new Response("Forbidden", { status: 403 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as Payload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (payload.object !== "whatsapp_business_account") return ok();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      // Only answer for our own number.
      if (value.metadata?.phone_number_id !== WHATSAPP_PHONE_NUMBER_ID) continue;
      const name = value.contacts?.[0]?.profile?.name ?? "";
      for (const msg of value.messages ?? []) {
        waitUntil(handle(msg, name).catch((err) => console.error("whatsapp: handle failed", err)));
      }
    }
  }
  return ok();
};

export const ALL: APIRoute = () => new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

/* ---------- One message ---------- */

async function handle(msg: InboundMessage, name: string) {
  if (!/^\d{6,16}$/.test(msg.from) || !msg.id) return;
  const db = cfg.DB;
  if (db) {
    await ensureTable(db);
    // Meta can deliver the same message more than once: reply only the first time.
    const ins = await db
      .prepare("INSERT OR IGNORE INTO wa_messages (id, wa_from, direction, body, created_at) VALUES (?1, ?2, 'in', ?3, ?4)")
      .bind(msg.id, msg.from, (msg.text?.body ?? `[${msg.type}]`).slice(0, 2000), now())
      .run();
    if (!ins.meta.changes) return;
  }

  await markRead(msg.id);

  if (msg.type !== "text" || !msg.text?.body?.trim()) {
    await reply(msg.from, "Thanks for your message! I can read text for now — please type your question and I’ll answer right away 🙂");
    return;
  }
  const text = msg.text.body.trim().slice(0, 600);

  if (cfg.CHAT_LIMITER) {
    const { success } = await cfg.CHAT_LIMITER.limit({ key: `wa:${msg.from}` });
    if (!success) return; // flooding: stay quiet rather than burn the AI allowance
  }

  const history = db ? await recentHistory(db, msg.from, msg.id) : [];
  const firstInWindow = history.length === 0;

  if (HANDOFF.test(text)) {
    await reply(msg.from, "Sure! I’ve passed your message to our team — someone will reply here or call you soon. 🙏");
    await notifyTeam(`WhatsApp: ${name || "Someone"} wants to talk to the team`, msg.from, name, text);
    return;
  }

  const answer =
    (await askDelta([...history, { role: "user", content: text }], "whatsapp")) ??
    "Thanks for your message! Our assistant is busy right now — a team member will reply to you here soon.";
  await reply(msg.from, answer);
  if (firstInWindow) await notifyTeam(`WhatsApp: new chat from ${name || `+${msg.from}`}`, msg.from, name, text, answer);
}

/* ---------- WhatsApp Cloud API calls ---------- */

async function graph(body: Record<string, unknown>) {
  try {
    const res = await fetch(`${GRAPH}/${cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error("whatsapp: graph error", res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (err) {
    console.error("whatsapp: graph request failed", err);
    return false;
  }
}

async function reply(to: string, text: string) {
  const sent = await graph({ recipient_type: "individual", to, type: "text", text: { body: text.slice(0, 4000), preview_url: true } });
  if (sent && cfg.DB) {
    await cfg.DB.prepare("INSERT INTO wa_messages (id, wa_from, direction, body, created_at) VALUES (?1, ?2, 'out', ?3, ?4)")
      .bind(`out-${crypto.randomUUID()}`, to, text.slice(0, 2000), now())
      .run();
  }
}

const markRead = (id: string) => graph({ status: "read", message_id: id });

/* ---------- Storage ---------- */

let tableReady = false;
async function ensureTable(db: D1Database) {
  if (tableReady) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS wa_messages (id TEXT PRIMARY KEY, wa_from TEXT NOT NULL, direction TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_wa_from_time ON wa_messages (wa_from, created_at)"),
    db.prepare("DELETE FROM wa_messages WHERE created_at < ?1").bind(now() - RETENTION_DAYS * 86400),
  ]);
  tableReady = true;
}

async function recentHistory(db: D1Database, from: string, currentId: string): Promise<ChatMessage[]> {
  const { results } = await db
    .prepare(
      "SELECT direction, body FROM wa_messages WHERE wa_from = ?1 AND id != ?2 AND created_at > ?3 ORDER BY created_at DESC LIMIT ?4",
    )
    .bind(from, currentId, now() - HISTORY_WINDOW_S, HISTORY_TURNS)
    .all<{ direction: string; body: string }>();
  return results
    .reverse()
    .map((r) => ({ role: r.direction === "in" ? "user" : "assistant", content: r.body.slice(0, 600) }) as ChatMessage);
}

/* ---------- Team notification (email) ---------- */

async function notifyTeam(subject: string, from: string, name: string, text: string, answer?: string) {
  if (!cfg.EMAIL || !cfg.CONTACT_SENDER || !cfg.CONTACT_NOTIFY_TO) return;
  const body = [
    `Name: ${name || "(not shared)"}`,
    `WhatsApp: +${from}  →  https://wa.me/${from}`,
    "",
    `They wrote:\n${text}`,
    answer ? `\nDelta replied:\n${answer}` : "",
  ].join("\n");
  try {
    await cfg.EMAIL.send({
      from: { name: "Delta AI WhatsApp", email: cfg.CONTACT_SENDER },
      to: cfg.CONTACT_NOTIFY_TO,
      subject: subject.slice(0, 150),
      text: body,
    });
  } catch (err) {
    console.error("whatsapp: notify email failed", err);
  }
}

/* ---------- Helpers ---------- */

const now = () => Math.floor(Date.now() / 1000);

async function validSignature(raw: ArrayBuffer, header: string, secret: string) {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, header.slice(7).toLowerCase());
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
