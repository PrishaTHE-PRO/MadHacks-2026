// Personal history (spec §7.1): kept on the device, 90-day expiry, earlier
// visits to the same listing and other listings from the same seller.
import { test } from "node:test";
import assert from "node:assert/strict";
import { earlierVisits, HISTORY_DAYS, withCheck, type HistoryEntry } from "../../extension/src/historyCore";
import type { Listing, RiskReport } from "../../shared/types";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-14T12:00:00Z");

const listing = (id: string, sellerId = "s1"): Listing => ({
  platform: "facebook",
  id,
  url: `https://www.facebook.com/marketplace/item/${id}/`,
  title: `Item ${id}`,
  description: "",
  price: 100,
  currency: "USD",
  photos: [`https://scontent.xx.fbcdn.net/${id}.jpg`],
  seller: { platform: "facebook", id: sellerId, username: "Sam", displayName: "Sam Lee", profileUrl: "" },
});

const report = (score: number): RiskReport => ({
  listingId: "x",
  platform: "facebook",
  score,
  maxScore: 100,
  level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
  summary: "",
  topReasons: [`reason ${score}`],
  signals: [],
  communityReports: 0,
  aiUsed: false,
  coverage: { seller: true, photos: { checked: 0, total: 1 }, ai: false, price: false },
  checkedAt: "",
});

test("first visit: no earlier visit; a refresh within the hour doesn't count as one", () => {
  let h: HistoryEntry[] = withCheck([], listing("A"), report(20), T0);
  assert.equal(h.length, 1);
  assert.equal(h[0].sellerName, "Sam Lee");
  assert.deepEqual(earlierVisits(h, listing("A")), { previous: undefined, otherListings: [] });

  h = withCheck(h, listing("A"), report(25), T0 + 10 * 60_000);
  assert.equal(h.length, 1);
  assert.equal(earlierVisits(h, listing("A")).previous, undefined);
});

test("coming back days later shows the earlier score, and other listings from the seller", () => {
  let h = withCheck([], listing("A"), report(72), T0);
  h = withCheck(h, listing("B"), report(40), T0 + HOUR);
  h = withCheck(h, listing("C", "someone-else"), report(10), T0 + HOUR);
  h = withCheck(h, listing("A"), report(80), T0 + 3 * DAY);

  const seen = earlierVisits(h, listing("A"));
  assert.deepEqual(seen.previous, { score: 72, level: "high", seenAt: T0 });
  assert.deepEqual(seen.otherListings.map((e) => e.listingId), ["B"]);
  assert.equal(h[0].listingId, "A"); // most recent first
  assert.equal(h[0].firstSeenAt, T0);
});

test(`entries expire after ${HISTORY_DAYS} days`, () => {
  let h = withCheck([], listing("old"), report(50), T0);
  h = withCheck(h, listing("new"), report(5), T0 + (HISTORY_DAYS + 1) * DAY);
  assert.deepEqual(h.map((e) => e.listingId), ["new"]);
});
