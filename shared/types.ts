// Types shared by the extension and the server.
// Every site adapter (Poshmark, eBay, Facebook Marketplace, ...) produces a
// `Listing`, and the server always answers with a `RiskReport`.

export const PLATFORMS = ["poshmark", "ebay", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  poshmark: "Poshmark",
  ebay: "eBay",
  facebook: "Facebook Marketplace",
};

export interface SellerInfo {
  platform: Platform;
  /** The platform's own seller id (from the profile URL). Empty if the page didn't show one. */
  id: string;
  username: string; // handle where the site has one; otherwise the display name
  displayName?: string;
  profileUrl: string;
  joinedAt?: string; // ISO date
  /** Some sites only show "Joined in 2015" or "Member since Mar 2014". */
  joinedPrecision?: "day" | "month" | "year";
  lastActiveAt?: string; // ISO date
  location?: string;
  // Poshmark
  ordersShipped?: number;
  fiveStarReviews?: number;
  listingsCount?: number;
  followers?: number;
  itemsSoldDisplay?: string; // e.g. "2500+"
  // eBay
  feedbackScore?: number;
  positiveFeedbackPercent?: number;
  // Facebook Marketplace
  ratingsCount?: number;
}

export interface Listing {
  platform: Platform;
  id: string;
  url: string;
  title: string;
  description: string;
  brand?: string;
  category?: string;
  condition?: string;
  size?: string;
  price: number;
  originalPrice?: number; // seller-entered "retail" price, not verified
  currency: string;
  photos: string[]; // full-size image URLs
  listedAt?: string; // ISO date (approximate when the site shows "3 days ago")
  location?: string; // where the item is, e.g. "Madison, WI"
  likes?: number;
  comments?: number;
  status?: string; // "available", "sold", ...
  seller: SellerInfo;
}

export type Severity = "good" | "info" | "caution" | "danger";

export interface Signal {
  id: string;
  severity: Severity;
  text: string; // one line, shown to the user
  source: "rules" | "ai" | "community";
  /** Risk points this signal added to the score (0 for good/info signals). */
  points: number;
}

export type Confidence = "low" | "medium" | "high";

export interface PriceCheck {
  typicalLow: number | null;
  typicalHigh: number | null;
  /** What we compare the asking price against. */
  median: number | null;
  confidence: Confidence;
  /** "ebay-listings": live eBay Browse API prices. "ai-estimate": Claude's estimate. */
  basis: "ebay-listings" | "ai-estimate";
  sampleSize?: number; // number of eBay listings behind the numbers
  note: string;
}

/** What Claude thinks the item actually is, used for brand and price checks. */
export interface NormalizedItem {
  brand: string | null;
  model: string | null;
  category: string;
  condition: string | null;
}

export type RiskLevel = "low" | "medium" | "high";

export interface RiskReport {
  listingId: string;
  platform: Platform;
  score: number; // 0 (safe) - 100 (very risky), computed in code from `signals[].points`
  level: RiskLevel; // 0-29 low, 30-59 medium (caution), 60+ high
  summary: string; // one line explaining the score (Claude when available)
  topReasons: string[]; // up to 3 biggest contributors, one line each
  signals: Signal[];
  item?: NormalizedItem;
  priceCheck?: PriceCheck;
  communityReports: number;
  aiUsed: boolean;
  checkedAt: string;
}

export interface ScamReportInput {
  platform: Platform;
  sellerId: string;
  sellerUsername: string;
  listingId?: string;
  reason: string;
}
