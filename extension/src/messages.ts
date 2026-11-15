// Messages passed between content scripts, the background worker and the side panel.

import type { ChatContext, ChatFlag, ChatPlatform, ChatRole, Listing, ListingStep, RiskReport } from "../../shared/types";

export type ExtensionMessage =
  | { type: "ANALYZE_LISTING"; listing: Listing }
  | { type: "ANALYZE_CHAT"; ctx: ChatContext }
  | { type: "RETRY_LISTING"; tabId: number } // side panel → background
  | { type: "CHAT_WATCHING"; threadId: string; watching: boolean } // content → background
  | { type: "OPEN_PANEL" };

export type AnalyzeResponse = { ok: true; report: RiskReport } | { ok: false; error: string };

/** Background → content script. */
export type ContentMessage =
  // The latest flags for a chat thread.
  | { type: "CHAT_RESULT"; threadId: string; flags: ChatFlag[]; status: ChatStatus }
  // A listing re-check finished (the side panel's "Try again"); update the badge.
  | { type: "LISTING_RESULT"; listingId: string; res: AnalyzeResponse };

/** What the background stores per tab in chrome.storage.session; the side panel renders it. */
export type TabState =
  // plan/step: live progress from the server (absent until the first line arrives, or for cached results)
  | { status: "loading"; listing: Listing; plan?: ListingStep[]; step?: ListingStep }
  | { status: "done"; listing: Listing; report: RiskReport }
  | { status: "error"; listing: Listing; error: string; offline?: boolean }; // offline: server unreachable

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
  /** True while a content script is watching this thread on the page. */
  watching?: boolean;
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
// ---------------------------------------------------------------------------
// Upload guard: photos the seller picked on a sell page are held by the
// content script until the side panel cleans them (or the seller skips).
// Extension messages must be JSON, so files travel as base64, one per message
// to stay well under Chrome's 64 MB message limit.

export interface WireFile {
  name: string;
  type: string;
  base64: string;
}

export interface HeldBatch {
  batchId: string;
  count: number;
  names: string[];
  platform: string;
}

/** Side panel → content script (chrome.tabs.sendMessage). */
export type GuardRequest =
  | { type: "GUARD_QUERY" }
  | { type: "GUARD_GET_FILE"; batchId: string; index: number }
  | { type: "GUARD_PUT_FILE"; batchId: string; index: number; file: WireFile }
  | { type: "GUARD_COMMIT"; batchId: string }
  | { type: "GUARD_SKIP"; batchId: string };

export type GuardResponse =
  | { ok: true; batch?: HeldBatch | null; file?: WireFile; delivered?: number }
  | { ok: false; error: string };

/** Content script → extension pages (chrome.runtime.sendMessage). */
export type GuardEvent = { type: "GUARD_HELD"; batch: HeldBatch } | { type: "GUARD_RELEASED"; batchId: string };

export async function fileToWire(file: Blob, name: string): Promise<WireFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return { name, type: file.type, base64: btoa(binary) };
}

export function wireToFile(w: WireFile): File {
  const binary = atob(w.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], w.name, { type: w.type, lastModified: Date.now() });
}
