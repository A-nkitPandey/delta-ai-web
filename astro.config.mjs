// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// Your live domain. Change it once here; canonical URLs, sitemap and
// social preview links all follow it.
const SITE = process.env.SITE_URL ?? 'https://deltaaiinnovation.in';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  // Pages are pre-built HTML by default. Only files that opt out with
  // `export const prerender = false` (the contact API) run as a Worker.
  output: 'static',
  adapter: cloudflare({
    // Optimise images at build time: no paid Cloudflare Images binding needed.
    imageService: 'compile',
  }),
  // No sessions needed, so no KV namespace is created.
  session: false,
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
  ],
  security: {
    // Astro writes a Content-Security-Policy with hashes for every
    // script and style it ships, so nothing inline runs unless we wrote it.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        'frame-src https://challenges.cloudflare.com',
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ],
      scriptDirective: {
        resources: ["'self'", 'https://challenges.cloudflare.com'],
      },
    },
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
});
