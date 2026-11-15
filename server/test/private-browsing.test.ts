// Private browsing (design doc "DealDig Private Browsing"): tracker rules,
// URL cleaning, what a listing check sends, Safe Browsing URL expressions,
// the history vault, and the server's photo opt-in and text retention.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCleanUrlRules,
  buildStrictRules,
  buildTrackerRules,
  canonicalUrl,
  cookieClearOrigins,
  forAnalysis,
  RULE_BASE,
  RULESET,
  SHIELD_SITES,
  stripTrackingParams,
  summarizeSent,
  trackerForRule,
  TRACKERS,
  CATEGORY_LABEL,
} from "../../shared/privacy";
import { registrableDomain } from "../../shared/linkCheck";
import { canPeekPrivately, isListingUrl } from "../../extension/src/privacy/listingUrl";
import { isSealed, newKey, seal, unseal } from "../../extension/src/privacy/vaultCore";
import { openHow } from "../../extension/src/privacy/openHow";
import { unwrapRedirector } from "../../extension/src/guardCore";
import { urlExpressions } from "../src/safeBrowsing";
import type { Listing } from "../../shared/types";

process.env.DEALDIG_DB = ":memory:";
const { db, purgeOldListingTexts, saveListingText } = await import("../src/db");
const { listingPlan } = await import("../src/analyze");

// --- Tracker shield rules ---------------------------------------------------

test("tracker rules: unique ids, a category for every tracker, and a way back from rule to tracker", () => {
  const rules = [...buildTrackerRules(), ...buildStrictRules(), ...buildCleanUrlRules()];
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  assert.ok(rules.every((r) => r.id < RULE_BASE.pause), "static ids stay below the per-site pause range");
  for (const t of TRACKERS) assert.ok(CATEGORY_LABEL[t.category]);
  const rules0 = buildTrackerRules();
  rules0.forEach((r, i) => assert.equal(trackerForRule(RULESET.trackers, r.id), TRACKERS[i]));
  assert.equal(trackerForRule("_dynamic", rules0[0].id), null);
});

test("tracker rules: third-party only, never main_frame, and never block a marketplace", () => {
  for (const r of buildTrackerRules()) {
    const c = r.condition as { domainType: string; resourceTypes: string[]; requestDomains?: string[]; initiatorDomains: string[] };
    assert.equal(c.domainType, "thirdParty");
    assert.ok(!c.resourceTypes.includes("main_frame"));
    for (const d of c.requestDomains ?? []) assert.ok(!SHIELD_SITES.includes(registrableDomain(d)), `${d} is a marketplace`);
  }
});

test("tracker rules: Meta's trackers are left alone on Facebook itself (first party there)", () => {
  const rules = buildTrackerRules();
  const pixel = rules[TRACKERS.findIndex((t) => t.domain === "connect.facebook.net")];
  const tr = rules[TRACKERS.findIndex((t) => t.path === "/tr")];
  for (const r of [pixel, tr]) {
    const initiators = (r.condition as { initiatorDomains: string[] }).initiatorDomains;
    assert.ok(!initiators.includes("facebook.com") && initiators.includes("poshmark.com"));
  }
  assert.equal((tr.condition as { urlFilter: string }).urlFilter, "||facebook.com/tr^");
});

test("clean-URL rule fires only when a tracking tag is present", () => {
  const [rule] = buildCleanUrlRules();
  const re = new RegExp((rule.condition as { regexFilter: string }).regexFilter);
  assert.ok(re.test("https://www.ebay.com/itm/123?_trksid=p2&mkevt=1"));
  assert.ok(re.test("https://poshmark.com/listing/x-1?utm_source=fb"));
  assert.ok(!re.test("https://poshmark.com/listing/x-1"));
  assert.ok(!re.test("https://poshmark.com/listing/x-1?size=M"));
  assert.ok(!re.test("https://poshmark.com/listing/x-1?my_utm_source=1"));
});

test("tracker cookies: only tracker-only domains, never one that would sign the user out", () => {
  const origins = cookieClearOrigins();
  assert.ok(origins.includes("https://doubleclick.net"));
  for (const o of origins) {
    const host = new URL(o).hostname;
    assert.equal(registrableDomain(host), host);
    assert.ok(!["google.com", "facebook.com", "linkedin.com", "pinterest.com", "twitter.com", "tiktok.com"].includes(host));
  }
});

// --- URL cleaning -------------------------------------------------------------

test("stripTrackingParams keeps the page's own parameters", () => {
  assert.equal(stripTrackingParams("https://shop.example/p?id=7&utm_source=fb&fbclid=abc#top"), "https://shop.example/p?id=7#top");
  assert.equal(stripTrackingParams("https://shop.example/p?id=7"), "https://shop.example/p?id=7");
  assert.equal(stripTrackingParams("not a url"), "not a url");
});

