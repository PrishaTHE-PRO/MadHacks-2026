// Listing risk score (implementation spec §2.4).
//
// The score is computed here, in code, so every point is explainable: each
// signal carries the points it added, and the score is their sum. Claude
// never sets the score directly. It can only add up to POINTS.textRedFlagsMax
// for red flags it spots, which also limits what a prompt-injected listing
// can do. This runs with no API key; Claude's findings and price data are
// optional inputs.

import { PLATFORM_NAMES, type Listing, type PriceCheck, type Signal } from "../../shared/types";

const DAY = 24 * 60 * 60 * 1000;

/** Risk points per signal. Higher = riskier. Tune the numbers here. */
export const POINTS = {
  blocklisted: 40, // spec: seller on shared blocklist
  priceBait: 20, // spec: price under 50% of median (also: under a brand's counterfeit floor)
  priceBaitLowConfidence: 10, // same, but the price reference is a low-confidence estimate
  newAccount: 15, // spec: account under 30 days old
  maybeNewAccount: 10, // join date too coarse to be sure it's under 30 days
  noTrackRecord: 10, // spec: no ratings (or sales/feedback)
  poorFeedback: 10,
  textRedFlagsMax: 15, // spec: text red flags, shared by the regex check and Claude
  reportEach: 10, // spec: +10 per prior DealDig report...
  reportsMax: 30, // ...capped at +30
  overpricedNewClaim: 5,
  fewPhotos: 5,
} as const;
// Not wired yet (need later features): photo found on another listing +25
// (image hashes, spec §3.1) and verified handshakes -5 each, max -20 (§4.4).

/** A seller with this many reports in the last 30 days counts as blocklisted. */
export const BLOCKLIST_REPORTS = 3;

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

// Asking to pay or talk outside the platform voids buyer protection.
const OFF_PLATFORM = [
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bcash ?app\b/i,
  /\bpaypal\b/i,
  /\bf\s?&\s?f\b|friends (and|&) family/i,
  /\bgift ?cards?\b/i,
  /\bwire transfer\b|\bwestern union\b/i,
  /\bwhats ?app\b/i,
  /\btelegram\b/i,
  /\b(text|call|email|dm) me\b/i,
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/, // phone number
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email address
  /\b(ig|insta(gram)?)\s*[:@]/i,
];

const NEW_CLAIM = /\b(brand new|sealed|new in box|nib|bnib|bnwt|nwt|unopened)\b/i;

export interface CommunityStats {
  reports: number;
  reportsLast30Days: number;
}

/** What Claude found, already validated. */
export interface AiFindings {
  brand?: string | null;
  redFlags: string[];
  riskAdjust: number; // 0-15, clamped here anyway
}

export interface RuleInput {
  community?: CommunityStats;
  price?: PriceCheck;
  ai?: AiFindings;
  now?: number;
}

export interface RuleResult {
  signals: Signal[];
  score: number; // 0-100
  topReasons: string[]; // up to 3, biggest contributors first
}

export const money = (n: number, currency = "USD") =>
  currency === "USD" ? `$${Math.round(n).toLocaleString("en-US")}` : `${Math.round(n).toLocaleString("en-US")} ${currency}`;

export function runRules(listing: Listing, input: RuleInput = {}): RuleResult {
  const signals: Signal[] = [];
  const add = (id: string, severity: Signal["severity"], text: string, points = 0, source: Signal["source"] = "rules") =>
    signals.push({ id, severity, text, source, points });

  const s = listing.seller;
  const now = input.now ?? Date.now();
  const site = PLATFORM_NAMES[listing.platform];

  // --- Community: blocklist + prior reports ---
  const community = input.community ?? { reports: 0, reportsLast30Days: 0 };
  if (community.reportsLast30Days >= BLOCKLIST_REPORTS) {
    add(
      "blocklisted",
      "danger",
      `Seller is on DealDig's shared blocklist (${community.reportsLast30Days} reports in the last 30 days).`,
      POINTS.blocklisted,
      "community",
    );
  }
  if (community.reports > 0) {
    add(
      "community-reports",
      "danger",
      `Reported by ${community.reports} DealDig user${community.reports > 1 ? "s" : ""}.`,
      Math.min(POINTS.reportsMax, community.reports * POINTS.reportEach),
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

  // --- Listing basics ---
  if (listing.photos.length <= 1) {
    add("few-photos", "caution", "Only one photo. Ask for more angles and a tag or serial photo.", POINTS.fewPhotos);
  }
  if (listing.status && listing.status !== "available") add("not-available", "info", `Listing status: ${listing.status}.`);

  const score = clamp(signals.reduce((sum, sig) => sum + sig.points, 0));
  return { signals, score, topReasons: topReasons(signals) };
}

/** The three biggest contributors, or the good news when nothing added points. */
export function topReasons(signals: Signal[]): string[] {
  const risky = signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
  const picked = risky.length ? risky : signals.filter((s) => s.severity === "good");
  return picked.slice(0, 3).map((s) => s.text);
}

export const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export const levelFor = (score: number) => (score >= 60 ? "high" : score >= 30 ? "medium" : "low") as
  | "low"
  | "medium"
  | "high";
