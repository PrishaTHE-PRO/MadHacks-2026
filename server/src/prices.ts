// Reference prices for the price check (implementation spec §2.2).
//
// Best: live eBay listings for the item, via the eBay Browse API, when
// EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are set (free developer keys at
// developer.ebay.com). These are asking prices of active listings, not sold
// prices, so they run a little high. Otherwise: Claude's estimate, labeled as one.

import type { Confidence, Listing, PriceCheck } from "../../shared/types";

const MIN_COMPS = 5;
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export const ebayEnabled = () => Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

export interface AiPriceEstimate {
  typical_low: number | null;
  typical_high: number | null;
  confidence: Confidence;
  note: string;
}

/** Pick the best price reference available. Never throws. */
export async function priceReference(
  listing: Listing,
  opts: { searchQuery?: string; aiEstimate?: AiPriceEstimate },
): Promise<PriceCheck | undefined> {
  if (ebayEnabled() && listing.currency === "USD") {
    try {
      const comps = await ebayComps(opts.searchQuery || listing.title, listing);
      if (comps) return comps;
    } catch (err) {
      console.warn("[prices] eBay lookup failed, falling back:", err instanceof Error ? err.message : err);
    }
  }
  const est = opts.aiEstimate;
  if (est && (est.typical_low !== null || est.typical_high !== null)) {
    const lo = est.typical_low ?? est.typical_high!;
    const hi = est.typical_high ?? est.typical_low!;
    return {
      typicalLow: lo,
      typicalHigh: hi,
      median: (lo + hi) / 2,
      confidence: est.confidence,
      basis: "ai-estimate",
      note: est.note,
    };
  }
  return undefined;
}

// --- eBay Browse API ---

let token: { value: string; expiresAt: number } | null = null;

async function ebayToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`eBay token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function ebayComps(query: string, listing: Listing): Promise<PriceCheck | null> {
  const isNew = /^new\b/i.test(listing.condition ?? "");
  const params = new URLSearchParams({
    q: query.slice(0, 100),
    limit: "20",
    filter: `buyingOptions:{FIXED_PRICE},priceCurrency:USD,conditions:{${isNew ? "NEW" : "USED"}}`,
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${await ebayToken()}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`eBay search ${res.status}`);
  return compsFromBrowse(await res.json(), listing.platform === "ebay" ? listing.id : undefined);
}

interface BrowseResponse {
  itemSummaries?: { itemId?: string; legacyItemId?: string; price?: { value?: string; currency?: string } }[];
}

/** Turn a Browse API search response into a PriceCheck. Pure, for tests. */
export function compsFromBrowse(json: unknown, excludeItemId?: string): PriceCheck | null {
  const items = (json as BrowseResponse)?.itemSummaries ?? [];
  const prices = items
    .filter((it) => !excludeItemId || (it.legacyItemId !== excludeItemId && !it.itemId?.includes(`|${excludeItemId}|`)))
    .filter((it) => (it.price?.currency ?? "USD") === "USD")
    .map((it) => parseFloat(it.price?.value ?? ""))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length < MIN_COMPS) return null;

  const confidence: Confidence = prices.length >= 15 ? "high" : prices.length >= 8 ? "medium" : "low";
  return {
    typicalLow: round(quantile(prices, 0.25)),
    typicalHigh: round(quantile(prices, 0.75)),
    median: round(quantile(prices, 0.5)),
    confidence,
    basis: "ebay-listings",
    sampleSize: prices.length,
    note: `Based on ${prices.length} similar eBay listings (asking prices, not sold prices).`,
  };
}

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (n: number) => Math.round(n * 100) / 100;
