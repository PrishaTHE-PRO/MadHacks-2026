// Background service worker: the only part of the extension that talks to the
// DealDig server. Results are kept in chrome.storage.session (per tab) so the
// side panel can render them and survives the worker being shut down.

import { SERVER_URL } from "./config";
import {
  chatKey,
  flagKey,
  sentKey,
  tabKey,
  type AnalyzeResponse,
  type ChatTabState,
  type ContentMessage,
  type ExtensionMessage,
  type TabState,
} from "./messages";
import { prefilter } from "../../shared/chatPatterns";
import type { ChatContext, ChatFlag, ChatReport, Listing, ListingProgress, ListingStep, RiskReport } from "../../shared/types";
import { dhashFromRgba } from "../../shared/photohash";
import { saveCheckToHistory } from "./history";
import { allowSite, guardChatFlags, startLinkGuard } from "./guard";
import { forAnalysis, summarizeSent, type SentSummary } from "../../shared/privacy";
import { loadSettings, SETTINGS_KEY, withDefaults, type PrivacySettings } from "./privacy/settings";
import { applyShield, forgetTab, pageStarted, shieldSummary } from "./privacy/shield";
import { maybeClearTrackerCookies, noteTabUrl, openClean, openPrivately, startHistoryScrub, wipeEverything } from "./privacy/noTrace";

startLinkGuard();
startHistoryScrub();

// Per-tab results stay with the extension's own pages (the default, made explicit):
// content scripts, which run inside marketplace pages, can't read them.
chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

// Tracker shield and link cleaning follow the privacy settings.
void loadSettings().then(applyShield).catch((e) => console.warn("[DealDig] shield not applied", e));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(SETTINGS_KEY in changes)) return;
  const before = withDefaults(changes[SETTINGS_KEY].oldValue as Partial<PrivacySettings> | undefined);
  const after = withDefaults(changes[SETTINGS_KEY].newValue as Partial<PrivacySettings> | undefined);
  void applyShield(after).catch((e) => console.warn("[DealDig] shield not applied", e));
  // Cached reports were made with the other photo setting: check again next time.
  if (before.webPhotos !== after.webPhotos) void clearCachedReports();
});

async function clearCachedReports() {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("report:")));
}

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

/**
 * Check a listing on the server. `onProgress` gets the planned steps and each
 * step as it starts, read from the server's newline-delimited JSON stream.
 */
