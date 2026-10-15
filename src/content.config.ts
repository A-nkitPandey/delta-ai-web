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
    /** Shown as a badge, e.g. "Live", "Product", "In development", "Client project". */
    status: z.string().optional(),
    /** Icon for the project card (any name from Icon.astro). */
    icon: z.string().optional(),
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

/** Job openings on /careers. Set "open": false to hide a role without deleting it. */
const jobs = defineCollection({
  loader: file('./src/content/jobs.json'),
  schema: z.object({
    title: z.string(),
    type: z.enum(['Full-time', 'Part-time', 'Internship', 'Contract']),
    location: z.string(),
    remote: z.boolean().default(false),
    duration: z.string().optional(),
    stipend: z.string().optional(),
    summary: z.string().max(240),
    responsibilities: z.array(z.string()).default([]),
    requirements: z.array(z.string()).default([]),
    open: z.boolean().default(true),
    datePosted: z.iso.date(),
    order: z.number().default(100),
  }),
});

/** One Markdown file per industry → /industries/<file-name> */
const industries = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/industries' }),
  schema: z.object({
    title: z.string(),
    headline: z.string(),
    summary: z.string().max(200),
    icon: z.string(),
    order: z.number().default(100),
    problems: z.array(z.string()).default([]),
    solutions: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    /** Service file names (e.g. booking-queue-saas) shown as related services. */
    services: z.array(z.string()).default([]),
    /** Optional case study file name (e.g. salon-token). */
    work: z.string().optional(),
    draft: z.boolean().default(false),
    seo,
  }),
});

export const collections = { services, work, plans, process, security, faq, jobs, industries };
