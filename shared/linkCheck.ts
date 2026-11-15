// Phishing link checks that run anywhere (extension and server), with no
// network: look-alike domains that pretend to be a brand people trust in a
// marketplace deal. The server adds domain age and Google Safe Browsing on top
// (server/src/links.ts).
//
// Pure TypeScript: no DOM, no Node APIs.

export type LookalikeKind = "impersonation" | "typo" | "punycode" | "ip" | "userinfo" | "redirect";

export interface LookalikeFinding {
  url: string;
  host: string;
  kind: LookalikeKind;
  brand?: string;
  /** One line for the user, naming the domain. */
  text: string;
}

interface Brand {
  name: string;
  /** Lowercase, no spaces or dots. Flagged anywhere in a domain ("zelle-payments-support.com"). */
  tokens: string[];
  /** Ordinary words ("apple") only count as the whole name, or one letter off, never inside other words. */
  exact?: string[];
  domains: string[];
}

// Brands a scammer would copy in a marketplace or payment chat, with their real domains.
export const BRANDS: Brand[] = [
  { name: "Facebook", tokens: ["facebook", "messenger"], domains: ["facebook.com", "fb.com", "fb.me", "messenger.com", "meta.com", "fbcdn.net"] },
  { name: "PayPal", tokens: ["paypal"], domains: ["paypal.com", "paypal.me", "paypalobjects.com"] },
  { name: "Venmo", tokens: ["venmo"], domains: ["venmo.com"] },
  { name: "Zelle", tokens: ["zelle", "zellepay"], domains: ["zellepay.com", "zelle.com"] },
  { name: "Cash App", tokens: ["cashapp"], domains: ["cash.app", "cashapp.com", "square.com", "squareup.com"] },
  { name: "Apple", tokens: ["icloud", "applepay", "appleid"], exact: ["apple"], domains: ["apple.com", "icloud.com"] },
  { name: "Google", tokens: ["google", "gmail"], domains: ["google.com", "gmail.com", "goo.gl", "googleusercontent.com", "g.co"] },
  { name: "Amazon", tokens: ["amazonpay", "amazonsupport"], exact: ["amazon"], domains: ["amazon.com", "amzn.to", "amazon.co.uk"] },
  { name: "eBay", tokens: ["ebay"], domains: ["ebay.com", "ebay.co.uk", "ebay.ca", "ebay.com.au", "ebayimg.com"] },
  { name: "Poshmark", tokens: ["poshmark"], domains: ["poshmark.com", "posh.mk"] },
  { name: "Etsy", tokens: ["etsy"], domains: ["etsy.com", "etsy.me"] },
  { name: "Depop", tokens: ["depop"], domains: ["depop.com"] },
  { name: "Mercari", tokens: ["mercari"], domains: ["mercari.com"] },
  { name: "OfferUp", tokens: ["offerup"], domains: ["offerup.com"] },
  { name: "Craigslist", tokens: ["craigslist"], domains: ["craigslist.org"] },
  { name: "USPS", tokens: ["usps"], domains: ["usps.com"] },
  { name: "UPS", tokens: ["upsdelivery", "upsshipping"], domains: ["ups.com"] },
  { name: "FedEx", tokens: ["fedex"], domains: ["fedex.com"] },
  { name: "DHL", tokens: ["dhlexpress", "dhlparcel"], domains: ["dhl.com"] },
  { name: "Chase", tokens: ["chasebank", "chaseonline"], exact: ["chase"], domains: ["chase.com"] },
  { name: "Bank of America", tokens: ["bankofamerica"], domains: ["bankofamerica.com", "bofa.com"] },
  { name: "Wells Fargo", tokens: ["wellsfargo"], domains: ["wellsfargo.com"] },
  { name: "Capital One", tokens: ["capitalone"], domains: ["capitalone.com"] },
  { name: "Western Union", tokens: ["westernunion"], domains: ["westernunion.com", "wu.com"] },
  { name: "Coinbase", tokens: ["coinbase"], domains: ["coinbase.com"] },
  { name: "Zillow", tokens: ["zillow"], domains: ["zillow.com"] },
];

// Two-part endings, so "paypal-help.co.uk" reduces to "paypal-help", not "co".
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.in", "co.jp", "com.br", "com.mx", "co.za", "com.cn"]);

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Lowercase ASCII hostname of a link, punycode included (xn--...). Null if it isn't a valid link. */
export function hostOfLink(raw: string): string | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    // URL() turns "раураl.com" (Cyrillic) into "xn--80aa0cbo65f.com".
    return new URL(withScheme).hostname.toLowerCase().replace(/\.+$/, "") || null;
  } catch {
    return null;
  }
}

