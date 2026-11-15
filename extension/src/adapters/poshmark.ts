// Poshmark adapter: turns a listing page's HTML into a `Listing`.
//
// Poshmark server-renders every listing with its full data in an inline
// `window.__INITIAL_STATE__={...}` script. That script deletes itself from the
// DOM right after it runs, so a content script can't read it from the page.
// Instead we re-fetch the page HTML (same origin, cheap) and parse it here.
// This is a pure function with no DOM access, so it can be tested in Node.

import type { Listing } from "../../../shared/types";

const STATE_MARKER = "window.__INITIAL_STATE__=";
const IMAGE_HOST = "https://di2ponv0v5otw.cloudfront.net/";

export function isPoshmarkListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)poshmark\.com$/.test(u.hostname) && u.pathname.startsWith("/listing/");
  } catch {
    return false;
  }
}

/** Pull the JSON object that follows `marker` out of a blob of HTML. */
export function extractJsonAfter(html: string, marker: string): unknown | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const open = html.indexOf("{", start + marker.length);
  if (open === -1) return null;

  // Walk braces while respecting strings, so `}` inside text doesn't end early.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(open, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Poshmark stores condition as a short code. Unknown codes are shown as-is.
const CONDITIONS: Record<string, string> = {
  nwt: "New with tags",
  ret: "Boutique / retail",
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function parsePoshmarkHtml(html: string, pageUrl: string): Listing | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = extractJsonAfter(html, STATE_MARKER) as any;
  const details = state?.["$_listing_details"];
  const d = details?.listingDetails;
  if (!d?.id) return null;

  const lister = details.listerData ?? {};
  const agg = lister.aggregates ?? {};
  const profile = lister.profile_v2 ?? {};

  const photos: string[] = [d.cover_shot, ...(d.pictures ?? [])]
    .filter(Boolean)
    .map((p: { path_large?: string; path?: string; url_large?: string; url?: string }) => p.url_large ?? p.path_large ?? p.url ?? p.path)
    .filter((p: unknown): p is string => typeof p === "string")
    .map((p: string) => (p.startsWith("http") ? p : IMAGE_HOST + p));

  const originalPrice = num(d.original_price_amount?.val ?? d.original_price);
  const username: string = lister.username ?? d.creator_username ?? "";

  return {
    platform: "poshmark",
    id: d.id,
    url: pageUrl.split("?")[0],
    title: d.title ?? "",
    description: d.description ?? "",
    brand: d.brand ?? d.brand_obj?.canonical_name,
    category: [d.department?.display, d.category_v2?.display ?? d.category]
      .filter(Boolean)
      .join(" > "),
    condition: d.condition ? CONDITIONS[d.condition] ?? d.condition : undefined,
    size: d.size_obj?.display ?? d.size,
    price: num(d.price_amount?.val ?? d.price) ?? 0,
    originalPrice: originalPrice && originalPrice > 0 ? originalPrice : undefined,
    currency: d.price_amount?.currency_code ?? "USD",
    photos: [...new Set(photos)],
    listedAt: d.first_published_at ?? d.created_at,
    likes: num(d.like_count ?? d.aggregates?.likes),
    comments: num(d.comment_count ?? d.aggregates?.comments),
    status: d.inventory?.status,
    seller: {
      platform: "poshmark",
      id: lister.id ?? d.creator_id,
      username,
      displayName: lister.full_name ?? d.creator_full_name,
      profileUrl: `https://poshmark.com/closet/${username}`,
      joinedAt: lister.created_at,
      lastActiveAt: lister.last_active_at,
      location: [profile.city, profile.state].filter(Boolean).join(", ") || undefined,
      ordersShipped: num(agg.seller_orders_shipped),
      fiveStarReviews: num(agg.seller_5_star_rating_comment_count),
      listingsCount: num(agg.posts),
      followers: num(agg.followers),
      itemsSoldDisplay: agg.items_sold_display,
    },
  };
}
