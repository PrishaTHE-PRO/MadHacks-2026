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

/** Another listing that uses the same (or a mirrored) photo, from DealDig's shared index. */
export interface PhotoMatch {
  photoIndex: number; // which photo of this listing matched
  platform: Platform;
  sellerId: string;
  sellerUsername: string;
  listingUrl: string;
  listingTitle: string;
  seenAt: string; // ISO date the other listing was checked
  mirrored: boolean;
}

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
  communityReports: number; // distinct people who reported this seller (last 12 months)
  community?: CommunityInfo;
  /** Listings by other sellers with the same photos (spec §3.1). Omitted when photos couldn't be fingerprinted. */
  photoMatches?: PhotoMatch[];
  aiUsed: boolean;
  checkedAt: string;
}

/**
 * Stages of a listing check, reported live when the client asks for progress
 * (POST /analyze-listing?progress=1). "item" and "summary" only run with Claude.
 */
export type ListingStep = "seller" | "item" | "price" | "summary";

/** One line of the progress stream (newline-delimited JSON). */
export type ListingProgress =
  | { plan: ListingStep[] } // first line: the steps this check will run
  | { step: ListingStep } // a step started (earlier ones are done)
  | { report: RiskReport } // last line on success
  | { error: string }; // last line on failure

// ---------------------------------------------------------------------------
// Community reports (spec §7.1, §7.2)
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = {
  "off-platform-payment": "Asked to pay outside the platform (Zelle, gift cards, wire...)",
  "deposit-before-viewing": "Asked for a deposit before I could see it",
  "fake-item": "Fake, counterfeit or not as described",
  "no-show": "Took payment and never delivered or showed up",
  "stolen-photos": "Used someone else's photos",
  "fake-documents": "Sent fake receipts, IDs or documents",
  "overpayment": "Overpaid and asked for money back",
  "other": "Something else",
} as const;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;

/** Short labels for showing report counts to other users. */
export const REPORT_CATEGORY_SHORT: Record<ReportCategory, string> = {
  "off-platform-payment": "asked to pay off-platform",
  "deposit-before-viewing": "asked for a deposit before viewing",
  "fake-item": "fake or not as described",
  "no-show": "took payment, never delivered",
  "stolen-photos": "used stolen photos",
  "fake-documents": "sent fake documents",
  "overpayment": "overpayment scam",
  "other": "other",
};

export interface ScamReportInput {
  platform: Platform;
  sellerId: string;
  sellerUsername: string;
  listingId?: string;
  category: ReportCategory;
  /** Optional details. Stored for moderation only: never shown to other users or sent to AI. */
  details?: string;
  /** Random id made on the user's device, so one person counts once per seller. Hashed before storing. */
  reporterId: string;
}

export interface CommunityInfo {
  /** Distinct people who reported this seller in the last 12 months. */
  reporters: number;
  reportersLast30Days: number;
  /** 3+ different people in 30 days. A warning to the buyer, not a block. */
  flagged: boolean;
  /** How many reporters picked each reason, biggest first. */
  categories: { category: ReportCategory; count: number }[];
}

export interface ReportResponse {
  ok: true;
  community: CommunityInfo;
}

// ---------------------------------------------------------------------------
// Meetup helper (implementation spec §4.2, §4.3)
// ---------------------------------------------------------------------------

/** Platforms where buyers and sellers meet in person. Shipping platforms
 *  (Poshmark, eBay) are safer kept on-platform, so they don't get the helper. */
export const LOCAL_PLATFORMS: readonly Platform[] = ["facebook"];

export type SpotKind = "police" | "library" | "grocery" | "bank" | "community" | "cafe";

export interface MeetupSpot {
  id: string;
  name: string;
  kind: SpotKind;
  address?: string;
  lat: number;
  lng: number;
  distanceKm: number; // from the meeting point (midpoint)
  /** One line on why this place is a good pick. */
  why: string;
  openingHours?: string; // raw OSM opening_hours when known
  mapUrl: string;
  source: "osm" | "curated";
}

export interface MeetupSpotsInput {
  /** Free text the user typed: neighborhood, zip or cross streets. Never their GPS. */
  area: string;
  listingLocation?: string;
  price?: number;
  riskLevel?: RiskLevel;
}

export interface MeetupSpotsResponse {
  spots: MeetupSpot[];
  /** Where we searched around, and how we got there. */
  center: { lat: number; lng: number; label: string };
  /** Sunrise/sunset (ISO) for today and tomorrow at the center, for daylight times. */
  daylight: { sunrise: string; sunset: string }[];
  /** Short notes for the user, e.g. "High-value item: meet at a police station lobby." */
  notes: string[];
}

export type ReplyTone = "friendly" | "firm";
export type DealRole = "buyer" | "seller";

export interface DraftReplyInput {
  listing: { title: string; price: number; platform: Platform };
  role: DealRole;
  tone: ReplyTone;
  spot: { name: string; address?: string };
  time: string; // human text, e.g. "Saturday 2:00 PM"
  /** Optional: the other person's latest message, pasted by the user. */
  theirMessage?: string;
  riskReasons?: string[];
}

export interface DraftReplyResponse {
  reply: string;
  aiUsed: boolean;
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
  // Phishing link checker: raised by code only, never by the AI.
  "lookalike_link", // on device: faceb00k-pay.com, paypa1.com, punycode, bare IPs
  "new_domain", // server: registered in the last 90 days (RDAP)
  "unsafe_link", // server: Google Safe Browsing match
] as const;
export type ChatPatternId = (typeof CHAT_PATTERN_IDS)[number];

/** Patterns Claude may return. The link checks need evidence (a lookup or a measured look-alike), so only code raises them. */
export const AI_CHAT_PATTERN_IDS = CHAT_PATTERN_IDS.filter(
  (id): id is Exclude<ChatPatternId, "lookalike_link" | "new_domain" | "unsafe_link"> =>
    id !== "lookalike_link" && id !== "new_domain" && id !== "unsafe_link",
) as [Exclude<ChatPatternId, "lookalike_link" | "new_domain" | "unsafe_link">, ...Exclude<ChatPatternId, "lookalike_link" | "new_domain" | "unsafe_link">[]];

/** The specific link warnings that replace the generic "suspicious_link" on the same message. */
export const LINK_CHECK_PATTERNS: readonly ChatPatternId[] = ["lookalike_link", "new_domain", "unsafe_link"];

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
