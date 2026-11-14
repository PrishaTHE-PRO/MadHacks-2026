// Listing risk score pipeline (implementation spec §2):
//   1. rules on the listing + community history (instant, no key needed)
//   2. Claude identifies the item, estimates its price, and adds red flags
//   3. price reference: live eBay listings if configured, else Claude's estimate
//   4. rules again with everything, so the score is computed in code
//   5. Claude explains the final score in one line

import type { RiskLevel, RiskReport } from "../../shared/types";
import { runRules, levelFor, type AiFindings, type RuleResult } from "./rules";
import { aiEnabled, analyzeListing as analyzeWithClaude, explainScore, type ListingAnalysis } from "./claude";
import { priceReference } from "./prices";
import { communityStats, otherListingPhotos, recentReports, saveCheck, savePhotoHashes } from "./db";
import { matchPhotos, otherSellerMatches } from "./photos";
import type { Listing, PhotoMatch } from "../../shared/types";

/**
 * `photoHashes[i]` is the dHash of `listing.photos[i]` (null where the
 * extension couldn't fingerprint it). Undefined means no photo check ran.
 */
export async function analyzeListing(listing: Listing, photoHashes?: (string | null)[]): Promise<RiskReport> {
  const sellerId = listing.seller.id;
  const community = sellerId ? communityStats(listing.platform, sellerId) : { reports: 0, reportsLast30Days: 0 };

  // Stolen-photo check: match against the shared index, then add this listing to it.
  let photoMatches: PhotoMatch[] | undefined;
  if (photoHashes?.some(Boolean)) {
    photoMatches = otherSellerMatches(listing, matchPhotos(photoHashes, otherListingPhotos(listing.platform, listing.id)));
    savePhotoHashes(
      { platform: listing.platform, id: listing.id, url: listing.url, title: listing.title, sellerId, sellerUsername: listing.seller.username },
      photoHashes,
    );
  }

  let analysis: ListingAnalysis | null = null;
  if (aiEnabled()) {
    const base = runRules(listing, { community, photoMatches });
    try {
      analysis = await analyzeWithClaude(listing, base.signals, sellerId ? recentReports(listing.platform, sellerId) : []);
    } catch (err) {
      console.error("[analyze] Claude analysis failed, using rules only:", err);
    }
  }

  const price = await priceReference(listing, {
    searchQuery: analysis?.search_query,
    aiEstimate: analysis?.price_estimate,
  });

  const ai: AiFindings | undefined = analysis
    ? { brand: analysis.item.brand, redFlags: analysis.red_flags, riskAdjust: analysis.risk_adjust }
    : undefined;
  const result = runRules(listing, { community, price, ai, photoMatches });
  const level = levelFor(result.score);

  let summary = fallbackSummary(result, level);
  let explained = false;
  if (aiEnabled()) {
    try {
      const line = await explainScore({ listing, score: result.score, level, signals: result.signals, price });
      if (line) {
        summary = line;
        explained = true;
      }
    } catch (err) {
      console.error("[analyze] Claude explanation failed, using fallback summary:", err);
    }
  }

  saveCheck(listing.platform, listing.id, sellerId, result.score, level);

  return {
    listingId: listing.id,
    platform: listing.platform,
    score: result.score,
    level,
    summary,
    topReasons: result.topReasons,
    signals: result.signals,
    item: analysis?.item,
    priceCheck: price,
    communityReports: community.reports,
    photoMatches: photoMatches?.slice(0, 10),
    aiUsed: Boolean(analysis) || explained,
    checkedAt: new Date().toISOString(),
  };
}

/** The one-liner when Claude isn't available: the level plus the biggest reason. */
export function fallbackSummary(result: RuleResult, level: RiskLevel): string {
  const top = result.signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points)[0];
  if (!top) return "No red flags found in the listing or seller history.";
  const lead = level === "high" ? "High risk" : level === "medium" ? "Be careful" : "Mostly fine";
  return `${lead}: ${top.text}`;
}
