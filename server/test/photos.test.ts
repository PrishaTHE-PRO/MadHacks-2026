// Stolen-photo check tests (spec §3.1): the dHash itself, mirror matching,
// which matches count, and the points they add.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dhashFromRgba, hamming, MATCH_DISTANCE, mirrorHash, reverseSearchLinks } from "../../shared/photohash";
import { matchPhotos, otherSellerMatches } from "../src/photos";
import { POINTS, runRules } from "../src/rules";
import type { StoredPhoto } from "../src/db";
import type { Listing, PhotoMatch } from "../../shared/types";

/** A synthetic RGBA "photo": smooth gradients plus a bright blob, so it has structure. */
function photo(w: number, h: number, opts: { seed?: number; flip?: boolean; noise?: number; tint?: number } = {}) {
  const { seed = 1, flip = false, noise = 0, tint = 0 } = opts;
  const data = new Uint8ClampedArray(w * h * 4);
  let r = seed * 9973;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 0; y < h; y++) {
    for (let x0 = 0; x0 < w; x0++) {
      const x = flip ? w - 1 - x0 : x0;
      const u = x / w, v = y / h;
      const blob = Math.exp(-((u - 0.3 * seed) ** 2 + (v - 0.6) ** 2) * 12) * 160;
      const base = 60 + 80 * Math.sin(u * 3 * seed + v * 2) + blob + (rand() - 0.5) * noise;
      const i = (y * w + x0) * 4;
      data[i] = base + tint;
      data[i + 1] = base * 0.9;
      data[i + 2] = base * 0.7;
      data[i + 3] = 255;
    }
  }
  return data;
}

test("dHash: same photo at another size, with noise and a color tint, still matches", () => {
  const a = dhashFromRgba(photo(720, 640), 720, 640)!;
  const b = dhashFromRgba(photo(300, 260, { noise: 20, tint: 15 }), 300, 260)!;
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(hamming(a, b) <= MATCH_DISTANCE, `distance ${hamming(a, b)}`);
});

test("dHash: different photos don't match", () => {
  const a = dhashFromRgba(photo(200, 200, { seed: 1 }), 200, 200)!;
  const b = dhashFromRgba(photo(200, 200, { seed: 2.3 }), 200, 200)!;
  assert.ok(hamming(a, b) > MATCH_DISTANCE, `distance ${hamming(a, b)}`);
});

test("dHash: a blank image has no fingerprint", () => {
  const flat = new Uint8ClampedArray(50 * 50 * 4).fill(200);
  assert.equal(dhashFromRgba(flat, 50, 50), null);
});

test("mirrorHash: matches the hash of the flipped photo, and is its own inverse", () => {
  const a = dhashFromRgba(photo(180, 160), 180, 160)!;
  const flipped = dhashFromRgba(photo(180, 160, { flip: true }), 180, 160)!;
  assert.ok(hamming(mirrorHash(a), flipped) <= 2, `distance ${hamming(mirrorHash(a), flipped)}`);
  assert.equal(mirrorHash(mirrorHash(a)), a);
});

const listing = (over: Partial<Listing> = {}, seller: Partial<Listing["seller"]> = {}): Listing => ({
  platform: "facebook",
  id: "L1",
  url: "https://www.facebook.com/marketplace/item/L1/",
  title: "Trek FX 2",
  description: "Rides great.",
  price: 350,
  currency: "USD",
  photos: ["a", "b", "c"],
  seller: { platform: "facebook", id: "me", username: "Sam Lee", profileUrl: "", ...seller },
  ...over,
});

const stored = (over: Partial<StoredPhoto>): StoredPhoto => ({
  platform: "facebook",
  listingId: "L9",
  photoIndex: 0,
  hash: "0123456789abcdef",
  sellerId: "other",
  sellerUsername: "Alex Kim",
  listingUrl: "https://www.facebook.com/marketplace/item/L9/",
  listingTitle: "Trek bike",
  seenAt: "2026-11-12 18:00:00",
  ...over,
});

test("matchPhotos: near and mirrored matches, one per photo and listing", () => {
  const h = "0123456789abcdef";
  const near = "0123456789abcdee"; // 1 bit off
  const matches = matchPhotos(
    [h, null, "ffffffffffffffff"],
    [
      stored({ hash: near }),
      stored({ hash: near, photoIndex: 1 }), // same other listing again: counted once
      stored({ listingId: "L8", listingUrl: "https://www.facebook.com/marketplace/item/L8/", hash: mirrorHash(h) }),
      stored({ listingId: "L7", listingUrl: "https://www.facebook.com/marketplace/item/L7/", hash: "fedcba9876543210" }), // unrelated
    ],
  );
  assert.deepEqual(
    matches.map((m) => [m.photoIndex, m.listingUrl.includes("L9") ? "L9" : "L8", m.mirrored]),
    [
      [0, "L9", false],
      [0, "L8", true],
    ],
  );
  assert.equal(matches[0].seenAt, "2026-11-12T18:00:00Z");
});

const match = (over: Partial<PhotoMatch> = {}): PhotoMatch => ({
  photoIndex: 0,
  platform: "facebook",
  sellerId: "other",
  sellerUsername: "Alex Kim",
  listingUrl: "u",
  listingTitle: "t",
  seenAt: "2026-11-12T18:00:00Z",
  mirrored: false,
  ...over,
});

test("otherSellerMatches: ignores the seller's own listings and same-handle crossposts", () => {
  const l = listing({ platform: "poshmark" }, { platform: "poshmark", id: "jane1", username: "jane" });
  const kept = otherSellerMatches(l, [
    match({ platform: "poshmark", sellerId: "jane1" }), // own relist
    match({ platform: "ebay", sellerId: "x", sellerUsername: "Jane" }), // same handle on eBay
    match({ platform: "ebay", sellerId: "y", sellerUsername: "bob" }),
    match({ platform: "poshmark", sellerId: "" }), // unknown seller: can't tell
  ]);
  assert.deepEqual(kept.map((m) => m.sellerId), ["y"]);
  assert.deepEqual(otherSellerMatches(listing({}, { id: "" }), [match()]), []);
});

const points = (r: ReturnType<typeof runRules>, id: string) => r.signals.find((s) => s.id === id)?.points;

test("rules: same-site reuse +25, other-site +10, stock photos 0", () => {
  assert.equal(points(runRules(listing(), { photoMatches: [match()] }), "photo-reused"), POINTS.photoReused);
  assert.equal(
    points(runRules(listing(), { photoMatches: [match({ platform: "ebay", sellerUsername: "bob" })] }), "photo-reused-other-site"),
    POINTS.photoReusedOtherSite,
  );
  const stock = runRules(listing(), { photoMatches: ["a", "b", "c", "d"].map((id) => match({ sellerId: id })) });
  assert.equal(points(stock, "stock-photo"), 0);
  assert.equal(points(stock, "photo-reused"), undefined);
  assert.equal(runRules(listing(), { photoMatches: [] }).signals.some((s) => s.id.startsWith("photo")), false);
});

test("reverseSearchLinks encode the photo URL", () => {
  const l = reverseSearchLinks("https://i.ebayimg.com/images/g/x/s-l1600.jpg?a=1&b=2");
  assert.equal(l.lens, "https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fi.ebayimg.com%2Fimages%2Fg%2Fx%2Fs-l1600.jpg%3Fa%3D1%26b%3D2");
  assert.ok(l.tineye.startsWith("https://tineye.com/search?url=https%3A%2F%2F"));
});
