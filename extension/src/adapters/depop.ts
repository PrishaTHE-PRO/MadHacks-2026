// Depop adapter: turns a depop.com/products/<slug>/ page into a `Listing`.
//
// Depop's class names are build hashes that change on every deploy, so this
// reads only stable hooks (see server/test/fixtures/depop-listing.html):
//   - JSON-LD Product: description, photos, price, currency, condition, brand
//   - the h1 title, data-testid="productPrimaryAttributes" ("Size S • Like new condition")
//   - the seller card: the "<user>'s shop" link, "194 sold", "Active today",
//     the "shop rating 5 stars" aria-label and the "(49)" review count
//   - the "Ask a question" link, which carries the seller and product ids
//
// Depop changes pages without reloading, so JSON-LD is only trusted when its
// URL is the current page; otherwise the on-screen values are used.

import type { Listing } from "../../../shared/types";
import { asArray, findJsonLd, parsePrice, relativeAgo, str, toInt, type PageData, type PageSection } from "./page";

/** Parts of the page the content script copies for this adapter (content/collect.ts). */
export const DEPOP_SECTIONS: Record<string, string> = {
  title: "h1",
  price: '[aria-description^="Price"]',
  attributes: '[data-testid="productPrimaryAttributes"]',
  // The block holding the "<user>'s shop" link, the sold/active line and the rating.
  seller: `div:has(> a[aria-label$="'s shop"])`,
  breadcrumbs: '[class*="breadcrumbsList"]',
  likes: '[data-testid="like-count"]',
  photos: '[data-testid="desktop"]',
};

/** depop.com/products/<username>-<item-slug>/, but not the sell flow (/products/create, /products/edit/...). */
export function isDepopListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !/(^|\.)depop\.com$/.test(u.hostname)) return false;
    const m = u.pathname.match(/^\/products\/([^/]+)\/?$/);
    return Boolean(m && !["create", "edit"].includes(m[1]));
  } catch {
    return false;
  }
}

const slugOf = (url: string) => new URL(url).pathname.match(/^\/products\/([^/]+)/)?.[1] ?? "";

const CONDITIONS: Record<string, string> = {
  NewCondition: "New",
  UsedCondition: "Used",
  RefurbishedCondition: "Refurbished",
  DamagedCondition: "Damaged",
};

/** Depop's name for items without a brand. */
const NO_BRAND = /^(other|unbranded)$/i;

/** "today", "yesterday", "this week", "2 weeks ago" → an ISO date (approximate). */
function activeAt(when: string, now: number): string | undefined {
  const w = when.toLowerCase().trim();
  const days = w === "today" ? 0 : w === "yesterday" ? 1 : w === "this week" ? 7 : w === "this month" ? 30 : undefined;
  if (days !== undefined) return new Date(now - days * 86_400_000).toISOString();
  return relativeAgo(w, now);
}

/** "194 sold", "1.2k sold", "500+ sold" → 194, 1200, 500. */
const soldCount = (text: string) => toInt(text.match(/([\d.,]+\s*[kKmM]?)\+?\s*sold\b/)?.[1]?.replace(/\s+/g, ""));

