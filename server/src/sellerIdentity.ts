// Who posted a page that shares this listing's photos or text?
//
// The rule the web checks rest on: a seller reusing their OWN photos or text
// (relisting, or crossposting to Depop and eBay) is normal. The same photo or
// description under a DIFFERENT account means the seller took it from
// someone else, which is a classic scam move.
//
// We find the other page's account three ways, cheapest first:
//   1. the URL itself (poshmark.com/closet/<user>, depop.com/products/<user>-...)
//   2. DealDig's own index (a listing someone already checked)
//   3. fetching the page and reading the seller link (Poshmark, eBay, Etsy, Mercari)
// When none works the owner is "unknown", and the rules count it for less.

import { parsePoshmarkHtml } from "../../extension/src/adapters/poshmark";
import { ebayItemId } from "../../extension/src/adapters/ebay";
import { facebookItemId } from "../../extension/src/adapters/facebook";
import type { CopyOwner, Listing, Platform, SiteKind } from "../../shared/types";
import { fetchHtml } from "./webFetch";

export interface SiteInfo {
  site: string; // hostname without www.
  siteName: string;
  kind: SiteKind;
}

const MARKETPLACES: Record<string, string> = {
  "poshmark.com": "Poshmark",
  "ebay.com": "eBay",
  "facebook.com": "Facebook",
  "depop.com": "Depop",
  "mercari.com": "Mercari",
  "etsy.com": "Etsy",
  "grailed.com": "Grailed",
  "vinted.com": "Vinted",
  "craigslist.org": "Craigslist",
  "offerup.com": "OfferUp",
  "therealreal.com": "The RealReal",
  "vestiairecollective.com": "Vestiaire Collective",
  "stockx.com": "StockX",
  "kijiji.ca": "Kijiji",
  "gumtree.com": "Gumtree",
  "carousell.com": "Carousell",
  "amazon.com": "Amazon",
  "walmart.com": "Walmart Marketplace",
};
const SOCIAL: Record<string, string> = {
  "instagram.com": "Instagram",
  "tiktok.com": "TikTok",
  "reddit.com": "Reddit",
  "pinterest.com": "Pinterest",
  "x.com": "X",
  "twitter.com": "X",
  "tumblr.com": "Tumblr",
  "flickr.com": "Flickr",
  "youtube.com": "YouTube",
  "threads.net": "Threads",
};
const STOCK = ["shutterstock.com", "istockphoto.com", "gettyimages.com", "stock.adobe.com", "alamy.com", "dreamstime.com", "depositphotos.com", "freepik.com", "unsplash.com", "pexels.com", "123rf.com", "pixabay.com"];
const AI_ART = ["civitai.com", "lexica.art", "openart.ai", "midjourney.com", "playground.com", "playgroundai.com", "nightcafe.studio", "krea.ai", "ideogram.ai", "leonardo.ai", "seaart.ai", "tensor.art", "pixai.art", "getimg.ai", "craiyon.com", "starryai.com"];

/** Domain suffix match: "m.ebay.com" and "ebay.co.uk" count as eBay. */
function lookup(host: string, table: Record<string, string>): string | undefined {
  for (const [domain, name] of Object.entries(table)) {
    const base = domain.split(".")[0];
    if (host === domain || host.endsWith(`.${domain}`)) return name;
    // Country sites: ebay.co.uk, ebay.de, etsy.ca ...
    if (MARKETPLACES === table && new RegExp(`(^|\\.)${base}\\.(co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})$`).test(host)) return name;
  }
  return undefined;
}

const matchesAny = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

export function siteInfo(url: string): SiteInfo {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { site: "", siteName: "a website", kind: "other" };
  }
  const market = lookup(host, MARKETPLACES);
  if (market) return { site: host, siteName: market, kind: "marketplace" };
  const social = lookup(host, SOCIAL);
  if (social) return { site: host, siteName: social, kind: "social" };
  if (matchesAny(host, STOCK)) return { site: host, siteName: host, kind: "stock" };
  if (matchesAny(host, AI_ART)) return { site: host, siteName: host, kind: "ai-art" };
  return { site: host, siteName: host, kind: "other" };
}

/** An account on some site: the platform's id when we have it, and the handle. */
export interface PageAccount {
  siteName: string;
  id?: string;
  username?: string;
}

