// Mock data for the UI preview page. Every seller, listing and number here is made up.

import type { Listing, RiskReport, Signal } from "../../../shared/types";
import type { ChatTabState } from "../messages";
import type { HistoryEntry } from "../historyCore";
import type { SentSummary } from "../../../shared/privacy";
import type { ShieldSummary } from "../privacy/shield";

/** A soft gradient "photo" so the preview needs no network. */
const photo = (a: string, b: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="58" r="26" fill="rgba(255,255,255,.55)"/></svg>`,
  )}`;

const CHECKED_AT = new Date(Date.now() - 2 * 60 * 1000).toISOString();

const sig = (id: string, severity: Signal["severity"], text: string, points = 0, source: Signal["source"] = "rules"): Signal => ({
  id,
  severity,
  text,
  points,
  source,
});

export const lowListing: Listing = {
  platform: "ebay",
  id: "mock-low",
  url: "https://www.ebay.com/itm/0000000001",
  title: "Trek FX 2 Hybrid Bike, Medium, tuned up",
  description: "Rides great, new brake pads last month.",
  size: "M",
  price: 360,
  currency: "USD",
  photos: [photo("#9fd3c7", "#5b8def")],
  seller: {
    platform: "ebay",
    id: "pedalpushers_mock",
    username: "pedalpushers_mock",
    profileUrl: "https://www.ebay.com/usr/pedalpushers_mock",
    joinedAt: "2015-03-01",
    joinedPrecision: "month",
    feedbackScore: 1240,
    positiveFeedbackPercent: 99.6,
  },
};

export const lowReport: RiskReport = {
  listingId: lowListing.id,
  platform: "ebay",
  score: 5,
  level: "low",
  summary: "Established seller with strong feedback and a fair price. Still pay through eBay checkout.",
  topReasons: ["Only one photo. Ask for more angles and a tag or serial photo."],
  signals: [
    sig("few-photos", "caution", "Only one photo. Ask for more angles and a tag or serial photo.", 5),
    sig("old-account", "good", "Seller has been on eBay since 2015."),
    sig("track-record", "good", "Seller has 1,240 feedback, 99.6% positive."),
  ],
  priceCheck: {
    typicalLow: 320,
    typicalHigh: 450,
    median: 390,
    confidence: "high",
    basis: "ebay-listings",
    sampleSize: 18,
    note: "Trek FX 2 bikes in good condition.",
  },
  communityReports: 0,
  aiUsed: true,
  checkedAt: CHECKED_AT,
  maxScore: 100,
};

export const mediumListing: Listing = {
  platform: "poshmark",
  id: "mock-medium",
  url: "https://poshmark.com/listing/mock-medium",
  title: "Coach Tabby Shoulder Bag 26 in Chalk",
  description: "Gently used, comes with dust bag.",
  size: "OS",
  price: 140,
  originalPrice: 450,
  currency: "USD",
  photos: [photo("#f2e4d4", "#d9b99b"), photo("#e8d6f0", "#b9a3d9")],
  seller: {
    platform: "poshmark",
    id: "closet_mock_lena",
    username: "closet_mock_lena",
    profileUrl: "https://poshmark.com/closet/closet_mock_lena",
    joinedAt: "2026-09-02",
    joinedPrecision: "day",
    ordersShipped: 3,
  },
};

export const mediumReport: RiskReport = {
  listingId: mediumListing.id,
  platform: "poshmark",
  score: 45,
  maxScore: 100,
  level: "medium",
  summary:
    "This listing scores 45/100 mainly because photo 1 also appears in a Depop listing by @mock_thriftqueen, a different seller, and it's priced 55% below similar bags. Ask for a tag and serial photo before you buy. Photo 2 may be AI-generated; that's your call.",
  topReasons: [
    "Photo 1 also appears in a Depop listing by @mock_thriftqueen, a different seller. This seller is likely using someone else's photos.",
    "Priced 55% below the typical $310 (estimate). Classic bait pricing.",
  ],
  signals: [
    {
      ...sig(
        "web-photo-other-seller",
        "danger",
        "Photo 1 also appears in a Depop listing by @mock_thriftqueen, a different seller. This seller is likely using someone else's photos.",
        25,
      ),
      links: [{ label: "Photo 1 in a Depop listing by @mock_thriftqueen", url: "https://www.depop.com/products/mock_thriftqueen-coach-tabby-26/" }],
    },
    sig("price-bait", "danger", "Priced 55% below the typical $310 (estimate). Classic bait pricing.", 20),
    sig("young-account", "caution", "Seller account is about 73 days old.", 0),
    {
      ...sig(
        "web-photo-same-seller",
        "good",
        "Photo 2 also appears in a Mercari listing by the same seller (@closet_mock_lena). That's crossposting, not a red flag.",
        0,
      ),
      links: [{ label: "Photo 2 in a Mercari listing by @closet_mock_lena", url: "https://www.mercari.com/us/item/m00000000001/" }],
    },
    sig("huge-discount", "info", "Priced 69% below the retail price the seller entered."),
  ],
  webPhotoMatches: [
    {
      photoIndex: 0,
      pageUrl: "https://www.depop.com/products/mock_thriftqueen-coach-tabby-26/",
      pageTitle: "Coach Tabby 26 pebbled leather",
      site: "depop.com",
      siteName: "Depop",
      kind: "marketplace",
      owner: "other-seller",
      username: "mock_thriftqueen",
      match: "full",
    },
    {
      photoIndex: 1,
      pageUrl: "https://www.mercari.com/us/item/m00000000001/",
      pageTitle: "Coach Tabby 26",
      site: "mercari.com",
      siteName: "Mercari",
      kind: "marketplace",
      owner: "same-seller",
      username: "closet_mock_lena",
      match: "full",
    },
  ],
  photoMatches: [],
  textMatches: [],
  aiImage: {
    verdict: "possible",
    photoIndexes: [1],
    evidence: ["Photo 2: the Coach lettering on the hangtag is warped and partly unreadable."],
    links: [],
  },
  webCheck: { photos: "done", text: "done", aiDetector: "off" },
  priceCheck: {
    typicalLow: 240,
    typicalHigh: 380,
    median: 310,
    confidence: "medium",
    basis: "ai-estimate",
    note: "Coach Tabby 26 bags, used.",
  },
  communityReports: 0,
  aiUsed: true,
  checkedAt: CHECKED_AT,
};

export const highListing: Listing = {
  platform: "facebook",
  id: "mock-high",
  url: "https://www.facebook.com/marketplace/item/0000000003",
  title: "Room for rent near campus, utilities included",
  description: "Out of town right now, send a deposit to hold it, text me on WhatsApp.",
  price: 375,
  currency: "USD",
  photos: [],
  location: "Madison, WI",
  seller: {
    platform: "facebook",
    id: "100000000000003",
    username: "Jordan Reyes (mock)",
    displayName: "Jordan Reyes (mock)",
    profileUrl: "https://www.facebook.com/marketplace/profile/100000000000003",
    joinedAt: "2026-01-01",
    joinedPrecision: "year",
    ratingsCount: 0,
  },
};

export const highReport: RiskReport = {
  listingId: highListing.id,
  platform: "facebook",
  score: 80,
  level: "high",
  summary: "Several classic rental-scam signs: far below local rent, a new account, and a push to pay off-platform.",
  topReasons: [
    "Reported by 3 DealDig users.",
    "Priced 52% below the typical $780 (estimate). Classic bait pricing.",
    "Listing mentions paying or contacting outside Facebook Marketplace. That removes your buyer protection.",
  ],
  signals: [
    sig("community-reports", "danger", "Reported by 3 DealDig users.", 30, "community"),
    sig("price-bait", "danger", "Priced 52% below the typical $780 (estimate). Classic bait pricing.", 20),
    sig("off-platform", "danger", "Listing mentions paying or contacting outside Facebook Marketplace. That removes your buyer protection.", 15),
    sig("joined-this-year", "caution", "Seller joined Facebook this year (2026).", 10),
    sig("no-track-record", "caution", "Seller has no Marketplace ratings yet.", 10),
    sig("few-photos", "caution", "Only one photo. Ask for more angles and a tag or serial photo.", 5),
  ],
  priceCheck: {
    typicalLow: 650,
    typicalHigh: 900,
    median: 780,
    confidence: "medium",
    basis: "ai-estimate",
    note: "Single rooms near campus.",
  },
  communityReports: 3,
  community: {
    reporters: 3,
    reportersLast30Days: 3,
    flagged: true,
    categories: [
      { category: "deposit-before-viewing", count: 2 },
      { category: "off-platform-payment", count: 1 },
    ],
  },
  aiUsed: true,
  checkedAt: CHECKED_AT,
  maxScore: 100,
};

// --- Chat (the demo sublet scam, made-up people) ---

/** A warning the preview can add to show a new one arriving. */
export const arrivingFlag = {
  message: "Before I send the deposit, can you read me the 6 digit code Google texted you? Just to verify you're real.",
  flag: {
    pattern: "verification_code",
    severity: "danger",
    reason: "Never share a code sent to your phone; it's used to take over your accounts (Google Voice scam).",
    messageId: "m7",
    source: "rules",
  } satisfies import("../../../shared/types").ChatFlag,
};


export const mockChat: ChatTabState = {
  platform: "facebook",
  threadId: "mock-thread",
  url: "https://www.facebook.com/messages/t/mock-thread",
  role: "buyer",
  otherParty: { username: "Jordan Reyes" },
  status: "done",
  aiUsed: true,
  watching: true,
  updatedAt: Date.now(),
  quotes: {
    m4: "I'm out of town for work so I can't show it in person, but I can hold it for you.",
    m5: "Send a $300 deposit on Zelle to hold it, and text me on WhatsApp at 608-555-0147 so we can sort out the keys.",
    m6: "Honestly three other students are asking about it, so I'd need it locked in by tonight.",
  },
  flags: [
    {
      pattern: "deposit_before_viewing",
      severity: "caution",
      reason: "Won't show the room in person but offers to hold it: the usual lead-in to a deposit request.",
      messageId: "m4",
      source: "ai",
    },
    {
      pattern: "deposit_before_viewing",
      severity: "danger",
      reason: "Asking for money before you've seen the item or place is the most common rental and big-item scam.",
      messageId: "m5",
      source: "rules",
    },
    {
      pattern: "off_platform",
      severity: "caution",
      reason: "Moving the chat off the platform removes its buyer and seller protection and is common before a scam.",
      messageId: "m5",
      source: "rules",
    },
    {
      pattern: "unprotected_payment",
      severity: "caution",
      reason: "This payment method can't be reversed; use cash in person or the platform's checkout.",
      messageId: "m5",
      source: "rules",
    },
    {
      pattern: "urgency_pressure",
      severity: "caution",
      reason: "Claims three others want it so you'll commit tonight without seeing the room.",
      messageId: "m6",
      source: "ai",
    },
  ],
};

// --- On-device history (made-up listings) ---

const HOUR = 60 * 60 * 1000;

export const mockHistory: HistoryEntry[] = [
  {
    platform: "facebook",
    listingId: highListing.id,
    url: highListing.url,
    title: highListing.title,
    sellerId: highListing.seller.id,
    sellerName: highListing.seller.displayName!,
    score: 72,
    level: "high",
    firstSeenAt: Date.now() - 3 * 24 * HOUR,
    lastSeenAt: Date.now() - 3 * 24 * HOUR,
  },
  {
    platform: "facebook",
    listingId: "mock-high-2",
    url: "https://www.facebook.com/marketplace/item/0000000004",
    title: "Studio apartment downtown, all utilities, available now",
    sellerId: highListing.seller.id,
    sellerName: highListing.seller.displayName!,
    score: 64,
    level: "high",
    firstSeenAt: Date.now() - 26 * HOUR,
    lastSeenAt: Date.now() - 26 * HOUR,
  },
  {
    platform: "ebay",
    listingId: lowListing.id,
    url: lowListing.url,
    title: lowListing.title,
    sellerId: lowListing.seller.id,
    sellerName: lowListing.seller.username,
    score: 5,
    level: "low",
    firstSeenAt: Date.now() - 5 * HOUR,
    lastSeenAt: Date.now() - 5 * HOUR,
  },
];

// --- Private browsing ---


export const mockShield: ShieldSummary = {
  site: "poshmark.com",
  on: true,
  paused: false,
  total: 14,
  blocked: [
    { domain: "doubleclick.net", category: "advertising", about: "Google's ad network", count: 4 },
    { domain: "criteo.com", category: "advertising", about: "Criteo retargeting ads", count: 2 },
    { domain: "google-analytics.com", category: "analytics", about: "Google Analytics", count: 3 },
    { domain: "googletagmanager.com", category: "analytics", about: "Google Tag Manager, which loads other trackers", count: 1 },
    { domain: "connect.facebook.net", category: "social", about: "Meta Pixel", count: 2 },
    { domain: "analytics.tiktok.com", category: "social", about: "TikTok Pixel", count: 2 },
  ],
};

export const mockSent: SentSummary = {
  at: Date.parse("2026-11-14T12:00:00Z"),
  fields: ["title", "price", "description", "photo links", "seller's public profile", "listing link (no tags)"],
  photoFingerprints: 4,
  webPhotos: false,
  linkTrimmed: true,
};
