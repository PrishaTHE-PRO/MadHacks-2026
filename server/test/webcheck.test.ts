// Web duplicate checks: who posted a copy of the photos or text, how it's
// scored (same seller fine, another seller flagged with proof links), copied
// description matching, and the AI-photo notice (never scored).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Listing, PhotoMatch, TextMatch, WebPhotoMatch } from "../../shared/types";
import { accountFromHtml, accountFromUrl, compareAccount, isSameListing, resolveOwner, siteInfo } from "../src/sellerIdentity";
import { isBlockedHost, safeUrl } from "../src/webFetch";
import { classifyPages } from "../src/webPhotos";
import { localTextMatches, longEnough, overlap, searchSentences, verifyHits } from "../src/textMatch";
import { combineAiImage } from "../src/aiImage";
import { POINTS, runRules, levelFor } from "../src/rules";
import { fallbackSummary } from "../src/analyze";
import type { StoredText } from "../src/db";

const DESCRIPTION =
  "Bought this Coach Tabby at the Chicago outlet last spring and carried it maybe five times. " +
  "Small scuff on the back corner near the strap ring, shown in photo four, otherwise the leather is clean and soft. " +
  "Comes with the dust bag and the original receipt. Smoke free home.";

const listing = (over: Partial<Listing> = {}): Listing => ({
  platform: "poshmark",
  id: "p1",
  url: "https://poshmark.com/listing/Coach-Tabby-p1",
  title: "Coach Tabby 26 shoulder bag",
  description: DESCRIPTION,
  price: 180,
  currency: "USD",
  condition: "Used",
  photos: ["https://di2ponv0v5otw.cloudfront.net/a.jpg", "https://di2ponv0v5otw.cloudfront.net/b.jpg"],
  seller: { platform: "poshmark", id: "seller1", username: "mia_closet", profileUrl: "https://poshmark.com/closet/mia_closet" },
  ...over,
});

const webMatch = (over: Partial<WebPhotoMatch> = {}): WebPhotoMatch => ({
  photoIndex: 0,
  pageUrl: "https://www.depop.com/products/thriftqueen-coach-tabby-bag/",
  pageTitle: "Coach Tabby bag | Depop",
  site: "depop.com",
  siteName: "Depop",
  kind: "marketplace",
  owner: "other-seller",
  username: "thriftqueen",
  match: "full",
  ...over,
});

// --- Who posted it ---

test("siteInfo: marketplaces, country sites, social, stock and AI-art sites", () => {
  assert.equal(siteInfo("https://www.ebay.co.uk/itm/123456789012").siteName, "eBay");
  assert.equal(siteInfo("https://m.ebay.com/itm/123456789012").kind, "marketplace");
  assert.equal(siteInfo("https://www.reddit.com/r/handbags/x").kind, "social");
  assert.equal(siteInfo("https://www.shutterstock.com/image-photo/x").kind, "stock");
  assert.equal(siteInfo("https://civitai.com/images/1").kind, "ai-art");
  assert.equal(siteInfo("https://www.nordstrom.com/s/coach").kind, "other");
});

test("accountFromUrl reads the account from profile and product URLs", () => {
  assert.equal(accountFromUrl("https://poshmark.com/closet/mia_closet")?.username, "mia_closet");
  assert.equal(accountFromUrl("https://www.depop.com/products/thriftqueen-coach-tabby-bag/")?.username, "thriftqueen");
  assert.equal(accountFromUrl("https://www.ebay.com/usr/bagdeals99")?.username, "bagdeals99");
  assert.equal(accountFromUrl("https://www.instagram.com/mia_closet/")?.username, "mia_closet");
  assert.equal(accountFromUrl("https://www.ebay.com/itm/123456789012"), null); // needs the page
});

test("accountFromHtml reads the seller from a fetched eBay page", () => {
  const html = `<a href="https://www.ebay.com/str/luxe_resale?_trksid=1">Visit store</a>`;
  assert.equal(accountFromHtml("https://www.ebay.com/itm/123456789012", html)?.username, "luxe_resale");
});

