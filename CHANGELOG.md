# Changelog

All notable changes to [deltaaiinnovation.in](https://deltaaiinnovation.in).

## v1.0.0 — Delta AI goes live (October 2026)

### ✦ Added
- **AI assistant everywhere** — website chat and WhatsApp auto-replies in English, Hindi and Hinglish, answering only from the site's own content (Cloudflare Workers AI)
- **“Try our AI” demo** — turns a messy customer message into a clean booking and a reply in the customer's language
- **WhatsApp-first conversion** — page-aware floating button, package buttons with pre-filled messages, “Continue on WhatsApp” from the chat
- **Packages & pricing** — starter packages with starting prices, delivery times and GST notes; care plans from ₹1,499/month
- **Two clear paths** — ready-made packages for small businesses and custom software for growing companies
- **Scroll story, ownership section and partner programme** pages
- **Trust details** — Udyam and GST registration, business details, phone in the footer, nine FAQs

### ✦ Changed
- Plain-language service descriptions; claims limited to what we deliver today
- Contact form accepts any email and budgets from under ₹25,000
- Privacy policy covers the AI chat and WhatsApp

### ✦ Security
- WhatsApp webhook verified with HMAC-SHA256, duplicate deliveries ignored, chats deleted after 30 days
- Same-origin checks, size limits, validation and rate limits on every API route
- Hash-based Content-Security-Policy, HSTS and Turnstile on forms
