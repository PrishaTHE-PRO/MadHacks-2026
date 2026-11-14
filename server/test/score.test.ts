// Risk score tests (implementation spec §2.4): points table, caps, bands,
// top reasons, and the eBay price comparison.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRules, levelFor, POINTS } from "../src/rules";
import { compsFromBrowse, quantile } from "../src/prices";
import type { Listing, PriceCheck } from "../../shared/types";

const NOW = Date.parse("2026-11-14T12:00:00Z");

const listing = (over: Partial<Listing> = {}, seller: Partial<Listing["seller"]> = {}): Listing => ({
  platform: "ebay",
  id: "1",
  url: "https://www.ebay.com/itm/1",
  title: "Trek FX 2 Hybrid Bike",
  description: "Rides great, tuned up last month.",
  price: 350,
  currency: "USD",
  photos: ["a", "b", "c"],
  seller: {
    platform: "ebay",
    id: "s",
    username: "s",
    profileUrl: "",
    joinedAt: "2015-03-01",
    joinedPrecision: "month",
    feedbackScore: 800,
    positiveFeedbackPercent: 99.5,
    ...seller,
  },
  ...over,
});

const comps = (median: number, over: Partial<PriceCheck> = {}): PriceCheck => ({
  typicalLow: median * 0.8,
  typicalHigh: median * 1.2,
  median,
  confidence: "high",
  basis: "ebay-listings",
  sampleSize: 20,
  note: "",
  ...over,
});

const ids = (r: ReturnType<typeof runRules>) => r.signals.map((s) => s.id);

test("an established seller at a normal price scores low", () => {
  const r = runRules(listing(), { price: comps(400), now: NOW });
  assert.equal(r.score, 0);
  assert.equal(levelFor(r.score), "low");
  assert.ok(ids(r).includes("track-record"));
  assert.ok(ids(r).includes("old-account"));
  // With nothing risky, the top reasons are the good news.
  assert.ok(r.topReasons.length > 0);
});

test("price under 50% of the median adds the bait points", () => {
  const r = runRules(listing({ price: 150 }), { price: comps(400), now: NOW });
  const bait = r.signals.find((s) => s.id === "price-bait");
  assert.ok(bait);
  assert.equal(bait.points, POINTS.priceBait);
  assert.match(bait.text, /63% below the typical \$400 on 20 eBay listings/);
});

test("a low-confidence AI estimate only adds half the bait points", () => {
  const r = runRules(listing({ price: 150 }), {
    price: comps(400, { basis: "ai-estimate", confidence: "low", sampleSize: undefined }),
    now: NOW,
  });
  const bait = r.signals.find((s) => s.id === "price-bait")!;
  assert.equal(bait.points, POINTS.priceBaitLowConfidence);
  assert.equal(bait.severity, "caution");
});

test("Claude's brand feeds the counterfeit floor when the page has no brand field", () => {
  const l = listing({ title: "Designer bag", price: 90, platform: "facebook" });
  const r = runRules(l, { ai: { brand: "Louis Vuitton", redFlags: [], riskAdjust: 0 }, now: NOW });
  assert.ok(ids(r).includes("too-cheap-brand"));
  // The counterfeit floor and the bait check share one price bucket.
  assert.ok(!ids(r).includes("price-bait"));
});

test("regex and Claude share one capped text bucket", () => {
  const l = listing({ description: "Pay with Zelle only, text me" });
  const both = runRules(l, {
    ai: { brand: null, redFlags: ["Description pushes payment off eBay.", "Photos look like stock images."], riskAdjust: 15 },
    now: NOW,
  });
  const textPoints = both.signals.filter((s) => s.id === "off-platform" || s.id.startsWith("ai-")).reduce((n, s) => n + s.points, 0);
  assert.equal(textPoints, POINTS.textRedFlagsMax);

  const aiOnly = runRules(listing(), {
    ai: { brand: null, redFlags: ["Photos look like stock images.", "Vague description."], riskAdjust: 8 },
    now: NOW,
  });
  assert.deepEqual(
    aiOnly.signals.filter((s) => s.source === "ai").map((s) => s.points),
    [8, 0],
  );
});

