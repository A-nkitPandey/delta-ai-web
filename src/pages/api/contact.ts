/**
 * POST /api/contact — the only server code on the site.
 *
 * Runs as a Cloudflare Worker (free plan: 100,000 requests/day).
 * Order of checks, cheapest first:
 *   same-origin → size → schema → honeypot/timing → Turnstile (when configured)
 *   → rate limit → save → email
 *
 * Email goes out through Cloudflare Email Routing's send_email binding (free,
 * to the verified destination in wrangler.jsonc). Resend is used instead if a
 * RESEND_API_KEY secret is ever added.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'astro/zod';

export const prerender = false;

const MAX_BODY_BYTES = 16 * 1024;
const PER_IP_PER_HOUR = 3;
const GLOBAL_PER_DAY = 300;
/** Humans take a few seconds to fill the form; instant submissions are bots. */
const MIN_FILL_MS = 3000;
const TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

const clean = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // Strip control characters (keep newlines and tabs).
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));

const LeadSchema = z.object({
  name: clean(100).pipe(z.string().min(2, 'Please enter your name.')),
  email: z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address.').max(200)),
  company: clean(300).optional().default(''), // company, or profile link for job applications
  service: z.string().regex(/^[a-z0-9-]{1,60}$/, 'Please choose a service.'),
  budget: clean(40).pipe(z.string().min(1)),
  message: clean(4000).pipe(z.string().min(10, 'Please add a few words about your project.')),
  website: z.string().max(200).optional().default(''), // honeypot
  page: z.string().max(200).optional().default('/'),
  token: z.string().max(4096).optional().default(''),
  t: z.coerce.number().int().nonnegative().optional().default(0), // ms the form was open
});

type Lead = z.infer<typeof LeadSchema>;

