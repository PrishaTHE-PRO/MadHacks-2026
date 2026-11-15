import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Listing } from "../../shared/types";
import type { ListingAnalysis } from "../src/claude";

process.env.DEALDIG_DB = ":memory:";
process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.EBAY_CLIENT_ID;
delete process.env.EBAY_CLIENT_SECRET;
const listing: Listing = JSON.parse(readFileSync(new URL("./fixtures/facebook-flyer.json", import.meta.url), "utf8"));
const jpeg = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/images/flyer.jpg", import.meta.url)).toString("base64")}`;
const analysis: ListingAnalysis = {
  item: { brand: null, model: null, category: "Food event", condition: null },
  search_query: "food event", price_estimate: { typical_low: null, typical_high: null, confidence: "low", note: "Event promotion" },
  red_flags: [], risk_adjust: 0, listing_type: "event_or_promo", price_looks_placeholder: true,
  photos: [{ index: 0, kind: "graphic_flyer_or_ad", ai_generated: "likely", shows_listed_item: false, note: "Garbled lettering." }],
};

test("pipeline sends image bytes and scores findings; text-only and failed checks stay partial", async (t) => {
  let output = analysis;
  let fail = false;
  let sent: { type: string; source?: { type: string; data?: string }; text?: string }[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages, "only the mocked Claude call should be made");
    sent = body.messages[0].content;
    if (fail) return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "test failure" } }), { status: 401 });
    return new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "test-model", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 1, output_tokens: 1 },
    }), { headers: { "content-type": "application/json" } });
  });
  try {
    const { analyzeListing } = await import("../src/analyze");
    await t.test("supplied JPEG is sent as base64 and the flyer stays low risk with an AI-photo notice", async () => {
      const report = await analyzeListing(listing, undefined, undefined, undefined, [jpeg]);
      assert.equal(sent.find((block) => block.type === "image")?.source?.type, "base64");
      assert.equal(report.score, 15); // the AI-looking photo is a notice, not points
      assert.equal(report.aiImage?.verdict, "likely");
      assert.equal(report.level, "low");
      assert.equal(report.coverage.seller, false);
      assert.equal(report.coverage.ai, true);
      assert.deepEqual(report.coverage.photos, { checked: 1, total: 1 });
      assert.equal(report.listingType, "event_or_promo");
    });
    await t.test("missing photos still allow text analysis, but invented photo findings are discarded", async () => {
      const report = await analyzeListing(listing); // local fixture path cannot be fetched
      assert.ok(!sent.some((block) => block.type === "image"));
      assert.equal(report.coverage.ai, true);
      assert.equal(report.coverage.photos.checked, 0);
      assert.equal(report.score, 15);
      assert.ok(!report.signals.some((s) => s.id === "ai-photo-likely"));
      assert.match(report.summary, /^Partial check:/);
    });
    await t.test("duplicate and out-of-range photo indices cannot inflate coverage", async () => {
      output = { ...analysis, photos: [analysis.photos[0], analysis.photos[0], { ...analysis.photos[0], index: 8 }] };
      const report = await analyzeListing(listing, undefined, undefined, undefined, [jpeg]);
      assert.equal(report.coverage.photos.checked, 1);
      assert.equal(report.photoAssessments?.length, 1);
    });
    await t.test("an API failure exposes the missing AI/photo checks", async () => {
      fail = true;
      const report = await analyzeListing(listing, undefined, undefined, undefined, [jpeg]);
      assert.equal(report.aiUsed, false);
      assert.equal(report.coverage.ai, false);
      assert.equal(report.aiUnavailableReason, "API key rejected (HTTP 401)");
      assert.equal(report.coverage.photos.checked, 0);
      assert.match(report.summary, /^Partial check:/);
    });
  } finally { fetchMock.mock.restore(); }
});
