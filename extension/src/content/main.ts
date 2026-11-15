// One content script for every supported marketplace. It picks the reader for
// the current URL, turns the page into a `Listing`, and asks the background
// worker to score it. Facebook and Poshmark are single-page apps, so we watch
// for URL changes instead of relying on page loads.
//
// Alongside that, if a chat adapter matches the URL, a chat watcher flags scam
// patterns in the open conversation (both can run on one page, e.g. a Facebook
// item with a chat popup).

import { isPoshmarkListingUrl, parsePoshmarkHtml } from "../adapters/poshmark";
import { EBAY_SECTIONS, isEbayListingUrl, parseEbayPage } from "../adapters/ebay";
import { isFacebookListingUrl, parseFacebookPage } from "../adapters/facebook";
import type { Listing, RiskReport } from "../../../shared/types";
import type { AnalyzeResponse, ContentMessage } from "../messages";
import { collectPageData } from "./collect";
import { showBadge, hideBadge } from "./badge";
import { findChatAdapter } from "../chat";
import type { ChatAdapter } from "../chat/adapter";
import { startChatWatcher } from "../chat/watch";
import { sellPagePlatform } from "../sellPages";
import { installUploadGuard, showSellBadge } from "./uploadGuard";
import { startOutboundCleaning } from "./outbound";

installUploadGuard();
startOutboundCleaning();

interface SiteReader {
  matches(url: string): boolean;
  read(url: string): Promise<Listing | null>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a DOM read until it succeeds, the URL changes, or we run out of time. */
async function poll(url: string, timeoutMs: number, attempt: () => Listing | null, accept = (_l: Listing) => true) {
  const deadline = Date.now() + timeoutMs;
  let last: Listing | null = null;
  while (Date.now() < deadline && location.href === url) {
    last = attempt();
    if (last && accept(last)) return settlePhotos(url, last, attempt, accept);
    await sleep(400);
  }
  return last;
}

/**
 * The first good read often has only the photo on screen: the rest of the
 * carousel loads a moment later. Keep reading for up to 2 seconds while more
 * photos appear, and stop once the count holds steady for two reads.
 */
async function settlePhotos(url: string, first: Listing, attempt: () => Listing | null, accept: (l: Listing) => boolean) {
  let best = first;
  let steady = 0;
  const deadline = Date.now() + 2000;
  while (steady < 2 && Date.now() < deadline && location.href === url) {
    await sleep(350);
    const next = attempt();
    if (next && accept(next) && next.id === best.id && next.photos.length > best.photos.length) {
      best = next;
      steady = 0;
    } else steady++;
  }
  return best;
}

// Poshmark: the data lives in an inline script that deletes itself, so re-fetch the HTML.
const poshmark: SiteReader = {
  matches: isPoshmarkListingUrl,
  async read(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    return parsePoshmarkHtml(await res.text(), url);
  },
};

// eBay: server-rendered, so the DOM is ready on load. Poll briefly for the seller card.
const ebay: SiteReader = {
  matches: isEbayListingUrl,
  read: (url) =>
    poll(
      url,
      4000,
      () => parseEbayPage(collectPageData({ sections: EBAY_SECTIONS })),
      (l) => Boolean(l.seller.id),
    ),
};

// Facebook: the item renders as a dialog over the feed, or as a full page.
// When clicking between items, the previous item's DOM can linger for a moment,
// so wait until the title changes before trusting the read.
let lastFacebookTitle = "";
const facebook: SiteReader = {
  matches: isFacebookListingUrl,
  async read(url) {
    const listing = await poll(
      url,
      10000,
      () => {
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        const root = dialogs.at(-1) ?? document.querySelector('[role="main"]');
        return parseFacebookPage(collectPageData({ root }));
      },
      (l) => l.title !== lastFacebookTitle && Boolean(l.seller.id) && l.photos.length > 0,
    );
    if (listing) lastFacebookTitle = listing.title;
    return listing;
  },
};

const READERS: SiteReader[] = [poshmark, ebay, facebook];

async function check(url: string) {
  // Creating your own listing: point to the photo privacy tool instead of scoring.
  if (sellPagePlatform(url)) {
    showSellBadge();
    return;
  }

  const reader = READERS.find((r) => r.matches(url));
  if (!reader) {
    hideBadge();
    return;
  }
  showBadge({ state: "loading" });

  let listing: Listing | null = null;
  try {
    listing = await reader.read(url);
  } catch (err) {
    console.warn("[Second Look] could not read listing", err);
  }
  if (url !== location.href) return; // user moved on while we were reading
  if (!listing) {
    showBadge({ state: "error", message: "Couldn't read this listing" });
    return;
  }

  shownListingId = listing.id;
  const res: AnalyzeResponse = await chrome.runtime.sendMessage({ type: "ANALYZE_LISTING", listing });
  if (url !== location.href) return;
  showResult(res);
}

let shownListingId = "";
function showResult(res: AnalyzeResponse) {
  if (res.ok) showBadge({ state: "done", report: res.report as RiskReport });
  else showBadge({ state: "error", message: res.error });
}

// The side panel's "Try again" re-runs the check in the background; show the new result.
chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
  if (msg.type === "LISTING_RESULT" && msg.listingId === shownListingId) showResult(msg.res);
});

// The chat watcher handles thread changes itself; we only swap it when the site changes.
let chat: { adapter: ChatAdapter; watcher: { stop(): void } } | null = null;
function updateChatWatcher(url: string) {
  const adapter = findChatAdapter(url);
  if (adapter === chat?.adapter) return;
  chat?.watcher.stop();
  chat = adapter ? { adapter, watcher: startChatWatcher(adapter) } : null;
}

let lastUrl = "";
function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    void check(lastUrl);
    updateChatWatcher(lastUrl);
  }
}

tick();
setInterval(tick, 1000);
