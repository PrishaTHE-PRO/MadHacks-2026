// Background service worker: the only part of the extension that talks to the
// DealDig server. Results are kept in chrome.storage.session (per tab) so the
// side panel can render them and survives the worker being shut down.

import { SERVER_URL } from "./config";
import { tabKey, type AnalyzeResponse, type ExtensionMessage, type TabState } from "./messages";
import type { Listing, RiskReport } from "../../shared/types";
import { dhashFromRgba } from "../../shared/photohash";
import { saveCheckToHistory } from "./history";

const CACHE_MS = 10 * 60 * 1000;
const HASHED_PHOTOS = 4;
// Decode at this size before averaging down to the 9×8 hash grid: big enough
// to smooth out noise, small enough to be quick.
const HASH_DECODE = { w: 72, h: 64 };

/**
 * Fingerprint a public listing photo (spec §3.1). Only the 16-character hash
 * is sent to the server. Needs host_permissions for the photo's CDN.
 */
async function photoHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob(), {
      resizeWidth: HASH_DECODE.w,
      resizeHeight: HASH_DECODE.h,
      resizeQuality: "high",
    });
    const canvas = new OffscreenCanvas(HASH_DECODE.w, HASH_DECODE.h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return dhashFromRgba(ctx.getImageData(0, 0, HASH_DECODE.w, HASH_DECODE.h).data, HASH_DECODE.w, HASH_DECODE.h);
  } catch {
    return null; // CDN blocked or not an image: the rest of the check still runs
  }
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function analyze(listing: Listing): Promise<RiskReport> {
  const cacheKey = `report:${listing.platform}:${listing.id}`;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey] as
    | { at: number; report: RiskReport }
    | undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.report;

  const photoHashes = await Promise.all(listing.photos.slice(0, HASHED_PHOTOS).map(photoHash));
  const res = await fetch(`${SERVER_URL}/analyze-listing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing, photoHashes }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const report = (await res.json()) as RiskReport;
  await chrome.storage.session.set({ [cacheKey]: { at: Date.now(), report } });
  return report;
}

async function setTab(tabId: number, state: TabState) {
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === "ANALYZE_LISTING" && tabId !== undefined) {
    const { listing } = msg;
    void (async () => {
      await setTab(tabId, { status: "loading", listing });
      try {
        const report = await analyze(listing);
        // Personal history stays on this device (chrome.storage.local).
        await saveCheckToHistory(listing, report).catch((e) => console.warn("[DealDig] history not saved", e));
        await setTab(tabId, { status: "done", listing, report });
        sendResponse({ ok: true, report } satisfies AnalyzeResponse);
      } catch (err) {
        const error =
          err instanceof TypeError
            ? "Can't reach the DealDig server. Is it running?"
            : err instanceof Error
              ? err.message
              : String(err);
        await setTab(tabId, { status: "error", listing, error });
        sendResponse({ ok: false, error } satisfies AnalyzeResponse);
      }
    })();
    return true; // keep the channel open for the async response
  }

  if (msg.type === "OPEN_PANEL" && tabId !== undefined) {
    chrome.sidePanel.open({ tabId }).catch(() => {
      // Chrome only allows this right after a user gesture; the toolbar icon always works.
    });
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(tabKey(tabId));
});