/** "login.paypal-help.co.uk" → "paypal-help.co.uk": the part someone actually registered. */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** "https://x.com/pay?id=5#a" → "https://x.com/pay": what we send to Safe Browsing (no personal query params). */
export function stripQuery(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return raw;
  }
}

const isIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

/** Undo the usual look-alike swaps: 0→o, 1→l, rn→m, vv→w... and drop hyphens and dots. */
export function skeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[0]/g, "o")
    .replace(/[1|!]/g, "l")
    .replace(/3/g, "e")
    .replace(/4|@/g, "a")
    .replace(/5|\$/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/[^a-z]/g, "");
}

/** Edit distance where swapping two neighbouring letters counts as one edit ("vemno" → "venmo"). Capped at max+1. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return Math.min(d[a.length][b.length], max + 1);
}

// One letter off for names of 5+ letters, two for long ones. Shorter names
// ("ebay", "etsy") only match through look-alike swaps (eb4y), or too many
// ordinary words would look like typos.
const typoBudget = (len: number) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

/** Is this host one of a brand's real domains (any brand)? */
export const isOfficialDomain = (host: string) => BRANDS.some((b) => b.domains.some((d) => onDomain(host, d)));

/** Look-alike finding for one link, or null for real brand domains and ordinary sites. */
export function checkLookalike(url: string, depth = 0): LookalikeFinding | null {
  const host = hostOfLink(url);
  if (!host) return null;
  let parsed: URL | null = null;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
  } catch {
    /* hostOfLink already validated it */
  }

  // "https://www.paypal.com@evil.xyz/" really goes to evil.xyz.
  if (parsed?.username) {
    return {
      url,
      host,
      kind: "userinfo",
      text: `This link really goes to ${registrableDomain(host)}. The part before the "@" is a disguise.`,
    };
  }
  if (isIp(host)) {
    return { url, host, kind: "ip", text: `This link goes to a bare number address (${host}) instead of a website name, a common phishing trick.` };
  }
  if (isOfficialDomain(host)) {
    // A real site that forwards you on (google.com/url?q=...): check where it forwards to.
    if (depth === 0 && parsed) {
      for (const value of parsed.searchParams.values()) {
        if (!/^https?:\/\//i.test(value)) continue;
        const inner = checkLookalike(value, 1);
        const innerHost = hostOfLink(value);
        if (inner) return { ...inner, url, kind: "redirect", text: `This ${registrableDomain(host)} link forwards you on. ${inner.text}` };
        if (innerHost && !isOfficialDomain(innerHost))
          return { url, host, kind: "redirect", text: `This ${registrableDomain(host)} link quietly forwards you to ${registrableDomain(innerHost)}.` };
      }
    }
    return null;
  }

  const registrable = registrableDomain(host);
  const dot = registrable.indexOf(".");
  const name = dot > 0 ? registrable.slice(0, dot) : registrable;
  // Everything before the ending: "paypal.secure-login.xyz" → "paypal.secure-login".
  const beforeEnding = host.slice(0, host.length - (registrable.length - name.length));

  if (host.split(".").some((l) => l.startsWith("xn--"))) {
    return { url, host, kind: "punycode", text: `${registrable} uses look-alike letters from another alphabet to imitate a real site name.` };
  }

  const whole = skeleton(beforeEnding);
  const nameSkel = skeleton(name);
  const plain = beforeEnding.replace(/[^a-z]/g, "");
  const impersonates = (brand: Brand, token: string): LookalikeFinding => ({
    url,
    host,
    kind: "impersonation",
    brand: brand.name,
    text: `${registrable} ${plain.includes(token) ? "uses the name" : "imitates"} ${brand.name} but isn't ${brand.name}'s real site.`,
  });

  for (const brand of BRANDS) {
    for (const token of brand.tokens) if (whole.includes(token)) return impersonates(brand, token);
    for (const token of [...brand.tokens, ...(brand.exact ?? [])]) {
      if (nameSkel === token) return impersonates(brand, token);
      const budget = typoBudget(token.length);
      if (!budget || nameSkel[0] !== token[0] || Math.abs(nameSkel.length - token.length) > 1) continue;
      const d = editDistance(nameSkel, token, budget);
      if (d > 0 && d <= budget) {
        return {
          url,
          host,
          kind: "typo",
          brand: brand.name,
          text: `${registrable} is a near-copy of ${brand.name}'s name. Look-alike spellings are a common phishing trick.`,
        };
      }
    }
  }
  return null;
}
