// Phishing link checker tests: the on-device look-alike check against an
// adversarial set (homoglyphs, typos, disguises, redirects), plus the
// server lookups (domain age, Safe Browsing, shorteners) with a fake network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLookalike, editDistance, registrableDomain, skeleton, stripQuery } from "../../shared/linkCheck";
import { prefilter } from "../../shared/chatPatterns";
import { ageFlag, linkFlags, registrationDate } from "../src/links";
import type { ChatContext } from "../../shared/types";

// --- Adversarial set: each of these should be caught, with the kind of trick ---
const EVASIONS: [string, string][] = [
  ["https://faceb00k-pay.com/claim", "impersonation"], // digit for letter
  ["paypa1.com/login", "impersonation"], // 1 for l
  ["https://www.paypai.com", "typo"], // capital I typed as l, lowercased
  ["https://pay-pal.com/secure", "impersonation"], // hyphen split
  ["https://paypal.secure-login.xyz", "impersonation"], // brand as a subdomain
  ["https://paypal.com.account-verify.top/", "impersonation"], // fake ".com" in the middle
  ["zelle-payments-support.com", "impersonation"], // brand plus scary words
  ["https://cashapp-refund.net", "impersonation"],
  ["https://rnercari.com/item", "impersonation"], // "rn" looks like "m"
  ["https://www.venrno.com", "impersonation"],
  ["https://wellsfargo-alerts.com", "impersonation"],
  ["https://usps-redelivery.info", "impersonation"],
  ["https://poshrnark.com", "impersonation"],
  ["https://craigslst.org/pay", "typo"], // dropped letter
  ["https://vemno.com", "typo"], // swapped neighbouring letters
  ["https://раураl.com", "punycode"], // Cyrillic letters
  ["http://192.168.4.20/login", "ip"],
  ["https://www.paypal.com@evil-site.xyz/login", "userinfo"], // real address is after the @
  ["https://www.google.com/url?q=https://paypa1-login.com", "redirect"], // open redirect to a look-alike
  ["https://www.google.com/url?q=https://claim-your-funds.xyz", "redirect"], // open redirect to anywhere
];

// --- Ordinary links that must stay quiet ---
const CLEAN = [
  "https://www.facebook.com/marketplace/item/123",
  "https://www.paypal.com/signin",
  "https://cash.app/$sam",
  "https://www.google.com/maps/place/Madison",
  "https://www.zillow.com/homedetails/1",
  "https://apple-pie-recipes.com", // ordinary word, not Apple
  "https://chaseoutdoors.com", // "chase" inside another word
  "https://metallica.com",
  "https://easy-bikes.com", // "easy" isn't "etsy"
  "https://homedepot.com",
  "https://example.org/page",
  "https://amazonrainforest.org",
];

for (const [url, kind] of EVASIONS) {
  test(`catches ${url} (${kind})`, () => {
    const f = checkLookalike(url);
    assert.ok(f, `missed ${url}`);
    assert.equal(f.kind, kind);
    assert.ok(f.text.length < 160 && !f.text.includes("\n"));
  });
}

for (const url of CLEAN) {
  test(`leaves ${url} alone`, () => assert.equal(checkLookalike(url), null));
}

test("known misses are documented: short names only match through look-alike swaps", () => {
  // One letter off a 4-letter name is too close to ordinary words to flag.
  assert.equal(checkLookalike("https://ebey.com"), null);
  assert.ok(checkLookalike("https://eb4y.com")); // but digit swaps still count
});

