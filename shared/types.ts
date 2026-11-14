// Types shared by the extension and the server.
// Every site adapter (Poshmark, eBay, Depop, ...) produces a `Listing`,
// and the server always answers with a `RiskReport`.

export type Platform = "poshmark";

export interface SellerInfo {
  platform: Platform;
  id: string;
  username: string;
  displayName?: string;
  profileUrl: string;
  joinedAt?: string; // ISO date
  lastActiveAt?: string; // ISO date
  location?: string;
  ordersShipped?: number;
  fiveStarReviews?: number;
  listingsCount?: number;
  followers?: number;
  itemsSoldDisplay?: string; // e.g. "2500+"
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
  listedAt?: string; // ISO date
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
}

export interface PriceCheck {
  typicalLow: number | null;
  typicalHigh: number | null;
  note: string;
  basis: "ai-estimate"; // later: "sold-comps" once a real comps source is wired in
}

export type RiskLevel = "low" | "medium" | "high";

export interface RiskReport {
  listingId: string;
  platform: Platform;
  score: number; // 0 (safe) - 100 (very risky)
  level: RiskLevel;
  summary: string;
  signals: Signal[];
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
