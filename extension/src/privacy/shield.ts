// Tracker shield (background only): turns the static rulesets on and off from
// the settings, keeps per-site pauses as dynamic rules, and reports what was
// blocked in a tab. Chrome enforces the rules itself, before any of our code runs.

import { pauseRule, RULE_BASE, RULESET, SHIELD_SITES, trackerForRule, trackerName, type TrackerCategory } from "../../../shared/privacy";
import { domainOf } from "../guardCore";
import type { PrivacySettings } from "./settings";

export interface BlockedTracker {
  domain: string;
  category: TrackerCategory;
  about: string;
  count: number;
}

export interface ShieldSummary {
  /** The marketplace's own registrable domain, e.g. "poshmark.com" (null off-marketplace). */
  site: string | null;
  on: boolean;
  paused: boolean;
  blocked: BlockedTracker[];
  total: number;
  /** getMatchedRules hit Chrome's rate limit: this is the last summary we had. */
  stale?: boolean;
}

/** Apply the settings to Chrome's rules. Safe to call again whenever settings change. */
export async function applyShield(s: PrivacySettings) {
  const enable: string[] = [];
  const disable: string[] = [];
  (s.shield ? enable : disable).push(RULESET.trackers);
  (s.shield && s.strict ? enable : disable).push(RULESET.strict);
  (s.cleanLinks ? enable : disable).push(RULESET.clean);
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldPauses = existing.filter((r) => r.id >= RULE_BASE.pause).map((r) => r.id);
  const paused = s.pausedSites.filter((site) => SHIELD_SITES.includes(site));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldPauses,
    addRules: paused.map((site, i) => pauseRule(site, i) as unknown as chrome.declarativeNetRequest.Rule),
  });

  // Per-tab count of blocked requests on the toolbar icon. Chrome keeps it; no polling.
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: s.shield });
}

/** The shield site a tab is on, as a registrable domain ("www.ebay.com" → "ebay.com"). */
export function shieldSiteOf(url: string | undefined): string | null {
  const d = url ? domainOf(url) : null;
  return d && SHIELD_SITES.includes(d) ? d : null;
}

// getMatchedRules is rate limited (about 20 calls per 10 minutes outside a user
// gesture), so summaries are cached per tab and only fetched when the panel asks.
const SUMMARY_TTL_MS = 15_000;
const cache = new Map<number, { at: number; summary: ShieldSummary }>();
/** When each tab's current page started loading, so earlier pages' matches aren't counted. */
const pageStart = new Map<number, number>();

export async function shieldSummary(tabId: number, s: PrivacySettings): Promise<ShieldSummary> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = shieldSiteOf(tab?.url);
  const base = { site, on: s.shield, paused: !!site && s.pausedSites.includes(site) };
  const hit = cache.get(tabId);
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return { ...hit.summary, ...base };

  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId, minTimeStamp: pageStart.get(tabId) });
    const byName = new Map<string, BlockedTracker>();
    for (const m of rulesMatchedInfo) {
      const t = trackerForRule(m.rule.rulesetId, m.rule.ruleId);
      if (!t) continue;
      const name = trackerName(t);
      const row = byName.get(name) ?? { domain: name, category: t.category, about: t.about, count: 0 };
      row.count++;
      byName.set(name, row);
    }
    const blocked = [...byName.values()].sort((a, b) => b.count - a.count);
    const summary: ShieldSummary = { ...base, blocked, total: blocked.reduce((n, b) => n + b.count, 0) };
    cache.set(tabId, { at: Date.now(), summary });
    return summary;
  } catch (err) {
    console.warn("[DealDig shield] getMatchedRules failed:", err);
    return { ...(hit?.summary ?? { blocked: [], total: 0 }), ...base, stale: true };
  }
}

/** A new page in the tab (full load): count from here. */
export function pageStarted(tabId: number, at = Date.now()) {
  pageStart.set(tabId, at);
  cache.delete(tabId);
}

export function forgetTab(tabId: number) {
  pageStart.delete(tabId);
  cache.delete(tabId);
}
