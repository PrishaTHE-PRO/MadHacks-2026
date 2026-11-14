// eBay adapter: item pages (ebay.com/itm/<id>) → `Listing`.
//
// eBay server-renders a schema.org Product in JSON-LD with the title, price,
// condition and photos, so that's the primary source. Seller details aren't
// in the JSON-LD; they come from the seller card section (links to /usr/ or
// /str/, plus "99.8% positive" style text).

import type { Listing } from "../../../shared/types";
import {
  asArray,
  dedupe,
  findJsonLd,
  lines,
  parseMonthYear,
  parsePrice,
  str,
  toInt,
  type PageData,
  type PageLink,
} from "./page";

const ITEM_PATH = /^\/itm\/(?:[^/]+\/)?(\d{9,})/;

export function isEbayListingUrl(url: string): boolean {
  return ebayItemId(url) !== null;
}

export function ebayItemId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)ebay\.com$/.test(u.hostname)) return null;
    return u.pathname.match(ITEM_PATH)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** CSS selectors the content script collects as named sections for this adapter. */
export const EBAY_SECTIONS = {
  seller: [
    '[data-testid="x-sellercard-atf"]',
    ".x-sellercard-atf",
    '[data-testid="ux-seller-section"]',
    ".ux-seller-section",
    ".x-about-this-seller",
  ].join(", "),
  photos: ['[data-testid="ux-image-carousel"]', ".ux-image-carousel", "#PicturePanel"].join(", "),
};

// Schema.org enum URLs → words a buyer reads.
const AVAILABILITY: Record<string, string> = {
  InStock: "available",
  LimitedAvailability: "available",
  OutOfStock: "sold",
  SoldOut: "sold",
  Discontinued: "ended",
};
const CONDITION: Record<string, string> = {
  NewCondition: "New",
  UsedCondition: "Used",
  RefurbishedCondition: "Refurbished",
  DamagedCondition: "For parts or not working",
};
const enumName = (v: unknown) => str(v)?.split("/").pop();

/** eBay photo URLs carry a size (s-l500); ask for the largest version instead. */
const fullSize = (url: string) => url.replace(/\/s-l\d+\./, "/s-l1600.");
const photoKey = (url: string) => url.match(/\/images\/g\/([^/]+)\//)?.[1] ?? url;

function sellerFromLinks(links: PageLink[]): { username: string; displayName?: string } | undefined {
  for (const l of links) {
    const m = l.href.match(/ebay\.com\/usr\/([^/?#]+)/);
    if (m) return { username: decodeURIComponent(m[1]), displayName: l.text || undefined };
  }
  for (const l of links) {
    const m = l.href.match(/[?&]_ssn=([^&#]+)/);
    if (m) return { username: decodeURIComponent(m[1]) };
  }
  for (const l of links) {
    const m = l.href.match(/ebay\.com\/str\/([^/?#]+)/);
    if (m) return { username: decodeURIComponent(m[1]), displayName: l.text || undefined };
  }
  return undefined;
}

export function parseEbayPage(page: PageData): Listing | null {
  const id = ebayItemId(page.url);
  if (!id) return null;

  const product = findJsonLd(page.jsonLd, "Product");
  const offer = asArray(product?.offers as unknown)[0] as Record<string, unknown> | undefined;

  const title = (str(product?.name) ?? str(page.meta["og:title"]) ?? page.headings[0] ?? "")
    .replace(/\s*\|\s*eBay\s*$/i, "")
    .trim();

  const price =
    parsePrice(offer?.price as string | number | undefined) ??
    parsePrice(page.meta["product:price:amount"]) ??
    parsePrice(page.text.match(/(?:US|C|AU)?\s?\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0]);
  if (!title || !price) return null;
  const currency = str(offer?.priceCurrency) ?? str(page.meta["product:price:currency"]) ?? price.currency ?? "USD";

  // Photos: JSON-LD first, then og:image, then the image carousel on the page.
  const carousel = page.images.filter((img) => /ebayimg\.com/.test(img.src)).map((img) => img.src);
  const ldImages = asArray(product?.image as unknown).map((img) =>
    typeof img === "string" ? img : str((img as Record<string, unknown>)?.url ?? (img as Record<string, unknown>)?.contentUrl),
  );
  const seen = new Set<string>();
  const photos = [...ldImages, page.meta["og:image"], ...carousel]
    .filter((u): u is string => typeof u === "string" && /^https?:/.test(u))
    .map(fullSize)
    .filter((u) => {
      const k = photoKey(u);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // Seller: the seller card if we found it, otherwise the whole page.
  const sellerText = page.sections.seller?.text ?? page.text;
  const seller = sellerFromLinks(page.sections.seller?.links ?? []) ?? sellerFromLinks(page.links);
  const positive = sellerText.match(/(\d{1,3}(?:\.\d+)?)%\s*positive/i);
  // Feedback score is shown in parentheses after the name: "bikeshop_mad (1,234)".
  const feedback = sellerText.match(/\(\s*([\d,]+)\s*\)/);
  const sold = sellerText.match(/([\d.,]+\s*[KkMm]?)\s+items?\s+sold/i);
  const joinedRaw = sellerText.match(/(?:Joined|Member since)\s*:?\s*([A-Za-z]{3,9}\.?\s+\d{4}|\d{4})/i)?.[1];
  const joined = joinedRaw ? parseMonthYear(joinedRaw) : undefined;
  const location = lines(page.text)
    .map((l) => l.match(/^Located in:?\s*(.+)$/i)?.[1])
    .find(Boolean);

  const brandField = product?.brand as unknown;
  const brand = str(brandField) ?? str((brandField as Record<string, unknown> | undefined)?.name);
  const username = seller?.username ?? "";

  return {
    platform: "ebay",
    id,
    url: `https://www.ebay.com/itm/${id}`,
    title,
    description: str(product?.description) ?? str(page.meta["og:description"]) ?? "",
    brand,
    category: str(product?.category),
    condition: CONDITION[enumName(offer?.itemCondition) ?? ""] ?? enumName(offer?.itemCondition),
    price: price.amount,
    currency,
    photos: dedupe(photos),
    location,
    status: AVAILABILITY[enumName(offer?.availability) ?? ""],
    seller: {
      platform: "ebay",
      id: username,
      username,
      displayName: seller?.displayName && seller.displayName !== username ? seller.displayName : undefined,
      profileUrl: username ? `https://www.ebay.com/usr/${encodeURIComponent(username)}` : "",
      joinedAt: joined?.iso,
      joinedPrecision: joined?.precision,
      positiveFeedbackPercent: positive ? parseFloat(positive[1]) : undefined,
      feedbackScore: toInt(feedback?.[1]),
      itemsSoldDisplay: sold?.[1].replace(/\s+/g, ""),
    },
  };
}
