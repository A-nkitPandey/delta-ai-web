import { site } from './site';

/** Business WhatsApp number, digits only with country code (from site.json). Empty when not set. */
export const waNumber = site.contact.whatsapp;

/** A wa.me link that opens WhatsApp with `text` already typed. Empty string when no number is set. */
export const waLink = (text?: string) =>
  waNumber ? `https://wa.me/${waNumber}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