test("compareAccount: same handle anywhere is the same seller; other handles are other sellers", () => {
  const l = listing();
  assert.equal(compareAccount(l, { siteName: "Depop", username: "MIA_CLOSET" }), "same-seller");
  assert.equal(compareAccount(l, { siteName: "Depop", username: "thriftqueen" }), "other-seller");
  assert.equal(compareAccount(l, { siteName: "Poshmark", id: "seller1", username: "renamed" }), "same-seller");
  assert.equal(compareAccount(l, { siteName: "Poshmark", id: "seller2" }), "other-seller");
  assert.equal(compareAccount(l, { siteName: "Mercari", id: "8812" }), "unknown"); // an id on another site proves nothing
  assert.equal(compareAccount(l, null), "unknown");
});

test("resolveOwner fetches marketplace pages it can't read from the URL", async () => {
  const fetchPage = async (url: string) => ({ url, html: `<a href="/str/luxe_resale">store</a> ebay.com/str/luxe_resale` });
  const r = await resolveOwner(listing(), "https://www.ebay.com/itm/123456789012", { allowFetch: true, fetchPage });
  assert.deepEqual(r, { owner: "other-seller", username: "luxe_resale" });
  // Without permission to fetch, it stays unknown rather than guessing.
  assert.equal((await resolveOwner(listing(), "https://www.ebay.com/itm/123456789012")).owner, "unknown");
});

test("isSameListing ignores the listing's own page", () => {
  assert.ok(isSameListing(listing(), "https://poshmark.com/listing/Coach-Tabby-p1?utm=x"));
  assert.ok(!isSameListing(listing(), "https://poshmark.com/listing/Other-p2"));
});

test("webFetch refuses localhost, private IPs and non-http URLs", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "intranet", "[::1]"])
    assert.ok(isBlockedHost(h), h);
  assert.ok(!isBlockedHost("www.ebay.com"));
  assert.equal(safeUrl("file:///etc/passwd"), null);
  assert.equal(safeUrl("http://user:pw@example.com/"), null);
});

test("classifyPages drops the listing's own page and labels the rest", async () => {
  const l = listing();
  const matches = await classifyPages(
    l,
    1,
    {
      pagesWithMatchingImages: [
        { url: l.url, pageTitle: "own listing", fullMatchingImages: [{ url: "x" }] },
        { url: "https://www.depop.com/products/thriftqueen-coach-tabby-bag/", pageTitle: "<b>Coach</b> Tabby", partialMatchingImages: [{ url: "y" }] },
      ],
    },
    async () => ({ owner: "other-seller", username: "thriftqueen" }),
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].photoIndex, 1);
  assert.equal(matches[0].pageTitle, "Coach Tabby");
  assert.equal(matches[0].match, "partial");
  assert.equal(matches[0].siteName, "Depop");
});

// --- Scoring photo matches ---

test("photo posted by a different seller: danger, full points, links to the other listing", () => {
  const r = runRules(listing(), { webPhotoMatches: [webMatch()] });
  const s = r.signals.find((x) => x.id === "web-photo-other-seller")!;
  assert.equal(s.severity, "danger");
  assert.equal(s.points, POINTS.webPhotoOtherSeller);
  assert.match(s.text, /Depop listing by @thriftqueen, a different seller/);
  assert.equal(s.links?.[0].url, webMatch().pageUrl);
});

test("photo on the same seller's own page: a good sign, no points", () => {
  const r = runRules(listing(), {
    webPhotoMatches: [webMatch({ owner: "same-seller", username: "mia_closet", pageUrl: "https://www.depop.com/mia_closet/" })],
  });
  const s = r.signals.find((x) => x.id === "web-photo-same-seller")!;
  assert.equal(s.severity, "good");
  assert.equal(s.points, 0);
  assert.equal(r.score, 0);
});

test("photo in a listing whose seller couldn't be read: caution, smaller points", () => {
  const r = runRules(listing(), { webPhotoMatches: [webMatch({ owner: "unknown", username: undefined, siteName: "Mercari" })] });
  assert.equal(r.signals.find((x) => x.id === "web-photo-unknown")?.points, POINTS.webPhotoUnknownListing);
});

