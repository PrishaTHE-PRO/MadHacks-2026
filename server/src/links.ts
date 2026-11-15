// Phishing link checker, server half. The extension already flags look-alike
// domains on the device (shared/linkCheck.ts). Here we look links up:
//   1. Follow URL shorteners (bit.ly...) to the real destination, without
//      loading the page itself.
//   2. Domain age from public registration records (RDAP, via rdap.org). Only
//      the bare domain is sent.
//   3. Google Safe Browsing, when GOOGLE_SAFE_BROWSING_KEY is set. The link is
//      sent without its query string or #fragment.
// The message text never leaves the server, and nothing here is stored except
// an in-memory cache of lookups.

import { isShortener, suspiciousLinks } from "../../shared/chatPatterns";
import { checkLookalike, hostOfLink, isOfficialDomain, registrableDomain, stripQuery } from "../../shared/linkCheck";
import type { ChatContext, ChatFlag } from "../../shared/types";

const RDAP_URL = "https://rdap.org/domain/";
const SAFE_BROWSING_URL = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const USER_AGENT = "DealDig/0.1 (hackathon prototype)";
const DAY = 24 * 60 * 60 * 1000;

/** Younger than this is "brand new" (danger). */
export const NEW_DOMAIN_DAYS = 30;
/** Younger than this is still worth a caution. */
export const YOUNG_DOMAIN_DAYS = 90;
/** The whole link check must finish within this, so chat warnings stay quick. */
const BUDGET_MS = 5000;
const MAX_LINKS = 5;
const MAX_REDIRECTS = 5;

export const safeBrowsingEnabled = () => Boolean(process.env.GOOGLE_SAFE_BROWSING_KEY);

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/** Registration date from an RDAP domain response, or null. */
export function registrationDate(rdap: unknown): Date | null {
  const events = (rdap as { events?: { eventAction?: string; eventDate?: string }[] })?.events;
  const reg = events?.find((e) => e.eventAction === "registration")?.eventDate;
  const t = reg ? Date.parse(reg) : NaN;
  return Number.isNaN(t) ? null : new Date(t);
}

export function ageFlag(domain: string, registeredAt: Date, now = Date.now()): { severity: "danger" | "caution"; reason: string } | null {
  const days = Math.max(0, Math.floor((now - registeredAt.getTime()) / DAY));
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  if (days < NEW_DOMAIN_DAYS)
    return { severity: "danger", reason: `${domain} was registered ${when}. Scam sites are usually brand new.` };
  if (days < YOUNG_DOMAIN_DAYS)
    return { severity: "caution", reason: `${domain} is only ${days} days old. Real stores and payment sites have been around for years.` };
  return null;
}

const THREAT_WORDS: Record<string, string> = {
  SOCIAL_ENGINEERING: "phishing",
  MALWARE: "malware",
  UNWANTED_SOFTWARE: "unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "harmful app",
};

// ---------------------------------------------------------------------------
// Lookups (cached, never throw)
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Follow redirects from a shortener with HEAD requests, without fetching the page body. */
export async function unshorten(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  return cached(`unshorten:${url}`, DAY, async () => {
    let current = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      try {
        const res = await fetchImpl(current, {
          method: "HEAD",
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(3000),
        });
        const next = res.headers.get("location");
        if (res.status < 300 || res.status >= 400 || !next) break;
        current = new URL(next, current).toString();
      } catch {
        break;
      }
    }
    return current;
  });
}

export async function domainRegisteredAt(domain: string, fetchImpl: typeof fetch = fetch): Promise<Date | null> {
  const iso = await cached(`rdap:${domain}`, DAY, async () => {
    try {
      const res = await fetchImpl(`${RDAP_URL}${encodeURIComponent(domain)}`, {
        headers: { Accept: "application/rdap+json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      return registrationDate(await res.json())?.toISOString() ?? null;
    } catch {
      return null;
    }
  });
  return iso ? new Date(iso) : null;
}

/** Safe Browsing matches: url (as sent) → threat type. Empty without a key. */
export async function safeBrowsingMatches(urls: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key || !urls.length) return out;
  try {
    const res = await fetchImpl(`${SAFE_BROWSING_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "dealdig", clientVersion: "0.1" },
        threatInfo: {
          threatTypes: Object.keys(THREAT_WORDS),
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Safe Browsing ${res.status}`);
    const data = (await res.json()) as { matches?: { threat?: { url?: string }; threatType?: string }[] };
    for (const m of data.matches ?? []) if (m.threat?.url) out.set(m.threat.url, m.threatType ?? "SOCIAL_ENGINEERING");
  } catch (err) {
    console.warn("[links] Safe Browsing failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point: flags for the links in a chat
// ---------------------------------------------------------------------------

interface FoundLink {
  messageId: string;
  url: string; // as written in the chat
  final: string; // after following shorteners
}

/**
 * New-domain, known-dangerous and (after a shortener) look-alike flags for
 * the other party's off-platform links. Finishes within BUDGET_MS; whatever
 * isn't back by then is skipped, never guessed.
 */
export async function linkFlags(ctx: ChatContext, fetchImpl: typeof fetch = fetch): Promise<ChatFlag[]> {
  const found: FoundLink[] = [];
  for (const msg of ctx.messages) {
    if (msg.fromMe) continue;
    for (const url of suspiciousLinks(msg.text, ctx.platform)) {
      if (found.length < MAX_LINKS) found.push({ messageId: msg.id, url, final: url });
    }
  }
  if (!found.length) return [];

  const work = (async () => {
    await Promise.all(found.map(async (l) => (l.final = isShortener(l.url) ? await unshorten(l.url, fetchImpl) : l.url)));

    const flags: ChatFlag[] = [];
    // A shortener that hides a look-alike: the device couldn't see it, so flag it here.
    for (const l of found) {
      if (l.final === l.url) continue;
      const look = checkLookalike(l.final);
      if (look) flags.push({ pattern: "lookalike_link", severity: "danger", reason: `This short link hides where it goes. ${look.text}`, messageId: l.messageId, source: "rules" });
    }

    const domains = [...new Set(found.map((l) => hostOfLink(l.final)).filter((h): h is string => !!h && !isOfficialDomain(h)).map(registrableDomain))];
    const sbUrls = [...new Set(found.map((l) => stripQuery(l.final)))];
    const [ages, threats] = await Promise.all([
      Promise.all(domains.map(async (d) => [d, await domainRegisteredAt(d, fetchImpl)] as const)),
      safeBrowsingMatches(sbUrls, fetchImpl),
    ]);
    const ageOf = new Map(ages);

    for (const l of found) {
      const threat = threats.get(stripQuery(l.final));
      const host = hostOfLink(l.final);
      const domain = host ? registrableDomain(host) : l.final;
      if (threat) {
        flags.push({
          pattern: "unsafe_link",
          severity: "danger",
          reason: `Google Safe Browsing lists ${domain} as ${THREAT_WORDS[threat] ?? "dangerous"}. Don't open it.`,
          messageId: l.messageId,
          source: "rules",
        });
      }
      const reg = ageOf.get(domain);
      const age = reg ? ageFlag(domain, reg) : null;
      if (age) flags.push({ pattern: "new_domain", severity: age.severity, reason: age.reason, messageId: l.messageId, source: "rules" });
    }
    return flags;
  })();

  const timeout = new Promise<ChatFlag[]>((resolve) => setTimeout(() => resolve([]), BUDGET_MS).unref?.());
  const flags = await Promise.race([work, timeout]);
  // One flag per pattern per message.
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.pattern}:${f.messageId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
