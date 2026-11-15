// "Leave no trace" (design doc Phase 3), background only:
//   - delete listing pages from Chrome history (optional `history` permission)
//   - open links clicked on a marketplace from the extension, with tracking
//     tags removed and no Referer (a tab the extension opens has no referrer)
//   - private peek: open a listing in an incognito window
//   - clear tracker cookies when the last marketplace tab closes (optional `browsingData`)
//   - wipe everything DealDig keeps

import { cookieClearOrigins, stripTrackingParams } from "../../../shared/privacy";
import { guardOpenedTab } from "../guard";
import { isMarketplaceUrl, unwrapRedirector } from "../guardCore";
import { canPeekPrivately, isListingUrl } from "./listingUrl";
import { loadSettings, SETTINGS_KEY } from "./settings";
import { deleteVaultKey } from "./vault";

// --- History scrub ----------------------------------------------------------

const onVisited = (item: chrome.history.HistoryItem) => {
  if (!item.url || !isListingUrl(item.url)) return;
  void loadSettings().then((s) => {
    if (s.scrubHistory) return chrome.history.deleteUrl({ url: item.url! });
  });
};

/** chrome.history only exists once the optional permission is granted, so listen for that too. */
export function startHistoryScrub() {
  const attach = () => {
    if (chrome.history && !chrome.history.onVisited.hasListener(onVisited)) chrome.history.onVisited.addListener(onVisited);
  };
  attach();
  chrome.permissions.onAdded.addListener(attach);
}

// --- Clean outbound links ---------------------------------------------------

export type { OpenHow } from "./openHow";
import type { OpenHow } from "./openHow";

/** The real destination of a link clicked on a marketplace, unwrapped and without tracking tags. */
export const cleanDestination = (url: string) => stripTrackingParams(unwrapRedirector(url));

export async function openClean(fromTabId: number, rawUrl: string, how: OpenHow) {
  const url = cleanDestination(rawUrl);
  if (!/^https?:\/\//i.test(url)) return;
  if (how === "same-tab") {
    // The link guard's onBeforeNavigate sees this tab is on a marketplace and checks it.
    await chrome.tabs.update(fromTabId, { url });
    return;
  }
  const from = await chrome.tabs.get(fromTabId).catch(() => null);
  const tab = await chrome.tabs.create({ url, active: how === "new-tab", openerTabId: fromTabId, index: from ? from.index + 1 : undefined });
  if (tab.id !== undefined) await guardOpenedTab(tab.id, url);
}

// --- Private peek -----------------------------------------------------------

export type PeekResult = { ok: true } | { ok: false; reason: "not-allowed" | "not-a-listing" };

export async function openPrivately(url: string): Promise<PeekResult> {
  if (!canPeekPrivately(url)) return { ok: false, reason: "not-a-listing" };
  if (!(await chrome.extension.isAllowedIncognitoAccess())) return { ok: false, reason: "not-allowed" };
  await chrome.windows.create({ url: stripTrackingParams(url), incognito: true });
  return { ok: true };
}

// --- Tracker cookies --------------------------------------------------------

const SAW_MARKETPLACE = "privacy:sawMarketplace";

/** Remember that a marketplace was open this session (tab URLs are gone by the time onRemoved fires). */
export function noteTabUrl(url: string | undefined) {
  if (isMarketplaceUrl(url)) void chrome.storage.session.set({ [SAW_MARKETPLACE]: true });
}

export async function maybeClearTrackerCookies() {
  const s = await loadSettings();
  if (!s.clearTrackerCookies || !chrome.browsingData) return;
  if (!(await chrome.storage.session.get(SAW_MARKETPLACE))[SAW_MARKETPLACE]) return;
  const tabs = await chrome.tabs.query({});
  if (tabs.some((t) => isMarketplaceUrl(t.url))) return; // still shopping
  // Tracker-only domains: the marketplace's cookies (and Google's, LinkedIn's...) stay, so the user stays signed in.
  const [first, ...rest] = cookieClearOrigins();
  if (!first) return;
  await chrome.browsingData.remove({ origins: [first, ...rest] }, { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true });
  await chrome.storage.session.remove(SAW_MARKETPLACE);
}

// --- Wipe everything --------------------------------------------------------

/** History, reports, reporter id, per-tab results and caches, and the history key. Settings stay. */
export async function wipeEverything() {
  const settings = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  await chrome.storage.local.clear();
  if (settings) await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await chrome.storage.session.clear();
  await deleteVaultKey();
}
