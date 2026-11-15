// Safe URL detonation: the server opens a link in a throwaway headless browser
// so the user never has to. The scam site sees this server's IP address, not
// the user's, and nothing it runs touches the user's browser, cookies or logins.
//
// Each link is opened twice, at the same time, in separate empty profiles:
//   "scanner": looks like an automated security check (headless browser, no
//              referrer). This is what most link scanners look like.
//   "visitor": looks like a real person clicking from Facebook (normal Chrome,
//              Facebook referrer, language set, automation flag hidden).
// Phishing kits often show scanners a harmless page and only show visitors the
// fake login ("cloaking"). If the two visits disagree, that is the warning.
//
// From the visitor visit we keep a screenshot, the redirect chain, and what
// the page asks for: passwords, card numbers, bank details, SSNs, one-time
// codes. Brand names on a page that isn't the brand's real site turn a login
// box into an impersonation warning.
//
// Every request the browser makes goes through netGuard (no private or
// internal addresses, checked at connect time). Anything that slips past the
// interceptor hits a dead proxy. WebSockets, service workers, WebRTC and
// downloads are off.

import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import { BRANDS, hostOfLink, isOfficialDomain, registrableDomain } from "../../shared/linkCheck";
import { assertPublicUrl, BlockedUrlError, guardedFetch } from "./netGuard";
import { demoResponse, isDemoHost } from "./demoSites";
import type { DetonationFinding as Finding, DetonationReport } from "../../shared/types";

export type { DetonationReport };

// ---------------------------------------------------------------------------
// What a visit found (pure data, so the scoring below is testable)
// ---------------------------------------------------------------------------

export type FieldKind = "password" | "card" | "bank" | "ssn" | "otp";

export interface Visit {
  /** The address the page ended on. */
  finalUrl: string;
  /** Main-frame addresses in order, starting with the link itself. */
  chain: string[];
  /** HTTP status of the last main-frame document. */
  status: number;
  title: string;
  /** Visible text, trimmed to a few thousand characters. */
  text: string;
  /** Kinds of sensitive fields the page shows (any frame). */
  fields: FieldKind[];
  /** File names the site tried to download. */
  downloads: string[];
  /** Did the page load at all? */
  error?: string;
  /** It tried to send us to a private or internal address (stopped). */
  pointedInward?: string;
  /** Its page tried to load something from a private or internal address (stopped). */
  probedInward?: string;
}

const FIELD_WORDS: Record<FieldKind, string> = {
  password: "a password",
  card: "card details",
  bank: "bank account details",
  ssn: "a Social Security number",
  otp: "a one-time code",
};

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** Share of words two pages have in common (0..1). */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

const domainOf = (url: string) => {
  const host = hostOfLink(url);
  return host ? registrableDomain(host) : "";
};

