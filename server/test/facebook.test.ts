// Facebook Marketplace parser tests. The fixture mirrors what content/collect.ts
// produces from an item page (no usable class names, so text + links + images),
// with made-up data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFacebookListingUrl, parseFacebookPage } from "../../extension/src/adapters/facebook";
import type { PageData } from "../../extension/src/adapters/page";
import { runRules } from "../src/rules";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const PHOTO_1 = "https://scontent-ord5-1.xx.fbcdn.net/v/t45/111_n.jpg";
const PHOTO_2 = "https://scontent-ord5-1.xx.fbcdn.net/v/t45/222_n.jpg";

const base = (over: Partial<PageData> = {}): PageData => ({
  url: "https://www.facebook.com/marketplace/item/1234567890123456/?ref=browse_tab",
  documentTitle: "(3) Marketplace - Road bike | Facebook",
  // Stale og tags from the previous item: must be ignored.
  meta: { "og:url": "https://www.facebook.com/marketplace/item/999/", "og:title": "Old item" },
  jsonLd: [],
  text: [
    "Road bike, 56cm, Shimano 105",
    "$250",
    "Listed 3 days ago in Madison, WI",
    "Message",
    "Save",
    "Share",
    "Details",
    "Condition",
    "Used - Good",
    "Rides great. New tires in June.",
    "Pickup near campus.",
    "See less",
    "Location is approximate",
    "Seller information",
    "Seller details",
    "Jordan Example",
    "(14)",
    "Joined Facebook in 2012",
    "Today's picks",
    "$40",
    "Kids bike",
  ].join("\n"),
  headings: ["Road bike, 56cm, Shimano 105"],
  links: [
    { href: "https://www.facebook.com/marketplace/profile/100001234567890/", text: "" },
    { href: "https://www.facebook.com/marketplace/profile/100001234567890/?ref=pdp", text: "Jordan Example" },
    { href: "https://www.facebook.com/marketplace/item/555/", text: "$40 Kids bike" },
  ],
  images: [
    { src: PHOTO_1, alt: "Road bike, 56cm", width: 620, height: 620 },
    { src: PHOTO_2, alt: "Thumbnail 2", width: 56, height: 56 },
    { src: "https://scontent.xx.fbcdn.net/v/avatar.jpg", alt: "", width: 36, height: 36 },
    {
      src: "https://scontent.xx.fbcdn.net/v/other.jpg",
      alt: "Kids bike",
      width: 240,
      height: 240,
      linkHref: "https://www.facebook.com/marketplace/item/555/",
    },
  ],
  sections: {},
  ...over,
});

test("recognizes Marketplace item URLs", () => {
  assert.ok(isFacebookListingUrl("https://www.facebook.com/marketplace/item/1234567890123456/"));
  assert.ok(isFacebookListingUrl("https://www.facebook.com/marketplace/madison/item/1234567890123456"));
  assert.ok(!isFacebookListingUrl("https://www.facebook.com/marketplace/"));
  assert.ok(!isFacebookListingUrl("https://www.facebook.com/groups/123"));
  assert.ok(!isFacebookListingUrl("https://facebook.com.evil.example/marketplace/item/1/"));
});

test("parses title, price, details, photos and seller", () => {
  const l = parseFacebookPage(base(), NOW);
  assert.ok(l);
  assert.equal(l.platform, "facebook");
  assert.equal(l.id, "1234567890123456");
  assert.equal(l.url, "https://www.facebook.com/marketplace/item/1234567890123456/");
  assert.equal(l.title, "Road bike, 56cm, Shimano 105");
  assert.equal(l.price, 250);
  assert.equal(l.currency, "USD");
  assert.equal(l.condition, "Used - Good");
  assert.equal(l.description, "Rides great. New tires in June.\nPickup near campus.");
  assert.equal(l.location, "Madison, WI");
  assert.equal(l.listedAt, "2026-11-11T12:00:00.000Z");
  // Main photo + thumbnail; no avatar, no "Today's picks" image.
  assert.deepEqual(l.photos, [PHOTO_1, PHOTO_2]);
  assert.equal(l.seller.id, "100001234567890");
  assert.equal(l.seller.displayName, "Jordan Example");
  assert.equal(l.seller.profileUrl, "https://www.facebook.com/marketplace/profile/100001234567890/");
  assert.equal(l.seller.ratingsCount, 14);
  assert.equal(l.seller.joinedAt, "2012-01-01");
  assert.equal(l.seller.joinedPrecision, "year");
});

test("uses og tags only when they point at this item", () => {
  const l = parseFacebookPage(
    base({
      headings: [],
      images: [],
      meta: {
        "og:url": "https://www.facebook.com/marketplace/item/1234567890123456/",
        "og:title": "Road bike | Facebook Marketplace",
        "og:image": PHOTO_1,
      },
    }),
    NOW,
  );
  assert.ok(l);
  assert.equal(l.title, "Road bike");
  assert.deepEqual(l.photos, [PHOTO_1]);
});

test("handles Free items, no ratings and a brand-new account", () => {
  const l = parseFacebookPage(
    base({
      text: "Couch\nFree\nListed about an hour ago in Madison, WI\nSeller information\nNew Person\nNo ratings yet\nJoined Facebook in 2026",
      headings: ["Couch"],
    }),
    NOW,
  );
  assert.ok(l);
  assert.equal(l.price, 0);
  assert.equal(l.seller.ratingsCount, 0);
  const ids = runRules(l, { now: NOW }).signals.map((s) => s.id);
  assert.ok(ids.includes("no-track-record"), ids.join(", "));
  assert.ok(ids.includes("joined-this-year"), ids.join(", "));
});

test("returns null before the item has rendered", () => {
  assert.equal(parseFacebookPage(base({ text: "", headings: [] }), NOW), null);
  assert.equal(parseFacebookPage(base({ url: "https://www.facebook.com/marketplace/" }), NOW), null);
});
