import { z } from 'astro/zod';
import raw from '../content/site.json';

/** Company-wide settings: name, contact details, hero copy. Edit src/content/site.json. */
const optionalUrl = z.union([z.url(), z.literal('')]).default('');

const SiteSchema = z.object({
  name: z.string(),
  legalName: z.string(),
  tagline: z.string(),
  description: z.string().max(170),
  announcement: z
    .object({ label: z.string(), text: z.string(), href: z.string() })
    .optional(),
  /** Shown instead of the announcement while at least one role on /careers is open. */
  hiring: z
    .object({ show: z.boolean().default(true), label: z.string().default('HIRING'), text: z.string() })
    .optional(),
  hero: z.object({
    before: z.string(),
    accent: z.string(),
    /** Optional words the accent cycles through (first one should match accent). */
    rotate: z.array(z.string()).default([]),
    after: z.string(),
    intro: z.string(),
    primaryCta: z.string(),
    secondaryCta: z.string(),
  }),
  stack: z.array(z.string()),
  clients: z.array(z.string()),
  contact: z.object({
    email: z.email(),
    phone: z.string().default(''),
    whatsapp: z.string().regex(/^\d*$/, 'WhatsApp number: digits only, with country code, e.g. 919876543210').default(''),
    city: z.string(),
    replyPromise: z.string(),
  }),
  social: z.object({
    linkedin: optionalUrl,
    github: optionalUrl,
    x: optionalUrl,
    instagram: optionalUrl,
  }),
  foundingYear: z.number().int(),
  udyam: z.string().optional().default(''),
  /** GST number, shown on /about and in the footer. */
  gstin: z.string().regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN must be 15 characters').default(''),
  /** Public area of the place of business (no street address). */
  area: z.string().default(''),
  /** Shown on /about. Leave out to hide the founder card. */
  founder: z
    .object({ name: z.string(), role: z.string(), bio: z.string(), initials: z.string().max(3) })
    .optional(),
  team: z.object({
    headline: z.string(),
    intro: z.string(),
    disciplines: z.array(z.string()),
  }),
});

export const site = SiteSchema.parse(raw);
export type Site = typeof site;
