// Listing risk score (implementation spec §2.4).
//
// The score is computed here, in code, so every point is explainable: each
// signal carries the points it added, and the score is their sum. Claude
// never sets the score directly. It can only add up to POINTS.textRedFlagsMax
// for red flags it spots, which also limits what a prompt-injected listing
// can do. This runs with no API key; Claude's findings and price data are
// optional inputs.

import {
  PLATFORM_NAMES,
  REPORT_CATEGORY_SHORT,
  SCORE_MAX,
  type CommunityInfo,
  type EvidenceLink,
  type Listing,
  type PhotoMatch,
  type PriceCheck,
  type Signal,
  type TextMatch,
  type WebPhotoMatch,
} from "../../shared/types";
// Off-platform payment/contact regexes, shared with the chat check.
import { OFF_PLATFORM } from "../../shared/chatPatterns";

const DAY = 24 * 60 * 60 * 1000;

/** Risk points per signal. Higher = riskier. Tune the numbers here. */
export const POINTS = {
  // No blocklist points: a seller flagged by 3+ people gets a warning banner,
  // not a block, since reports can be wrong. Their reports still add points below.
  priceBait: 20, // spec: price under 50% of median (also: under a brand's counterfeit floor)
  priceBaitLowConfidence: 10, // same, but the price reference is a low-confidence estimate
  newAccount: 15, // spec: account under 30 days old
  maybeNewAccount: 10, // join date too coarse to be sure it's under 30 days
  noTrackRecord: 10, // spec: no ratings (or sales/feedback)
  poorFeedback: 10,
  textRedFlagsMax: 15, // spec: text red flags, shared by the regex check and Claude
  reportEach: 10, // spec: +10 per person who reported the seller (one report each)...
  reportsMax: 30, // ...capped at +30
  overpricedNewClaim: 5,
  fewPhotos: 5,
  photoReused: 25, // spec §3.1: same photo in another seller's listing on the same site
  photoReusedOtherSite: 10, // same, on another site: could be the seller crossposting
  // Reverse image search (webPhotos.ts). The seller's own pages never add points.
  webPhotoOtherSeller: 25, // the photo is in a listing or post by a different account
  webPhotoUnknownListing: 10, // in another marketplace listing whose seller we couldn't read
  webPhotoStock: 10, // on a stock-photo site, for a used item
  webPhotoOtherSite: 8, // on other websites (shops, blogs), for a used item
  photosMax: 30, // all photo findings together, index + web
  // Copied description (textMatch.ts).
  textCopiedOtherSeller: 15, // same description in another seller's listing
  textCopiedUnknown: 5, // in another listing whose seller we couldn't read
  textCopiedOtherSite: 5, // on another website, for a used item
  copiedTextMax: 15,
} as const;
// Not wired yet (needs a later feature): verified handshakes -5 each, max -20 (§4.4).

/** A photo used by this many other sellers is a stock or catalog photo, not a stolen one. */
export const STOCK_PHOTO_SELLERS = 4;


// Brands that get counterfeited a lot, with a rough "too cheap to be real" floor (USD).
// Rough numbers for a starting point; tune with real data.
const COUNTERFEIT_FLOORS: Record<string, number> = {
  "louis vuitton": 250,
  chanel: 600,
  gucci: 200,
  "christian dior": 300,
  dior: 300,
  hermes: 800,
  "hermès": 800,
  prada: 200,
  "saint laurent": 300,
  "yves saint laurent": 300,
  goyard: 400,
  fendi: 250,
  balenciaga: 200,
  "bottega veneta": 400,
  celine: 350,
  "van cleef & arpels": 800,
  cartier: 500,
  rolex: 2000,
  "canada goose": 200,
  moncler: 250,
  jordan: 60,
  nike: 30,
  "off-white": 100,
  supreme: 40,
  apple: 80,
  dyson: 80,
};


const NEW_CLAIM = /\b(brand new|sealed|new in box|nib|bnib|bnwt|nwt|unopened)\b/i;


