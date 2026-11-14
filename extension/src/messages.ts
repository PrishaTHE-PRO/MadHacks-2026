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
