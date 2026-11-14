// Personal history and anonymous reporting identity (spec §7.1). Everything
// here lives in chrome.storage.local, on this device only: it is never sent
// to the server. History entries expire after 90 days, and the user can
// forget one seller or clear it all. Clearing history never removes reports
// already sent, so a scammer can't ask a victim to "reset" their record.

import type { Listing, Platform, ReportCategory, RiskReport } from "../../shared/types";
import { isFresh, withCheck, type HistoryEntry } from "./historyCore";

export { earlierVisits, HISTORY_DAYS, type HistoryEntry } from "./historyCore";

const HISTORY_KEY = "history";
const MY_REPORTS_KEY = "myReports";
const REPORTER_KEY = "reporterId";

export async function loadHistory(now = Date.now()): Promise<HistoryEntry[]> {
  const all = ((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
  return all.filter((h) => isFresh(h, now));
}

export async function saveCheckToHistory(listing: Listing, report: RiskReport) {
  const now = Date.now();
  await chrome.storage.local.set({ [HISTORY_KEY]: withCheck(await loadHistory(now), listing, report, now) });
}

export async function forgetSeller(platform: Platform, sellerId: string, listingId: string) {
  const all = await loadHistory();
  const keep = all.filter((h) => h.platform !== platform || (sellerId ? h.sellerId !== sellerId : h.listingId !== listingId));
  await chrome.storage.local.set({ [HISTORY_KEY]: keep });
}

export async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

// --- Anonymous reporting ---------------------------------------------------

/** A random id made on this device. It isn't linked to any account; the server stores only a hash. */
export async function reporterId(): Promise<string> {
  const stored = (await chrome.storage.local.get(REPORTER_KEY))[REPORTER_KEY] as string | undefined;
  if (stored) return stored;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ [REPORTER_KEY]: id });
  return id;
}

export interface MyReport {
  category: ReportCategory;
  at: number;
}

const reportKey = (platform: Platform, sellerId: string) => `${platform}:${sellerId}`;

/** Remembers which sellers this user reported, so the panel can show it and offer Undo. */
export async function myReport(platform: Platform, sellerId: string): Promise<MyReport | undefined> {
  const all = ((await chrome.storage.local.get(MY_REPORTS_KEY))[MY_REPORTS_KEY] as Record<string, MyReport>) ?? {};
  return all[reportKey(platform, sellerId)];
}

export async function setMyReport(platform: Platform, sellerId: string, report: MyReport | null) {
  const all = ((await chrome.storage.local.get(MY_REPORTS_KEY))[MY_REPORTS_KEY] as Record<string, MyReport>) ?? {};
  if (report) all[reportKey(platform, sellerId)] = report;
  else delete all[reportKey(platform, sellerId)];
  await chrome.storage.local.set({ [MY_REPORTS_KEY]: all });
}
