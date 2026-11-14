// Background service worker: the only part of the extension that talks to the
// DealDig server. Results are kept in chrome.storage.session (per tab) so the
// side panel can render them and survives the worker being shut down.

import { SERVER_URL } from "./config";
import { tabKey, type AnalyzeResponse, type ExtensionMessage, type TabState } from "./messages";
import type { Listing, RiskReport } from "../../shared/types";

const CACHE_MS = 10 * 60 * 1000;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function analyze(listing: Listing): Promise<RiskReport> {
  const cacheKey = `report:${listing.platform}:${listing.id}`;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey] as
    | { at: number; report: RiskReport }
    | undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.report;

  const res = await fetch(`${SERVER_URL}/analyze-listing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing }),
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