/** Brands the page talks about, when the page isn't on that brand's real domain. */
export function impersonatedBrands(visit: Pick<Visit, "finalUrl" | "title" | "text">): string[] {
  const host = hostOfLink(visit.finalUrl) ?? "";
  // "Sign in with Google" buttons are on plenty of real sites; they don't count.
  const strip = (s: string) => s.replace(/\b(sign|log)\s?(in|up|on)\s+with\s+\S+|\bcontinue\s+with\s+\S+|\bpay\s+with\s+\S+/gi, " ");
  const title = strip(visit.title);
  const body = strip(visit.text.slice(0, 3000));
  const out: string[] = [];
  for (const b of BRANDS) {
    if (b.domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    // Whole word; case-sensitive for ordinary words and short acronyms ("Apple" not "apple pie", "UPS" not "pop-ups").
    const name = b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strict = Boolean(b.exact) || b.name === b.name.toUpperCase();
    const re = new RegExp(`\\b${name}\\b`, strict ? "g" : "gi");
    // In the title, or more than once on the page: a footer mention alone isn't impersonation.
    if (re.test(title) || (body.match(re)?.length ?? 0) >= 2) out.push(b.name);
  }
  return out;
}

/** Did the scanner and the visitor get meaningfully different pages? Returns the reason, or null. */
export function cloakingReason(scanner: Visit, visitor: Visit): string | null {
  if (scanner.error || visitor.error) {
    if (scanner.error && !visitor.error && visitor.text.length > 200)
      return "It refused to load for a security scanner but loaded for a normal visitor.";
    return null;
  }
  const sd = domainOf(scanner.finalUrl);
  const vd = domainOf(visitor.finalUrl);
  if (sd && vd && sd !== vd) return `A security scanner was sent to ${sd}, but a normal visitor was sent to ${vd}.`;
  const sFields = new Set(scanner.fields);
  const hidden = visitor.fields.filter((f) => !sFields.has(f) && f !== "otp");
  if (hidden.length) return `It asks a normal visitor for ${FIELD_WORDS[hidden[0]]}, but shows a security scanner a different page.`;
  if (scanner.status >= 400 && visitor.status < 400) return `It told a security scanner the page doesn't exist (${scanner.status}), but showed it to a normal visitor.`;
  const sw = words(scanner.text).size;
  const vw = words(visitor.text).size;
  if (sw >= 25 && vw >= 25 && similarity(scanner.text, visitor.text) < 0.25) return "A security scanner and a normal visitor saw completely different pages.";
  if (sw < 8 && vw >= 60) return "It showed a security scanner a blank page, but a full page to a normal visitor.";
  return null;
}

/** Turn the two visits into findings and a verdict. */
export function assess(link: string, scanner: Visit, visitor: Visit): Pick<DetonationReport, "verdict" | "findings" | "cloaking" | "domain"> {
  const findings: Finding[] = [];
  const domain = domainOf(visitor.finalUrl) || domainOf(link);
  const host = hostOfLink(visitor.finalUrl) ?? "";
  const official = host ? isOfficialDomain(host) : false;

  const inward = visitor.pointedInward ?? scanner.pointedInward;
  if (inward)
    findings.push({
      severity: "danger",
      text: `It tried to send us to ${inward}, an address inside a private network (like your home router). We stopped it. Links that do this are attacks.`,
    });
  else if (visitor.probedInward ?? scanner.probedInward)
    findings.push({
      severity: "danger",
      text: `The page tried to reach ${visitor.probedInward ?? scanner.probedInward}, an address inside a private network. Pages that poke at your router or other devices are attacks. We stopped it.`,
    });
  if (!inward && visitor.error) {
    findings.push({ severity: "info", text: `The page didn't load (${visitor.error}).` });
  }

  // Where it went.
  const hops = [...new Set(visitor.chain.map(domainOf).filter(Boolean))];
  if (hops.length > 1 && domainOf(link) !== domain) {
    findings.push({
      severity: hops.length > 2 ? "caution" : "info",
      text: hops.length > 2 ? `It bounced through ${hops.length - 1} other sites (${hops.slice(0, -1).join(" → ")}) before landing on ${domain}.` : `It sent us to ${domain}.`,
    });
  }

  // Cloaking.
  const cloak = cloakingReason(scanner, visitor);
  if (cloak) findings.push({ severity: "danger", text: `${cloak} Scam sites do this to hide from security checks.` });

  // What it asks for.
  const brands = impersonatedBrands(visitor);
  if (!official) {
    const sensitive = visitor.fields.filter((f) => f !== "otp");
    if (sensitive.length && brands.length) {
      findings.push({
        severity: "danger",
        text: `It asks for ${FIELD_WORDS[sensitive[0]]} and says it's ${brands[0]}, but ${domain} isn't ${brands[0]}'s real site.`,
      });
    } else {
      for (const f of visitor.fields) {
        if (f === "password") findings.push({ severity: "caution", text: `It has a login box. Never sign in on a site you reached from a chat; type the address yourself.` });
        if (f === "card") findings.push({ severity: "caution", text: `It asks for card details. Pay inside the marketplace so you're covered.` });
        if (f === "bank") findings.push({ severity: "danger", text: `It asks for bank account details. No buyer or seller needs those.` });
        if (f === "ssn") findings.push({ severity: "danger", text: `It asks for a Social Security number. No sale needs that.` });
        if (f === "otp") findings.push({ severity: "caution", text: `It asks for a one-time code. Scammers use these to take over your accounts.` });
      }
    }
    if (!visitor.fields.length && brands.length && /verif|confirm|claim|receive|payment|refund|suspend|locked/i.test(visitor.text.slice(0, 3000)))
      findings.push({ severity: "caution", text: `It uses ${brands[0]}'s name, but ${domain} isn't ${brands[0]}'s real site.` });
  }

  // Downloads.
  const files = [...new Set([...visitor.downloads, ...scanner.downloads])];
  if (files.length) findings.push({ severity: "danger", text: `It tried to download a file on its own (${files.slice(0, 2).join(", ")}). Don't run anything from a chat link.` });

  const verdict = findings.some((f) => f.severity === "danger") ? "danger" : findings.some((f) => f.severity === "caution") ? "caution" : "ok";
  if (inward) {
    // already explained
  } else if (verdict === "ok" && !visitor.error && words(visitor.text).size < 5 && !visitor.title)
    findings.push({ severity: "info", text: "The page came up blank, so there wasn't much to check. A blank page from a chat link is still worth skipping." });
  else if (verdict === "ok" && !visitor.error)
    findings.push({ severity: "info", text: "No login, payment or download tricks, and it showed the same page to scanners and visitors." });
  return { verdict, findings, cloaking: Boolean(cloak), domain };
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 12_000;
const SETTLE_MS = 2_500; // let JS redirects and late-rendering login forms appear
const MAX_REQUESTS = 200;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

type Profile = "scanner" | "visitor";

let browserPromise: Promise<Browser> | null = null;

export class DetonationUnavailable extends Error {}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      try {
        return await chromium.launch({
          headless: true,
          // Optional: use an already-installed Chrome/Chromium instead of Playwright's download.
          executablePath: process.env.CHROMIUM_PATH || undefined,
          // Anything the interceptor doesn't handle goes to a proxy that isn't there, so it fails.
          proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
          args: [
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--dns-prefetch-disable",
            "--disable-background-networking",
            "--disable-features=InterestFeedContentSuggestions,MediaRouter,OptimizationHints,Translate",
            "--no-first-run",
            "--mute-audio",
          ],
        });
      } catch (err) {
        browserPromise = null;
        throw new DetonationUnavailable(
          `The headless browser isn't installed on the server. Run: npx playwright-core install chromium-headless-shell (${err instanceof Error ? err.message.split("\n")[0] : err})`,
        );
      }
    })();
    void browserPromise.then((b) => b.on("disconnected", () => (browserPromise = null))).catch(() => {});
  }
  return browserPromise;
}