test("stock and catalog photos count for used items, not new ones", () => {
  const stock = webMatch({ kind: "stock", site: "shutterstock.com", siteName: "shutterstock.com", owner: "unknown", username: undefined });
  assert.equal(runRules(listing(), { webPhotoMatches: [stock] }).signals.find((x) => x.id === "web-photo-stock")?.points, POINTS.webPhotoStock);
  const fresh = runRules(listing({ condition: "New with tags" }), { webPhotoMatches: [stock] });
  assert.equal(fresh.signals.find((x) => x.id === "web-photo-stock")?.points, 0);
});

test("a photo used by many accounts is treated as a catalog photo, not proof of theft", () => {
  const many = ["a1", "b2", "c3", "d4"].map((u, i) => webMatch({ username: u, pageUrl: `https://www.depop.com/products/${u}-bag-${i}/` }));
  const r = runRules(listing(), { webPhotoMatches: many });
  assert.ok(!r.signals.some((x) => x.id === "web-photo-other-seller"));
  assert.equal(r.signals.find((x) => x.id === "web-photo-widespread")?.points, POINTS.webPhotoStock);
});

test("all photo findings together are capped", () => {
  const indexMatch: PhotoMatch = {
    photoIndex: 0,
    platform: "poshmark",
    sellerId: "s9",
    sellerUsername: "other_closet",
    listingUrl: "https://poshmark.com/listing/x-9",
    listingTitle: "Coach bag",
    seenAt: "2026-11-01T00:00:00Z",
    mirrored: false,
  };
  const r = runRules(listing(), {
    photoMatches: [indexMatch],
    webPhotoMatches: [webMatch(), webMatch({ owner: "unknown", username: undefined, pageUrl: "https://www.mercari.com/us/item/m1/", siteName: "Mercari" })],
  });
  const photoPoints = r.signals.filter((s) => s.id.startsWith("photo") || s.id.startsWith("web-photo")).reduce((n, s) => n + s.points, 0);
  assert.equal(photoPoints, POINTS.photosMax);
  // The index match now links to the other listing too.
  assert.equal(r.signals.find((s) => s.id === "photo-reused")?.links?.[0].url, indexMatch.listingUrl);
});

test("AI-art site matches never add points (they become the AI notice instead)", () => {
  const r = runRules(listing(), { webPhotoMatches: [webMatch({ kind: "ai-art", siteName: "civitai.com", owner: "unknown" })] });
  assert.equal(r.score, 0);
});

// --- Copied description ---

const stored = (over: Partial<StoredText> = {}): StoredText => ({
  platform: "poshmark",
  listingId: "p2",
  sellerId: "seller2",
  sellerUsername: "bag_flipper",
  listingUrl: "https://poshmark.com/listing/Coach-p2",
  listingTitle: "Coach Tabby",
  text: DESCRIPTION.replace("five times", "5 times"),
  ...over,
});

test("overlap finds the shared passage", () => {
  const o = overlap(DESCRIPTION, `Totally different intro. ${DESCRIPTION}`);
  assert.equal(o.overlap, 1);
  assert.match(o.excerpt, /^bought this coach tabby/);
});

test("localTextMatches: another seller's copy is flagged, the same seller's is fine", () => {
  const [other] = localTextMatches(listing(), [stored()]);
  assert.equal(other.owner, "other-seller");
  assert.ok(other.overlap >= 0.6);
  const [mine] = localTextMatches(listing(), [stored({ sellerId: "seller1", sellerUsername: "mia_closet" })]);
  assert.equal(mine.owner, "same-seller");
});

test("short or boilerplate-only descriptions aren't compared", () => {
  const generic = "Smoke free home. Bundle to save! Offers welcome. Ships same day. Check out my closet for more.";
  assert.ok(!longEnough(generic));
  assert.deepEqual(localTextMatches(listing({ description: generic }), [stored({ text: generic })]), []);
  assert.deepEqual(searchSentences(generic), []);
});

