// Link guard tests: which page loads get checked (only ones opened from a
// marketplace), unwrapping link redirectors, and the server's /check-url
// verdict (look-alike, domain age, Safe Browsing, Cloudflare's filtering resolver).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedPagePath, destinationToCheck, domainOf, isMarketplaceUrl, ruleIdFor, unwrapRedirector } from "../../extension/src/guardCore";
import { checkDestination, linkFlags, resolverSaysBlocked } from "../src/links";
import type { ChatContext } from "../../shared/types";

test("only page loads that start from a marketplace (or a tab opened from one) are checked", () => {
  const fb = "https://www.facebook.com/marketplace/item/1";
  assert.equal(destinationToCheck({ fromUrl: fb, toUrl: "https://paypa1-secure.com/x", guardedTab: false }), "https://paypa1-secure.com/x");
  // Ordinary browsing is never checked.
  assert.equal(destinationToCheck({ fromUrl: "https://news.example.com", toUrl: "https://paypa1-secure.com", guardedTab: false }), null);
  // A tab opened from a marketplace stays guarded.
  assert.equal(destinationToCheck({ fromUrl: undefined, toUrl: "https://evil.xyz", guardedTab: true }), "https://evil.xyz");
  // Moving around the marketplace itself, and browser pages, are ignored.
  assert.equal(destinationToCheck({ fromUrl: fb, toUrl: "https://www.facebook.com/marketplace/item/2", guardedTab: false }), null);
  assert.equal(destinationToCheck({ fromUrl: fb, toUrl: "chrome-extension://abc/blocked.html", guardedTab: false }), null);
  assert.equal(destinationToCheck({ fromUrl: "http://localhost:8787/demo/chat", toUrl: "https://evil.xyz", guardedTab: false }), "https://evil.xyz");
});

test("Facebook's, Google's and eBay's link redirectors are unwrapped to the real destination", () => {
  const fb = "https://l.facebook.com/l.php?u=https%3A%2F%2Fpaypa1-secure.com%2Flogin&h=AT0abc";
  assert.equal(unwrapRedirector(fb), "https://paypa1-secure.com/login");
  assert.equal(unwrapRedirector("https://www.google.com/url?q=https://evil.xyz/a&sa=D"), "https://evil.xyz/a");
  assert.equal(unwrapRedirector("https://example.com/page?u=https://x.com"), "https://example.com/page?u=https://x.com");
  // l.facebook.com is Facebook's own site, but the link it wraps still gets checked.
  assert.equal(destinationToCheck({ fromUrl: "https://www.facebook.com/messages/t/1", toUrl: fb, guardedTab: false }), "https://paypa1-secure.com/login");
});

test("helpers", () => {
  assert.ok(isMarketplaceUrl("https://poshmark.com/listing/x"));
  assert.ok(!isMarketplaceUrl("https://poshmark.com.evil.xyz/"));
  assert.equal(domainOf("https://login.paypa1-secure.com/x"), "paypa1-secure.com");
  const id = ruleIdFor("evil.xyz");
  assert.ok(Number.isInteger(id) && id > 0 && id <= 2_000_000_000);
  assert.equal(ruleIdFor("evil.xyz"), id);
  const path = blockedPagePath({ url: "https://evil.xyz/a?b=1", domain: "evil.xyz", reasons: ["r1", "r2"] });
  const q = new URLSearchParams(path.split("?")[1]);
  assert.equal(q.get("url"), "https://evil.xyz/a?b=1");
  assert.deepEqual(JSON.parse(q.get("reasons")!), ["r1", "r2"]);
});

test("Cloudflare's filtering resolver: 0.0.0.0 means blocked", () => {
  assert.equal(resolverSaysBlocked({ Status: 0, Answer: [{ type: 1, data: "0.0.0.0" }] }), true);
  assert.equal(resolverSaysBlocked({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), false);
  assert.equal(resolverSaysBlocked({ Status: 3 }), false); // doesn't exist: not "blocked"
});

/** Fake network for /check-url: RDAP ages and DNS answers per domain. */
function fakeNet(opts: { ages?: Record<string, string>; dnsBlocked?: string[] }) {
  const sent: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    sent.push(url);
    if (url.startsWith("https://rdap.org/domain/")) {
      const reg = opts.ages?.[decodeURIComponent(url.slice(24))];
      return reg ? new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: reg }] })) : new Response("{}", { status: 404 });
    }
    if (url.startsWith("https://security.cloudflare-dns.com/dns-query")) {
      const name = new URL(url).searchParams.get("name")!;
      const data = opts.dnsBlocked?.includes(name) ? "0.0.0.0" : "93.184.216.34";
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data }] }));
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { impl, sent };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

test("check-url: a site on Cloudflare's block list is stopped, and only the domain goes to the resolver", async () => {
  const net = fakeNet({ ages: { "old-but-bad.com": daysAgo(3000) }, dnsBlocked: ["old-but-bad.com"] });
  const v = await checkDestination("https://old-but-bad.com/login?session=SECRET", net.impl);
  assert.equal(v.verdict, "block");
  assert.deepEqual(v.reasons, ["Cloudflare's security filter blocks old-but-bad.com as a malware or phishing site."]);
  const dns = net.sent.find((u) => u.includes("dns-query"))!;
  assert.ok(dns.includes("name=old-but-bad.com") && !dns.includes("SECRET") && !dns.includes("login"));
});

test("check-url: brand-new and look-alike sites are stopped; an old ordinary site isn't", async () => {
  const net = fakeNet({ ages: { "claim-funds-now.xyz": daysAgo(2), "example.org": daysAgo(9000) } });
  assert.equal((await checkDestination("https://claim-funds-now.xyz/pay", net.impl)).verdict, "block");
  const look = await checkDestination("https://paypa1-secure.com/login", net.impl);
  assert.equal(look.verdict, "block");
  assert.match(look.reasons[0], /paypa1-secure\.com imitates PayPal/);
  assert.deepEqual(await checkDestination("https://example.org/page", net.impl), {
    url: "https://example.org/page",
    domain: "example.org",
    verdict: "ok",
    reasons: [],
  });
});

test("check-url: real brand sites aren't looked up at all", async () => {
  const net = fakeNet({});
  assert.equal((await checkDestination("https://www.paypal.com/signin", net.impl)).verdict, "ok");
  assert.equal(net.sent.length, 0);
});

test("chat links on Cloudflare's block list get the known-dangerous warning", async () => {
  const net = fakeNet({ ages: { "bad-store.com": daysAgo(5000) }, dnsBlocked: ["bad-store.com"] });
  const ctx: ChatContext = {
    platform: "facebook",
    threadId: "t",
    url: "",
    role: "buyer",
    messages: [{ id: "m1", fromMe: false, text: "buy it here https://bad-store.com/item" }],
  };
  const flags = await linkFlags(ctx, net.impl);
  assert.deepEqual(flags.map((f) => f.pattern), ["unsafe_link"]);
  assert.match(flags[0].reason, /Cloudflare's security filter blocks bad-store\.com/);
});
