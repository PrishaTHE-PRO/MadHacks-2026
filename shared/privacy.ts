// Private browsing (design doc "Second Look Private Browsing"): the tracker list,
// the declarativeNetRequest rules built from it, URL cleaning, and what the
// extension sends the server for a listing check. Pure, with no chrome.* calls,
// so build.mjs can generate the rule files from it and Node tests can import it.

import { registrableDomain } from "./linkCheck";
import type { Listing } from "./types";

// ---------------------------------------------------------------------------
// Trackers
// ---------------------------------------------------------------------------

export type TrackerCategory = "advertising" | "analytics" | "social";

export interface Tracker {
  /** Matched with requestDomains (covers subdomains), or with urlFilter when `path` is set. */
  domain: string;
  path?: string;
  category: TrackerCategory;
  /** One plain line for the side panel: who this is. */
  about: string;
  /** Sites where this is the site's own company (blocking it there would break the page). */
  ownedBy?: string[];
}

const META = ["facebook.com", "messenger.com"];

/** Hand-curated, third-party only. Every entry has to be safe to block on every marketplace below. */
export const TRACKERS: Tracker[] = [
  // Advertising
  { domain: "doubleclick.net", category: "advertising", about: "Google's ad network" },
  { domain: "googlesyndication.com", category: "advertising", about: "Google ads on websites" },
  { domain: "googleadservices.com", category: "advertising", about: "Google ad conversion tracking" },
  { domain: "adservice.google.com", category: "advertising", about: "Google ad targeting" },
  { domain: "amazon-adsystem.com", category: "advertising", about: "Amazon's ad network" },
  { domain: "criteo.com", category: "advertising", about: "Criteo retargeting ads" },
  { domain: "criteo.net", category: "advertising", about: "Criteo retargeting ads" },
  { domain: "taboola.com", category: "advertising", about: "Taboola sponsored content" },
  { domain: "outbrain.com", category: "advertising", about: "Outbrain sponsored content" },
  { domain: "adnxs.com", category: "advertising", about: "Microsoft Xandr ad exchange" },
  { domain: "pubmatic.com", category: "advertising", about: "PubMatic ad exchange" },
  { domain: "rubiconproject.com", category: "advertising", about: "Magnite ad exchange" },
  { domain: "casalemedia.com", category: "advertising", about: "Index Exchange ads" },
  { domain: "openx.net", category: "advertising", about: "OpenX ad exchange" },
  { domain: "adsrvr.org", category: "advertising", about: "The Trade Desk ad buying" },
  { domain: "moatads.com", category: "advertising", about: "Oracle Moat ad measurement" },
  { domain: "quantserve.com", category: "advertising", about: "Quantcast audience tracking" },
  // Analytics
  { domain: "google-analytics.com", category: "analytics", about: "Google Analytics" },
  { domain: "googletagmanager.com", category: "analytics", about: "Google Tag Manager, which loads other trackers" },
  { domain: "scorecardresearch.com", category: "analytics", about: "Comscore audience measurement" },
  { domain: "cdn.segment.com", category: "analytics", about: "Segment, which forwards data to other tools" },
  { domain: "api.segment.io", category: "analytics", about: "Segment, which forwards data to other tools" },
  { domain: "hotjar.com", category: "analytics", about: "Hotjar session recording" },
  { domain: "hotjar.io", category: "analytics", about: "Hotjar session recording" },
  { domain: "mixpanel.com", category: "analytics", about: "Mixpanel product analytics" },
  { domain: "amplitude.com", category: "analytics", about: "Amplitude product analytics" },
  { domain: "fullstory.com", category: "analytics", about: "FullStory session recording" },
  { domain: "heapanalytics.com", category: "analytics", about: "Heap product analytics" },
  { domain: "clarity.ms", category: "analytics", about: "Microsoft Clarity session recording" },
  { domain: "quantummetric.com", category: "analytics", about: "Quantum Metric session recording" },
  { domain: "nr-data.net", category: "analytics", about: "New Relic page monitoring" },
  // Social
  { domain: "connect.facebook.net", category: "social", about: "Meta Pixel", ownedBy: META },
  { domain: "facebook.com", path: "/tr", category: "social", about: "Meta Pixel events", ownedBy: META },
  { domain: "analytics.tiktok.com", category: "social", about: "TikTok Pixel" },
  { domain: "bat.bing.com", category: "social", about: "Microsoft Ads (Bing) tracking" },
  { domain: "snap.licdn.com", category: "social", about: "LinkedIn Insight tag" },
  { domain: "px.ads.linkedin.com", category: "social", about: "LinkedIn ad tracking" },
  { domain: "ct.pinterest.com", category: "social", about: "Pinterest Tag" },
  { domain: "tr.snapchat.com", category: "social", about: "Snap Pixel" },
  { domain: "sc-static.net", category: "social", about: "Snap Pixel loader" },
  { domain: "static.ads-twitter.com", category: "social", about: "X (Twitter) ad tracking" },
  { domain: "analytics.twitter.com", category: "social", about: "X (Twitter) ad tracking" },
];

