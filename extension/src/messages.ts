// Messages passed between content scripts, the background worker and the side panel.

import type { Listing, RiskReport } from "../../shared/types";

export type ExtensionMessage =
  | { type: "ANALYZE_LISTING"; listing: Listing }
  | { type: "OPEN_PANEL" };

export type AnalyzeResponse = { ok: true; report: RiskReport } | { ok: false; error: string };

/** What the background stores per tab in chrome.storage.session; the side panel renders it. */
export type TabState =
  | { status: "loading"; listing: Listing }
  | { status: "done"; listing: Listing; report: RiskReport }
  | { status: "error"; listing: Listing; error: string };

export const tabKey = (tabId: number) => `tab:${tabId}`;

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
