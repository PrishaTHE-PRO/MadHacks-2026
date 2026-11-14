// Facebook Marketplace adapter: item pages (facebook.com/marketplace/item/<id>) → `Listing`.
//
// Facebook's class names are obfuscated and change often, so this never uses
// them. It reads, in order of trust:
//   1. og: meta tags, but only when og:url points at this same item (in the
//      single-page app they go stale as you click between listings);
//   2. the first heading (title), links to /marketplace/profile/<id> (seller);
//   3. text patterns Facebook shows to every user: "$120", "Listed 3 days ago
//      in Madison, WI", "Condition", "Joined Facebook in 2015".

import type { Listing } from "../../../shared/types";
import { dedupe, lines, parsePrice, relativeAgo, str, type PageData } from "./page";

const ITEM_PATH = /^\/marketplace\/(?:[^/]+\/)?item\/(\d+)/;

export function facebookItemId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.|web\.|m\.)?facebook\.com$/.test(u.hostname)) return null;
    return u.pathname.match(ITEM_PATH)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const isFacebookListingUrl = (url: string) => facebookItemId(url) !== null;

const PRICE_LINE = /^(?:[A-Z]{2,3}\s?)?[$€£¥₹]\s?\d[\d,]*(?:\.\d{1,2})?\b|^Free$/;
const LISTED_LINE = /^Listed\s+(.+?)\s+ago(?:\s+in\s+(.+))?$/i;
// Lines that end the description block.
const DESCRIPTION_STOP =
  /^(See (less|more|translation)|Location is approximate|Seller (information|details)|Today's picks|Send seller a message|Send|Message|Save|Share|Sponsored|Hello, is this still available\?)$/i;
const SELLER_MARKER = /^Seller (information|details)$/i;
const NOT_A_NAME = /^(Seller (information|details)|See profile|Follow|Message|View profile)$/i;

export function parseFacebookPage(page: PageData, now = Date.now()): Listing | null {
  const id = facebookItemId(page.url);
  if (!id) return null;

  const ogMatches = (page.meta["og:url"] ?? "").includes(id);
  const og = (k: string) => (ogMatches ? str(page.meta[k]) : undefined);
  const text = lines(page.text);

  // --- Price: the first price-looking line on the item, which sits right under the title.
  const priceIdx = text.findIndex((l) => PRICE_LINE.test(l));
  const price = priceIdx === -1 ? undefined : parsePrice(text[priceIdx].match(PRICE_LINE)![0]);

  // --- Title: first heading, else og:title, else the line just above the price.
  const title =
    page.headings.find((h) => h && !/^(Marketplace|Notifications|Chats?)$/i.test(h)) ??
    og("og:title")?.replace(/\s*\|\s*Facebook( Marketplace)?\s*$/i, "") ??
    (priceIdx > 0 ? text[priceIdx - 1] : undefined);
  if (!title || !price) return null;

  // --- "Listed 3 days ago in Madison, WI"
  let listedAt: string | undefined;
  let location: string | undefined;
  for (const l of text) {
    const m = l.match(LISTED_LINE);
    if (m) {
      listedAt = relativeAgo(m[1], now);
      location = m[2]?.trim();
      break;
    }
  }

  // --- Details: "Condition" then its value, then the description until a stop line.
  let condition: string | undefined;
  let descStart = -1;
  const condIdx = text.findIndex((l) => /^Condition$/i.test(l));
  if (condIdx !== -1 && text[condIdx + 1]) {
    condition = text[condIdx + 1];
    descStart = condIdx + 2;
  } else {
    const detailsIdx = text.findIndex((l) => /^(Details|Description|Seller's description)$/i.test(l));
    if (detailsIdx !== -1) descStart = detailsIdx + 1;
  }
  const desc: string[] = [];
  if (descStart !== -1) {
    for (let i = descStart; i < text.length && !DESCRIPTION_STOP.test(text[i]); i++) desc.push(text[i]);
  }
  const description = desc.join("\n") || og("og:description") || "";

  // --- Seller: the profile link, and what follows "Seller information".
  const sellerLink = page.links.find((l) => /\/marketplace\/profile\/\d+/.test(l.href) && !NOT_A_NAME.test(l.text));
  const anyProfileLink = sellerLink ?? page.links.find((l) => /\/marketplace\/profile\/\d+/.test(l.href));
  const sellerId = anyProfileLink?.href.match(/\/marketplace\/profile\/(\d+)/)?.[1] ?? "";
  const sellerIdx = text.findIndex((l) => SELLER_MARKER.test(l));
  const sellerBlock = sellerIdx === -1 ? [] : text.slice(sellerIdx + 1, sellerIdx + 15);
  const displayName =
    str(sellerLink?.text) ?? str(sellerLink?.label) ?? sellerBlock.find((l) => !NOT_A_NAME.test(l) && !/\d/.test(l));

  const joinedYear = page.text.match(/Joined Facebook in (\d{4})/i)?.[1];
  let ratingsCount: number | undefined;
  if (sellerBlock.some((l) => /^No ratings yet$/i.test(l))) ratingsCount = 0;
  else {
    const r = sellerBlock.map((l) => l.match(/^\((\d[\d,]*)\)$/)?.[1]).find(Boolean);
    if (r) ratingsCount = parseInt(r.replace(/,/g, ""), 10);
  }

  // --- Photos: large fbcdn images that aren't links to other listings (the
  // "Today's picks" grid) and aren't avatars. Fall back to og:image.
  const photos = page.images
    .filter(
      (img) =>
        /fbcdn\.net|scontent/.test(img.src) &&
        !/\/marketplace\/item\//.test(img.linkHref ?? "") &&
        !/\/profile|profile picture/i.test(`${img.linkHref ?? ""} ${img.alt}`) &&
        (Math.min(img.width, img.height) >= 200 || /^thumbnail/i.test(img.alt)),
    )
    .map((img) => img.src);
  const ogImage = og("og:image");
  if (!photos.length && ogImage) photos.push(ogImage);

  return {
    platform: "facebook",
    id,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    title,
    description,
    condition,
    price: price.amount,
    currency: price.currency ?? "USD",
    photos: dedupe(photos).slice(0, 10),
    listedAt,
    location,
    seller: {
      platform: "facebook",
      id: sellerId,
      username: displayName ?? "",
      displayName,
      profileUrl: sellerId ? `https://www.facebook.com/marketplace/profile/${sellerId}/` : "",
      joinedAt: joinedYear ? `${joinedYear}-01-01` : undefined,
      joinedPrecision: joinedYear ? "year" : undefined,
      ratingsCount,
    },
  };
}