/**
 * First-party analytics, blocked only in Strict mode (off by default).
 * UNVERIFIED: test each on its site before demoing Strict mode.
 */
export const STRICT_TRACKERS: Tracker[] = [
  { domain: "pulsar.ebay.com", category: "analytics", about: "eBay's own page analytics" },
];

/** Sites the shield runs on (pages these initiate). Matches the content script's sites. */
export const SHIELD_SITES = ["poshmark.com", "ebay.com", "facebook.com", "mercari.com", "etsy.com", "depop.com"];

export const CATEGORY_LABEL: Record<TrackerCategory, string> = {
  advertising: "Advertising",
  analytics: "Analytics",
  social: "Social",
};

export const trackerName = (t: Tracker) => (t.path ? `${t.domain}${t.path}` : t.domain);

/**
 * Origins whose cookies are safe to clear. Chrome clears cookies for a whole
 * registrable domain, so a tracker on a subdomain of a service people sign in
 * to (adservice.google.com, px.ads.linkedin.com) is left out: clearing it
 * would sign the user out of Google or LinkedIn.
 */
export const cookieClearOrigins = (): string[] =>
  TRACKERS.filter((t) => !t.path && !t.ownedBy && registrableDomain(t.domain) === t.domain).map((t) => `https://${t.domain}`);

// ---------------------------------------------------------------------------
// declarativeNetRequest rules (static rulesets, written by build.mjs)
// ---------------------------------------------------------------------------

export const RULESET = { trackers: "trackers", strict: "strict", clean: "clean" } as const;
export type RulesetId = (typeof RULESET)[keyof typeof RULESET];

/** Rule ids: trackers 1.., strict 1001.., clean 2001.., per-site pauses (dynamic) 10000.. */
export const RULE_BASE = { trackers: 1, strict: 1001, clean: 2001, pause: 10_000 };

/** Request types a tracker uses. Never main_frame: pages the user opens are the link guard's job. */
const TRACKER_TYPES = ["script", "xmlhttprequest", "ping", "image", "sub_frame"] as const;

export interface DnrRule {
  id: number;
  priority: number;
  action: Record<string, unknown>;
  condition: Record<string, unknown>;
}

function blockRule(t: Tracker, id: number): DnrRule {
  const condition: Record<string, unknown> = {
    domainType: "thirdParty",
    initiatorDomains: SHIELD_SITES.filter((s) => !t.ownedBy?.includes(s)),
    resourceTypes: [...TRACKER_TYPES],
  };
  // `^` ends the path, so "/tr" doesn't also match "/translate".
  if (t.path) condition.urlFilter = `||${t.domain}${t.path}^`;
  else condition.requestDomains = [t.domain];
  return { id, priority: 1, action: { type: "block" }, condition };
}

export const buildTrackerRules = (): DnrRule[] => TRACKERS.map((t, i) => blockRule(t, RULE_BASE.trackers + i));

