/**
 * POST /api/contact — the only server code on the site.
 *
 * Runs as a Cloudflare Worker (free plan: 100,000 requests/day).
 * Order of checks, cheapest first:
 *   same-origin → size → schema → honeypot → Turnstile → rate limit → save → email
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'astro/zod';

export const prerender = false;

const MAX_BODY_BYTES = 16 * 1024;
const PER_IP_PER_HOUR = 3;
const GLOBAL_PER_DAY = 300;
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
  company: clean(120).optional().default(''),
  service: z.string().regex(/^[a-z0-9-]{1,60}$/, 'Please choose a service.'),
  budget: clean(40).pipe(z.string().min(1)),
  message: clean(4000).pipe(z.string().min(10, 'Please add a few words about your project.')),
  website: z.string().max(200).optional().default(''), // honeypot
  page: z.string().max(200).optional().default('/'),
  token: z.string().min(1, 'Spam check missing. Please try again.').max(4096),
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

async function sendEmail(lead: Lead, id: number | null) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;
  const rows: [string, string][] = [
    ['Name', lead.name],
    ['Email', lead.email],
    ['Company', lead.company || '—'],
    ['Service', lead.service],
    ['Budget', lead.budget],
    ['Page', lead.page],
  ];
  const html = `
    <h2 style="font-family:sans-serif">New enquiry${id ? ` #${id}` : ''}</h2>
    <table style="font-family:sans-serif;font-size:14px">${rows
      .map(([k, v]) => `<tr><td style="color:#666;padding:4px 12px 4px 0">${k}</td><td>${escapeHtml(v)}</td></tr>`)
      .join('')}</table>
    <p style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(lead.message)}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM_EMAIL,
      to: [env.CONTACT_TO_EMAIL],
      reply_to: lead.email,
      subject: `New enquiry: ${lead.service} — ${lead.name}`.slice(0, 150),
      html,
    }),
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

  // 4. Honeypot: pretend success so bots learn nothing.
  if (parsed.website) return json(200, { message: 'Thanks! We’ll be in touch.' });

  const ip = request.headers.get('CF-Connecting-IP') ?? clientAddress ?? '';
  const country = request.headers.get('CF-IPCountry') ?? null;

  // 5. Bot check.
  const secret = env.TURNSTILE_SECRET_KEY;
  const host = new URL(request.url).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!secret || (TURNSTILE_TEST_SECRETS.has(secret) && !isLocal)) {
    console.error('TURNSTILE_SECRET_KEY missing or still a test key in production');
    return json(500, { message: 'Form is not configured yet. Please email us.' });
  }
  try {
    if (!(await verifyTurnstile(parsed.token, ip, secret))) {
      return json(400, { message: 'Spam check failed. Please refresh the page and try again.' });
    }
  } catch {
    return json(503, { message: 'Spam check is unavailable right now. Please try again shortly.' });
  }

  // 6. Rate limits (per visitor and overall, to protect the free tier).
  const db = env.DB;
  const ipHash = await sha256Hex(`${env.IP_HASH_SALT ?? ''}:${ip}`);
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

  // 8. Notify the team. A failed email never loses the lead — it's already saved.
  try {
    if (await sendEmail(parsed, id)) {
      if (id) await db.prepare('UPDATE leads SET emailed = 1 WHERE id = ?1').bind(id).run();
    }
  } catch (err) {
    console.error('email failed', err);
  }

  return json(200, { message: 'Thanks! We’ll reply within one business day.' });
};

export const ALL: APIRoute = () => json(405, { message: 'Method not allowed.' }, { Allow: 'POST' });
