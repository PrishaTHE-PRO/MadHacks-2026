// Link guard decisions, with no chrome.* calls so Node tests can import them.
// The guard only looks at pages opened FROM a marketplace tab or chat: the
// rest of the user's browsing is never checked or sent anywhere.

import { hostOfLink, registrableDomain } from "../../shared/linkCheck";

/** Sites whose tabs are guarded: a link opened from one of these gets checked. */
const MARKETPLACES = [
  "poshmark.com",
  "ebay.com",
  "facebook.com",
  "messenger.com",
  "etsy.com",
  "depop.com",
  "mercari.com",
  "offerup.com",
  "craigslist.org",
];

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function isMarketplaceUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (/^http:\/\/localhost:8787\/demo\//.test(url)) return true; // the demo chat page
  const host = /^https?:\/\//i.test(url) ? hostOfLink(url) : null;
  return !!host && MARKETPLACES.some((d) => onDomain(host, d));
}

// Link redirectors that wrap the real destination in a query parameter.
const REDIRECTORS: { host: RegExp; path: RegExp; param: string }[] = [
  { host: /^(l|lm)\.facebook\.com$/, path: /^\/l\.php/, param: "u" },
  { host: /^l\.messenger\.com$/, path: /^\/l\.php/, param: "u" },
  { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url/, param: "q" },
  { host: /^rover\.ebay\.com$/, path: /^\/rover\//, param: "mpre" },
];

/** "l.facebook.com/l.php?u=https%3A%2F%2Fevil.xyz" → "https://evil.xyz". Other links unchanged. */
export function unwrapRedirector(url: string): string {
  try {
    const u = new URL(url);
    const r = REDIRECTORS.find((x) => x.host.test(u.hostname) && x.path.test(u.pathname));
    const inner = r ? u.searchParams.get(r.param) : null;
    return inner && /^https?:\/\//i.test(inner) ? inner : url;
  } catch {
    return url;
  }
}

/**
 * Should the guard check this page load? Only when it starts from a
 * marketplace (or a tab opened from one) and goes somewhere else.
 * Returns the real destination to check, or null.
 */
export function destinationToCheck(opts: { fromUrl?: string; toUrl: string; guardedTab: boolean }): string | null {
  if (!opts.guardedTab && !isMarketplaceUrl(opts.fromUrl)) return null;
  const target = unwrapRedirector(opts.toUrl);
  if (!/^https?:\/\//i.test(target)) return null; // chrome://, extension pages, about:blank
  if (isMarketplaceUrl(target)) return null;
  return target;
}

export const domainOf = (url: string) => {
  const host = hostOfLink(url);
  return host ? registrableDomain(host) : null;
};

/** Stable positive rule id for a domain (declarativeNetRequest ids are 32-bit ints). */
export function ruleIdFor(domain: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) h = Math.imul(h ^ domain.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 2_000_000_000) + 1;
}

export interface BlockedInfo {
  url: string;
  domain: string;
  reasons: string[];
}

/** The extension's warning page for a blocked site. */
export function blockedPagePath(info: BlockedInfo): string {
  const q = new URLSearchParams({ url: info.url, domain: info.domain, reasons: JSON.stringify(info.reasons.slice(0, 4)) });
  return `blocked.html?${q.toString()}`;
}
