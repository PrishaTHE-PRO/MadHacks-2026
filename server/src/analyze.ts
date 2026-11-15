// Listing risk score pipeline (implementation spec §2):
//   1. rules on the listing + community history (instant, no key needed)
//   2. Claude identifies the item, estimates its price, and adds red flags
//   3. price reference: live eBay listings if configured, else Claude's estimate
//   4. rules again with everything, so the score is computed in code
//   5. Claude explains the final score in one line

import type { ListingStep, RiskLevel, RiskReport } from "../../shared/types";
import { runRules, levelFor, reportSummary, type AiFindings, type RuleResult } from "./rules";
import { aiEnabled, aiFailureReason, analyzeListing as analyzeWithClaude, explainScore, type ListingAnalysis } from "./claude";
import { priceReference } from "./prices";
import { communityStats, otherListingPhotos, saveCheck, savePhotoHashes } from "./db";
import { matchPhotos, otherSellerMatches } from "./photos";
import type { Listing, PhotoMatch } from "../../shared/types";
import { coverageGaps } from "../../shared/listingCheck";
import { loadPhotos } from "./images";

/** The steps analyzeListing will run, in order (for the progress stream). */
export const listingPlan = (): ListingStep[] =>
  aiEnabled() ? ["seller", "item", "price", "summary"] : ["seller", "price"];

/**
 * `photoHashes[i]` is the dHash of `listing.photos[i]` (null where the
 * extension couldn't fingerprint it). Undefined means no photo check ran.
 * `onStep` is called as each stage starts, so the extension can show live progress.
 */
export async function analyzeListing(
  listing: Listing,
  photoHashes?: (string | null)[],
  onStep: (step: ListingStep) => void = () => {},
  photoData?: (string | null)[],
): Promise<RiskReport> {
  const sellerId = listing.seller.id;
  onStep("seller");
  const community = sellerId ? communityStats(listing.platform, sellerId) : undefined;

  // Stolen-photo check: match against the shared index, then add this listing to it.
  let photoMatches: PhotoMatch[] | undefined;
  if (photoHashes?.some(Boolean)) {
    photoMatches = otherSellerMatches(listing, matchPhotos(photoHashes, otherListingPhotos(listing.platform, listing.id)));
    savePhotoHashes(
      { platform: listing.platform, id: listing.id, url: listing.url, title: listing.title, sellerId, sellerUsername: listing.seller.username },
      photoHashes,
    );
  }

  // Logs name only the platform and listing id: never listing text or image URLs.
  const tag = `${listing.platform}/${listing.id}`;
  let analysis: ListingAnalysis | null = null;
  let aiUnavailableReason: string | undefined;
  if (!aiEnabled()) {
    aiUnavailableReason = "No API key configured on the server";
    console.warn(`[analyze] AI check skipped for ${tag}: no API key (rules only)`);
  } else {
    const base = runRules(listing, { community, photoMatches });
    onStep("item");
    try {
      // Only report counts per reason go to the AI, never what reporters typed.
      const reports = community?.reporters ? [`${community.reporters} people reported this seller: ${reportSummary(community)}`] : [];
      const { photos } = await loadPhotos(listing.photos, 4, photoData);
      analysis = await analyzeWithClaude(listing, base.signals, reports, photos);
      if (analysis) {
        // Only count unique assessments of images that were actually supplied.
        const seen = new Set<number>();
        const supplied = new Set(photos.map((p) => p.index));
        analysis.photos = analysis.photos.filter((p) => {
          if (!supplied.has(p.index) || seen.has(p.index)) return false;
          seen.add(p.index);
          return true;
        });
        console.log(`[analyze] AI check ran for ${tag} (${photos.length} photo(s) sent, ${analysis.photos.length} assessed)`);
      } else {
        aiUnavailableReason = "No readable analysis was returned";
        console.warn(`[analyze] AI check failed for ${tag}: unreadable output (rules only)`);
      }
    } catch (err) {
      analysis = null;
      aiUnavailableReason = aiFailureReason(err);
      console.warn(`[analyze] AI check failed for ${tag}: ${aiUnavailableReason} (rules only)`);
    }
  }

  onStep("price");
  const price = await priceReference(listing, {
    searchQuery: analysis?.search_query,
    aiEstimate: analysis?.price_estimate,
  });

  const ai: AiFindings | undefined = analysis
    ? { brand: analysis.item.brand, redFlags: analysis.red_flags, riskAdjust: analysis.risk_adjust,
        listingType: analysis.listing_type, photos: analysis.photos, priceLooksPlaceholder: analysis.price_looks_placeholder }
    : undefined;
  const result = runRules(listing, { community, price, ai, photoMatches });
  const level = levelFor(result.score);

  const coverage = {
    seller: Boolean(listing.seller.id || listing.seller.username),
    photos: { checked: analysis?.photos.length ?? 0, total: listing.photos.length },
    ai: Boolean(analysis),
    price: Boolean(price?.median && price.median > 0),
  };
  if (!coverage.seller) result.signals.push({ id: "coverage-seller", severity: "info", points: 0, source: "rules", text: "Couldn't read the seller's profile, so seller history wasn't checked." });
  if (!coverage.ai) result.signals.push({ id: "coverage-ai", severity: "info", points: 0, source: "rules", text: "AI listing analysis was unavailable. Only rule checks ran." });
  if (!coverage.photos.checked || coverage.photos.checked < coverage.photos.total)
    result.signals.push({ id: "coverage-photos", severity: "info", points: 0, source: "rules", text: coverage.photos.checked ? `Only ${coverage.photos.checked} of ${coverage.photos.total} photos were checked.` : "The photo content check didn't run." });
  if (!coverage.price) result.signals.push({ id: "coverage-price", severity: "info", points: 0, source: "rules", text: "No typical price was available for comparison." });

  const partial = coverageGaps(coverage).length > 0;
  let summary = fallbackSummary(result, level, partial);
  let explained = false;
  if (aiEnabled() && !partial) {
    onStep("summary");
    try {
      const line = await explainScore({ listing, score: result.score, level, signals: result.signals, price });
      if (line) {
        summary = line;
        explained = true;
      } else {
        console.warn(`[analyze] AI summary failed for ${tag}: refusal or empty output (using the fallback summary)`);
      }
    } catch (err) {
      console.warn(`[analyze] AI summary failed for ${tag}: ${aiFailureReason(err)} (using the fallback summary)`);
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
    communityReports: community?.reporters ?? 0,
    community,
    photoMatches: photoMatches?.slice(0, 10),
    coverage,
    listingType: analysis?.listing_type,
    photoAssessments: analysis?.photos,
    aiUnavailableReason,
    aiUsed: Boolean(analysis) || explained,
    checkedAt: new Date().toISOString(),
  };
}

/** The one-liner when Claude isn't available: the level plus the biggest reason. */
export function fallbackSummary(result: RuleResult, level: RiskLevel, partial = false): string {
  const top = result.signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points)[0];
  if (partial) return `Partial check: ${top?.text ?? "Some checks couldn't run. Review what wasn't checked before deciding."}`;
  if (!top) return "No red flags found in the listing or seller history.";
  const lead = level === "high" ? "High risk" : level === "medium" ? "Be careful" : "Mostly fine";
  return `${lead}: ${top.text}`;
}
