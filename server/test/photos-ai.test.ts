import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runRules, levelFor, type AiFindings } from "../src/rules";
import type { Listing, PhotoAssessment } from "../../shared/types";
import { canReuseListingReport, riskLabel } from "../../shared/listingCheck";

const flyer: Listing = JSON.parse(readFileSync(new URL("./fixtures/facebook-flyer.json", import.meta.url), "utf8"));
const photo: PhotoAssessment = {
  index: 0, kind: "graphic_flyer_or_ad", ai_generated: "likely", shows_listed_item: false,
  note: "Garbled lettering and warped food details.",
};
const findings = (over: Partial<AiFindings> = {}): AiFindings => ({
  redFlags: [], riskAdjust: 0, listingType: "event_or_promo", photos: [photo], priceLooksPlaceholder: true, ...over,
});
const has = (r: ReturnType<typeof runRules>, id: string) => r.signals.some((s) => s.id === id);

test("Food/comida with a likely AI flyer stays low risk; the AI photo is a notice, not points", () => {
  const result = runRules(flyer, { ai: findings() });
  assert.equal(result.score, 15);
  assert.equal(levelFor(result.score), "low");
  assert.ok(!result.signals.some((s) => s.id.startsWith("ai-photo")));
  assert.ok(has(result, "placeholder-price"));
  assert.equal(result.signals.find((s) => s.id === "not-an-item")?.points, 0);
  assert.ok(!has(result, "no-real-photo"));
});

test("a flyer posing as an item also gets the missing-item-photo warning", () => {
  const result = runRules(flyer, { ai: findings({ listingType: "item_for_sale" }) });
  assert.equal(result.score, 35);
  assert.ok(has(result, "no-real-photo"));
});

test("placeholder prices are caught without AI", () => {
  for (const price of [0, 1, 1234, 12345, 9999, 99999])
    assert.ok(has(runRules({ ...flyer, price }), "placeholder-price"));
});

test("ordinary bike photos and a new eBay catalog photo do not get photo warnings", () => {
  for (const kind of ["real_photo_of_item", "stock_or_catalog"] as const) {
    const listing = { ...flyer, platform: "ebay" as const, title: "Bike", price: 180, photos: ["a", "b", "c", "d"] };
    const result = runRules(listing, { ai: findings({
      listingType: "item_for_sale", priceLooksPlaceholder: false,
      photos: listing.photos.map((_, index) => ({ ...photo, index, kind, ai_generated: "no", shows_listed_item: true })),
    }) });
    assert.equal(result.score, 0);
    assert.ok(!has(result, "no-real-photo"));
    assert.ok(!has(result, "ai-photo-likely"));
    assert.ok(!has(result, "placeholder-price"));
  }
});

test("uncertain AI evidence adds no points either", () => {
  const possible = { ...photo, ai_generated: "possible" as const };
  const result = runRules(flyer, { ai: findings({ photos: [possible] }) });
  assert.equal(result.score, 15);
  assert.ok(!result.signals.some((s) => s.id.startsWith("ai-photo")));
});

test("duplicate AI-generated and flyer text does not score the photo twice", () => {
  const result = runRules(flyer, { ai: findings({ redFlags: ["Looks AI-generated.", "An event flyer."], riskAdjust: 15 }) });
  assert.equal(result.score, 15);
  assert.ok(!result.signals.some((s) => /^ai-\d+$/.test(s.id)));
});

test("failed or missing image assessments cannot imply none of the photos show the item", () => {
  for (const photos of [[], [photo]]) {
    const result = runRules({ ...flyer, photos: ["a", "b"] }, { ai: findings({ listingType: "item_for_sale", photos }) });
    assert.ok(!has(result, "no-real-photo"));
  }
});

test("missing coverage qualifies low-risk labels; medium/high keep their labels", () => {
  const coverage = { seller: false, photos: { checked: 0, total: 1 }, ai: false, price: false };
  assert.equal(riskLabel({ level: "low", coverage }), "Low risk · partial check");
  assert.equal(riskLabel({ level: "medium", coverage }), "Be careful");
  assert.equal(riskLabel({ level: "high", coverage }), "High risk");
  assert.equal(riskLabel({ level: "low", coverage: { seller: true, photos: { checked: 1, total: 1 }, ai: true, price: true } }), "Low risk");
});

test("cached failed AI or photo checks are retried, while successful checks are reused", () => {
  const coverage = { seller: false, photos: { checked: 1, total: 1 }, ai: true, price: false };
  assert.equal(canReuseListingReport({ coverage }), true);
  assert.equal(canReuseListingReport({ coverage: { ...coverage, ai: false } }), false);
  assert.equal(canReuseListingReport({ coverage: { ...coverage, photos: { checked: 0, total: 1 } } }), false);
  assert.equal(canReuseListingReport({ coverage: { ...coverage, photos: { checked: 3, total: 8 } } }), false);
  assert.equal(canReuseListingReport({ coverage: { ...coverage, photos: { checked: 4, total: 8 } } }), true);
  assert.equal(canReuseListingReport({ coverage: { ...coverage, photos: { checked: 0, total: 0 } } }), true);
});

test("Claude's per-photo assessment feeds the single AI-photo notice", async () => {
  const { claudeAiPhotoView, combineAiImage } = await import("../src/aiImage");
  const view = claudeAiPhotoView([photo, { ...photo, index: 1, ai_generated: "no", note: "" }]);
  assert.deepEqual(view, { verdict: "likely", photo_numbers: [1], evidence: ["Photo 1: Garbled lettering and warped food details."] });
  const notice = combineAiImage({ ...flyer, photos: ["a", "b"] }, view, [], []);
  assert.equal(notice?.verdict, "likely");
  assert.deepEqual(notice?.photoIndexes, [0]);
  assert.equal(claudeAiPhotoView(undefined), undefined);
});
