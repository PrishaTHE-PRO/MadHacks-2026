// Parser + rules tests. The fixture mirrors the shape of a real Poshmark
// listing page (as of Nov 2026) with made-up data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePoshmarkHtml, isPoshmarkListingUrl } from "../../extension/src/adapters/poshmark";
import { runRules } from "../src/rules";

const state = {
  common: { note: 'braces in strings "}{" must not break parsing' },
  $_listing_details: {
    listingDetails: {
      id: "abc123",
      title: "Louis Vuitton Neverfull MM",
      description: "Like new. Text me at 555-123-4567 for a better price!",
      brand: "Louis Vuitton",
      condition: "nwt",
      size_obj: { display: "One Size" },
      department: { display: "Women" },
      category_v2: { display: "Bags" },
      price_amount: { val: "120.0", currency_code: "USD" },
      original_price_amount: { val: "2000.0" },
      cover_shot: { path_large: "posts/2026/11/01/abc123/l_cover.jpg" },
      pictures: [{ path_large: "posts/2026/11/01/abc123/l_cover.jpg" }],
      first_published_at: "2026-11-10T10:00:00-08:00",
      like_count: 3,
      comment_count: 0,
      inventory: { status: "available" },
    },
    listerData: {
      id: "seller1",
      username: "test_closet",
      full_name: "Test Closet",
      created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      last_active_at: new Date().toISOString(),
      profile_v2: { city: "Madison", state: "WI" },
      aggregates: { seller_orders_shipped: 0, seller_5_star_rating_comment_count: 0, posts: 2, followers: 1 },
    },
  },
};

const html = `<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(state)};(function(){var s;}())</script></body></html>`;
const url = "https://poshmark.com/listing/Louis-Vuitton-Neverfull-abc123?ref=x";

test("recognizes listing URLs", () => {
  assert.ok(isPoshmarkListingUrl(url));
  assert.ok(!isPoshmarkListingUrl("https://poshmark.com/closet/someone"));
  assert.ok(!isPoshmarkListingUrl("https://evil-poshmark.com/listing/x"));
});

test("parses a listing page", () => {
  const l = parsePoshmarkHtml(html, url);
  assert.ok(l);
  assert.equal(l.id, "abc123");
  assert.equal(l.url, "https://poshmark.com/listing/Louis-Vuitton-Neverfull-abc123");
  assert.equal(l.price, 120);
  assert.equal(l.originalPrice, 2000);
  assert.equal(l.condition, "New with tags");
  assert.equal(l.category, "Women > Bags");
  assert.deepEqual(l.photos, ["https://di2ponv0v5otw.cloudfront.net/posts/2026/11/01/abc123/l_cover.jpg"]);
  assert.equal(l.seller.username, "test_closet");
  assert.equal(l.seller.ordersShipped, 0);
  assert.equal(l.seller.location, "Madison, WI");
});

test("returns null for pages without listing data", () => {
  assert.equal(parsePoshmarkHtml("<html></html>", url), null);
});

test("rules flag an obviously risky listing", () => {
  const l = parsePoshmarkHtml(html, url)!;
  const r = runRules(l, {
    community: { reporters: 2, reportersLast30Days: 2, flagged: false, categories: [{ category: "off-platform-payment", count: 2 }] },
  });
  const ids = r.signals.map((s) => s.id);
  for (const id of ["community-reports", "new-account", "no-track-record", "few-photos", "too-cheap-brand", "off-platform"]) {
    assert.ok(ids.includes(id), `expected signal ${id}, got ${ids.join(", ")}`);
  }
  assert.equal(r.score, 20 + 15 + 10 + 5 + 20 + 15);
});
