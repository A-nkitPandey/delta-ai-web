# Delta AI — company website

Fast, SEO-friendly, secure company site for **Delta AI** (Delta AI Innovation).
Built with **Astro 7** and deployed on **Cloudflare's free plan** — the only paid item is your domain.

- Pages are pre-built HTML: ~11 KB per page (gzipped) and ~2.5 KB of JavaScript in total.
- All text lives in content files, so the site changes without touching code.
- One small serverless function handles the contact form (validation, spam check, rate limit, database, email).

---

## Architecture

```
Visitor ──► Cloudflare edge (free SSL, CDN, firewall)
              │
              ├── Static pages & assets  ─────────── free and unlimited
              │     dist/client  (HTML, CSS, fonts, images)
              │
              └── /api/contact  (Cloudflare Worker) ── 100,000 requests/day free
                    1. same-origin + size check
                    2. schema validation (zod)
                    3. honeypot
                    4. Turnstile bot check ─────────► challenges.cloudflare.com
                    5. rate limit (per visitor + per day)
                    6. save lead ───────────────────► D1 database (5 GB free)
                    7. notify team ─────────────────► Resend (3,000 emails/month free)
```

**Front end** — `src/`

| Path | What it is |
|---|---|
| `src/content/` | **All site content.** Edit these, not the code. |
| `src/content.config.ts` | Schemas that validate content at build time |
| `src/components/` | Reusable sections (Hero, Services, Plans, Contact…) |
| `src/layouts/` | Page shells; `BaseLayout` adds SEO tags and header/footer |
| `src/pages/` | Routes. `services/[slug]` and `work/[slug]` generate one page per content file |
| `src/styles/global.css` | Design tokens (colours, fonts, radii) and shared styles |
| `public/` | Files served as-is: icons, social image, `_headers` (security headers) |

**Back end** — `src/pages/api/contact.ts` + `migrations/` (database schema).

**Future growth.** When a client project needs your .NET 10 API, deploy it as its own service and call it from the site or from a new Astro endpoint. Nothing here needs to be rewritten.

---

## Change content (no coding)

| To change… | Edit |
|---|---|
| Company name, hero text, email, phone, WhatsApp, socials, client names | `src/content/site.json` |
| A service | `src/content/services/<name>.md` |
| Add a service | Copy any file in `src/content/services/`, rename it, edit. Its page, menu link, footer link, sitemap entry and SEO tags appear automatically. |
| Hide a service without deleting it | Set `draft: true` |
| A case study | `src/content/work/<name>.md` (add `metrics` once you have real numbers; add `cover: ./screenshot.png` to show a screenshot) |
| Support plans, process steps, security list, FAQ | `plans.json`, `process.json`, `security.json`, `faq.json` |
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
- **Send** form notifications: sign up at [resend.com](https://resend.com), add your domain (it gives DNS records — add them in Cloudflare DNS), and create an API key.
- In `wrangler.jsonc` set `CONTACT_TO_EMAIL` (where leads go) and `CONTACT_FROM_EMAIL` (e.g. `Delta AI Website <website@yourdomain>`). Update `contact.email` in `src/content/site.json`.

### 6. Connect Cloudflare to GitHub
Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick your repo.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Build variables:
  - `SITE_URL` = `https://yourdomain`
  - `PUBLIC_TURNSTILE_SITE_KEY` = your Turnstile site key

After the first deploy, open the Worker → **Settings → Variables and Secrets** and add these as **Secret**:
- `TURNSTILE_SECRET_KEY` — from step 4
- `RESEND_API_KEY` — from step 5
- `IP_HASH_SALT` — any long random string (`openssl rand -hex 32`)

(Or from your terminal: `npx wrangler secret put TURNSTILE_SECRET_KEY`, etc.)

### 7. Attach your domain
Worker → **Settings → Domains & Routes → Add → Custom domain** → `yourdomain` (and `www.yourdomain` if you want). SSL is automatic.

From now on, every push to `main` (or every save in Pages CMS) redeploys in about a minute.

### 8. Tell Google
- [Google Search Console](https://search.google.com/search-console) → add your domain → verify with the DNS record (add it in Cloudflare DNS) → **Sitemaps** → submit `sitemap-index.xml`.
- Create a free **Google Business Profile** for local search.

### Read your leads
Cloudflare dashboard → **D1** → `delta-leads` → **Console**:
```sql
SELECT id, created_at, name, email, service, budget, message FROM leads ORDER BY id DESC LIMIT 50;
```

---

## Free-plan limits (checked October 2026)

| Service | Free allowance | Used by |
|---|---|---|
| Cloudflare static assets | Unlimited requests and bandwidth | Every page view |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU each | Contact form only |
| Cloudflare D1 | 5 GB storage, 100,000 writes/day | Saved leads |
| Cloudflare Turnstile, SSL, DNS, Email Routing | Free | Spam check, HTTPS, mail forwarding |
| Resend | 3,000 emails/month, 100/day, 1 domain | Lead notifications |

The form also caps itself at 300 submissions a day and 3 per visitor per hour, so a spam wave can't exhaust any of these.

---

## Security checklist (what's already done)

- Content-Security-Policy with per-file hashes (Astro), plus HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, Permissions-Policy, strict referrer — see `public/_headers`
- No third-party scripts except Cloudflare Turnstile; fonts are self-hosted
- Contact API: same-origin check, 16 KB body limit, schema validation, honeypot, Turnstile with action binding, per-IP and global rate limits, parameterised SQL, HTML-escaped emails
- Visitor IPs stored only as salted hashes
- Test Turnstile keys are refused in production, so the form can't go live unprotected by accident
- Secrets only in Cloudflare secrets / `.dev.vars` (git-ignored) — never in code
- CI runs type checks, build and `npm audit` on every push; Dependabot opens weekly update PRs
