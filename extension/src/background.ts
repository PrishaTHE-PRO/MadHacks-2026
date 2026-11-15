// Background service worker: the only part of the extension that talks to the
// DealDig server. Results are kept in chrome.storage.session (per tab) so the
// side panel can render them and survives the worker being shut down.

import { SERVER_URL } from "./config";
import {
  chatKey,
  flagKey,
  tabKey,
  type AnalyzeResponse,
  type ChatTabState,
  type ContentMessage,
  type ExtensionMessage,
  type TabState,
} from "./messages";
import { prefilter } from "../../shared/chatPatterns";
import type { ChatContext, ChatFlag, ChatReport, Listing, RiskReport } from "../../shared/types";

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

/** Check a listing and store the result for the tab (the side panel renders it). */
async function runListing(tabId: number, listing: Listing): Promise<AnalyzeResponse> {
  await setTab(tabId, { status: "loading", listing });
  try {
    const report = await analyze(listing);
    await setTab(tabId, { status: "done", listing, report });
    return { ok: true, report };
  } catch (err) {
    // fetch() throws TypeError when the server can't be reached at all.
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
    void runListing(tabId, msg.listing).then(sendResponse);
    return true; // keep the channel open for the async response
  }

  // From the side panel's "Try again": re-run the tab's last listing check.
  if (msg.type === "RETRY_LISTING") {
    void (async () => {
      const key = tabKey(msg.tabId);
      const state = (await chrome.storage.session.get(key))[key] as TabState | undefined;
      if (!state) return;
      const res = await runListing(msg.tabId, state.listing);
      const note: ContentMessage = { type: "LISTING_RESULT", listingId: state.listing.id, res };
      chrome.tabs.sendMessage(msg.tabId, note).catch(() => {});
    })();
    return false;
  }

  if (msg.type === "ANALYZE_CHAT" && tabId !== undefined) {
    void onChat(tabId, msg.ctx);
    return false;
  }

  if (msg.type === "OPEN_PANEL" && tabId !== undefined) {
    chrome.sidePanel.open({ tabId }).catch(() => {
      // Chrome only allows this right after a user gesture; the toolbar icon always works.
    });
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove([tabKey(tabId), chatKey(tabId)]);
});

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
