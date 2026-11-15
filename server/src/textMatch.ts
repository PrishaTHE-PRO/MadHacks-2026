// Copied description check: is this listing's text in another listing?
//
// Two sources:
//   1. DealDig's own index of descriptions from listings users have checked
//      (free, instant, grows with every check)
//   2. a web search for the description's most distinctive sentences
//      (Claude's web search tool), each hit confirmed by opening the page and
//      finding the text on it. Unconfirmed hits are dropped, so every match
//      shown comes with a page the user can open and see the same words.
// As with photos, the same seller's own listings are fine; another seller
// using the same words is a sign the listing was copied.

import type { Listing, TextMatch } from "../../shared/types";
import type { StoredText } from "./db";
import { compareAccount, isSameListing, resolveOwner, siteInfo, type IndexLookup } from "./sellerIdentity";
import { fetchHtml, htmlToText } from "./webFetch";

const SHINGLE = 5; // words per phrase when comparing whole descriptions
const VERIFY_SHINGLE = 4; // words per phrase when confirming a sentence on a page
/** Share of this description's phrases another listing must contain to count as copied. */
export const COPY_OVERLAP = 0.6;
/** Descriptions shorter than this (in distinctive words) are too generic to compare. */
export const MIN_WORDS = 20;

/** Lines every reseller writes; they prove nothing, so they're ignored. */
const BOILERPLATE = [
  /smoke[- ]?(and pet[- ])?free/i,
  /pet[- ]?free/i,
  /bundle/i,
  /\bship(s|ping)?\b.*\b(same|next|business) day/i,
  /offers? (are )?(welcome|considered)/i,
  /no (trades|holds|lowball)/i,
  /price (is )?firm/i,
  /(check out|see) my (closet|shop|other)/i,
  /(feel free to |please )?ask (any )?questions/i,
  /thanks? for (looking|shopping|stopping)/i,
  /measurements? (available|upon request)/i,
  /all sales (are )?final/i,
  /\bfast shipping\b/i,
];

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9$%.\s]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string) => normalize(s).split(" ").filter(Boolean);

/** The description without boilerplate lines. */
export function distinctiveText(description: string): string {
  return sentences(description)
    .filter((s) => !BOILERPLATE.some((re) => re.test(s)))
    .join(" ");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|\s[•·|]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function shingles(text: string, n = SHINGLE): string[] {
  const w = words(text);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * Share of `a`'s phrases also in `b`, and the longest shared run of words
 * (as it reads in `a`), for showing the user what was copied.
 */
export function overlap(a: string, b: string, n = SHINGLE): { overlap: number; excerpt: string } {
  const aw = words(a);
  const theirs = new Set(shingles(b, n));
  if (aw.length < n || !theirs.size) return { overlap: 0, excerpt: "" };
  const hits = aw.slice(0, aw.length - n + 1).map((_, i) => theirs.has(aw.slice(i, i + n).join(" ")));
  let best = { start: 0, len: 0 };
  let run = 0;
  hits.forEach((hit, i) => {
    run = hit ? run + 1 : 0;
    if (run > best.len) best = { start: i - run + 1, len: run };
  });
  const excerpt = best.len ? aw.slice(best.start, best.start + best.len + n - 1).join(" ") : "";
  return { overlap: hits.filter(Boolean).length / hits.length, excerpt };
}

export const longEnough = (description: string) => words(distinctiveText(description)).length >= MIN_WORDS;

/** Matches from DealDig's own description index. Pure, tested. */
export function localTextMatches(listing: Listing, stored: StoredText[]): TextMatch[] {
  const mine = distinctiveText(listing.description);
  if (words(mine).length < MIN_WORDS) return [];
  const out: TextMatch[] = [];
  for (const s of stored) {
    const theirs = distinctiveText(s.text);
    if (words(theirs).length < MIN_WORDS) continue;
    const o = overlap(mine, theirs);
    if (o.overlap < COPY_OVERLAP) continue;
    const site = { poshmark: "Poshmark", ebay: "eBay", facebook: "Facebook", depop: "Depop" }[s.platform] ?? s.platform;
    out.push({
      source: "dealdig",
      url: s.listingUrl,
      title: s.listingTitle,
      ...siteInfo(s.listingUrl),
      siteName: site,
      owner: compareAccount(listing, { siteName: site, id: s.sellerId || undefined, username: s.sellerUsername }),
      username: s.sellerUsername,
      excerpt: clip(o.excerpt),
      overlap: round(o.overlap),
    });
  }
  return out.sort((a, b) => b.overlap - a.overlap).slice(0, 5);
}

/**
 * Up to two sentences worth searching for: the longest non-boilerplate ones,
 * cut to about 20 words (search engines handle shorter quoted phrases better).
 */
export function searchSentences(description: string, max = 2): string[] {
  return sentences(description)
    .filter((s) => !BOILERPLATE.some((re) => re.test(s)))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").length >= 8)
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .map((s) => s.split(" ").slice(0, 20).join(" ").replace(/[.,;:!?]+$/, ""));
}

/** Does the page's text contain this sentence (allowing small edits)? Returns the overlap. */
export function sentenceOnPage(sentence: string, pageText: string): number {
  return overlap(sentence, pageText, VERIFY_SHINGLE).overlap;
}

/** Share of a sentence's phrases that must be on the page to count as the same text. */
export const VERIFY_OVERLAP = 0.8;

export interface SearchHit {
  url: string;
  title: string;
}

/**
 * Open each search hit and keep the ones whose page really has one of the
 * sentences, then work out who posted them.
 */
export async function verifyHits(
  listing: Listing,
  sentencesSearched: string[],
  hits: SearchHit[],
  opts: { index?: IndexLookup; fetchPage?: typeof fetchHtml } = {},
): Promise<TextMatch[]> {
  const fetchPage = opts.fetchPage ?? fetchHtml;
  const unique = [...new Map(hits.filter((h) => !isSameListing(listing, h.url)).map((h) => [h.url, h])).values()].slice(0, 8);
  const results = await Promise.all(
    unique.map(async (hit): Promise<TextMatch | null> => {
      const page = await fetchPage(hit.url);
      if (!page) return null;
      const text = htmlToText(page.html);
      const best = sentencesSearched
        .map((s) => ({ s, o: sentenceOnPage(s, text) }))
        .sort((a, b) => b.o - a.o)[0];
      if (!best || best.o < VERIFY_OVERLAP) return null;
      const info = siteInfo(page.url);
      const { owner, username } = await resolveOwner(listing, page.url, {
        index: opts.index,
        allowFetch: true,
        // Reuse the page we already have instead of fetching it twice.
        fetchPage: async () => page,
      });
      return {
        source: "web",
        url: page.url,
        title: hit.title.slice(0, 160),
        ...info,
        owner,
        username,
        excerpt: clip(best.s),
        overlap: round(best.o),
      };
    }),
  );
  return results.filter((m): m is TextMatch => m !== null);
}

const clip = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}…` : s);
const round = (n: number) => Math.round(n * 100) / 100;