function json(status: number, body: Record<string, unknown>, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function verifyTurnstile(token: string, ip: string, secret: string) {
  // Cloudflare's documented test secrets always pass ("1x…") or fail ("2x…", "3x…").
  // Answer locally so development works offline; production refuses them (see POST).
  if (TURNSTILE_TEST_SECRETS.has(secret)) return secret.startsWith('1x');

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  form.append('idempotency_key', crypto.randomUUID());

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  const out = (await res.json()) as { success: boolean; action?: string; 'error-codes'?: string[] };
  if (!out.success) return false;
  // Make sure the token was issued for this form, not reused from another widget.
  if (out.action && out.action !== 'contact') return false;
  return true;
}

const isApplication = (lead: Lead) => lead.service.startsWith('careers-');

function leadSummary(lead: Lead, id: number | null) {
  const job = isApplication(lead);
  const kind = job ? 'job application' : 'enquiry';
  const rows: [string, string][] = [
    ['Name', lead.name],
    ['Email', lead.email],
    [job ? 'Profile / resume' : 'Company', lead.company || '—'],
    [job ? 'Role' : 'Service', job ? lead.service.slice('careers-'.length).replaceAll('-', ' ') : lead.service],
    [job ? 'Experience' : 'Budget', lead.budget],
    ['Page', lead.page],
  ];
  const subject = (job ? `New job application: ${rows[3][1]} — ${lead.name}` : `New enquiry: ${lead.service} — ${lead.name}`).slice(0, 150);
  const text = `New website ${kind}${id ? ` #${id}` : ''}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${lead.message}\n\nReply to this email to answer ${lead.name} directly.`;
  const html = `
    <h2 style="font-family:sans-serif">New ${kind}${id ? ` #${id}` : ''}</h2>
    <table style="font-family:sans-serif;font-size:14px">${rows
      .map(([k, v]) => `<tr><td style="color:#666;padding:4px 12px 4px 0">${k}</td><td>${escapeHtml(v)}</td></tr>`)
      .join('')}</table>
    <p style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(lead.message)}</p>
    <p style="font-family:sans-serif;font-size:12px;color:#666">Reply to this email to answer ${escapeHtml(lead.name)} directly.</p>`;
  return { subject, text, html };
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** Raw MIME for older runtimes that only accept EmailMessage. */
function buildMime(from: string, to: string, replyTo: string, subject: string, text: string) {
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  return [
    `From: Delta AI Website <${from}>`,
    `To: <${to}>`,
    `Reply-To: <${replyTo}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Message-ID: <${crypto.randomUUID()}@deltaaiinnovation.in>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

async function sendEmail(lead: Lead, id: number | null): Promise<boolean> {
  const { subject, text, html } = leadSummary(lead, id);
  const from = env.CONTACT_SENDER;
  const to = env.CONTACT_NOTIFY_TO;

  // 1) Cloudflare Email Routing (free, no extra account).
  if (env.EMAIL && to) {
    try {
      await env.EMAIL.send({ from: { name: 'Delta AI Website', email: from }, to, replyTo: lead.email, subject, text, html });
      return true;
    } catch (err) {
      console.error('send_email (builder) failed, trying raw MIME', err);
      try {
        const { EmailMessage } = await import('cloudflare:email');
        await env.EMAIL.send(new EmailMessage(from, to, buildMime(from, to, lead.email, subject, text)));
        return true;
      } catch (err2) {
        console.error('send_email (raw) failed', err2);
      }
    }
  }

  // 2) Resend, if an API key is ever configured.
  const apiKey = (env as { RESEND_API_KEY?: string }).RESEND_API_KEY;
  if (!apiKey) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM_EMAIL, to: [env.CONTACT_TO_EMAIL], reply_to: lead.email, subject, html }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // 1. Only accept posts from our own pages.
  const origin = request.headers.get('Origin');
  const self = new URL(request.url).origin;
  if (!origin || origin !== self) return json(403, { message: 'Forbidden.' });

  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    return json(415, { message: 'Unsupported content type.' });
  }

  // 2. Size limit.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { message: 'Message too long.' });

  // 3. Schema.
  let parsed: Lead;
  try {
    const result = LeadSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      return json(400, { message: result.error.issues[0]?.message ?? 'Please check the form and try again.' });
    }
    parsed = result.data;
  } catch {
    return json(400, { message: 'Invalid request.' });
  }

  // Job applications must include a link to a profile, portfolio or resume.
  if (isApplication(parsed) && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(parsed.company)) {
    return json(400, { message: 'Please add an https:// link to your LinkedIn, portfolio or resume.' });
  }

  // 4. Honeypot and fill-time trap: pretend success so bots learn nothing.
  if (parsed.website || parsed.t < MIN_FILL_MS) return json(200, { message: 'Thanks! We’ll be in touch.' });

  const ip = request.headers.get('CF-Connecting-IP') ?? clientAddress ?? '';
  const country = request.headers.get('CF-IPCountry') ?? null;

  // 5. Turnstile bot check — enforced once a real secret is configured.
  //    Until then the honeypot, fill-time trap and rate limits protect the form.
  const secret = (env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY;
  const host = new URL(request.url).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const turnstileOn = !!secret && (!TURNSTILE_TEST_SECRETS.has(secret) || isLocal);
  if (turnstileOn) {
    if (!parsed.token) return json(400, { message: 'Spam check missing. Please try again.' });
    try {
      if (!(await verifyTurnstile(parsed.token, ip, secret))) {
        return json(400, { message: 'Spam check failed. Please refresh the page and try again.' });
      }
    } catch {
      return json(503, { message: 'Spam check is unavailable right now. Please try again shortly.' });
    }
  }

  // 6. Rate limits (per visitor and overall, to protect the free tier).
  const db = env.DB;
  const ipHash = await sha256Hex(`${(env as { IP_HASH_SALT?: string }).IP_HASH_SALT ?? 'delta-ai'}:${ip}`);
  const [perIp, perDay] = await db.batch<{ n: number }>([
    db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')`).bind(ipHash),
    db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now', '-1 day')`),
  ]);
  if ((perIp.results[0]?.n ?? 0) >= PER_IP_PER_HOUR) {
    return json(429, { message: 'You’ve sent a few requests already. Please email us directly.' }, { 'Retry-After': '3600' });
  }
  if ((perDay.results[0]?.n ?? 0) >= GLOBAL_PER_DAY) {
    return json(429, { message: 'We’re receiving a lot of requests. Please email us directly.' }, { 'Retry-After': '3600' });
  }

  // 7. Save. Parameterised queries only — never string-built SQL.
  const insert = await db
    .prepare(
      `INSERT INTO leads (name, email, company, service, budget, message, source_page, ip_hash, country)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
    )
    .bind(parsed.name, parsed.email, parsed.company || null, parsed.service, parsed.budget, parsed.message, parsed.page, ipHash, country)
    .first<{ id: number }>();
  const id = insert?.id ?? null;

  // 8. Notify the team. The lead is already saved; if the email can't go out,
  //    ask the visitor to write directly so nothing slips through unseen.
  let emailed = false;
  try {
    emailed = await sendEmail(parsed, id);
    if (emailed && id) await db.prepare('UPDATE leads SET emailed = 1 WHERE id = ?1').bind(id).run();
  } catch (err) {
    console.error('email failed', err);
  }
  if (!emailed) {
    return json(502, { message: `We couldn’t send that just now. Please email us at ${env.CONTACT_TO_EMAIL}.` });
  }

  return json(200, {
    message: isApplication(parsed)
      ? 'Thanks for applying! We read every application and will get back to you if there’s a fit.'
      : 'Thanks! We’ve received your request and will reply within one business day.',
  });
};

export const ALL: APIRoute = () => json(405, { message: 'Method not allowed.' }, { Allow: 'POST' });