/** What Claude found, already validated. */
export interface AiFindings {
  brand?: string | null;
  redFlags: string[];
  riskAdjust: number; // 0-15, clamped here anyway
}

export interface RuleInput {
  community?: CommunityInfo;
  /** Other sellers' listings with the same photos (already excludes this seller). */
  photoMatches?: PhotoMatch[];
  /** Web pages with the same photos, this seller's own pages included. */
  webPhotoMatches?: WebPhotoMatch[];
  /** Listings and pages with the same description text, this seller's own included. */
  textMatches?: TextMatch[];
  price?: PriceCheck;
  ai?: AiFindings;
  now?: number;
}

export interface RuleResult {
  signals: Signal[];
  score: number; // 0-SCORE_MAX
  topReasons: string[]; // up to 3, biggest contributors first
}

export const money = (n: number, currency = "USD") =>
  currency === "USD" ? `$${Math.round(n).toLocaleString("en-US")}` : `${Math.round(n).toLocaleString("en-US")} ${currency}`;

export function runRules(listing: Listing, input: RuleInput = {}): RuleResult {
  const signals: Signal[] = [];
  const add = (
    id: string,
    severity: Signal["severity"],
    text: string,
    points = 0,
    source: Signal["source"] = "rules",
    links?: EvidenceLink[],
  ) => signals.push({ id, severity, text, source, points, ...(links?.length ? { links } : {}) });

  const s = listing.seller;
  const now = input.now ?? Date.now();
  const site = PLATFORM_NAMES[listing.platform];

  // --- Community reports (one per person, last 12 months) ---
  const community = input.community;
  if (community && community.reporters > 0) {
    const n = community.reporters;
    add(
      "community-reports",
      "danger",
      `Reported by ${n} ${n > 1 ? "people" : "person"} on DealDig: ${reportSummary(community)}.`,
      Math.min(POINTS.reportsMax, n * POINTS.reportEach),
      "community",
    );
  }
  if (community?.flagged) {
    add(
      "community-flag",
      "danger",
      `Flagged: ${community.reportersLast30Days} different people reported this seller in the last 30 days. Reports can be wrong, so weigh them with everything else.`,
      0,
      "community",
    );
  }

  // --- Price: bait pricing and counterfeit floors ---
  const price = input.price;
  const brand = listing.brand || input.ai?.brand || undefined;
  if (listing.price > 0) {
    const floor = brand ? COUNTERFEIT_FLOORS[brand.toLowerCase().trim()] : undefined;
    if (floor && listing.price < floor) {
      add(
        "too-cheap-brand",
        "danger",
        `${money(listing.price, listing.currency)} is unusually cheap for ${brand}. Common sign of a counterfeit.`,
        POINTS.priceBait,
      );
    } else if (price?.median && listing.price < price.median * 0.5) {
      const pct = Math.round((1 - listing.price / price.median) * 100);
      const solid = price.basis === "ebay-listings" || price.confidence !== "low";
      const basis =
        price.basis === "ebay-listings" ? ` on ${price.sampleSize ?? "similar"} eBay listings` : " (estimate)";
      add(
        "price-bait",
        solid ? "danger" : "caution",
        `Priced ${pct}% below the typical ${money(price.median, listing.currency)}${basis}. Classic bait pricing.`,
        solid ? POINTS.priceBait : POINTS.priceBaitLowConfidence,
      );
    }
    const text = `${listing.title}\n${listing.description}`;
    if (price?.typicalHigh && listing.price > price.typicalHigh * 2 && NEW_CLAIM.test(text)) {
      add(
        "overpriced-new",
        "caution",
        `Priced over twice the usual ${money(price.typicalHigh, listing.currency)} for a "brand new" claim. Make sure it's genuine.`,
        POINTS.overpricedNewClaim,
      );
    }
  }
  if (listing.originalPrice && listing.originalPrice >= 100 && listing.price < listing.originalPrice * 0.15) {
    add(
      "huge-discount",
      "info",
      `Priced ${Math.round((1 - listing.price / listing.originalPrice) * 100)}% below the retail price the seller entered.`,
    );
  }

  // --- Seller account age ---
  // Facebook's join date is for the Facebook account, not Marketplace.
  const where = listing.platform === "facebook" ? "Facebook" : site;
  if (s.joinedAt) {
    const start = Date.parse(s.joinedAt);
    const d = new Date(start);
    const year = d.getUTCFullYear();
    if (s.joinedPrecision === "year") {
      if (year === new Date(now).getUTCFullYear())
        add("joined-this-year", "caution", `Seller joined ${where} this year (${year}).`, POINTS.maybeNewAccount);
      else if (now - start > 3 * 365 * DAY) add("old-account", "good", `Seller has been on ${where} since ${year}.`);
    } else {
      // A start date gives the oldest the account can be; with month precision,
      // the end of that month gives the youngest.
      const maxAge = (now - start) / DAY;
      const minAge = s.joinedPrecision === "month" ? (now - Date.UTC(year, d.getUTCMonth() + 1, 1)) / DAY : maxAge;
      const monthYear = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      if (maxAge < 30) {
        add(
          "new-account",
          "danger",
          s.joinedPrecision === "month"
            ? `Seller joined in ${monthYear}, less than a month ago.`
            : `Seller account is only ${Math.max(0, Math.round(maxAge))} days old.`,
          POINTS.newAccount,
        );
      } else if (minAge < 30) {
        add("maybe-new-account", "caution", `Seller joined in ${monthYear}, so the account may be under a month old.`, POINTS.maybeNewAccount);
      } else if (maxAge < 90) {
        add("young-account", "caution", `Seller account is about ${Math.round(maxAge)} days old.`);
      } else if (minAge > 2 * 365) {
        add("old-account", "good", `Seller has been on ${where} since ${year}.`);
      }
    }
  }

  // --- Seller track record ---
  const noRecord =
    (s.ordersShipped === 0 && "Seller hasn't shipped any orders yet.") ||
    (s.feedbackScore !== undefined && s.feedbackScore < 5 && `Seller has only ${s.feedbackScore} feedback.`) ||
    (s.ratingsCount === 0 && "Seller has no Marketplace ratings yet.");
  if (noRecord) add("no-track-record", "caution", noRecord, POINTS.noTrackRecord);

  const poorFeedback =
    (s.positiveFeedbackPercent !== undefined &&
      s.positiveFeedbackPercent < 95 &&
      (s.feedbackScore ?? 10) >= 10 &&
      `Only ${s.positiveFeedbackPercent}% positive feedback.`) ||
    (s.ordersShipped !== undefined &&
      s.ordersShipped >= 20 &&
      (s.fiveStarReviews ?? 0) === 0 &&
      "Many sales but no 5-star reviews.");
  if (poorFeedback) add("poor-feedback", "caution", poorFeedback, POINTS.poorFeedback);

  const goodRecord =
    (s.ordersShipped !== undefined && s.ordersShipped >= 50 && `Seller has shipped ${s.ordersShipped.toLocaleString("en-US")} orders.`) ||
    (s.feedbackScore !== undefined &&
      s.feedbackScore >= 500 &&
      (s.positiveFeedbackPercent ?? 0) >= 98 &&
      `Seller has ${s.feedbackScore.toLocaleString("en-US")} feedback, ${s.positiveFeedbackPercent}% positive.`) ||
    (s.ratingsCount !== undefined && s.ratingsCount >= 10 && `Seller has ${s.ratingsCount} Marketplace ratings.`);
  if (goodRecord && !poorFeedback) add("track-record", "good", goodRecord);

  if (s.lastActiveAt && now - Date.parse(s.lastActiveAt) > 60 * DAY) {
    add("inactive", "caution", "Seller hasn't been active in over 2 months.");
  }

  // --- Listing text: regex check and Claude share one capped bucket ---
  const text = `${listing.title}\n${listing.description}`;
  let textPoints = 0;
  if (OFF_PLATFORM.some((re) => re.test(text))) {
    textPoints = POINTS.textRedFlagsMax;
    add(
      "off-platform",
      "danger",
      `Listing mentions paying or contacting outside ${site}. That removes your buyer protection.`,
      textPoints,
    );
  }
  if (input.ai) {
    const aiPoints = Math.max(0, Math.min(POINTS.textRedFlagsMax, Math.round(input.ai.riskAdjust)));
    // Claude's points only count beyond what the regex check already added.
    let remaining = Math.max(0, aiPoints - textPoints);
    input.ai.redFlags.forEach((flag, i) => {
      add(`ai-${i}`, remaining > 0 ? "caution" : "info", flag, remaining, "ai");
      remaining = 0;
    });
  }

  // --- Photos reused from other sellers' listings (DealDig's index) ---
  const photoStart = signals.length;
  const photoMatches = input.photoMatches ?? [];
  const indexLinks: EvidenceLink[] = photoMatches.slice(0, 3).map((m) => ({
    label: `${PLATFORM_NAMES[m.platform]} listing by ${handle(m.platform === "facebook" ? m.sellerUsername : `@${m.sellerUsername}`)}`,
    url: m.listingUrl,
  }));
  if (photoMatches.length) {
    const sellers = new Set(photoMatches.map((m) => `${m.platform}:${m.sellerId}`));
    const sameSite = photoMatches.filter((m) => m.platform === listing.platform);
    const first = sameSite[0] ?? photoMatches[0];
    const who = `${first.platform === "facebook" ? first.sellerUsername : `@${first.sellerUsername}`}`;
    const flipped = photoMatches.some((m) => m.mirrored) ? " (one is flipped)" : "";
    if (sellers.size >= STOCK_PHOTO_SELLERS) {
      add("stock-photo", "info", `These photos are used by ${sellers.size} other sellers, so they're likely stock or catalog photos.`, 0, "community");
    } else if (sameSite.length) {
      const others = new Set(sameSite.map((m) => m.sellerId)).size;
      add(
        "photo-reused",
        "danger",
        `A photo here is also in a listing by ${others > 1 ? `${others} other sellers` : `another ${site} seller, ${who}`}${flipped}. Copied photos are a common scam.`,
        POINTS.photoReused,
        "community",
        indexLinks,
      );
    } else {
      add(
        "photo-reused-other-site",
        "caution",
        `A photo here is also in a ${PLATFORM_NAMES[first.platform]} listing by ${who}${flipped}. Could be the same person crossposting; ask the seller.`,
        POINTS.photoReusedOtherSite,
        "community",
        indexLinks,
      );
    }
  }

  // --- Photos found elsewhere on the web (reverse image search) ---
  const isNew = isNewItem(listing);
  const indexUrls = new Set(photoMatches.map((m) => m.listingUrl));
  const web = (input.webPhotoMatches ?? []).filter((m) => m.kind !== "ai-art" && !indexUrls.has(m.pageUrl));
  const others = web.filter((m) => m.owner === "other-seller");
  const otherAccounts = new Set(others.map((m) => `${m.siteName}:${(m.username ?? m.pageUrl).toLowerCase()}`));
  if (otherAccounts.size >= STOCK_PHOTO_SELLERS) {
    add(
      "web-photo-widespread",
      isNew ? "info" : "caution",
      `${photoLabel(others)} is used by ${otherAccounts.size} different accounts online, so it's a widely shared catalog or stock photo, not a photo of this item.${isNew ? "" : " For a used item, ask for a photo of the actual one."}`,
      isNew ? 0 : POINTS.webPhotoStock,
      "rules",
      webLinks(others),
    );
  } else if (others.length) {
    const m = others[0];
    const more = others.length > 1 ? ` and ${others.length - 1} more ${others.length === 2 ? "page" : "pages"}` : "";
    add(
      "web-photo-other-seller",
      "danger",
      `${photoLabel([m])} also appears in ${where_(m)} by ${handle(m.username, m)}, a different ${m.kind === "marketplace" ? "seller" : "account"}${more}. This seller is likely using someone else's photos.`,
      POINTS.webPhotoOtherSeller,
      "rules",
      webLinks(others),
    );
  }
  const unknown = web.filter((m) => m.owner === "unknown" && (m.kind === "marketplace" || m.kind === "social"));
  if (unknown.length) {
    const m = unknown[0];
    add(
      "web-photo-unknown",
      "caution",
      `${photoLabel([m])} also appears in ${where_(m)}${unknown.length > 1 ? ` and ${unknown.length - 1} more` : ""}. DealDig couldn't read who posted it: open it and check whether it's the same seller.`,
      POINTS.webPhotoUnknownListing,
      "rules",
      webLinks(unknown),
    );
  }
  const stock = web.filter((m) => m.kind === "stock");
  if (stock.length) {
    add(
      "web-photo-stock",
      isNew ? "info" : "caution",
      `${photoLabel(stock)} is a stock photo (found on ${stock[0].siteName}).${isNew ? " Common for new items." : " For a used item, ask for real photos."}`,
      isNew ? 0 : POINTS.webPhotoStock,
      "rules",
      webLinks(stock),
    );
  }
  const elsewhere = web.filter((m) => m.kind === "other" && m.owner !== "same-seller");
  if (elsewhere.length) {
    const sites = [...new Set(elsewhere.map((m) => m.siteName))];
    add(
      "web-photo-other-site",
      isNew ? "info" : "caution",
      `${photoLabel(elsewhere)} also appears on ${sites.length === 1 ? sites[0] : `${sites.length} other websites (${sites.slice(0, 2).join(", ")}…)`}. ${isNew ? "It may be the maker's catalog photo, which is normal for new items." : "For a used item that usually means a catalog or borrowed photo: ask for a photo of the actual item."}`,
      isNew ? 0 : POINTS.webPhotoOtherSite,
      "rules",
      webLinks(elsewhere),
    );
  }
  const mine = web.filter((m) => m.owner === "same-seller");
  if (mine.length) {
    const m = mine[0];
    add(
      "web-photo-same-seller",
      "good",
      `${photoLabel(mine)} also appears in ${where_(m)} by the same seller (${handle(m.username, m)}). That's crossposting, not a red flag.`,
      0,
      "rules",
      webLinks(mine),
    );
  }
  capPoints(signals, photoStart, POINTS.photosMax);

  // --- Description copied from another listing ---
  const textStart = signals.length;
  const texts = input.textMatches ?? [];
  const copied = texts.filter((t) => t.owner === "other-seller");
  if (copied.length) {
    const t = copied[0];
    add(
      "text-copied",
      "danger",
      `The description matches ${where_(t)} by ${handle(t.username, t)}, a different seller (${Math.round(t.overlap * 100)}% the same): "${t.excerpt}". Copied listings are a common scam.`,
      POINTS.textCopiedOtherSeller,
      t.source === "dealdig" ? "community" : "rules",
      textLinks(copied),
    );
  }
  const textUnknown = texts.filter((t) => t.owner === "unknown" && (t.kind === "marketplace" || t.kind === "social"));
  if (textUnknown.length) {
    const t = textUnknown[0];
    add(
      "text-copied-unknown",
      "caution",
      `The same description is in ${where_(t)}: "${t.excerpt}". DealDig couldn't read who posted it: check whether it's the same seller.`,
      POINTS.textCopiedUnknown,
      "rules",
      textLinks(textUnknown),
    );
  }
  const textElsewhere = texts.filter((t) => t.owner !== "same-seller" && t.kind !== "marketplace" && t.kind !== "social");
  if (textElsewhere.length) {
    const t = textElsewhere[0];
    add(
      "text-other-site",
      isNew ? "info" : "caution",
      `The description is also on ${t.siteName}: "${t.excerpt}". ${isNew ? "It may be the maker's product text, which is normal for new items." : "For a used item, a copied description is worth asking about."}`,
      isNew ? 0 : POINTS.textCopiedOtherSite,
      "rules",
      textLinks(textElsewhere),
    );
  }
  const textMine = texts.filter((t) => t.owner === "same-seller");
  if (textMine.length) {
    const t = textMine[0];
    add("text-same-seller", "good", `The same description is in ${where_(t)} by this seller. That's crossposting, not a red flag.`, 0, "rules", textLinks(textMine));
  }
  capPoints(signals, textStart, POINTS.copiedTextMax);

  // --- Listing basics ---
  if (listing.photos.length <= 1) {
    add("few-photos", "caution", "Only one photo. Ask for more angles and a tag or serial photo.", POINTS.fewPhotos);
  }
  if (listing.status && listing.status !== "available") add("not-available", "info", `Listing status: ${listing.status}.`);

  const score = clamp(signals.reduce((sum, sig) => sum + sig.points, 0));
  return { signals, score, topReasons: topReasons(signals) };
}