/** Strict mode also blocks first-party endpoints, so it drops the thirdParty condition. */
export const buildStrictRules = (): DnrRule[] =>
  STRICT_TRACKERS.map((t, i) => {
    const r = blockRule(t, RULE_BASE.strict + i);
    delete r.condition.domainType;
    return r;
  });

/** Look a matched rule back up: which tracker was it? */
export function trackerForRule(rulesetId: string, ruleId: number): Tracker | null {
  if (rulesetId === RULESET.trackers) return TRACKERS[ruleId - RULE_BASE.trackers] ?? null;
  if (rulesetId === RULESET.strict) return STRICT_TRACKERS[ruleId - RULE_BASE.strict] ?? null;
  return null;
}

/** Per-site pause: lets that site's tracker requests through again (never touches main_frame, so the link guard still works). */
export function pauseRule(site: string, index: number): DnrRule {
  return {
    id: RULE_BASE.pause + index,
    priority: 100,
    action: { type: "allow" },
    condition: { initiatorDomains: [site], resourceTypes: [...TRACKER_TYPES] },
  };
}

// ---------------------------------------------------------------------------
// URL cleaning
// ---------------------------------------------------------------------------

/** Query parameters that only exist to track who clicked what. Removing them never changes the page. */
export const TRACKING_PARAMS = [
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_eid",
  "igshid",
  "ttclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "_branch_match_id",
  // eBay's own click tracking
  "_trkparms",
  "_trksid",
  "mkevt",
  "mkcid",
  "mkrid",
];

/** Strip tracking parameters from a link opened on (or into) a marketplace page. */
export function buildCleanUrlRules(): DnrRule[] {
  const names = TRACKING_PARAMS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [
    {
      id: RULE_BASE.clean,
      priority: 1,
      action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: [...TRACKING_PARAMS] } } } },
      // Only fire when a tracking parameter is present, so a clean URL is never redirected.
      condition: { regexFilter: `[?&](${names})=`, requestDomains: [...SHIELD_SITES], resourceTypes: ["main_frame"] },
    },
  ];
}

/** "https://x.com/a?utm_source=fb&id=2#top" → "https://x.com/a?id=2#top". Invalid URLs come back unchanged. */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

/** The listing's address without its query or fragment (where session ids and tracking tags live). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// What a listing check sends the server
// ---------------------------------------------------------------------------

export interface CheckOptions {
  /** Send photos to Google Vision to find copies on the web (opt-in). */
  webPhotos: boolean;
}

/** The listing as sent for analysis: public listing details only, with the link cut to its canonical form. */
export function forAnalysis(listing: Listing): Listing {
  return { ...listing, url: canonicalUrl(listing.url) };
}

/** Shown in the side panel's "Second Look sent" row, built from the exact request body. */
export interface SentSummary {
  at: number;
  /** Listing fields that had a value, in plain words. */
  fields: string[];
  photoFingerprints: number;
  /** Small JPEG copies of public listing photos sent for Claude to look at (not stored). */
  photoCopies: number;
  webPhotos: boolean;
  /** The page address had a query or fragment that was cut off before sending. */
  linkTrimmed: boolean;
}

const FIELD_WORDS: Partial<Record<keyof Listing, string>> = {
  title: "title",
  price: "price",
  description: "description",
  photos: "photo links",
  seller: "seller's public profile",
  location: "item location",
  condition: "condition",
  brand: "brand",
  url: "listing link (no tags)",
};

export function summarizeSent(original: Listing, sent: Listing, photoHashes: (string | null)[], opts: CheckOptions, now = Date.now(), photoData: (string | null)[] = []): SentSummary {
  const fields = (Object.keys(FIELD_WORDS) as (keyof Listing)[])
    .filter((k) => {
      const v = sent[k];
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
    })
    .map((k) => FIELD_WORDS[k]!);
  return {
    at: now,
    fields,
    photoFingerprints: photoHashes.filter(Boolean).length,
    photoCopies: photoData.filter(Boolean).length,
    webPhotos: opts.webPhotos,
    linkTrimmed: canonicalUrl(original.url) !== original.url,
  };
}
