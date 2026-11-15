import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, BlockedUrlError, guardedFetch, isBlockedIp } from "../src/netGuard";
import { assess, cloakingReason, impersonatedBrands, similarity, type Visit } from "../src/detonate";

// --- netGuard: the server must never be pointed at itself or its network ---

test("private, loopback, metadata and reserved IPs are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1"])
    assert.equal(isBlockedIp(ip), true, ip);
});

test("public IPs are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("URLs that point inward are refused before any network work", () => {
  for (const u of [
    "http://localhost:8787/health",
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 as one number
    "http://0x7f.1/", // hex form
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://router.local/",
    "http://intranet/",
    "https://example.com:22/",
    "file:///etc/passwd",
    "https://paypal.com@evil.example/",
  ])
    assert.throws(() => assertPublicUrl(u), BlockedUrlError, u);
  assert.equal(assertPublicUrl("https://example.com/a?b=1").hostname, "example.com");
});

test("a public name that resolves to loopback is refused at connect time", async () => {
  // localtest.me and its subdomains resolve to 127.0.0.1 in public DNS: the DNS-rebinding shape.
  // Offline, the lookup itself fails instead; either way nothing is fetched.
  await assert.rejects(guardedFetch("http://localtest.me:8080/", { maxBytes: 1000, timeoutMs: 3000 }));
});

// --- Scoring ---

const visit = (v: Partial<Visit>): Visit => ({ finalUrl: "https://shop.example/", chain: ["https://shop.example/"], status: 200, title: "", text: "", fields: [], downloads: [], ...v });
const lorem = (n: number, seed = "") => Array.from({ length: n }, (_, i) => `${seed}word${i}`).join(" ");

test("similarity", () => {
  assert.equal(similarity("alpha beta gamma", "alpha beta gamma"), 1);
  assert.equal(similarity("alpha beta", "delta omega"), 0);
});

test("brands: named in the title, or repeatedly, on a site that isn't theirs", () => {
  assert.deepEqual(impersonatedBrands(visit({ title: "PayPal: Log in", finalUrl: "https://secure-login.example/" })), ["PayPal"]);
  assert.deepEqual(impersonatedBrands(visit({ title: "PayPal", finalUrl: "https://www.paypal.com/signin" })), []);
  assert.deepEqual(impersonatedBrands(visit({ text: "Sign in with Google. Continue with Apple." })), []);
  assert.deepEqual(impersonatedBrands(visit({ text: "Block pop-ups. Close pop-ups." })), []);
  assert.deepEqual(impersonatedBrands(visit({ text: "We accept PayPal." })), []); // one mention: a footer
});

test("fake PayPal login is danger", () => {
  const v = visit({ finalUrl: "https://paypal-resolution.example/", title: "PayPal: Log in to your account", fields: ["password"] });
  const r = assess("https://bit.ly/x", v, v);
  assert.equal(r.verdict, "danger");
  assert.match(r.findings.map((f) => f.text).join(" "), /isn't PayPal's real site/);
});

test("a login box on an unknown site is a caution; on the real brand it's fine", () => {
  assert.equal(assess("https://forum.example/", visit({ fields: ["password"] }), visit({ fields: ["password"] })).verdict, "caution");
  const real = visit({ finalUrl: "https://www.paypal.com/signin", title: "PayPal", fields: ["password"] });
  assert.equal(assess("https://www.paypal.com/signin", real, real).verdict, "ok");
});

test("cloaking: the login form only appears for a real visitor", () => {
  const scanner = visit({ title: "Under construction", text: lorem(40) });
  const visitor = visit({ title: "Verify your account", text: lorem(40), fields: ["card"] });
  assert.match(cloakingReason(scanner, visitor) ?? "", /card details/);
  const r = assess("https://shop.example/", scanner, visitor);
  assert.equal(r.verdict, "danger");
  assert.equal(r.cloaking, true);
});

test("cloaking: scanner sent somewhere else", () => {
  const scanner = visit({ finalUrl: "https://www.google.com/", text: lorem(50) });
  const visitor = visit({ finalUrl: "https://claim-prize.example/", text: lorem(50) });
  assert.match(cloakingReason(scanner, visitor) ?? "", /google\.com.*claim-prize\.example/);
});

test("cloaking: blank or 404 for the scanner only", () => {
  assert.ok(cloakingReason(visit({ text: "" }), visit({ text: lorem(80) })));
  assert.ok(cloakingReason(visit({ status: 404, text: lorem(30) }), visit({ text: lorem(30) })));
});

test("same page to both: no cloaking, ok verdict", () => {
  const page = visit({ title: "Vintage lamps", text: lorem(80) });
  assert.equal(cloakingReason(page, { ...page }), null);
  const r = assess("https://shop.example/", page, { ...page });
  assert.equal(r.verdict, "ok");
});

test("drive-by download is danger", () => {
  const r = assess("https://shop.example/", visit({}), visit({ downloads: ["invoice.pdf.exe"] }));
  assert.equal(r.verdict, "danger");
  assert.match(r.findings[0].text, /invoice\.pdf\.exe/);
});

test("bank details or SSN are danger even without a brand", () => {
  assert.equal(assess("https://x.example/", visit({ fields: ["bank"] }), visit({ fields: ["bank"] })).verdict, "danger");
  assert.equal(assess("https://x.example/", visit({ fields: ["ssn"] }), visit({ fields: ["ssn"] })).verdict, "danger");
});

test("redirect chain through several sites is reported", () => {
  const v = visit({ finalUrl: "https://land.example/", chain: ["https://bit.ly/a", "https://track.example/r", "https://land.example/"] });
  const r = assess("https://bit.ly/a", v, v);
  assert.match(r.findings.map((f) => f.text).join(" "), /bounced through 2 other sites/);
});

test("a link that points into a private network is danger", () => {
  const v = visit({ pointedInward: "192.168.1.1" });
  const r = assess("https://evil.example/", v, v);
  assert.equal(r.verdict, "danger");
  assert.match(r.findings[0].text, /192\.168\.1\.1/);
});

// --- Demo sites (reserved ".example" names only) ---

test("demo site: only reserved .example hosts, scanner and visitor get different pages", async () => {
  const { isDemoHost, demoResponse } = await import("../src/demoSites");
  assert.equal(isDemoHost("https://paypal-resolve.example/login"), true);
  assert.equal(isDemoHost("https://paypal-resolve.com/login"), false);
  assert.equal(isDemoHost("https://account-verify.top/"), false);
  const scanner = demoResponse("https://paypal-resolve.example/login", { "user-agent": "Mozilla/5.0 HeadlessChrome/141.0" }).body.toString();
  const visitor = demoResponse("https://paypal-resolve.example/login", { "user-agent": "Mozilla/5.0 Chrome/141.0" }).body.toString();
  assert.match(scanner, /coming soon/i);
  assert.match(visitor, /type="password"/);
  assert.match(visitor, /Not a real site/);
});
