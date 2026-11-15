// Made-up scam sites for the demo, served to the safe preview's headless
// browser from memory. They live under ".example", a name that's reserved and
// can never be a real website, so nothing real is imitated or contacted.
//
// paypal-resolve.example cloaks like a real phishing kit: a security scanner
// (headless browser) gets a harmless "coming soon" page, and a normal visitor
// gets a fake PayPal page asking for a password and card number.

import type { GuardedResponse } from "./netGuard";

const html = (body: string): GuardedResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from(body),
  truncated: false,
});

const DEMO_NOTE = `<p style="margin-top:40px;font:12px sans-serif;color:#999">Second Look demo page. Not a real site.</p>`;

const SCANNER_PAGE = `<!doctype html><title>Coming soon</title>
<body style="font:18px Georgia,serif;max-width:640px;margin:80px auto;color:#333">
<h1>Garden furniture, coming soon</h1>
<p>Our new store is opening soon. Please check back later for teak benches, planters and outdoor lights.</p>
${DEMO_NOTE}</body>`;

const VISITOR_PAGE = `<!doctype html><title>PayPal: Resolve a payment</title>
<body style="margin:0;font:16px Helvetica,Arial,sans-serif;background:#f5f7fa;color:#2c2e2f">
<div style="background:#fff;border-bottom:1px solid #e5e7eb;padding:18px 32px;font:bold 26px Helvetica;color:#003087">PayPal</div>
<main style="max-width:420px;margin:48px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<h2 style="margin:0 0 8px">Payment on hold</h2>
<p style="color:#555">Your buyer sent <b>$650.00</b>. Confirm your account to release the funds.</p>
<form>
<input name="email" placeholder="Email" style="display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:6px">
<input type="password" name="password" placeholder="Password" style="display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:6px">
<input name="cardnumber" autocomplete="cc-number" placeholder="Card number" style="display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:6px">
<input name="cvv" placeholder="CVV" style="display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:6px">
<button type="button" style="width:100%;padding:12px;border:0;border-radius:24px;background:#0070ba;color:#fff;font-weight:bold">Release payment</button>
</form></main>${DEMO_NOTE}</body>`;

/** The demo sites' hostnames. Only reserved ".example" names. */
const DEMO_HOSTS = new Set(["paypal-resolve.example"]);

export const isDemoHost = (url: string) => {
  try {
    return DEMO_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** The demo page for this request: the scanner gets the harmless page, a normal browser the fake login. */
export function demoResponse(url: string, headers: Record<string, string> = {}): GuardedResponse {
  const ua = Object.entries(headers).find(([k]) => k.toLowerCase() === "user-agent")?.[1] ?? "";
  if (new URL(url).pathname === "/favicon.ico") return { status: 404, headers: {}, body: Buffer.alloc(0), truncated: false };
  return html(/HeadlessChrome/.test(ua) ? SCANNER_PAGE : VISITOR_PAGE);
}
