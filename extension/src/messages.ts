// Messages passed between content scripts, the background worker and the side panel.

import type { ChatContext, ChatFlag, ChatPlatform, ChatRole, Listing, RiskReport } from "../../shared/types";

export type ExtensionMessage =
  | { type: "ANALYZE_LISTING"; listing: Listing }
  | { type: "ANALYZE_CHAT"; ctx: ChatContext }
  | { type: "OPEN_PANEL" };

/** Background → content script: the latest flags for a chat thread. */
export type ContentMessage = {
  type: "CHAT_RESULT";
  threadId: string;
  flags: ChatFlag[];
  status: ChatStatus;
};

export type AnalyzeResponse = { ok: true; report: RiskReport } | { ok: false; error: string };

/** What the background stores per tab in chrome.storage.session; the side panel renders it. */
export type TabState =
  | { status: "loading"; listing: Listing }
  | { status: "done"; listing: Listing; report: RiskReport }
  | { status: "error"; listing: Listing; error: string };

export const tabKey = (tabId: number) => `tab:${tabId}`;

// --- Chat safety ---

/** "checking": regex flags shown, server call in flight. "offline": server unreachable, regex only. */
export type ChatStatus = "checking" | "done" | "offline";

/** Per-tab chat state in chrome.storage.session under `chat:<tabId>`. */
export interface ChatTabState {
  platform: ChatPlatform;
  threadId: string;
  url: string;
  role: ChatRole;
  /** Every flag seen in this thread so far (not just the last 10 messages), in message order. */
  flags: ChatFlag[];
  /** messageId → message text, for quoting in the side panel. */
  quotes: Record<string, string>;
  status: ChatStatus;
  aiUsed: boolean;
  otherParty?: ChatContext["otherParty"];
  updatedAt: number;
}

export const chatKey = (tabId: number) => `chat:${tabId}`;

/** Identifies a thread across tabs and reloads. */
export const threadKey = (platform: ChatPlatform, threadId: string) => `${platform}:${threadId}`;

/** chrome.storage.local: the "I'm buying / I'm selling" choice per thread. */
export const roleKey = (thread: string) => `chatRole:${thread}`;

/** chrome.storage.local: `pattern:messageId` keys the user marked "Not a scam", per thread. */
export const dismissedKey = (thread: string) => `chatDismissed:${thread}`;

export const flagKey = (f: Pick<ChatFlag, "pattern" | "messageId">) => `${f.pattern}:${f.messageId}`;
