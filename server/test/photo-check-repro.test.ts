// Regression: missing AI/seller data must not give the Food/comida flyer an
// unqualified low-risk verdict. No network or real API key is needed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Listing } from "../../shared/types";

process.env.DEALDIG_DB = ":memory:"; // keep test checks out of the dev database
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { _fixture, ...listing } = JSON.parse(
  readFileSync(new URL("./fixtures/facebook-flyer.json", import.meta.url), "utf8"),
) as Listing & { _fixture: string };

test("fixture: the photo is a local test image, not a Facebook URL", () => {
  assert.equal(listing.photos.length, 1);
  assert.ok(!listing.photos[0].startsWith("http"), "photo should be a local fixture path");
  assert.ok(readFileSync(new URL(`../${listing.photos[0]}`, import.meta.url)).length > 0);
  assert.equal(listing.seller.id, "", "the seller wasn't read (Unknown seller)");
});

// The saved overlay page (Cmd+S on the real listing). It holds the user's own
// Facebook session, so it stays out of git; these checks skip without it.
const HTML = new URL("./fixtures/facebook-flyer.html", import.meta.url);

test("saved page: the overlay has the listing but no seller profile link", { skip: !existsSync(HTML) && "facebook-flyer.html not saved" }, () => {
  const html = readFileSync(HTML, "utf8");
  assert.ok(html.includes('role="dialog"'), "opened in the overlay view");
  assert.ok(html.includes("Food/comida") && html.includes("UWGB!"));
  // Why the seller is "Unknown seller": the adapter needs a /marketplace/profile/<id> link, and there is none.
  assert.equal(html.match(/\/marketplace\/profile\//g)?.length ?? 0, 0);
  assert.ok(!/Seller (information|details)/.test(html));
});

test("without an API key, the flyer has a placeholder warning and a partial check", async () => {
  const { analyzeListing } = await import("../src/analyze");
  const warn = mock.method(console, "warn", () => {});
  try {
    const report = await analyzeListing(listing);
    assert.equal(report.level, "low");
    assert.match(report.summary, /^Partial check:/);
    assert.equal(report.score, 15);
    assert.deepEqual(report.coverage, { seller: false, photos: { checked: 0, total: 1 }, ai: false, price: false });
    assert.deepEqual(
      report.signals.filter((s) => s.points > 0).map((s) => s.id),
      ["placeholder-price", "few-photos"],
    );
    assert.equal(report.aiUsed, false);
    assert.equal(report.aiUnavailableReason, "No API key configured on the server");
    // Phase 0: the skip is logged with platform/id only, never the title or photo URL.
    const lines = warn.mock.calls.map((c) => String(c.arguments[0]));
    assert.ok(
      lines.includes("[analyze] AI check skipped for facebook/1610701347365365: no API key (rules only)"),
      lines.join("\n"),
    );
    assert.ok(!lines.some((l) => l.includes("Food/comida") || l.includes("flyer.jpg")));
  } finally {
    warn.mock.restore();
  }
});

test("AI failure reasons are short and never echo the error text", async () => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { aiFailureReason, ClaudeRefusal } = await import("../src/claude");
  const secretUrl = "https://scontent.fbcdn.net/v/t39/SECRET.jpg?oh=abc";
  const badImage = new Anthropic.BadRequestError(
    400,
    { type: "error", error: { type: "invalid_request_error", message: `Unable to download the file at ${secretUrl}` } },
    `400 Unable to download the file at ${secretUrl}`,
    new Headers(),
  );
  assert.equal(aiFailureReason(badImage), "image fetch failed (HTTP 400)");
  assert.equal(aiFailureReason(new ClaudeRefusal("cyber")), "refusal (cyber)");
  assert.equal(aiFailureReason(new Error(secretUrl)), "other error (Error)");
  assert.ok(!aiFailureReason(badImage).includes("fbcdn"));
});
