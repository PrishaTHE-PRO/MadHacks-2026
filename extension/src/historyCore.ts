// Pure history logic (spec §7.1), with no chrome.* calls so Node tests can import it.
// Storage lives in history.ts.

import type { Listing, Platform, RiskLevel, RiskReport } from "../../shared/types";

const DAY = 24 * 60 * 60 * 1000;
export const HISTORY_DAYS = 90;
const MAX_ENTRIES = 500;
/** A visit counts as "earlier" if it was at least this long ago (not just a page refresh). */
const REVISIT_GAP = 60 * 60 * 1000;

export const isFresh = (h: { lastSeenAt: number }, now: number) => now - h.lastSeenAt < HISTORY_DAYS * DAY;

export interface HistoryEntry {
  platform: Platform;
  listingId: string;
  url: string;
  title: string;
  photo?: string;
  sellerId: string;
  sellerName: string;
  score: number;
  level: RiskLevel;
  topReason?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** The score at the previous visit (at least an hour earlier), if any. */
  previous?: { score: number; level: RiskLevel; seenAt: number };
}

const sellerNameOf = (l: Listing) =>
  l.platform === "facebook" ? l.seller.displayName || l.seller.username : `@${l.seller.username}`;

/** Add or update a check. Pure, so it's easy to test; `saveCheckToHistory` stores the result. */
export function withCheck(history: HistoryEntry[], listing: Listing, report: RiskReport, now: number): HistoryEntry[] {
  const fresh = history.filter((h) => isFresh(h, now));
  const old = fresh.find((h) => h.platform === listing.platform && h.listingId === listing.id);
  const entry: HistoryEntry = {
    platform: listing.platform,
    listingId: listing.id,
    url: listing.url,
    title: listing.title,
    photo: listing.photos[0],
    sellerId: listing.seller.id,
    sellerName: sellerNameOf(listing),
    score: report.score,
    level: report.level,
    topReason: report.topReasons[0],
    firstSeenAt: old?.firstSeenAt ?? now,
    lastSeenAt: now,
    previous: old
      ? now - old.lastSeenAt >= REVISIT_GAP
        ? { score: old.score, level: old.level, seenAt: old.lastSeenAt }
        : old.previous
      : undefined,
  };
  return [entry, ...fresh.filter((h) => h !== old)].slice(0, MAX_ENTRIES);
}

/** What to tell the user about earlier visits to this listing and seller. Pure. */
export function earlierVisits(history: HistoryEntry[], listing: Listing) {
  const sameListing = history.find((h) => h.platform === listing.platform && h.listingId === listing.id);
  const otherListings = listing.seller.id
    ? history.filter((h) => h.platform === listing.platform && h.sellerId === listing.seller.id && h.listingId !== listing.id)
    : [];
  return { previous: sameListing?.previous, otherListings };
}