const ATTACHMENT = /attachment/i;
const RISKY_TYPES = /application\/(octet-stream|x-msdownload|x-msdos-program|vnd\.android\.package-archive|x-apple-diskimage|zip|x-rar|x-7z|java-archive|x-sh)/i;

async function newContext(browser: Browser, profile: Profile): Promise<BrowserContext> {
  const visitor = profile === "visitor";
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: visitor ? CHROME_UA : undefined, // the scanner keeps "HeadlessChrome"
    locale: visitor ? "en-US" : undefined,
    timezoneId: visitor ? "America/Chicago" : undefined,
    extraHTTPHeaders: visitor ? { "Accept-Language": "en-US,en;q=0.9" } : {},
    serviceWorkers: "block",
    acceptDownloads: false,
    javaScriptEnabled: true,
    bypassCSP: false,
    permissions: [],
    geolocation: undefined,
  });
  if (visitor) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  await ctx.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: "not allowed" }));
  return ctx;
}

/** Fetch every request ourselves through netGuard and hand the browser the answer. */
type Fetcher = typeof guardedFetch;

function interceptor(page: Page, visit: Visit, fetcher: Fetcher) {
  let requests = 0;
  let bytes = 0;
  return async (route: Route) => {
    const req = route.request();
    const type = req.resourceType();
    const mainDoc = req.isNavigationRequest() && req.frame() === page.mainFrame();
    if (mainDoc) visit.chain.push(req.url());
    if (type === "media" || type === "font" || type === "websocket" || type === "eventsource" || type === "manifest") return route.abort("blockedbyclient");
    if (++requests > MAX_REQUESTS || bytes > MAX_TOTAL_BYTES) return route.abort("blockedbyclient");
    if (!/^https?:/i.test(req.url())) return route.abort("blockedbyclient");
    try {
      const headers = await req.allHeaders();
      let target = req.url();
      let res = await fetcher(target, { method: req.method(), headers, body: req.postDataBuffer(), maxBytes: MAX_RESPONSE_BYTES, timeoutMs: 8000 });
      // Never hand Chromium a redirect: it would follow it itself, around this guard.
      for (let hop = 0; res.status >= 300 && res.status < 400 && res.headers["location"]; hop++) {
        const next = new URL(res.headers["location"], target).toString();
        if (req.isNavigationRequest()) {
          try {
            assertPublicUrl(next);
          } catch (err) {
            if (!(err instanceof BlockedUrlError)) throw err;
            visit.pointedInward = new URL(next).host;
            return route.fulfill({ status: 200, contentType: "text/html", body: "" });
          }
          // A page: navigate to the next address from inside the page, so that request comes back through here.
          if (mainDoc) visit.status = res.status;
          return route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(next).replace(/</g, "\\u003c")})</script>` });
        }
        // An image or script: follow it here, each hop checked.
        if (hop >= 5) return route.abort("failed");
        target = next;
        res = await fetcher(target, { method: "GET", headers, body: null, maxBytes: MAX_RESPONSE_BYTES, timeoutMs: 8000 });
      }
      bytes += res.body.length;
      // A document that's really a download: record it and don't hand it over.
      const disposition = res.headers["content-disposition"] ?? "";
      if (req.isNavigationRequest() && (ATTACHMENT.test(disposition) || RISKY_TYPES.test(res.headers["content-type"] ?? ""))) {
        const name = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? new URL(req.url()).pathname.split("/").pop() ?? "file";
        visit.downloads.push(decodeURIComponent(name).slice(0, 80));
        return route.fulfill({ status: 204, body: "" });
      }
      if (mainDoc) visit.status = res.status;
      return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        if (req.isNavigationRequest()) visit.pointedInward = new URL(req.url()).host;
        else visit.probedInward ??= new URL(req.url()).host;
      }
      return route.abort(err instanceof BlockedUrlError ? "blockedbyclient" : "failed");
    }
  };
}

/**
 * Runs inside each frame of the page: which sensitive fields are visible?
 * A string, not a function: tsx/esbuild add helpers (__name) to compiled
 * functions that don't exist inside the page.
 */
const FIND_FIELDS = `(() => {
  const kinds = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  for (const el of document.querySelectorAll("input, select")) {
    if (!visible(el)) continue;
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio", "image", "reset", "search"].includes(type)) continue;
    const label = Array.from(el.labels || []).map((l) => l.textContent || "").join(" ");
    const hint = [el.name, el.id, el.placeholder, el.autocomplete, el.getAttribute("aria-label"), label].join(" ").toLowerCase();
    if (type === "password" || /current-password|new-password/.test(hint)) kinds.add("password");
    if (/cc-(number|csc|exp)|card.?(number|num|no)|credit.?card|debit.?card|\\bcvv\\b|\\bcvc\\b|\\bcsc\\b|expir/.test(hint)) kinds.add("card");
    if (/routing|account.?(number|num|no)|\\biban\\b|sort.?code|bank.?account/.test(hint)) kinds.add("bank");
    if (/\\bssn\\b|social.?security/.test(hint)) kinds.add("ssn");
    if (/one-time-code|one.?time|\\botp\\b|verification.?code|security.?code|2fa|sms.?code|auth.?code/.test(hint) && !kinds.has("card")) kinds.add("otp");
  }
  return [...kinds];
})()`;

async function visitOnce(browser: Browser, url: string, profile: Profile, wantShot: boolean, fetcher: Fetcher) {
  const visit: Visit = { finalUrl: url, chain: [], status: 0, title: "", text: "", fields: [], downloads: [] };
  const ctx = await newContext(browser, profile);
  let shot: Buffer | null = null;
  try {
    const page = await ctx.newPage();
    page.on("download", (d) => visit.downloads.push(d.suggestedFilename().slice(0, 80)));
    page.on("dialog", (d) => void d.dismiss().catch(() => {})); // alert("Your PC is infected!") shouldn't hang the visit
    page.on("popup", (p) => void p.close().catch(() => {}));
    await page.route("**/*", interceptor(page, visit, fetcher));
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS, referer: profile === "visitor" ? "https://www.facebook.com/" : undefined });
    } catch (err) {
      if (!visit.error) visit.error = err instanceof Error && /timeout/i.test(err.message) ? "it took too long to respond" : "the site couldn't be reached";
    }
    await page.waitForTimeout(SETTLE_MS);
    await page.waitForLoadState("load", { timeout: 1500 }).catch(() => {});
    visit.finalUrl = page.url().startsWith("http") ? page.url() : visit.chain.at(-1) ?? url;
    if (visit.status && visit.error === "the site couldn't be reached") delete visit.error;
    visit.title = (await page.title().catch(() => "")).slice(0, 200);
    visit.text = ((await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string).replace(/\s+/g, " ").slice(0, 6000);
    const kinds = new Set<FieldKind>();
    for (const frame of page.frames()) for (const k of ((await frame.evaluate(FIND_FIELDS).catch(() => [])) as string[])) kinds.add(k as FieldKind);
    visit.fields = [...kinds];
    if (wantShot) shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 4000 }).catch(() => null);
  } finally {
    await ctx.close().catch(() => {});
  }
  return { visit, shot };
}

// ---------------------------------------------------------------------------
// Entry point: queue, cache, both visits
// ---------------------------------------------------------------------------

const MAX_PARALLEL = 2;
const MAX_WAITING = 6;
const CACHE_MS = 10 * 60 * 1000;
let running = 0;
const waiting: (() => void)[] = [];
const cache = new Map<string, { at: number; report: DetonationReport }>();

export class DetonationBusy extends Error {}

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    if (waiting.length >= MAX_WAITING) throw new DetonationBusy("Too many links are being checked right now. Try again in a minute.");
    await new Promise<void>((r) => waiting.push(r));
  }
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const dataUrl = (b: Buffer | null) => (b ? `data:image/jpeg;base64,${b.toString("base64")}` : null);

/** Every request goes through netGuard, except the made-up ".example" demo sites, served from memory. */
const siteFetch: Fetcher = async (url, init) => (isDemoHost(url) ? demoResponse(url, init.headers) : guardedFetch(url, init));

/** `fetcher` is for tests (a fake site); the server always uses siteFetch. */
export async function detonate(url: string, fetcher: Fetcher = siteFetch): Promise<DetonationReport> {
  assertPublicUrl(url); // throws BlockedUrlError before anything is opened
  const useCache = fetcher === siteFetch;
  const hit = useCache ? cache.get(url) : undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;

  return slot(async () => {
    const started = Date.now();
    const browser = await getBrowser();
    const [scanner, visitor] = await Promise.all([visitOnce(browser, url, "scanner", true, fetcher), visitOnce(browser, url, "visitor", true, fetcher)]);
    const a = assess(url, scanner.visit, visitor.visit);
    const report: DetonationReport = {
      url,
      finalUrl: visitor.visit.finalUrl,
      domain: a.domain,
      verdict: a.verdict,
      findings: a.findings,
      title: visitor.visit.title,
      redirects: visitor.visit.chain.slice(0, 10),
      screenshot: dataUrl(visitor.shot),
      scannerScreenshot: a.cloaking ? dataUrl(scanner.shot) : null,
      cloaking: a.cloaking,
      tookMs: Date.now() - started,
    };
    if (useCache) cache.set(url, { at: Date.now(), report });
    for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
    return report;
  });
}

export async function closeDetonationBrowser() {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}