function readSeller(section: PageSection | undefined, now: number) {
  if (!section) return {};
  const shop = section.links.find((l) => l.label?.endsWith("'s shop"));
  const username = shop?.label?.replace(/'s shop$/, "") || shop?.text || undefined;
  const rating = section.labels
    ?.map((l) => l.match(/shop rating ([\d.]+) stars?/i)?.[1])
    .find(Boolean);
  const reviews = section.text.match(/\(([\d.,]+\s*[kKmM]?)\)/)?.[1];
  const active = section.text.match(/Active\s+([^\n·]+?)\s*(?:\n|·|\(|$)/i)?.[1];
  return {
    username,
    rating: rating ? parseFloat(rating) : undefined,
    // Only say "no reviews" when the page says so: missing stars may just not have loaded yet.
    reviewsCount: reviews ? toInt(reviews.replace(/\s+/g, "")) : /\bno reviews\b/i.test(section.text) ? 0 : undefined,
    itemsSold: soldCount(section.text),
    lastActiveAt: active ? activeAt(active, now) : undefined,
  };
}

/** Breadcrumbs: Home › Brands › <brand> › Women › Tops › Shirts → brand and "Women > Tops > Shirts". */
function readBreadcrumbs(section: PageSection | undefined) {
  if (!section) return {};
  const brandLink = section.links.find((l) => /\/brands\/[^/]+\/?$/.test(new URL(l.href).pathname));
  const crumbs = section.text
    .split(/\n|›|>/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Category crumbs are the /c/... links plus the last crumb (the current page, not a link).
  const categoryLinks = section.links.filter((l) => /\/c\//.test(l.href)).map((l) => l.text);
  const last = crumbs.at(-1);
  const category = [...categoryLinks, ...(last && !categoryLinks.includes(last) && last !== brandLink?.text ? [last] : [])];
  return {
    brand: brandLink && !NO_BRAND.test(brandLink.text) && !/unbranded/.test(brandLink.href) ? brandLink.text : undefined,
    category: category.length ? category.join(" > ") : undefined,
  };
}

export function parseDepopPage(page: PageData, now = Date.now()): Listing | null {
  if (!isDepopListingUrl(page.url)) return null;
  const url = page.url.split(/[?#]/)[0];
  const slug = slugOf(url);

  // JSON-LD, only if it describes this page (it can lag behind client-side navigation).
  const ld = findJsonLd(page.jsonLd, "Product");
  const offer = asArray(ld?.offers as Record<string, unknown> | Record<string, unknown>[])[0];
  const fresh = Boolean(ld && typeof offer?.url === "string" && slugOf(offer.url) === slug);
  const product = fresh ? ld : undefined;

  const s = page.sections;
  const title = str(s.title?.text) ?? str(product?.name);
  const price = parsePrice(product ? (offer?.price as string) : s.price?.text);
  if (!title || !price) return null;

  // "Size S • Like new condition"
  const attrs = (s.attributes?.text ?? "").split(/[•\n]/).map((a) => a.trim()).filter(Boolean);
  const size = attrs.find((a) => /^size\b/i.test(a))?.replace(/^size\s*/i, "");
  const conditionText = attrs.find((a) => /condition$/i.test(a)); // "Like new condition"
  const ldCondition = typeof offer?.itemCondition === "string" ? offer.itemCondition.split("/").pop() : undefined;

  // Ids from the "Ask a question" / shop links: ?userId=<seller>&productId=<item>.
  const params = page.links
    .filter((l) => /depop\.com\/(messages\/create|[^/]+\/\?)/.test(l.href) && /productId=/.test(l.href))
    .map((l) => new URL(l.href).searchParams);
  const productId = params.map((p) => p.get("productId")).find(Boolean);
  const sellerIdFromLink = params.map((p) => p.get("userId")).find(Boolean);

  const photos = product
    ? asArray(product.image as string | string[]).filter((p): p is string => typeof p === "string")
    : page.images.map((i) => i.src).filter((src) => /media-photos\.depop\.com/.test(src));
  // Photo URLs carry the seller's id: media-photos.depop.com/r1/<sellerId>/...
  const sellerIdFromPhoto = photos.map((p) => p.match(/media-photos\.depop\.com\/\w+\/(\d+)\//)?.[1]).find(Boolean);

  const seller = readSeller(s.seller, now);
  // Fallback for the username: og:description ends "Sold by @<user>", but only
  // trust og tags that describe this page. Never the URL slug: it can be off by a character.
  const ogFresh = page.meta["og:url"] && slugOf(page.meta["og:url"]) === slug;
  const ogUser = ogFresh ? page.meta["og:description"]?.match(/Sold by @([\w.]+)\s*$/)?.[1] : undefined;
  const crumbs = readBreadcrumbs(s.breadcrumbs);
  const ldBrand = str((product?.brand as { name?: string } | undefined)?.name);
  const username = seller.username ?? ogUser ?? "";

  return {
    platform: "depop",
    id: productId ?? slug,
    url,
    title,
    description: str(product?.description) ?? "",
    brand: crumbs.brand ?? (ldBrand && !NO_BRAND.test(ldBrand) ? ldBrand : undefined),
    category: crumbs.category,
    condition: conditionText ?? (ldCondition ? CONDITIONS[ldCondition] : undefined),
    size,
    price: price.amount,
    currency: (product && str(offer?.priceCurrency)) || price.currency || "USD",
    photos: [...new Set(photos)],
    likes: toInt(s.likes?.text),
    status:
      typeof offer?.availability === "string"
        ? /InStock/.test(offer.availability)
          ? "available"
          : /SoldOut|OutOfStock/.test(offer.availability)
            ? "sold"
            : undefined
        : undefined,
    seller: {
      platform: "depop",
      id: sellerIdFromLink ?? sellerIdFromPhoto ?? "",
      username,
      profileUrl: username ? `https://www.depop.com/${username}/` : "",
      lastActiveAt: seller.lastActiveAt,
      rating: seller.rating,
      reviewsCount: seller.reviewsCount,
      itemsSold: seller.itemsSold,
    },
  };
}
