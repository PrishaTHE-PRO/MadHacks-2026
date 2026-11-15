// Fetching pages that a search turned up (a reverse image search hit, a page
// with the same description), so we can read who posted them and confirm the
// text really is there.
//
// These URLs come from third parties, so the fetch is locked down: http(s)
// only, public hostnames only (no localhost or private IPs, checked again on
// every redirect), a short timeout and a size cap.

const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; SecondLook/1.0; +listing-safety-check)";

/** True for hosts we must never fetch: localhost, bare names, private and link-local IPs. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return true; // "localhost", intranet names
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (h.includes(":")) return true; // IPv6 literals: no legitimate listing page uses one
  return false;
}

export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (isBlockedHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

export interface FetchedPage {
  url: string; // final URL after redirects
  contentType: string;
  body: Buffer;
}

/** GET a public URL with the limits above. Returns null on any failure. */
export async function safeFetch(raw: string, opts: { maxBytes?: number; accept?: string } = {}): Promise<FetchedPage | null> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = safeUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: opts.accept ?? "text/html,application/xhtml+xml" },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? safeUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) return null;
        chunks.push(Buffer.from(chunk));
      }
    } catch {
      return null;
    }
    return { url: url.toString(), contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  return null;
}

export async function fetchHtml(url: string): Promise<{ url: string; html: string } | null> {
  const page = await safeFetch(url);
  if (!page || !/html|xml/i.test(page.contentType)) return null;
  return { url: page.url, html: page.body.toString("utf8") };
}

/** Visible text of an HTML page, roughly: scripts, styles and tags removed, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ");
}