test("helpers", () => {
  assert.equal(registrableDomain("login.paypal-help.co.uk"), "paypal-help.co.uk");
  assert.equal(registrableDomain("a.b.example.com"), "example.com");
  assert.equal(skeleton("faceb00k-pay"), "facebookpay");
  assert.equal(skeleton("rnercari"), "mercari");
  assert.equal(editDistance("craigslst", "craigslist"), 1);
  assert.equal(editDistance("vemno", "venmo"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(stripQuery("https://x.com/pay?id=5&email=a@b.com#top"), "https://x.com/pay");
});

const chat = (texts: (string | { text: string; fromMe: boolean })[]): ChatContext => ({
  platform: "facebook",
  threadId: "t",
  url: "https://www.facebook.com/messages/t/1",
  role: "buyer",
  messages: texts.map((t, i) => (typeof t === "string" ? { id: `m${i}`, fromMe: false, text: t } : { id: `m${i}`, ...t })),
});

test("on device: a look-alike link gets the specific warning, naming the domain, instead of the generic one", () => {
  const flags = prefilter(chat(["Pay here to hold it: https://faceb00k-pay.com/claim"]));
  const ids = flags.map((f) => f.pattern);
  assert.ok(ids.includes("lookalike_link"));
  assert.ok(!ids.includes("suspicious_link"));
  assert.match(flags.find((f) => f.pattern === "lookalike_link")!.reason, /faceb00k-pay\.com imitates Facebook/);
});

test("on device: an ordinary outside link still gets the generic warning", () => {
  const ids = prefilter(chat(["details at https://example.org/form"])).map((f) => f.pattern);
  assert.ok(ids.includes("suspicious_link"));
  assert.ok(!ids.includes("lookalike_link"));
});

test("RDAP registration date and age thresholds", () => {
  assert.equal(
    registrationDate({ events: [{ eventAction: "last changed", eventDate: "2026-01-01T00:00:00Z" }, { eventAction: "registration", eventDate: "2026-11-11T08:00:00Z" }] })?.toISOString(),
    "2026-11-11T08:00:00.000Z",
  );
  assert.equal(registrationDate({}), null);
  const now = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(ageFlag("x.com", new Date("2026-11-11T00:00:00Z"), now)?.severity, "danger");
  assert.match(ageFlag("x.com", new Date("2026-11-11T00:00:00Z"), now)!.reason, /registered 3 days ago/);
  assert.equal(ageFlag("x.com", new Date("2026-09-01T00:00:00Z"), now)?.severity, "caution");
  assert.equal(ageFlag("x.com", new Date("2019-01-01T00:00:00Z"), now), null);
});

/** A fake network: RDAP ages, Safe Browsing matches and shortener redirects. Records what was sent. */
function fakeNet(opts: { ages?: Record<string, string>; threats?: string[]; redirects?: Record<string, string> }) {
  const sent: { url: string; body?: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("https://rdap.org/domain/")) {
      const domain = decodeURIComponent(url.slice("https://rdap.org/domain/".length));
      const reg = opts.ages?.[domain];
      return reg
        ? new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: reg }] }), { status: 200 })
        : new Response("{}", { status: 404 });
    }
    if (url.startsWith("https://safebrowsing.googleapis.com/")) {
      const entries = (JSON.parse(String(init?.body)).threatInfo.threatEntries as { url: string }[]).map((e) => e.url);
      const matches = entries.filter((u) => opts.threats?.some((t) => u.includes(t))).map((u) => ({ threatType: "SOCIAL_ENGINEERING", threat: { url: u } }));
      return new Response(JSON.stringify(matches.length ? { matches } : {}), { status: 200 });
    }
    const to = opts.redirects?.[url];
    return to ? new Response(null, { status: 301, headers: { location: to } }) : new Response(null, { status: 200 });
  }) as typeof fetch;
  return { impl, sent };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

test("server: a brand-new domain is flagged, and only the bare domain goes to RDAP", async () => {
  const net = fakeNet({ ages: { "claim-your-funds.xyz": daysAgo(3) } });
  const flags = await linkFlags(chat(["Fill out the form at https://claim-your-funds.xyz/pay?email=me@x.com to get paid"]), net.impl);
  assert.deepEqual(flags.map((f) => [f.pattern, f.severity]), [["new_domain", "danger"]]);
  assert.match(flags[0].reason, /claim-your-funds\.xyz was registered 3 days ago/);
  // RDAP and the filtering resolver each get the bare domain, never the path or the email in it.
  assert.deepEqual(net.sent.map((s) => s.url).sort(), [
    "https://rdap.org/domain/claim-your-funds.xyz",
    "https://security.cloudflare-dns.com/dns-query?name=claim-your-funds.xyz&type=A",
  ]);
});

test("server: Safe Browsing match, sent without the query string", async () => {
  process.env.GOOGLE_SAFE_BROWSING_KEY = "test-key";
  try {
    const net = fakeNet({ ages: { "evil-pay.com": daysAgo(4000) }, threats: ["evil-pay.com"] });
    const flags = await linkFlags(chat(["https://evil-pay.com/login?token=SECRET"]), net.impl);
    assert.deepEqual(flags.map((f) => f.pattern), ["unsafe_link"]);
    assert.match(flags[0].reason, /lists evil-pay\.com as phishing/);
    const sb = net.sent.find((s) => s.url.startsWith("https://safebrowsing"))!;
    assert.ok(sb.body!.includes("https://evil-pay.com/login") && !sb.body!.includes("SECRET"));
  } finally {
    delete process.env.GOOGLE_SAFE_BROWSING_KEY;
  }
});

test("server: a shortener hiding a look-alike is followed and flagged", async () => {
  const net = fakeNet({ redirects: { "https://bit.ly/3xYz": "https://paypa1-secure.com/login" }, ages: { "paypa1-secure.com": daysAgo(2) } });
  const flags = await linkFlags(chat(["here's the payment link bit.ly/3xYz"]), net.impl);
  assert.deepEqual(flags.map((f) => f.pattern).sort(), ["lookalike_link", "new_domain"]);
  assert.match(flags.find((f) => f.pattern === "lookalike_link")!.reason, /short link hides where it goes\. paypa1-secure\.com/);
});

test("server: my own links, official sites and old domains raise nothing, and nothing is looked up for official sites", async () => {
  const net = fakeNet({ ages: { "example.org": daysAgo(9000) } });
  const flags = await linkFlags(
    chat([{ text: "my site https://brand-new-mine.xyz", fromMe: true }, "see https://www.paypal.com/signin and https://example.org"]),
    net.impl,
  );
  assert.deepEqual(flags, []);
  assert.ok(net.sent.every((s) => !s.url.includes("paypal.com") && !s.url.includes("brand-new-mine")));
});

test("server: no links means no network at all", async () => {
  const net = fakeNet({});
  assert.deepEqual(await linkFlags(chat(["Is this still available?"]), net.impl), []);
  assert.equal(net.sent.length, 0);
});
