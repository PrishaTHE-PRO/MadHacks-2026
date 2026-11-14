// Rule checks that run instantly with no API key. They produce signals and
// a base score; Claude (if configured) then reviews the listing on top of them.

import { PLATFORM_NAMES, type Listing, type Signal } from "../../shared/types";

const DAY = 24 * 60 * 60 * 1000;

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
};

// Asking to pay or talk outside the platform voids buyer protection: the #1 scam pattern.
const OFF_PLATFORM = [
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bcash ?app\b/i,
  /\bpaypal\b/i,
  /\bf\s?&\s?f\b|friends (and|&) family/i,
  /\bwhats ?app\b/i,
  /\btelegram\b/i,
  /\b(text|call|email|dm) me\b/i,
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/, // phone number
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email address
  /\b(ig|insta(gram)?)\s*[:@]/i,
];

export interface RuleResult {
  signals: Signal[];
  score: number; // 0-100
}

export function runRules(listing: Listing, communityReports: number): RuleResult {
  const signals: Signal[] = [];
  let score = 10;
  const add = (id: string, severity: Signal["severity"], text: string, points: number, source: Signal["source"] = "rules") => {
    signals.push({ id, severity, text, source });
    score += points;
  };

  const s = listing.seller;
  const now = Date.now();

  // --- Community reports ---
  if (communityReports > 0) {
    add(
      "community-reports",
      "danger",
      `${communityReports} DealDig user${communityReports > 1 ? "s have" : " has"} reported this seller.`,
      Math.min(50, 30 + communityReports * 10),
      "community",
    );
  }

  // --- Seller account ---
  const site = PLATFORM_NAMES[listing.platform];
  // Facebook's join date is for the Facebook account, not Marketplace.
  const where = listing.platform === "facebook" ? "Facebook" : site;
  if (s.joinedAt) {
    const joined = Date.parse(s.joinedAt);
    const year = new Date(joined).getUTCFullYear();
    if (s.joinedPrecision === "year") {
      // "Joined in 2026" could mean yesterday, so only the current year is a warning.
      if (year === new Date(now).getUTCFullYear())
        add("young-account", "caution", `Seller joined ${where} this year (${year}).`, 15);
      else if (now - joined > 365 * 3 * DAY) add("old-account", "good", `Seller has been on ${where} since ${year}.`, -5);
    } else {
      // For month precision, measure from the end of that month so we never overstate the age.
      const end = s.joinedPrecision === "month" ? Date.UTC(year, new Date(joined).getUTCMonth() + 1, 1) : joined;
      const ageDays = (now - end) / DAY;
      if (ageDays < 14) add("new-account", "danger", `Seller account is only ${Math.max(0, Math.round(ageDays))} days old.`, 25);
      else if (ageDays < 90) add("young-account", "caution", `Seller account is ${Math.round(ageDays)} days old.`, 10);
      else if (ageDays > 365 * 2) add("old-account", "good", `Seller has been on ${where} since ${year}.`, -5);
    }
  }

  // eBay feedback
  if (s.feedbackScore !== undefined) {
    if (s.feedbackScore < 5) add("little-feedback", "caution", `Seller has only ${s.feedbackScore} feedback.`, 12);
    else if (s.feedbackScore >= 500 && (s.positiveFeedbackPercent ?? 0) >= 98)
      add("track-record", "good", `Seller has ${s.feedbackScore.toLocaleString()} feedback, ${s.positiveFeedbackPercent}% positive.`, -8);
  }
  if (s.positiveFeedbackPercent !== undefined && s.positiveFeedbackPercent < 95 && (s.feedbackScore ?? 10) >= 10) {
    add("low-positive", "caution", `Only ${s.positiveFeedbackPercent}% positive feedback.`, 10);
  }

  // Facebook Marketplace ratings
  if (s.ratingsCount === 0) add("no-ratings", "caution", "Seller has no Marketplace ratings yet.", 10);

  if (s.ordersShipped !== undefined) {
    if (s.ordersShipped === 0) add("no-sales", "caution", "Seller hasn't shipped any orders yet.", 12);
    else if (s.ordersShipped >= 50)
      add("track-record", "good", `Seller has shipped ${s.ordersShipped.toLocaleString()} orders.`, -8);
  }

  if (s.ordersShipped && s.ordersShipped >= 20 && (s.fiveStarReviews ?? 0) === 0) {
    add("no-reviews", "caution", "Many sales but no 5-star reviews.", 8);
  }

  if (s.lastActiveAt && now - Date.parse(s.lastActiveAt) > 60 * DAY) {
    add("inactive", "caution", "Seller hasn't been active in over 2 months.", 6);
  }

  // --- Listing ---
  if (listing.photos.length <= 1) add("few-photos", "caution", "Only one photo. Ask for more angles and a tag photo.", 8);

  const brandKey = listing.brand?.toLowerCase().trim();
  const floor = brandKey ? COUNTERFEIT_FLOORS[brandKey] : undefined;
  if (floor && listing.price < floor) {
    add(
      "too-cheap-brand",
      "danger",
      `$${listing.price} is unusually cheap for ${listing.brand}. Common sign of a counterfeit.`,
      25,
    );
  }

  if (listing.originalPrice && listing.price < listing.originalPrice * 0.15 && listing.originalPrice >= 100) {
    add(
      "huge-discount",
      "caution",
      `Priced ${Math.round((1 - listing.price / listing.originalPrice) * 100)}% below the listed retail price.`,
      8,
    );
  }

  const text = `${listing.title}\n${listing.description}`;
  const offPlatform = OFF_PLATFORM.find((re) => re.test(text));
  if (offPlatform) {
    add(
      "off-platform",
      "danger",
      `Listing mentions paying or contacting outside ${site}. That removes your buyer protection.`,
      30,
    );
  }

  if (listing.status && listing.status !== "available") {
    add("not-available", "info", `Listing status: ${listing.status}.`, 0);
  }

  return { signals, score: clamp(score) };
}

export const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export const levelFor = (score: number) => (score >= 60 ? "high" : score >= 30 ? "medium" : "low") as
  | "low"
  | "medium"
  | "high";