test("Claude can't push its points past the cap", () => {
  const r = runRules(listing(), { ai: { brand: null, redFlags: ["x"], riskAdjust: 99 }, now: NOW });
  assert.equal(r.signals.find((s) => s.source === "ai")!.points, POINTS.textRedFlagsMax);
});

const community = (reporters: number, reportersLast30Days: number) => ({
  reporters,
  reportersLast30Days,
  flagged: reportersLast30Days >= 3,
  categories: [
    { category: "deposit-before-viewing" as const, count: Math.ceil(reporters / 2) },
    { category: "off-platform-payment" as const, count: Math.floor(reporters / 2) },
  ].filter((c) => c.count > 0),
});

test("reports add 10 per person up to 30; 3 people in 30 days flags the seller but adds no extra points", () => {
  const two = runRules(listing(), { community: community(2, 1), now: NOW });
  const sig = two.signals.find((s) => s.id === "community-reports")!;
  assert.equal(sig.points, 20);
  assert.equal(sig.text, "Reported by 2 people on DealDig: asked for a deposit before viewing (1), asked to pay off-platform (1).");
  assert.ok(!ids(two).includes("community-flag"));

  const many = runRules(listing(), { community: community(6, 3), now: NOW });
  assert.equal(many.signals.find((s) => s.id === "community-reports")!.points, POINTS.reportsMax);
  const flag = many.signals.find((s) => s.id === "community-flag")!;
  assert.equal(flag.points, 0);
  assert.match(flag.text, /3 different people/);
  assert.equal(many.score, POINTS.reportsMax);
  assert.equal(levelFor(many.score), "medium");
});

test("account age respects how precise the join date is", () => {
  const days = runRules(listing({}, { joinedAt: "2026-11-01", joinedPrecision: "day" }), { now: NOW });
  assert.equal(days.signals.find((s) => s.id === "new-account")!.points, POINTS.newAccount);

  // Joined some time in October: could be 14 or 44 days old.
  const month = runRules(listing({}, { joinedAt: "2026-10-01", joinedPrecision: "month" }), { now: NOW });
  assert.ok(ids(month).includes("maybe-new-account"), ids(month).join(", "));
});

test("top reasons are the three biggest contributors", () => {
  const r = runRules(
    listing({ price: 100, photos: ["a"], description: "venmo only" }, { feedbackScore: 1, positiveFeedbackPercent: undefined, joinedAt: "2026-11-10", joinedPrecision: "day" }),
    { price: comps(400), community: community(1, 1), now: NOW },
  );
  assert.equal(r.topReasons.length, 3);
  assert.match(r.topReasons[0], /below the typical/); // 20
  assert.equal(levelFor(r.score), "high");
});

test("bands: 0-29 low, 30-59 medium, 60+ high", () => {
  assert.equal(levelFor(29), "low");
  assert.equal(levelFor(30), "medium");
  assert.equal(levelFor(59), "medium");
  assert.equal(levelFor(60), "high");
});

test("eBay comps: median and quartiles, skipping the listing itself", () => {
  const items = [100, 120, 140, 160, 180, 200, 9999].map((p, i) => ({
    itemId: `v1|${i}|0`,
    legacyItemId: String(i),
    price: { value: String(p), currency: "USD" },
  }));
  const c = compsFromBrowse({ itemSummaries: items }, "6"); // drops the 9999 one
  assert.ok(c);
  assert.equal(c.median, 150);
  assert.equal(c.sampleSize, 6);
  assert.equal(c.basis, "ebay-listings");
  assert.equal(c.confidence, "low");
  assert.equal(compsFromBrowse({ itemSummaries: items.slice(0, 3) }), null);
  assert.equal(compsFromBrowse({}), null);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});
