// Google Safe Browsing by hash prefix (design doc 1.4). Instead of sending
// Google the full link (v4 threatMatches:find), we hash the link's URL
// expressions and send only the first 4 bytes of each hash (v5
// hashes:search). Google answers with every full hash that shares those
// prefixes, and we compare locally, so Google can't tell which link was checked.
//
// URL expressions follow the Safe Browsing spec, simplified: the exact host
// plus up to 4 parent domains, times the exact path with and without its
// query plus up to 4 leading path prefixes.

import { createHash } from "node:crypto";

export const SB_V5_URL = process.env.DEALDIG_SAFE_BROWSING_URL ?? "https://safebrowsing.googleapis.com/v5/hashes:search";
const PREFIX_BYTES = 4;

/** "https://a.b.evil.com/x/y?z=1" → ["a.b.evil.com/x/y?z=1", "a.b.evil.com/x/y", "a.b.evil.com/", …, "evil.com/x/"]. */
export function urlExpressions(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return [];
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  const hosts = [host];
  if (!isIp) {
    const parts = host.split(".");
    for (let i = Math.max(1, parts.length - 5); i < parts.length - 1; i++) hosts.push(parts.slice(i).join("."));
  }

  const path = u.pathname || "/";
  // Up to 4 prefixes from the root: "/", "/a/", "/a/b/", "/a/b/c/".
  const segments = path.split("/").filter(Boolean);
  const prefixes = ["/"];
  for (let i = 1; i < segments.length && prefixes.length < 4; i++) prefixes.push(`/${segments.slice(0, i).join("/")}/`);
  const paths = [path + u.search, path, ...prefixes];

  const out = new Set<string>();
  for (const h of new Set(hosts)) for (const p of new Set(paths)) out.add(`${h}${p}`);
  return [...out];
}

export const fullHash = (expression: string) => createHash("sha256").update(expression).digest();
export const hashPrefix = (hash: Buffer) => hash.subarray(0, PREFIX_BYTES).toString("base64");

interface V5Response {
  fullHashes?: { fullHash?: string; fullHashDetails?: { threatType?: string }[] }[];
}

/**
 * url → threat type, for each URL Google lists. Only hash prefixes leave the
 * server. Throws on an HTTP error so the caller can decide what to do.
 */
export async function safeBrowsingByPrefix(urls: string[], key: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const hashesByUrl = new Map(urls.map((u) => [u, urlExpressions(u).map((e) => fullHash(e).toString("base64"))]));
  const prefixes = new Set<string>();
  for (const hashes of hashesByUrl.values()) for (const h of hashes) prefixes.add(hashPrefix(Buffer.from(h, "base64")));
  if (!prefixes.size) return out;

  const q = new URLSearchParams({ key });
  for (const p of prefixes) q.append("hashPrefixes", p);
  const res = await fetchImpl(`${SB_V5_URL}?${q.toString()}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Safe Browsing v5 ${res.status}`);
  const data = (await res.json()) as V5Response;

  const listed = new Map<string, string>(); // full hash (base64) → threat type
  for (const f of data.fullHashes ?? []) {
    if (f.fullHash) listed.set(f.fullHash, f.fullHashDetails?.[0]?.threatType ?? "SOCIAL_ENGINEERING");
  }
  for (const [url, hashes] of hashesByUrl) {
    const hit = hashes.find((h) => listed.has(h));
    if (hit) out.set(url, listed.get(hit)!);
  }
  return out;
}
