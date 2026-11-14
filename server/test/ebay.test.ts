// eBay parser tests. The fixture mirrors what content/collect.ts produces on an
// eBay item page (JSON-LD Product + seller card), with made-up data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEbayListingUrl, parseEbayPage } from "../../extension/src/adapters/ebay";
import type { PageData } from "../../extension/src/adapters/page";
import { runRules } from "../src/rules";

const base = (over: Partial<PageData> = {}): PageData => ({
  url: "https://www.ebay.com/itm/Trek-FX-2-Hybrid-Bike-Medium/256789012345?hash=item3b",
  documentTitle: "Trek FX 2 Hybrid Bike Medium | eBay",
  meta: {
    "og:title": "Trek FX 2 Hybrid Bike Medium | eBay",
    "og:image": "https://i.ebayimg.com/images/g/AAAOSw1/s-l500.jpg",
  },
  jsonLd: [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] },
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Trek FX 2 Hybrid Bike Medium",
      brand: { "@type": "Brand", name: "Trek" },
      image: [
        "https://i.ebayimg.com/images/g/AAAOSw1/s-l1600.jpg",
        "https://i.ebayimg.com/images/g/BBBOSw2/s-l1600.jpg",
      ],
      offers: {
        "@type": "Offer",
        price: "349.99",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
      },
    },
  ],
  text: "Trek FX 2 Hybrid Bike Medium\nUS $349.99\nCondition: Used\nLocated in: Madison, Wisconsin, United States\nSimilar items\nUS $20.00",
  headings: ["Trek FX 2 Hybrid Bike Medium"],
  links: [{ href: "https://www.ebay.com/sch/i.html?_ssn=other_seller", text: "Other" }],
  images: [
    { src: "https://i.ebayimg.com/images/g/AAAOSw1/s-l140.jpg", alt: "", width: 64, height: 64 },
    { src: "https://i.ebayimg.com/images/g/CCCOSw3/s-l140.jpg", alt: "", width: 64, height: 64 },
  ],
  sections: {
    seller: {
      text: "madison_bike_co\n(1,234)\n99.6% positive\n2.1K items sold\nJoined Mar 2014",
      links: [{ href: "https://www.ebay.com/usr/madison_bike_co?_trksid=p1", text: "madison_bike_co" }],
    },
  },
  ...over,
});

test("recognizes eBay item URLs", () => {
  assert.ok(isEbayListingUrl("https://www.ebay.com/itm/256789012345"));
  assert.ok(isEbayListingUrl("https://www.ebay.com/itm/Some-Title/256789012345?x=1"));
  assert.ok(!isEbayListingUrl("https://www.ebay.com/sch/i.html?_nkw=bike"));
  assert.ok(!isEbayListingUrl("https://ebay.com.evil.example/itm/256789012345"));
});

test("parses title, price, photos and seller", () => {
  const l = parseEbayPage(base());
  assert.ok(l);
  assert.equal(l.platform, "ebay");
  assert.equal(l.id, "256789012345");
  assert.equal(l.url, "https://www.ebay.com/itm/256789012345");
  assert.equal(l.title, "Trek FX 2 Hybrid Bike Medium");
  assert.equal(l.price, 349.99);
  assert.equal(l.currency, "USD");
  assert.equal(l.brand, "Trek");
  assert.equal(l.condition, "Used");
  assert.equal(l.status, "available");
  assert.equal(l.location, "Madison, Wisconsin, United States");
  // JSON-LD photos, og:image deduped against them, carousel thumbs upscaled.
  assert.deepEqual(l.photos, [
    "https://i.ebayimg.com/images/g/AAAOSw1/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/BBBOSw2/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/CCCOSw3/s-l1600.jpg",
  ]);
  assert.equal(l.seller.id, "madison_bike_co");
  assert.equal(l.seller.profileUrl, "https://www.ebay.com/usr/madison_bike_co");
  assert.equal(l.seller.feedbackScore, 1234);
  assert.equal(l.seller.positiveFeedbackPercent, 99.6);
  assert.equal(l.seller.itemsSoldDisplay, "2.1K");
  assert.equal(l.seller.joinedAt, "2014-03-01");
  assert.equal(l.seller.joinedPrecision, "month");
});

test("falls back to og tags, page text and search links without JSON-LD", () => {
  const l = parseEbayPage(
    base({
      jsonLd: [],
      images: [],
      sections: {},
      text: "Trek FX 2\nUS $1,050.00\n(3)\n80% positive",
      links: [{ href: "https://www.ebay.com/sch/i.html?_ssn=new_seller_99", text: "See other items" }],
    }),
  );
  assert.ok(l);
  assert.equal(l.title, "Trek FX 2 Hybrid Bike Medium");
  assert.equal(l.price, 1050);
  assert.deepEqual(l.photos, ["https://i.ebayimg.com/images/g/AAAOSw1/s-l1600.jpg"]);
  assert.equal(l.seller.id, "new_seller_99");
  assert.equal(l.seller.feedbackScore, 3);
});

test("returns null when there's no title or price", () => {
  assert.equal(parseEbayPage(base({ jsonLd: [], meta: {}, headings: [], text: "" })), null);
  assert.equal(parseEbayPage(base({ url: "https://www.ebay.com/" })), null);
});

test("rules use eBay feedback", () => {
  const good = runRules(parseEbayPage(base())!);
  assert.ok(good.signals.some((s) => s.id === "track-record"));
  assert.ok(good.signals.some((s) => s.id === "old-account"));

  const risky = parseEbayPage(
    base({ sections: { seller: { text: "x (2)\n90% positive\nJoined Nov 2026", links: [] } } }),
  )!;
  const ids = runRules(risky).signals.map((s) => s.id);
  assert.ok(ids.includes("no-track-record"), ids.join(", "));
  assert.ok(ids.includes("new-account"), ids.join(", "));
});
