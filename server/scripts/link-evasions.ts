// Prints which phishing-link evasions the on-device check catches, and which
// it misses, for the demo and to track progress.
//
//   npm run eval:links -w server
//
// Only the look-alike check runs here (no network). Brand-new domains and
// Safe Browsing matches are caught on the server; see server/test/links.test.ts.

import { checkLookalike } from "../../shared/linkCheck";

const CASES: { url: string; trick: string; phishing: boolean }[] = [
  { url: "https://faceb00k-pay.com/claim", trick: "digit for a letter", phishing: true },
  { url: "paypa1.com/login", trick: "1 for l", phishing: true },
  { url: "https://www.paypai.com", trick: "capital I for l", phishing: true },
  { url: "https://pay-pal.com/secure", trick: "hyphen split", phishing: true },
  { url: "https://paypal.secure-login.xyz", trick: "brand as a subdomain", phishing: true },
  { url: "https://paypal.com.account-verify.top/", trick: "fake .com in the middle", phishing: true },
  { url: "zelle-payments-support.com", trick: "brand + scary words", phishing: true },
  { url: "https://rnercari.com/item", trick: "rn looks like m", phishing: true },
  { url: "https://craigslst.org/pay", trick: "dropped letter", phishing: true },
  { url: "https://раураl.com", trick: "Cyrillic letters", phishing: true },
  { url: "http://192.168.4.20/login", trick: "bare IP address", phishing: true },
  { url: "https://www.paypal.com@evil-site.xyz/login", trick: "real site before @", phishing: true },
  { url: "https://www.google.com/url?q=https://paypa1-login.com", trick: "open redirect", phishing: true },
  { url: "https://ebey.com", trick: "one letter off a short name", phishing: true },
  { url: "https://vemno.com", trick: "swapped letters", phishing: true },
  { url: "https://secure-account-update.com", trick: "no brand name at all", phishing: true },
  { url: "https://bit.ly/3xYz", trick: "URL shortener", phishing: true },
  { url: "https://www.paypal.com/signin", trick: "real PayPal", phishing: false },
  { url: "https://apple-pie-recipes.com", trick: "ordinary word", phishing: false },
  { url: "https://easy-bikes.com", trick: "near a brand name", phishing: false },
  { url: "https://www.google.com/maps/place/Madison", trick: "real Google", phishing: false },
];

const NOTE: Record<string, string> = {
  "https://ebey.com": "short names only match through digit swaps, to avoid false alarms",
  "https://secure-account-update.com": "caught on the server if the domain is brand new",
  "https://bit.ly/3xYz": "the server follows the short link, then checks the real address",
};

let tp = 0, fn = 0, fp = 0, tn = 0;
console.log("Result   Trick                          Link");
for (const c of CASES) {
  const f = checkLookalike(c.url);
  const flagged = f !== null;
  if (c.phishing && flagged) tp++;
  else if (c.phishing) fn++;
  else if (flagged) fp++;
  else tn++;
  const mark = c.phishing ? (flagged ? "caught " : "MISSED ") : flagged ? "FALSE! " : "ok     ";
  console.log(`${mark}  ${c.trick.padEnd(30)} ${c.url}${!flagged && NOTE[c.url] ? `\n         ↳ ${NOTE[c.url]}` : ""}`);
}
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
console.log(`\nOn-device: caught ${tp}/${tp + fn} phishing links, ${fp} false alarm(s) on ${fp + tn} safe links.`);
console.log(`Precision ${(precision * 100).toFixed(0)}%, recall ${(recall * 100).toFixed(0)}% (on-device check alone).`);
