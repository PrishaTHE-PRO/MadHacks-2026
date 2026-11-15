// Chat safety pre-filter tests (docs/chat-safety-task.md, Phase 1).
// Pure regex checks from shared/chatPatterns.ts, so no API key needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_PATTERNS, OFF_PLATFORM, prefilter, suspiciousLinks } from "../../shared/chatPatterns";
import {
  CHAT_PATTERN_IDS,
  type ChatContext,
  type ChatMessage,
  type ChatPatternId,
  type ChatPlatform,
  type ChatRole,
} from "../../shared/types";

const chat = (
  messages: (string | Partial<ChatMessage>)[],
  over: { platform?: ChatPlatform; role?: ChatRole } = {},
): ChatContext => ({
  platform: over.platform ?? "facebook",
  threadId: "t1",
  url: "https://www.facebook.com/messages/t/1",
  role: over.role ?? "unknown",
  messages: messages.map((m, i) =>
    typeof m === "string" ? { id: `m${i}`, fromMe: false, text: m } : { id: `m${i}`, fromMe: false, text: "", ...m },
  ),
});

/** Pattern ids flagged for a single message from the other party. */
const ids = (text: string, over?: Parameters<typeof chat>[1]) =>
  prefilter(chat([text], over))
    .map((f) => f.pattern)
    .sort();

const flagOf = (text: string, pattern: ChatPatternId, over?: Parameters<typeof chat>[1]) =>
  prefilter(chat([text], over)).find((f) => f.pattern === pattern);

// --- The cases from the task ---

// [message, expected patterns, the role this scam targets]
const SHOULD_FLAG: [string, ChatPatternId[], ChatRole][] = [
  ["Send $300 deposit on Zelle to hold the room, I'm out of town", ["deposit_before_viewing", "unprotected_payment"], "buyer"],
  ["I accidentally sent $800 instead of $300, please refund the $500 to my cousin", ["overpayment_refund"], "seller"],
  ["Text me on WhatsApp 608-555-0199", ["off_platform"], "unknown"],
  ["Before I buy, send me the 6 digit code Google sent you", ["verification_code"], "seller"],
  ["Zelle emailed you, the money is pending until you send the tracking number", ["fake_payment_notice"], "seller"],
  ["My mover will pick it up, I'll pay extra for his fee", ["shipping_agent"], "unknown"],
  ["Fill out this form to get paid: bit.ly/xyz", ["suspicious_link"], "unknown"],
];

// With the role unknown (the default), every expected pattern is raised.
for (const [text, expected] of SHOULD_FLAG) {
  test(`flags: "${text}"`, () => {
    const got = ids(text);
    for (const id of expected) assert.ok(got.includes(id), `expected ${id}, got [${got.join(", ")}]`);
  });
}

// With the role set to the side the scam targets, nothing else fires.
// (With the role unknown, "Zelle emailed you" also raises the buyer-side
// unprotected_payment warning, since it mentions Zelle.)
test("the task's examples raise exactly the expected patterns for the targeted role", () => {
  for (const [text, expected, role] of SHOULD_FLAG) assert.deepEqual(ids(text, { role }), [...expected].sort(), text);
});

const SHOULD_NOT_FLAG = [
  "Is this still available?",
  "Would you take $40?",
  "I'll bring cash, meet at the Union at 5?",
  "Can you send more photos of the sole?",
  "Paying through Poshmark now",
];

for (const text of SHOULD_NOT_FLAG) {
  for (const platform of ["facebook", "poshmark", "generic"] as const) {
    test(`no flag on ${platform}: "${text}"`, () => assert.deepEqual(ids(text, { platform }), []));
  }
}

test("my own phone number doesn't raise off_platform against the other person", () => {
  const flags = prefilter(chat([{ fromMe: true, text: "My number is 608-555-0199" }]));
  assert.deepEqual(flags, []);
});

// --- Honest messages that look a bit like scams ---

