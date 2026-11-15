// A plain-data snapshot of a marketplace page, plus helpers adapters share.
//
// Sites like Facebook and eBay render listings into the live DOM, so the
// content script copies the parts we care about into a `PageData` object
// (see content/collect.ts). Adapters only ever see this object, never the
// DOM, so they stay pure functions that can be tested in Node.
//
// Stable hooks first: JSON-LD and og: meta tags, then aria-labels and link
// targets, then text patterns as a last resort.

export interface PageLink {
  href: string;
  text: string;
  label?: string; // aria-label
}

export interface PageImage {
  src: string;
  alt: string;
  width: number; // rendered size in CSS px
  height: number;
  linkHref?: string; // href of the closest <a>, if the image is inside one
}

/** A section of the page an adapter asked for by CSS selector (e.g. the seller card). */
export interface PageSection {
  text: string;
  links: PageLink[];
  /** aria-labels in the section (its own first), for values only shown as icons, e.g. "shop rating 5 stars". */
  labels?: string[];
}

export interface PageData {
  url: string;
  documentTitle: string;
  meta: Record<string, string>; // <meta property|name> → content
  jsonLd: unknown[]; // parsed <script type="application/ld+json"> blocks
  text: string; // innerText of the listing root
  headings: string[]; // h1/h2 text inside the root, in order
  links: PageLink[];
  images: PageImage[];
  sections: Record<string, PageSection | undefined>;
}

export const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };

/** "$1,200", "US $25.00", "€30" → { amount, currency }. "Free" → 0. */
export function parsePrice(raw: string | number | undefined | null): { amount: number; currency?: string } | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? { amount: raw } : undefined;
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^free$/i.test(s)) return { amount: 0 };
  const m = s.match(/(?:([A-Z]{2,3})\s*)?([$€£¥₹])?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (!m) return undefined;
  const amount = parseFloat(m[3].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  const code = m[1] && m[1].length === 3 ? m[1] : undefined;
  return { amount, currency: code ?? (m[2] ? CURRENCY_SYMBOLS[m[2]] : undefined) };
}

/** Find the first JSON-LD node whose @type matches, looking inside arrays and @graph. */
export function findJsonLd(blocks: unknown[], type: string): Record<string, unknown> | undefined {
  const stack = [...blocks];
  while (stack.length) {
    const node = stack.shift();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (t === type || (Array.isArray(t) && t.includes(type))) return obj;
    if (obj["@graph"]) stack.push(obj["@graph"]);
  }
  return undefined;
}

export const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export const toInt = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const m = s.trim().match(/^([\d.,]+)\s*([KkMm])?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return Math.round(n * mult);
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mar 2014", "March 2014", "2014" → ISO date for the start of that period. */
export function parseMonthYear(s: string): { iso: string; precision: "month" | "year" } | undefined {
  const m = s.trim().match(/^(?:([A-Za-z]{3,9})\.?\s+)?(\d{4})$/);
  if (!m) return undefined;
  const year = Number(m[2]);
  if (!m[1]) return { iso: `${year}-01-01`, precision: "year" };
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month === -1) return undefined;
  return { iso: `${year}-${String(month + 1).padStart(2, "0")}-01`, precision: "month" };
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** "3 days", "a week", "about an hour", "over a year" → ISO timestamp that long before `now`. */
export function relativeAgo(s: string, now = Date.now()): string | undefined {
  const m = s
    .toLowerCase()
    .match(/(?:about |over |almost )?(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_MS[m[2]]).toISOString();
}

export const dedupe = (xs: string[]): string[] => [...new Set(xs)];
