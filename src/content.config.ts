/**
 * Content model for the whole site.
 *
 * Everything a visitor reads comes from files under `src/content/`.
 * Add, edit or remove a file and the matching pages, menus, sitemap and
 * SEO tags update on the next build. The schemas below stop a typo
 * (a missing title, a bad URL) from ever reaching production: the build
 * fails with a clear message instead.
 */
import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

export const ICONS = ['ai', 'apps', 'payments', 'modernize', 'systems', 'calendar', 'shield', 'chart', 'cloud'] as const;

const seo = z
  .object({
    title: z.string().max(70).optional(),
    description: z.string().max(170).optional(),
  })
  .optional();

/** One Markdown file per service → /services/<file-name> */
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(200),
    icon: z.enum(ICONS),
    tags: z.array(z.string()).max(4).default([]),
    order: z.number().default(100),
    featured: z.boolean().default(false),
    deliverables: z.array(z.string()).default([]),
    idealFor: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    seo,
  }),
});

/** One Markdown file per case study → /work/<file-name> */
const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    // Optional screenshot (put the file next to the .md). Without one, the
    // built-in live-queue phone mock is shown.
    cover: image().optional(),
    coverAlt: z.string().optional(),
    headline: z.string(),
    accentWord: z.string().optional(),
    client: z.string(),
    url: z.url().optional(),
    summary: z.string().max(320),
    industry: z.string(),
    tags: z.array(z.string()).max(4).default([]),
    metrics: z
      .array(z.object({ value: z.string(), label: z.string() }))
      .max(4)
      .default([]),
    services: z.array(z.string()).default([]),
    order: z.number().default(100),
    featured: z.boolean().default(false),
    year: z.number().int().optional(),
    draft: z.boolean().default(false),
    seo,
  }),
});

/** Support / care plans shown on the home page. */
const plans = defineCollection({
  loader: file('./src/content/plans.json'),
  schema: z.object({
    name: z.string(),
    blurb: z.string(),
    price: z.string(),
    period: z.string().optional(),
    features: z.array(z.string()).min(1),
    cta: z.string(),
    highlighted: z.boolean().default(false),
    badge: z.string().optional(),
    order: z.number().default(100),
  }),
});

/** Steps in "How we work". */
const process = defineCollection({
  loader: file('./src/content/process.json'),
  schema: z.object({
    title: z.string(),
    text: z.string(),
    order: z.number(),
  }),
});

/** Security promises. */
const security = defineCollection({
  loader: file('./src/content/security.json'),
  schema: z.object({
    title: z.string(),
    text: z.string(),
    order: z.number(),
  }),
});

/** Frequently asked questions (also published as FAQ rich results). */
const faq = defineCollection({
  loader: file('./src/content/faq.json'),
  schema: z.object({
    question: z.string(),
    answer: z.string(),
    order: z.number(),
  }),
});

export const collections = { services, work, plans, process, security, faq };
