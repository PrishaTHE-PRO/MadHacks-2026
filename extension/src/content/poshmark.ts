// Runs on every poshmark.com page. Poshmark is a single-page app, so we watch
// for URL changes instead of relying on page loads.

import { isPoshmarkListingUrl, parsePoshmarkHtml } from "../adapters/poshmark";
import type { Listing, RiskReport } from "../../../shared/types";
import type { AnalyzeResponse } from "../messages";
import { showBadge, hideBadge } from "./badge";

let lastUrl = "";

async function readListing(url: string): Promise<Listing | null> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return parsePoshmarkHtml(await res.text(), url);
}

async function check(url: string) {
  if (!isPoshmarkListingUrl(url)) {
    hideBadge();
    return;
  }
  showBadge({ state: "loading" });

  let listing: Listing | null = null;
  try {
    listing = await readListing(url);
  } catch (err) {
    console.warn("[DealDig] could not read listing", err);
  }
  if (!listing) {
    showBadge({ state: "error", message: "Couldn't read this listing" });
    return;
  }

  const res: AnalyzeResponse = await chrome.runtime.sendMessage({ type: "ANALYZE_LISTING", listing });
  if (url !== location.href) return; // user moved on while we were waiting
  if (res.ok) showBadge({ state: "done", report: res.report as RiskReport });
  else showBadge({ state: "error", message: res.error });
}

function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    void check(lastUrl);
  }
}

tick();
setInterval(tick, 1000);
