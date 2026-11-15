// Reverse image search: is this listing's photo elsewhere on the internet?
//
// Uses Google Cloud Vision's Web Detection (GOOGLE_VISION_API_KEY), which
// returns the pages that show the same image. For each page we work out who
// posted it (sellerIdentity.ts):
//   - this seller's own listing or profile: fine, it's crossposting
//   - another seller or account: the photo came from someone else
//   - a stock photo or AI-art site: noted with the page as proof
// The photo itself goes to Google; that's the only place it is sent.

import type { Listing, WebPhotoMatch } from "../../shared/types";
import { cacheGet, cacheSet, knownListingByUrl } from "./db";
import { isSameListing, resolveOwner, siteInfo, type IndexLookup } from "./sellerIdentity";
import { safeFetch } from "./webFetch";

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
/** Photos per listing sent to the search (each is a paid call after the free tier). */
export const WEB_SEARCHED_PHOTOS = 3;
/** Pages kept per photo, after dropping the listing's own pages. */
const PAGES_PER_PHOTO = 8;
const MAX_IMAGE_BYTES = 4_000_000;

export const webPhotoSearchEnabled = () => Boolean(process.env.GOOGLE_VISION_API_KEY);

/** The parts of Vision's webDetection response we use. */
export interface WebDetection {
  pagesWithMatchingImages?: {
    url: string;
    pageTitle?: string;
    fullMatchingImages?: { url: string }[];
    partialMatchingImages?: { url: string }[];
  }[];
  fullMatchingImages?: { url: string }[];
  bestGuessLabels?: { label: string }[];
}

/** Ask Vision which web pages show this photo. Cached for a week per photo URL. */
export async function detectWeb(photoUrl: string): Promise<WebDetection | null> {
  const key = `vision:${photoUrl}`;
  const cached = cacheGet<WebDetection>(key);
  if (cached) return cached;

  // Send the bytes when we can fetch them: Vision's own fetch of marketplace
  // CDNs is unreliable. Fall back to letting Vision fetch the URL.
  const img = await safeFetch(photoUrl, { maxBytes: MAX_IMAGE_BYTES, accept: "image/*" });
  const image = img && /^image\//.test(img.contentType)
    ? { content: img.body.toString("base64") }
    : { source: { imageUri: photoUrl } };

  const res = await fetch(`${VISION_URL}?key=${encodeURIComponent(process.env.GOOGLE_VISION_API_KEY ?? "")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ image, features: [{ type: "WEB_DETECTION", maxResults: 20 }] }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { responses?: { webDetection?: WebDetection; error?: { message: string } }[] };
  const first = json.responses?.[0];
  if (first?.error) throw new Error(`Vision API: ${first.error.message}`);
  const detection = first?.webDetection ?? {};
  cacheSet(key, detection);
  return detection;
}

const indexLookup: IndexLookup = (url) => {
  const row = knownListingByUrl(url);
  if (!row) return null;
  const siteName = { poshmark: "Poshmark", ebay: "eBay", facebook: "Facebook", depop: "Depop" }[row.platform] ?? row.platform;
  return { siteName, id: row.sellerId, username: row.sellerUsername };
};

/**
 * Turn Vision's pages into matches with an owner. Pure apart from `resolve`,
 * which tests replace. Drops the listing's own page and pages on the same
 * site's image CDN.
 */
export async function classifyPages(
  listing: Listing,
  photoIndex: number,
  detection: WebDetection,
  resolve: (url: string) => Promise<{ owner: WebPhotoMatch["owner"]; username?: string }>,
): Promise<WebPhotoMatch[]> {
  const pages = (detection.pagesWithMatchingImages ?? [])
    .filter((p) => p.url && /^https?:/i.test(p.url) && !isSameListing(listing, p.url))
    .slice(0, PAGES_PER_PHOTO);
  return Promise.all(
    pages.map(async (p): Promise<WebPhotoMatch> => {
      const info = siteInfo(p.url);
      const { owner, username } = await resolve(p.url);
      return {
        photoIndex,
        pageUrl: p.url,
        pageTitle: stripTags(p.pageTitle ?? "").slice(0, 160),
        ...info,
        owner,
        username,
        match: p.fullMatchingImages?.length ? "full" : "partial",
      };
    }),
  );
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Search the web for the first few photos. Throws if the search itself fails. */
export async function searchListingPhotos(listing: Listing): Promise<WebPhotoMatch[]> {
  const photos = listing.photos.slice(0, WEB_SEARCHED_PHOTOS);
  const perPhoto = await Promise.all(
    photos.map(async (url, i) => {
      const detection = await detectWeb(url);
      if (!detection) return [];
      return classifyPages(listing, i, detection, (pageUrl) =>
        resolveOwner(listing, pageUrl, { index: indexLookup, allowFetch: true }),
      );
    }),
  );
  // One entry per page: a page showing photos 1 and 2 counts once (first photo kept).
  const seen = new Set<string>();
  return perPhoto.flat().filter((m) => !seen.has(m.pageUrl) && seen.add(m.pageUrl));
}
