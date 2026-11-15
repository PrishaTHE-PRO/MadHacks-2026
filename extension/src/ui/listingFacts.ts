// Seller and price formatting shared by the side panel and the pop-up.

import type { Listing } from "../../../shared/types";

/** "@handle" on sites with handles; Facebook only has a display name. */
export const sellerName = (l: Listing) =>
  l.platform === "facebook" ? l.seller.displayName || l.seller.username || "Unknown seller" : `@${l.seller.username}`;

export function sellerFacts(l: Listing): string[] {
  const s = l.seller;
  const facts: string[] = [];
  if (s.positiveFeedbackPercent !== undefined) facts.push(`${s.positiveFeedbackPercent}% positive`);
  if (s.feedbackScore !== undefined) facts.push(`${s.feedbackScore.toLocaleString()} feedback`);
  if (s.ratingsCount !== undefined) facts.push(s.ratingsCount ? `${s.ratingsCount} ratings` : "no ratings");
  if (s.joinedAt) {
    const d = new Date(s.joinedAt);
    facts.push(
      `joined ${
        s.joinedPrecision === "year"
          ? d.getUTCFullYear()
          : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })
      }`,
    );
  }
  return facts;
}

const NAME_MAX = 48;
// Words that can't end a name: "Coach bag with" → "Coach bag".
// A lone letter ("…top with v" from "v neck") is cut too.
const DANGLING = /[\s,;:/|&+–-]+$|\s+(with|and|or|for|in|of|the|a|an|to|by|from|on|\w)$/i;

/**
 * The product name to show: Claude's short name when there is one, otherwise
 * the site's title without trailing dots, cut at a word (never mid-word, never "…").
 */
export function displayName(l: Listing, itemName?: string): string {
  const ai = itemName?.trim();
  if (ai) return ai;
  let name = l.title.replace(/\s*(\.{2,}|…)+\s*$/, "").replace(/\s+/g, " ").trim();
  if (name.length > NAME_MAX) {
    const cut = name.slice(0, NAME_MAX + 1);
    name = cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : NAME_MAX);
  }
  let prev;
  do {
    prev = name;
    name = name.replace(DANGLING, "").trim();
  } while (name !== prev);
  return name || l.title;
}

export const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** "5 min ago", "3 hours ago", "2 days ago". */
export const ago = (ms: number) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
};

export const LEVEL_LABEL = { low: "low risk", medium: "be careful", high: "high risk" } as const;
