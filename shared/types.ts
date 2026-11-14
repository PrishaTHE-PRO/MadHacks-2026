// Types shared by the extension and the server.
// Every site adapter (Poshmark, eBay, Facebook Marketplace, ...) produces a
// `Listing`, and the server always answers with a `RiskReport`.

export const PLATFORMS = ["poshmark", "ebay", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Sites where DealDig can check chats. Separate from `PLATFORMS` (listing
 * checks): a site can have chat support before it has a listing adapter.
 * "generic" is the paste box and any site without a chat adapter.
 */
export const CHAT_PLATFORMS = ["facebook", "poshmark", "ebay", "etsy", "depop", "mercari", "generic"] as const;
export type ChatPlatform = (typeof CHAT_PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform | ChatPlatform, string> = {
  poshmark: "Poshmark",
  ebay: "eBay",
  facebook: "Facebook Marketplace",
  etsy: "Etsy",
  depop: "Depop",
  mercari: "Mercari",
  generic: "this chat",
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

// --- Chat safety (docs/chat-safety-task.md) ---
// Pattern definitions, regexes and reason text live in shared/chatPatterns.ts.

export type ChatRole = "buyer" | "seller" | "unknown";

export const CHAT_PATTERN_IDS = [
  "deposit_before_viewing",
  "overpayment_refund",
  "off_platform",
  "verification_code",
  "fake_payment_notice",
  "shipping_agent",
  "unprotected_payment",
  "urgency_pressure",
  "suspicious_link",
  "personal_info_request",
] as const;
export type ChatPatternId = (typeof CHAT_PATTERN_IDS)[number];

export interface ChatMessage {
  /** Stable per message: the platform's message id if present, else hash(author + text + index). */
  id: string;
  fromMe: boolean;
  author?: string; // display name, if shown
  text: string;
  sentAt?: string; // ISO, if shown
}

export interface ChatContext {
  platform: ChatPlatform;
  threadId: string; // from the URL or thread element
  url: string;
  role: ChatRole; // from the side panel toggle, default "unknown"
  otherParty?: { id?: string; username?: string; profileUrl?: string };
  listing?: { title?: string; price?: number; url?: string }; // if the thread shows it
  messages: ChatMessage[]; // last 10, oldest first
}

export interface ChatFlag {
  pattern: ChatPatternId;
  severity: Severity;
  reason: string; // one line
  messageId: string; // which message triggered it
  source: "rules" | "ai";
}

export interface ChatReport {
  threadId: string;
  platform: ChatPlatform;
  flags: ChatFlag[];
  aiUsed: boolean;
  /** Prior DealDig reports about the other party, when the thread shows their id. */
  communityReports?: number;
  checkedAt: string;
}