async function analyze(
  listing: Listing,
  onProgress: (p: { plan?: ListingStep[]; step?: ListingStep }) => void = () => {},
  onSent: (s: SentSummary) => void = () => {},
): Promise<RiskReport> {
  const cacheKey = `report:${listing.platform}:${listing.id}`;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey] as
    | { at: number; report: RiskReport }
    | undefined;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.report;

  // Photos are fingerprinted here first (part of "Reading the listing" in the sidebar).
  const photoHashes = await Promise.all(listing.photos.slice(0, HASHED_PHOTOS).map(photoHash));
  // Only public listing details, with the link cut to its canonical form;
  // photos go to Google only if the user turned that on.
  const options = { webPhotos: (await loadSettings()).webPhotos };
  const sent = forAnalysis(listing);
  onSent(summarizeSent(listing, sent, photoHashes, options));
  const res = await fetch(`${SERVER_URL}/analyze-listing?progress=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listing: sent, photoHashes, options }),
  });
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);

  let report: RiskReport | null = null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as ListingProgress;
      if ("plan" in msg) onProgress({ plan: msg.plan });
      else if ("step" in msg) onProgress({ step: msg.step });
      else if ("report" in msg) report = msg.report;
      else throw new Error(msg.error);
    }
    if (done) break;
  }
  if (!report) throw new Error("The server ended the check without a result.");
  await chrome.storage.session.set({ [cacheKey]: { at: Date.now(), report } });
  return report;
}

async function setTab(tabId: number, state: TabState) {
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
}

/** Check a listing and store the result for the tab (the side panel renders it). */
async function runListing(tabId: number, listing: Listing, incognito = false): Promise<AnalyzeResponse> {
  let loading: TabState & { status: "loading" } = { status: "loading", listing };
  await setTab(tabId, loading);
  // Progress writes are chained so a late one can't overwrite the final result.
  let writes = Promise.resolve();
  try {
    const report = await analyze(
      listing,
      (p) => {
        loading = { ...loading, ...p };
        const snapshot = loading;
        writes = writes.then(() => setTab(tabId, snapshot));
      },
      (sent) => void chrome.storage.session.set({ [sentKey(tabId)]: sent }),
    );
    await writes;
    // Personal history stays on this device (chrome.storage.local), and never for private windows.
    if (!incognito) await saveCheckToHistory(listing, report).catch((e) => console.warn("[DealDig] history not saved", e));
    await setTab(tabId, { status: "done", listing, report });
    return { ok: true, report };
  } catch (err) {
    // fetch() throws TypeError when the server can't be reached at all.
    await writes;
    const offline = err instanceof TypeError;
    const error = offline
      ? "Can't reach the DealDig server. Is it running?"
      : err instanceof Error
        ? err.message
        : String(err);
    await setTab(tabId, { status: "error", listing, error, offline });
    return { ok: false, error };
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === "ANALYZE_LISTING" && tabId !== undefined) {
    void runListing(tabId, msg.listing, sender.tab?.incognito).then(sendResponse);
    return true; // keep the channel open for the async response
  }

  // From the side panel's "Try again": re-run the tab's last listing check.
  if (msg.type === "RETRY_LISTING") {
    void (async () => {
      const key = tabKey(msg.tabId);
      const state = (await chrome.storage.session.get(key))[key] as TabState | undefined;
      if (!state) return;
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      const res = await runListing(msg.tabId, state.listing, tab?.incognito);
      const note: ContentMessage = { type: "LISTING_RESULT", listingId: state.listing.id, res };
      chrome.tabs.sendMessage(msg.tabId, note).catch(() => {});
    })();
    return false;
  }

  if (msg.type === "CHAT_WATCHING" && tabId !== undefined) {
    void setChatWatching(tabId, msg.threadId, msg.watching);
    return false;
  }

  if (msg.type === "ANALYZE_CHAT" && tabId !== undefined) {
    void onChat(tabId, msg.ctx);
    return false;
  }

  if (msg.type === "ALLOW_SITE" && tabId !== undefined) {
    void allowSite(tabId, msg.domain, msg.url);
    return false;
  }

  if (msg.type === "CLOSE_TAB" && tabId !== undefined) {
    void chrome.tabs.remove(tabId);
    return false;
  }

  if (msg.type === "OPEN_CLEAN" && tabId !== undefined) {
    void openClean(tabId, msg.url, msg.how).catch((e) => console.warn("[DealDig] couldn't open link", e));
    return false;
  }

  if (msg.type === "PRIVACY_SUMMARY") {
    void loadSettings()
      .then((s) => shieldSummary(msg.tabId, s))
      .then(sendResponse);
    return true;
  }

  if (msg.type === "OPEN_PRIVATELY") {
    void openPrivately(msg.url).then(sendResponse);
    return true;
  }

  if (msg.type === "WIPE_EVERYTHING") {
    void wipeEverything().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "OPEN_PANEL" && tabId !== undefined) {
    chrome.sidePanel.open({ tabId }).catch(() => {
      // Chrome only allows this right after a user gesture; the toolbar icon always works.
    });
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove([tabKey(tabId), chatKey(tabId), sentKey(tabId)]);
  forgetTab(tabId);
  void maybeClearTrackerCookies().catch((e) => console.warn("[DealDig] tracker cookies not cleared", e));
});

// Count blocked trackers per page, not per tab lifetime.
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) pageStarted(d.tabId, d.timeStamp);
});

// A navigation stops any chat watcher on the old page; the content script on
// the new page says so again if it's still a chat.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) void setChatWatching(tabId, null, false);
  if (info.url) noteTabUrl(info.url);
});

/** Mark the tab's chat as watched or not (the sidebar's "Watching this chat" dot). */
function setChatWatching(tabId: number, threadId: string | null, watching: boolean) {
  return serialize(tabId, async () => {
    const key = chatKey(tabId);
    const state = (await chrome.storage.session.get(key))[key] as ChatTabState | undefined;
    if (!state || (threadId !== null && state.threadId !== threadId) || state.watching === watching) return;
    await chrome.storage.session.set({ [key]: { ...state, watching } });
  });
}

// ---------------------------------------------------------------------------
// Chat safety
// ---------------------------------------------------------------------------
// State per tab lives in chrome.storage.session under chat:<tabId> so the side
// panel can render it. Server calls are rate limited per thread (one per 3 s,
// coalesced to the latest messages). If the server is down, the regex flags
// stay and the status says the AI check is unavailable.

const CHAT_MIN_INTERVAL_MS = 3000;
const CHAT_TIMEOUT_MS = 20_000;

interface ThreadCalls {
  lastCall: number;
  timer?: ReturnType<typeof setTimeout>;
  pending?: ChatContext; // latest context waiting for its turn
}
const threadCalls = new Map<string, ThreadCalls>(); // `${tabId}:${threadId}`

// One storage update at a time per tab, so concurrent results don't clobber each other.
const tabQueues = new Map<number, Promise<unknown>>();
function serialize<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const next = (tabQueues.get(tabId) ?? Promise.resolve()).then(fn, fn);
  tabQueues.set(tabId, next.catch(() => {}));
  return next;
}

const messageOrder = (flags: ChatFlag[], order: string[]) => {
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...flags].sort((a, b) => (idx.get(a.messageId) ?? -1) - (idx.get(b.messageId) ?? -1));
};

/** Apply an update to the tab's chat state, then tell the content script. */
function updateChat(
  tabId: number,
  ctx: ChatContext,
  update: (state: ChatTabState) => void,
): Promise<ChatTabState> {
  return serialize(tabId, async () => {
    const key = chatKey(tabId);
    const prev = (await chrome.storage.session.get(key))[key] as ChatTabState | undefined;
    const fresh = !prev || prev.threadId !== ctx.threadId || prev.platform !== ctx.platform;
    const state: ChatTabState = fresh
      ? { platform: ctx.platform, threadId: ctx.threadId, url: ctx.url, role: ctx.role, flags: [], quotes: {}, status: "checking", aiUsed: false, updatedAt: 0 }
      : prev;
    // A new role means the old flags for these messages no longer apply.
    if (!fresh && state.role !== ctx.role) {
      const ids = new Set(ctx.messages.map((m) => m.id));
      state.flags = state.flags.filter((f) => !ids.has(f.messageId));
      state.role = ctx.role;
    }
    for (const m of ctx.messages) state.quotes[m.id] = m.text;
    state.watching = true; // only the content script's watcher sends ANALYZE_CHAT
    state.url = ctx.url;
    state.otherParty = ctx.otherParty;
    update(state);
    state.flags = messageOrder(state.flags, Object.keys(state.quotes));
    state.updatedAt = Date.now();
    await chrome.storage.session.set({ [key]: state });
    const note: ContentMessage = { type: "CHAT_RESULT", threadId: state.threadId, flags: state.flags, status: state.status };
    chrome.tabs.sendMessage(tabId, note).catch(() => {});
    return state;
  });
}

async function onChat(tabId: number, ctx: ChatContext) {
  // Regex flags right away (the content script has them too; this is for the side panel).
  await updateChat(tabId, ctx, (state) => {
    const have = new Set(state.flags.map(flagKey));
    for (const f of prefilter(ctx)) if (!have.has(flagKey(f))) state.flags.push(f);
    state.status = "checking";
  });
  // Look-alike links are known on the device already: block them before anyone clicks.
  void guardChatFlags(ctx, prefilter(ctx));

  const id = `${tabId}:${ctx.threadId}`;
  const calls = threadCalls.get(id) ?? { lastCall: 0 };
  threadCalls.set(id, calls);
  calls.pending = ctx;
  if (calls.timer) return; // a call is already scheduled; it'll use the latest context
  const wait = Math.max(0, calls.lastCall + CHAT_MIN_INTERVAL_MS - Date.now());
  calls.timer = setTimeout(() => {
    calls.timer = undefined;
    const latest = calls.pending!;
    calls.pending = undefined;
    calls.lastCall = Date.now();
    void callChatServer(tabId, latest);
  }, wait);
}

async function callChatServer(tabId: number, ctx: ChatContext) {
  try {
    const res = await fetch(`${SERVER_URL}/analyze-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ctx }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const report = (await res.json()) as ChatReport;
    // Red link warnings (brand-new, known dangerous) become blocking rules too.
    void guardChatFlags(ctx, report.flags);
    await updateChat(tabId, ctx, (state) => {
      // The server's answer covers these messages completely (its regex + AI flags).
      const ids = new Set(ctx.messages.map((m) => m.id));
      state.flags = [...state.flags.filter((f) => !ids.has(f.messageId)), ...report.flags];
      state.status = "done";
      state.aiUsed = report.aiUsed;
    });
  } catch (err) {
    console.warn("[DealDig] chat check failed, keeping regex flags:", err);
    await updateChat(tabId, ctx, (state) => {
      state.status = "offline";
    });
  }
}