/** Account readable from the URL alone (profile pages, Depop product slugs...). */
export function accountFromUrl(url: string): PageAccount | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const { siteName } = siteInfo(url);
  const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const host = u.hostname.toLowerCase();
  const first = parts[0]?.toLowerCase();
  const user = (username: string | undefined, id?: string): PageAccount | null =>
    username || id ? { siteName, username: username?.replace(/^@/, ""), id } : null;

  if (/(^|\.)poshmark\./.test(host) && first === "closet") return user(parts[1]);
  if (/(^|\.)ebay\./.test(host) && (first === "usr" || first === "str")) return user(parts[1]);
  if (/(^|\.)depop\.com$/.test(host)) {
    // depop.com/products/<username>-<item-slug>/ ; Depop handles have no hyphens.
    if (first === "products" && parts[1]) return user(parts[1].split("-")[0]);
    if (parts.length === 1 && !["search", "category", "products", "sell", "about", "help"].includes(first ?? "")) return user(parts[0]);
  }
  if (/(^|\.)mercari\.com$/.test(host) && first === "u") return user(undefined, parts[1]);
  if (/(^|\.)etsy\.com$/.test(host) && first === "shop") return user(parts[1]);
  if (/(^|\.)grailed\.com$/.test(host) && parts.length === 1) return user(parts[0]);
  if (/(^|\.)facebook\.com$/.test(host) && first === "marketplace" && parts[1] === "profile") return user(undefined, parts[2]);
  if (/(^|\.)instagram\.com$/.test(host) && parts.length >= 1 && !["p", "reel", "explore", "stories"].includes(first ?? "")) return user(parts[0]);
  if (/(^|\.)tiktok\.com$/.test(host) && parts[0]?.startsWith("@")) return user(parts[0]);
  if (/(^|\.)reddit\.com$/.test(host) && (first === "user" || first === "u")) return user(parts[1]);
  return null;
}

/** Read the seller off a fetched marketplace listing page. */
export function accountFromHtml(url: string, html: string): PageAccount | null {
  const { siteName } = siteInfo(url);
  if (siteName === "Poshmark") {
    const parsed = parsePoshmarkHtml(html, url);
    if (parsed?.seller.username || parsed?.seller.id) return { siteName, id: parsed.seller.id, username: parsed.seller.username };
  }
  const patterns: Record<string, RegExp[]> = {
    eBay: [/"sellerUserName"\s*:\s*"([^"]+)"/, /ebay\.[a-z.]+\/(?:usr|str)\/([A-Za-z0-9._-]+)/],
    Etsy: [/etsy\.com\/(?:[a-z-]+\/)?shop\/([A-Za-z0-9]+)/, /"shop_name"\s*:\s*"([^"]+)"/],
    Mercari: [/mercari\.com\/u\/(\d+)/, /"sellerId"\s*:\s*"?(\d+)/],
    Depop: [/depop\.com\/([a-z0-9_.]+)\/?"/],
    Grailed: [/"username"\s*:\s*"([^"]+)"/],
  };
  for (const re of patterns[siteName] ?? []) {
    const m = html.match(re);
    if (m?.[1]) return siteName === "Mercari" ? { siteName, id: m[1] } : { siteName, username: m[1] };
  }
  return null;
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^@/, "");

const PLATFORM_SITE: Record<Platform, string> = { poshmark: "Poshmark", ebay: "eBay", facebook: "Facebook", depop: "Depop" };

/** Compare an account to this listing's seller. */
export function compareAccount(listing: Listing, account: PageAccount | null): CopyOwner {
  if (!account) return "unknown";
  const me = listing.seller;
  const sameSite = account.siteName === PLATFORM_SITE[listing.platform];
  if (sameSite && account.id && me.id) return account.id === me.id ? "same-seller" : "other-seller";
  const theirName = norm(account.username);
  const myNames = [me.username, me.displayName].map(norm).filter(Boolean);
  if (!theirName) return "unknown";
  if (!myNames.length) return "unknown"; // can't tell without knowing who this seller is
  // Same handle on any site: almost always the seller crossposting.
  return myNames.includes(theirName) ? "same-seller" : "other-seller";
}

/** Is this URL the listing being checked (or one of its own photos' pages)? */
export function isSameListing(listing: Listing, url: string): boolean {
  const clean = (s: string) => s.split(/[?#]/)[0].replace(/\/$/, "").replace(/^https?:\/\/(www\.|m\.)?/, "").toLowerCase();
  if (clean(url) === clean(listing.url)) return true;
  if (listing.platform === "ebay") return ebayItemId(url) === listing.id;
  if (listing.platform === "facebook") return facebookItemId(url) === listing.id;
  if (listing.platform === "poshmark") return /poshmark\./.test(url) && url.includes(listing.id);
  return false;
}

/** A known account for a URL from DealDig's own index, if any listing there has it. */
export type IndexLookup = (url: string) => PageAccount | null;

export interface OwnerResult {
  owner: CopyOwner;
  username?: string;
}

/**
 * Work out who posted `url`, cheapest source first. Fetches only marketplace
 * listing pages, and only when `allowFetch` is set.
 */
export async function resolveOwner(
  listing: Listing,
  url: string,
  opts: { index?: IndexLookup; allowFetch?: boolean; fetchPage?: typeof fetchHtml } = {},
): Promise<OwnerResult> {
  const fromUrl = accountFromUrl(url);
  if (fromUrl) return { owner: compareAccount(listing, fromUrl), username: fromUrl.username ?? fromUrl.id };
  const fromIndex = opts.index?.(url);
  if (fromIndex) return { owner: compareAccount(listing, fromIndex), username: fromIndex.username ?? fromIndex.id };
  const { kind, siteName } = siteInfo(url);
  if (kind !== "marketplace" || !opts.allowFetch || siteName === "Facebook") return { owner: "unknown" };
  const page = await (opts.fetchPage ?? fetchHtml)(url);
  const fromPage = page ? accountFromHtml(page.url, page.html) : null;
  return fromPage ? { owner: compareAccount(listing, fromPage), username: fromPage.username ?? fromPage.id } : { owner: "unknown" };
}
