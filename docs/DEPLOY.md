# Delta AI — run, edit and deploy

Everything you need to run the site locally, change its content and deploy it on Cloudflare's free plan.

## Change content (no coding)

| To change… | Edit |
|---|---|
| Company name, hero text, email, phone, WhatsApp, GSTIN, socials, client names | `src/content/site.json` |
| A service | `src/content/services/<name>.md` |
| Add a service | Copy any file in `src/content/services/`, rename it, edit. Its page, menu link, footer link, sitemap entry and SEO tags appear automatically. |
| Hide a service without deleting it | Set `draft: true` |
| A case study | `src/content/work/<name>.md` (add `metrics` once you have real numbers; add `cover: ./screenshot.png` to show a screenshot) |
| Starter packages and prices | `packages.json` |
| Support plans, process steps, security list, FAQ | `plans.json`, `process.json`, `security.json`, `faq.json` |
| Open roles on /careers | `jobs.json` |
| An industry page | `src/content/industries/<name>.md` |
| Colours or fonts | `:root` block at the top of `src/styles/global.css` |
| Privacy / terms | `src/pages/privacy.md`, `src/pages/terms.md` (templates — have a lawyer review) |

If you make a mistake (a missing title, a summary that's too long, a bad URL), the build stops with a clear message and the live site stays as it was.

**Optional web editor:** sign in at [app.pagescms.org](https://app.pagescms.org) with GitHub and open this repo. The forms are defined in `.pages.yml`. Every save becomes a commit and Cloudflare redeploys automatically.

---

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars       # test keys for local use
npm run db:migrate:local             # creates the local leads table
npm run dev                          # http://localhost:4321
```

`npm run check` type-checks everything. `npm run build` produces `dist/`.

---

## Deploy for free — step by step

You need: a GitHub account, a free Cloudflare account, and your domain.

### 1. Domain
Buy the domain. **Cloudflare Registrar** sells at cost with no markup if it supports your extension; otherwise buy anywhere (GoDaddy, Hostinger, etc.), then in Cloudflare choose **Add a domain** (Free plan) and change the nameservers at your registrar to the two Cloudflare gives you.

Then put your domain in **three places**: `astro.config.mjs` (`SITE`), `public/.well-known/security.txt`, and the `SITE_URL` build variable in step 6.

### 2. Push this code to GitHub
Create an empty repo (e.g. `delta-ai-web`) and push this folder to it.

### 3. Create the database
```bash
npx wrangler login
npx wrangler d1 create delta-leads
```
Copy the `database_id` it prints into `wrangler.jsonc`, then:
```bash
npm run db:migrate:remote
```

### 4. Turnstile (free spam protection)
Cloudflare dashboard → **Turnstile** → **Add widget** → hostname = your domain, mode **Managed**. You get a **site key** (public) and a **secret key**.

### 5. Email
- **Receive** mail at `hello@yourdomain` for free: Cloudflare dashboard → your domain → **Email Routing** → forward to your Gmail.
- **Send** lead notifications: the Worker uses Cloudflare's `send_email` binding (free) to the verified address in `wrangler.jsonc` (`CONTACT_NOTIFY_TO`, sender `CONTACT_SENDER`). [Resend](https://resend.com) is an optional fallback — add a `RESEND_API_KEY` secret only if you want it.
- Update `contact.email` in `src/content/site.json`.

### 6. Connect Cloudflare to GitHub
Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick your repo.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Build variables:
  - `SITE_URL` = `https://yourdomain`
  - `PUBLIC_TURNSTILE_SITE_KEY` = your Turnstile site key

After the first deploy, open the Worker → **Settings → Variables and Secrets** and add these as **Secret**:
- `TURNSTILE_SECRET_KEY` — from step 4
- `IP_HASH_SALT` — any long random string (`openssl rand -hex 32`)
- `RESEND_API_KEY` — optional, see step 5

(Or from your terminal: `npx wrangler secret put TURNSTILE_SECRET_KEY`, etc.)

### 7. Attach your domain
Worker → **Settings → Domains & Routes → Add → Custom domain** → `yourdomain` (and `www.yourdomain` if you want). SSL is automatic.

From now on, every push to `main` (or every save in Pages CMS) redeploys in about a minute.

### 8. AI chat and demo (Workers AI)
Nothing to set up: the `AI` binding in `wrangler.jsonc` runs the website chat (`/api/chat`) and the "Try our AI" demo (`/api/extract`) on Cloudflare's free daily allowance. Change the model with the `CHAT_MODEL` variable.

### 9. WhatsApp auto-replies (optional)
`/api/whatsapp` answers messages sent to your WhatsApp Business number with the same assistant. It stays silent until these four secrets exist:

| Secret | Where it comes from |
|---|---|
| `WHATSAPP_TOKEN` | Meta Business Settings → System users → Generate token (`whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`) |
| `WHATSAPP_APP_SECRET` | Meta app → App settings → Basic → App secret |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Any long random phrase you choose |

Then in the Meta app → WhatsApp → Configuration → Webhook: callback URL `https://yourdomain/api/whatsapp`, the same verify phrase, and subscribe to **messages**. The number must not also be in use on the WhatsApp app.

### 10. Tell Google
- [Google Search Console](https://search.google.com/search-console) → add your domain → verify with the DNS record (add it in Cloudflare DNS) → **Sitemaps** → submit `sitemap-index.xml`.
- Create a free **Google Business Profile** for local search.

### Read your leads
Cloudflare dashboard → **D1** → `delta-leads` → **Console**:
```sql
SELECT id, created_at, name, email, service, budget, message FROM leads ORDER BY id DESC LIMIT 50;
```

---

## Read WhatsApp chats
```sql
SELECT wa_from, direction, body, datetime(created_at, 'unixepoch') AS at
FROM wa_messages ORDER BY created_at DESC LIMIT 50;
```
Chats are deleted automatically after 30 days.

---

## Free-plan limits (checked October 2026)

| Service | Free allowance | Used by |
|---|---|---|
| Cloudflare static assets | Unlimited requests and bandwidth | Every page view |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU each | Contact form, chat, demo, WhatsApp webhook |
| Cloudflare D1 | 5 GB storage, 100,000 writes/day | Saved leads |
| Cloudflare Turnstile, SSL, DNS, Email Routing | Free | Spam check, HTTPS, mail forwarding |
| Cloudflare Workers AI | Free daily allowance | Website chat, AI demo, WhatsApp replies |
| Resend (optional) | 3,000 emails/month, 100/day, 1 domain | Fallback for lead notifications |

The form also caps itself at 300 submissions a day and 3 per visitor per hour, so a spam wave can't exhaust any of these.

---

## Security checklist (what's already done)

- Content-Security-Policy with per-file hashes (Astro), plus HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, Permissions-Policy, strict referrer — see `public/_headers`
- No third-party scripts except Cloudflare Turnstile; fonts are self-hosted
- Chat and demo APIs: same-origin check, size limits, validation and per-visitor rate limits; nothing typed is stored
- WhatsApp webhook: every request verified with the Meta app secret (HMAC-SHA256), duplicate deliveries ignored, chats auto-deleted after 30 days
- Contact API: same-origin check, 16 KB body limit, schema validation, honeypot, Turnstile with action binding, per-IP and global rate limits, parameterised SQL, HTML-escaped emails
- Visitor IPs stored only as salted hashes
- Test Turnstile keys are refused in production, so the form can't go live unprotected by accident
- Secrets only in Cloudflare secrets / `.dev.vars` (git-ignored) — never in code
- CI runs type checks, build and `npm audit` on every push; Dependabot opens weekly update PRs