test("searchSentences picks the most distinctive sentences, about 20 words each", () => {
  const picked = searchSentences(DESCRIPTION);
  assert.equal(picked.length, 2);
  assert.ok(picked[0].startsWith("Small scuff on the back corner"));
  assert.ok(picked.every((s) => s.split(" ").length <= 20));
  assert.ok(!picked.some((s) => /smoke/i.test(s)));
});

test("verifyHits keeps only pages that really contain the text", async () => {
  const sentences = searchSentences(DESCRIPTION);
  const pages: Record<string, string> = {
    "https://www.ebay.com/itm/111111111111": `<html><body><p>${DESCRIPTION}</p><a href="https://www.ebay.com/usr/bag_flipper">seller</a></body></html>`,
    "https://www.ebay.com/itm/222222222222": "<html><body>Some other bag entirely, nothing in common with it.</body></html>",
  };
  const matches = await verifyHits(
    listing(),
    sentences,
    [
      { url: "https://www.ebay.com/itm/111111111111", title: "Coach Tabby" },
      { url: "https://www.ebay.com/itm/222222222222", title: "Other" },
      { url: listing().url, title: "this listing" },
    ],
    { fetchPage: async (url) => (pages[url] ? { url, html: pages[url] } : null) },
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].owner, "other-seller");
  assert.equal(matches[0].username, "bag_flipper");
  assert.equal(matches[0].source, "web");
});

test("copied description by another seller: danger, quoted, linked", () => {
  const t: TextMatch = {
    source: "web",
    url: "https://www.ebay.com/itm/111111111111",
    title: "Coach Tabby",
    site: "ebay.com",
    siteName: "eBay",
    kind: "marketplace",
    owner: "other-seller",
    username: "bag_flipper",
    excerpt: "small scuff on the back corner near the strap ring",
    overlap: 0.95,
  };
  const r = runRules(listing(), { textMatches: [t] });
  const s = r.signals.find((x) => x.id === "text-copied")!;
  assert.equal(s.points, POINTS.textCopiedOtherSeller);
  assert.match(s.text, /an eBay listing by @bag_flipper, a different seller \(95% the same\): "small scuff/);
  assert.equal(s.links?.[0].url, t.url);
  // The seller's own copy elsewhere is fine.
  const mine = runRules(listing(), { textMatches: [{ ...t, owner: "same-seller", username: "mia_closet" }] });
  assert.equal(mine.score, 0);
});

// --- AI-generated photos: a notice, never scored ---

test("combineAiImage merges Claude, the detector and AI-art matches", () => {
  const l = listing();
  assert.equal(combineAiImage(l, { verdict: "no", photo_numbers: [], evidence: [] }, [0.1], []), undefined);
  const fromClaude = combineAiImage(l, { verdict: "possible", photo_numbers: [2, 9], evidence: ["Photo 2: logo letters are warped"] }, [], []);
  assert.deepEqual(fromClaude?.photoIndexes, [1]); // photo 9 doesn't exist
  assert.equal(fromClaude?.verdict, "possible");
  const fromDetector = combineAiImage(l, undefined, [0.97], []);
  assert.equal(fromDetector?.verdict, "likely");
  assert.match(fromDetector!.evidence[0], /97% likely AI-generated/);
  const fromWeb = combineAiImage(l, undefined, [], [webMatch({ kind: "ai-art", siteName: "civitai.com", pageUrl: "https://civitai.com/images/1" })]);
  assert.equal(fromWeb?.links[0].url, "https://civitai.com/images/1");
});

// --- Score shown out of 100 ---

test("fallback summary says what to do next without repeating the score or reasons", () => {
  const r = runRules(listing(), { webPhotoMatches: [webMatch()] });
  const text = fallbackSummary(r, levelFor(r.score));
  assert.doesNotMatch(text, /\/100|\+\d/);
  assert.match(fallbackSummary(r, "medium"), /before you pay/);
  assert.match(fallbackSummary(r, "high"), /^Don't pay/);
  assert.match(fallbackSummary(runRules(listing({ photos: ["a", "b"] })), "low"), /^No red flags/);
});