/** Keep the points from signals[start..] within `max`, trimming the later (weaker) ones first. */
function capPoints(signals: Signal[], start: number, max: number) {
  let left = max;
  for (const sig of signals.slice(start)) {
    sig.points = Math.min(sig.points, left);
    left -= sig.points;
  }
}

const isNewItem = (l: Listing) =>
  (Boolean(l.condition) && /\bnew\b/i.test(l.condition!) && !/like new/i.test(l.condition!)) || NEW_CLAIM.test(`${l.title}\n${l.description}`);

/** "Photo 1", "Photos 1 and 2" */
function photoLabel(ms: { photoIndex: number }[]): string {
  const n = [...new Set(ms.map((m) => m.photoIndex + 1))].sort((a, b) => a - b);
  return n.length === 1 ? `Photo ${n[0]}` : `Photos ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** "a Depop listing", "a Reddit post", "a page on nordstrom.com" */
function where_(m: { kind: string; siteName: string }): string {
  if (m.kind === "marketplace") return `${/^[aeiou]/i.test(m.siteName) ? "an" : "a"} ${m.siteName} listing`;
  if (m.kind === "social") return `a ${m.siteName} post`;
  return `a page on ${m.siteName}`;
}

function handle(username: string | undefined, m?: { siteName: string }): string {
  if (!username) return "another account";
  if (/^\d+$/.test(username) || m?.siteName === "Facebook" || username.includes(" ")) return username;
  return username.startsWith("@") ? username : `@${username}`;
}

function webLinks(ms: WebPhotoMatch[]): EvidenceLink[] {
  return ms.slice(0, 3).map((m) => ({
    label: `Photo ${m.photoIndex + 1} in ${where_(m)}${m.username ? ` by ${handle(m.username, m)}` : ""}`,
    url: m.pageUrl,
  }));
}

function textLinks(ts: TextMatch[]): EvidenceLink[] {
  return ts.slice(0, 3).map((t) => ({
    label: `Same text in ${where_(t)}${t.username ? ` by ${handle(t.username, t)}` : ""}`,
    url: t.url,
  }));
}

/** "asked for a deposit before viewing (2), asked to pay off-platform (1)" */
export function reportSummary(c: CommunityInfo): string {
  return c.categories
    .slice(0, 3)
    .map((x) => `${REPORT_CATEGORY_SHORT[x.category]} (${x.count})`)
    .join(", ");
}

/** The three biggest contributors, or the good news when nothing added points. */
export function topReasons(signals: Signal[]): string[] {
  const risky = signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
  const picked = risky.length ? risky : signals.filter((s) => s.severity === "good");
  return picked.slice(0, 3).map((s) => s.text);
}

export const clamp = (n: number) => Math.max(0, Math.min(SCORE_MAX, Math.round(n)));

export const levelFor = (score: number) => (score >= 60 ? "high" : score >= 30 ? "medium" : "low") as
  | "low"
  | "medium"
  | "high";
