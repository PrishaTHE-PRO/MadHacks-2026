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

export const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