test("a Facebook-wrapped outbound link is unwrapped and cleaned", () => {
  const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent("https://pay-me.example/x?fbclid=IwAR0&ref=2")}&h=AT0`;
  assert.equal(stripTrackingParams(unwrapRedirector(wrapped)), "https://pay-me.example/x?ref=2");
});

test("outbound clicks open the way the browser would have", () => {
  const click = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false };
  assert.equal(openHow(click, ""), "same-tab");
  assert.equal(openHow(click, "_blank"), "new-tab");
  assert.equal(openHow({ ...click, button: 1 }, ""), "background-tab");
  assert.equal(openHow({ ...click, metaKey: true }, ""), "background-tab");
  assert.equal(openHow({ ...click, shiftKey: true }, ""), "new-tab");
});

test("listing URLs: listings match, search and profile pages don't", () => {
  for (const u of [
    "https://www.ebay.com/itm/123456789012",
    "https://www.facebook.com/marketplace/item/987654321/",
    "https://poshmark.com/listing/Nike-Dunk-Low-65a1b2c3d4e5f6a7b8c9d0e1",
    "https://www.mercari.com/us/item/m12345678901/",
    "https://www.etsy.com/listing/1234567/handmade-mug",
    "https://www.depop.com/products/seller-vintage-tee/",
  ])
    assert.ok(isListingUrl(u), u);
  for (const u of ["https://www.ebay.com/sch/i.html?_nkw=ps5", "https://poshmark.com/closet/someone", "https://www.facebook.com/marketplace/", "https://example.com/listing/1"])
    assert.ok(!isListingUrl(u), u);
  assert.ok(canPeekPrivately("https://www.ebay.com/itm/123456789012"));
  assert.ok(!canPeekPrivately("https://www.facebook.com/marketplace/item/987654321/"), "Facebook needs a login");
});

// --- What a listing check sends ---------------------------------------------

const listing: Listing = {
  platform: "poshmark",
  id: "65a1b2c3",
  url: "https://poshmark.com/listing/Nike-Dunk-65a1b2c3?utm_source=ig&sid=SESSION#photos",
  title: "Nike Dunk",
  description: "Brand new",
  price: 80,
  currency: "USD",
  photos: ["https://di2ponv0v5otw.cloudfront.net/a.jpg"],
  seller: { platform: "poshmark", id: "u1", username: "seller1", displayName: "Seller", profileUrl: "" },
};

test("the listing goes out with its link cut to the canonical form, nothing else changed", () => {
  const sent = forAnalysis(listing);
  assert.equal(sent.url, "https://poshmark.com/listing/Nike-Dunk-65a1b2c3");
  assert.deepEqual({ ...sent, url: listing.url }, listing);
  assert.equal(canonicalUrl("nope"), "nope");
});

test("the 'DealDig sent' summary is built from the request itself", () => {
  const s = summarizeSent(listing, forAnalysis(listing), ["abcd", null], { webPhotos: false }, 1);
  assert.deepEqual(s, {
    at: 1,
    fields: ["title", "price", "description", "photo links", "seller's public profile", "listing link (no tags)"],
    photoFingerprints: 1,
    webPhotos: false,
    linkTrimmed: true,
  });
});

// --- Safe Browsing URL expressions (spec example) ----------------------------

test("Safe Browsing expressions follow the spec's example", () => {
  assert.deepEqual(urlExpressions("http://a.b.c/1/2.html?param=1").sort(), [
    "a.b.c/",
    "a.b.c/1/",
    "a.b.c/1/2.html",
    "a.b.c/1/2.html?param=1",
    "b.c/",
    "b.c/1/",
    "b.c/1/2.html",
    "b.c/1/2.html?param=1",
  ]);
  // At most 5 hosts × 6 paths, and an IP address isn't split into parent domains.
  const deep = urlExpressions("https://a.b.c.d.e.f.g/1/2/3/4/5/6.html?x=1");
  assert.ok(deep.length <= 30 && deep.includes("f.g/") && !deep.some((e) => e.startsWith("b.c.d.e.f.g/")));
  assert.deepEqual(urlExpressions("http://1.2.3.4/").sort(), ["1.2.3.4/"]);
});

// --- History vault --------------------------------------------------------------

test("history vault: round-trips, and a changed byte or another key fails", async () => {
  const key = await newKey();
  const sealed = await seal(key, [{ title: "Nike Dunk", score: 72 }]);
  assert.ok(isSealed(sealed) && !sealed.data.includes("Nike"));
  assert.deepEqual(await unseal(key, sealed), [{ title: "Nike Dunk", score: 72 }]);
  await assert.rejects(unseal(await newKey(), sealed));
  const flipped = { ...sealed, data: (sealed.data[0] === "A" ? "B" : "A") + sealed.data.slice(1) };
  await assert.rejects(unseal(key, flipped));
});

// --- Server ---------------------------------------------------------------------

test("server: photos go to outside services only when the user opted in", () => {
  const saved = { vision: process.env.GOOGLE_VISION_API_KEY, text: process.env.DEALDIG_WEB_TEXT_SEARCH, ai: process.env.ANTHROPIC_API_KEY };
  process.env.GOOGLE_VISION_API_KEY = "test";
  process.env.DEALDIG_WEB_TEXT_SEARCH = "off";
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.ok(listingPlan({ webPhotos: true }).includes("web"));
    assert.ok(!listingPlan({ webPhotos: false }).includes("web"));
  } finally {
    for (const [k, v] of [["GOOGLE_VISION_API_KEY", saved.vision], ["DEALDIG_WEB_TEXT_SEARCH", saved.text], ["ANTHROPIC_API_KEY", saved.ai]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("server: listing descriptions older than 30 days are purged", () => {
  const row = { platform: "poshmark", url: "https://poshmark.com/listing/x", title: "T", sellerId: "s", sellerUsername: "u", text: "some description" };
  saveListingText({ ...row, id: "old" });
  saveListingText({ ...row, id: "new" });
  db.prepare(`UPDATE listing_texts SET seen_at = datetime('now', '-31 days') WHERE listing_id = 'old'`).run();
  assert.equal(purgeOldListingTexts(), 1);
  const left = db.prepare(`SELECT listing_id AS id FROM listing_texts`).all() as { id: string }[];
  assert.deepEqual(left.map((r) => r.id), ["new"]);
});