test("everyday logistics stay quiet", () => {
  for (const text of [
    "I sent extra photos of the scratches",
    "I can hold it until Saturday, you can pay when you pick it up",
    "Does it come with the charging wire?",
    "Do you have a discount code?",
    "I'm out of town until Monday, can show it after",
    "I can be there in 10 minutes",
    "Here's the listing: https://www.facebook.com/marketplace/item/123",
    "What's a good place to meet? The library is near me",
  ]) {
    assert.deepEqual(ids(text), [], text);
  }
  // PayPal on Facebook is only an info note, not a warning.
  assert.deepEqual(
    prefilter(chat(["What's your PayPal email so I can pay?"])).map((f) => [f.pattern, f.severity]),
    [["unprotected_payment", "info"]],
  );
});

// --- "Protect me" patterns on my own messages ---

test("warns me before I share a verification code", () => {
  const flags = prefilter(chat([{ fromMe: true, text: "ok the code is 482913" }]));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].pattern, "verification_code");
  assert.match(flags[0].reason, /You're about to share a verification code/);
});

test("a zip code isn't a verification code", () => {
  assert.deepEqual(prefilter(chat([{ fromMe: true, text: "I'm in zip code 53703" }])), []);
});

test("warns me before I share personal info", () => {
  const flags = prefilter(chat([{ fromMe: true, text: "here's a photo of my license" }]));
  assert.deepEqual(
    flags.map((f) => f.pattern),
    ["personal_info_request"],
  );
  assert.match(flags[0].reason, /^You're about to share/);
});

test("my own messages never raise the other patterns", () => {
  const scammy = "Send $300 deposit on Zelle to hold the room, text me on WhatsApp 608-555-0199";
  assert.deepEqual(prefilter(chat([{ fromMe: true, text: scammy }])), []);
});

// --- Severity and reason text ---

test("regex flags use the fixed reason text", () => {
  for (const flag of prefilter(chat(SHOULD_FLAG.map(([t]) => t)))) {
    const p = CHAT_PATTERNS.find((x) => x.id === flag.pattern)!;
    assert.equal(flag.reason, p.reason);
    assert.equal(flag.source, "rules");
  }
});

test("every pattern id has exactly one definition with a one-line reason", () => {
  assert.deepEqual(CHAT_PATTERNS.map((p) => p.id).sort(), [...CHAT_PATTERN_IDS].sort());
  for (const p of CHAT_PATTERNS) {
    assert.ok(!p.reason.includes("\n") && p.reason.length < 140, p.id);
    if (p.self) assert.ok(!p.self.reason.includes("\n") && p.self.reason.length < 140, p.id);
  }
});

test("unprotected payment severity depends on the platform and method", () => {
  const sev = (text: string, platform: ChatPlatform) => flagOf(text, "unprotected_payment", { platform })?.severity;
  // Facebook local pickup: Venmo is normal-ish, Zelle and gift cards aren't.
  assert.equal(sev("Can I Venmo you when I get there?", "facebook"), "info");
  assert.equal(sev("PayPal goods and services ok?", "facebook"), "info");
  assert.equal(sev("I only take Zelle", "facebook"), "caution");
  assert.equal(sev("PayPal friends and family please", "facebook"), "caution");
  assert.equal(sev("Can you pay with Apple gift cards?", "facebook"), "caution");
  // Protected checkouts: off-platform payment voids protection.
  for (const platform of ["poshmark", "ebay", "etsy", "depop"] as const) {
    assert.equal(sev("Zelle me and I'll ship today", platform), "danger", platform);
    assert.equal(sev("Pay with Bitcoin for a discount", platform), "danger", platform);
  }
  // A bare PayPal/Venmo mention can be the site's own checkout, so only amber.
  assert.equal(sev("Paid with PayPal", "ebay"), "caution");
  assert.equal(sev("I'll check out with Venmo", "poshmark"), "caution");
  // Mercari and the paste box use the default.
  assert.equal(sev("Cash App only", "mercari"), "caution");
  assert.equal(sev("Cash App only", "generic"), "caution");
});

test("urgency is info alone and caution next to another warning sign", () => {
  assert.equal(flagOf("Need an answer in 10 minutes", "urgency_pressure")?.severity, "info");
  assert.equal(flagOf("Other buyers are waiting, Zelle me now", "urgency_pressure")?.severity, "caution");
});

test("shipping-only requests only count on local-pickup sites", () => {
  assert.ok(ids("I'm overseas, ship it to me", { platform: "facebook" }).includes("shipping_agent"));
  assert.ok(!ids("I'm overseas, ship it to me", { platform: "ebay" }).includes("shipping_agent"));
});

// --- Role ---

test("patterns aimed at the other side are skipped once the role is known", () => {
  const overpay = "I accidentally sent $800 instead of $300, please refund the difference";
  assert.ok(ids(overpay, { role: "seller" }).includes("overpayment_refund"));
  assert.ok(!ids(overpay, { role: "buyer" }).includes("overpayment_refund"));
  const deposit = "Send a $200 deposit to hold it";
  assert.ok(ids(deposit, { role: "buyer" }).includes("deposit_before_viewing"));
  assert.ok(!ids(deposit, { role: "seller" }).includes("deposit_before_viewing"));
  // "both" patterns always apply.
  assert.ok(ids("text me on whatsapp", { role: "seller" }).includes("off_platform"));
});

// --- Dedupe and message ids ---

test("one flag per pattern per message, tied to the right message", () => {
  const flags = prefilter(
    chat(["Hi, is it available?", "WhatsApp me or Telegram me, or text me at 608-555-0199", "Also email me"]),
  );
  assert.deepEqual(
    flags.map((f) => [f.pattern, f.messageId]),
    [
      ["off_platform", "m1"],
      ["off_platform", "m2"],
    ],
  );
});

// --- Links ---

test("links: off-platform domains and shorteners are suspicious, the platform's own aren't", () => {
  assert.deepEqual(suspiciousLinks("see https://www.ebay.com/itm/123", "ebay"), []);
  assert.deepEqual(suspiciousLinks("see m.facebook.com/marketplace/item/1", "facebook"), []);
  assert.equal(suspiciousLinks("pay here: https://ebay-secure-payments.com/login", "ebay").length, 1);
  assert.equal(suspiciousLinks("tinyurl.com/abc", "facebook").length, 1);
  assert.equal(suspiciousLinks("https://bit.ly/x", "generic").length, 1);
  // The paste box accepts links to any known marketplace.
  assert.deepEqual(suspiciousLinks("https://madison.craigslist.org/sub/123.html", "generic"), []);
  // Emails aren't links (they're off_platform instead).
  assert.deepEqual(suspiciousLinks("email me at bob@gmail.com", "facebook"), []);
});

// --- Shared with the listing check ---

test("listing off-platform regexes still cover payment and contact", () => {
  for (const text of ["venmo me", "Zelle only", "PayPal F&F", "whatsapp", "608-555-0199", "a@b.co", "IG: @shop"])
    assert.ok(
      OFF_PLATFORM.some((re) => re.test(text)),
      text,
    );
});

// --- Server pipeline (no API key) ---

test("redact hides phone numbers, emails and long numbers before text goes to Claude", async () => {
  const { redact } = await import("../src/chat");
  assert.equal(
    redact("Text 608-555-0199 or (608) 555-0123, email bob.smith@gmail.com, code 482913, card 4111 1111 1111 1111"),
    "Text [phone] or [phone], email [email], code [number], card [number]",
  );
  // Prices, times and short numbers stay.
  assert.equal(redact("Would you take $40? Meet at 5:30, room 204"), "Would you take $40? Meet at 5:30, room 204");
});

test("analyzeChat without an API key returns the regex flags", async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const { analyzeChat } = await import("../src/chat");
    const ctx = chat(["Hi!", "Send $300 deposit on Zelle to hold the room, I'm out of town"], { role: "buyer" });
    const report = await analyzeChat(ctx);
    assert.equal(report.aiUsed, false);
    assert.deepEqual(report.flags, prefilter(ctx));
    assert.equal(report.communityReports, undefined);
  } finally {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});
