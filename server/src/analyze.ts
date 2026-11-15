// Listing risk score pipeline (implementation spec §2):
//   1. rules on the listing + community history (instant, no key needed)
//   2. web checks, in parallel with step 3: reverse image search for the
//      photos and a web search for the description, then who posted each copy
//   3. Claude identifies the item, estimates its price, adds red flags and
//      says whether a photo looks AI-generated
//   4. price reference: live eBay listings if configured, else Claude's estimate
//   5. rules again with everything, so the score is computed in code
//   6. Claude explains the final score, citing the evidence

import { SCORE_MAX, type ListingStep, type RiskLevel, type RiskReport, type TextMatch, type WebCheckStatus, type WebPhotoMatch } from "../../shared/types";
import { runRules, levelFor, reportSummary, type AiFindings, type RuleResult } from "./rules";
import { aiEnabled, aiFailureReason, analyzeListing as analyzeWithClaude, explainScore, searchWebForText, type ListingAnalysis } from "./claude";
import { priceReference } from "./prices";
import {
  cacheGet,
  cacheSet,
  communityStats,
  knownListingByUrl,
  otherListingPhotos,
  otherListingTexts,
  saveCheck,
  saveListingText,
  savePhotoHashes,
} from "./db";
import { matchPhotos, otherSellerMatches } from "./photos";
import { searchListingPhotos, webPhotoSearchEnabled } from "./webPhotos";
import { localTextMatches, longEnough, searchSentences, verifyHits } from "./textMatch";
import { aiDetectorEnabled, aiImageNote, claudeAiPhotoView, combineAiImage, detectorScore, DETECTOR_PHOTOS } from "./aiImage";
import type { IndexLookup } from "./sellerIdentity";
import type { Listing, PhotoMatch } from "../../shared/types";
import { coverageGaps } from "../../shared/listingCheck";
import { loadPhotos } from "./images";

/** Web text search runs when Claude is available, unless DEALDIG_WEB_TEXT_SEARCH=off. */
const webTextSearchEnabled = () => aiEnabled() && process.env.DEALDIG_WEB_TEXT_SEARCH !== "off";
const webChecksEnabled = () => webPhotoSearchEnabled() || webTextSearchEnabled() || aiDetectorEnabled();

/** The steps analyzeListing will run, in order (for the progress stream). */
export const listingPlan = (): ListingStep[] => [
  "seller",
  ...(webChecksEnabled() ? (["web"] as const) : []),
  ...(aiEnabled() ? (["item", "price", "summary"] as const) : (["price"] as const)),
];

const indexLookup: IndexLookup = (url) => {
  const row = knownListingByUrl(url);
  if (!row) return null;
  const siteName = { poshmark: "Poshmark", ebay: "eBay", facebook: "Facebook" }[row.platform] ?? row.platform;
  return { siteName, id: row.sellerId, username: row.sellerUsername };
};

/** Description matches on the web, verified page by page. Cached per listing for a week. */
async function webTextMatches(listing: Listing): Promise<TextMatch[]> {
  const sentences = searchSentences(listing.description);
  const key = `textsearch:${sentences.join("|")}`;
  let hits = cacheGet<{ url: string; title: string }[]>(key);
  if (!hits) {
    hits = await searchWebForText(sentences);
    cacheSet(key, hits);
  }
  return verifyHits(listing, sentences, hits, { index: indexLookup });
}

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

  // Copied description, from DealDig's own index (free), then add this one to it.
  let textMatches: TextMatch[] = localTextMatches(listing, otherListingTexts(listing.platform, listing.id));
  saveListingText({ ...listing, sellerId, sellerUsername: listing.seller.username, text: listing.description });

  // Logs name only the platform and listing id: never listing text or image URLs.
  const tag = `${listing.platform}/${listing.id}`;
  let aiUnavailableReason: string | undefined;

  // Claude's analysis starts now and runs while the web checks do.
  const base = runRules(listing, { community, photoMatches, textMatches });
  const analysisPromise: Promise<ListingAnalysis | null> = aiEnabled()
    ? (async () => {
        try {
          // Only report counts per reason go to the AI, never what reporters typed.
          const reports = community?.reporters ? [`${community.reporters} people reported this seller: ${reportSummary(community)}`] : [];
          const { photos } = await loadPhotos(listing.photos, 4, photoData);
          const result = await analyzeWithClaude(listing, base.signals, reports, photos);
          if (!result) {
            aiUnavailableReason = "No readable analysis was returned";
            console.warn(`[analyze] AI check failed for ${tag}: unreadable output (rules only)`);
            return null;
          }
          // Only count unique assessments of images that were actually supplied.
          const seen = new Set<number>();
          const supplied = new Set(photos.map((p) => p.index));
          result.photos = result.photos.filter((p) => {
            if (!supplied.has(p.index) || seen.has(p.index)) return false;
            seen.add(p.index);
            return true;
          });
          console.log(`[analyze] AI check ran for ${tag} (${photos.length} photo(s) sent, ${result.photos.length} assessed)`);
          return result;
        } catch (err) {
          aiUnavailableReason = aiFailureReason(err);
          console.warn(`[analyze] AI check failed for ${tag}: ${aiUnavailableReason} (rules only)`);
          return null;
        }
      })()
    : ((aiUnavailableReason = "No API key configured on the server"),
      console.warn(`[analyze] AI check skipped for ${tag}: no API key (rules only)`),
      Promise.resolve(null));

  const webCheck: WebCheckStatus = { photos: "off", text: "off", aiDetector: "off" };
  let webPhotoMatches: WebPhotoMatch[] | undefined;
  let detector: (number | null)[] = [];
  if (webChecksEnabled()) {
    onStep("web");
    const photoSearch = webPhotoSearchEnabled() && listing.photos.length
      ? searchListingPhotos(listing).then(
          (m) => ((webCheck.photos = "done"), m),
          (err) => (console.error("[analyze] reverse image search failed:", err), (webCheck.photos = "failed"), undefined),
        )
      : Promise.resolve(undefined);
    const textSearch = !webTextSearchEnabled()
      ? Promise.resolve([] as TextMatch[])
      : !longEnough(listing.description) || !searchSentences(listing.description).length
        ? ((webCheck.text = "skipped"), Promise.resolve([] as TextMatch[]))
        : webTextMatches(listing).then(
            (m) => ((webCheck.text = "done"), m),
            (err) => (console.error("[analyze] web text search failed:", err), (webCheck.text = "failed"), [] as TextMatch[]),
          );
    const detectorRun = aiDetectorEnabled()
      ? Promise.all(listing.photos.slice(0, DETECTOR_PHOTOS).map((u) => detectorScore(u))).then(
          (scores) => ((webCheck.aiDetector = "done"), scores),
          (err) => (console.error("[analyze] AI-image detector failed:", err), (webCheck.aiDetector = "failed"), [] as (number | null)[]),
        )
      : Promise.resolve([] as (number | null)[]);
    const [photos, webTexts, scores] = await Promise.all([photoSearch, textSearch, detectorRun]);
    webPhotoMatches = photos;
    detector = scores;
    // A page can turn up in both the index and the web search: keep one.
    const seen = new Set(textMatches.map((t) => t.url));
    textMatches = [...textMatches, ...webTexts.filter((t) => !seen.has(t.url))];
  }

  let analysis: ListingAnalysis | null = null;
  if (aiEnabled()) {
    onStep("item");
    analysis = await analysisPromise;
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
  const result = runRules(listing, { community, price, ai, photoMatches, webPhotoMatches, textMatches });
  const level = levelFor(result.score);
  const aiImage = combineAiImage(listing, claudeAiPhotoView(analysis?.photos), detector, webPhotoMatches ?? []);

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
      const line = await explainScore({ listing, score: result.score, level, signals: result.signals, price, aiPhotoNote: aiImageNote(aiImage) });
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
    maxScore: SCORE_MAX,
    level,
    summary,
    topReasons: result.topReasons,
    signals: result.signals,
    item: analysis?.item,
    priceCheck: price,
    communityReports: community?.reporters ?? 0,
    community,
    photoMatches: photoMatches?.slice(0, 10),
    webPhotoMatches: webPhotoMatches?.slice(0, 15),
    textMatches: textMatches.slice(0, 8),
    aiImage,
    webCheck,
    coverage,
    listingType: analysis?.listing_type,
    photoAssessments: analysis?.photos,
    aiUnavailableReason,
    aiUsed: Boolean(analysis) || explained,
    checkedAt: new Date().toISOString(),
  };
}

/** The explanation when Claude isn't available: the level, then the biggest reasons. Never a score number. */
export function fallbackSummary(result: RuleResult, level: RiskLevel, partial = false): string {
  const risky = result.signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
  if (partial) return `Partial check: ${risky[0]?.text ?? "Some checks couldn't run. Review what wasn't checked before deciding."}`;
  if (!risky.length) return "No red flags found in the listing, its photos or the seller's history.";
  const lead = level === "high" ? "High risk" : level === "medium" ? "Be careful" : "Mostly fine";
  const reasons = risky.slice(0, 2).map((s) => s.text.replace(/\.$/, ""));
  const rest = risky.length > 2 ? ` Plus ${risky.length - 2} smaller ${risky.length === 3 ? "reason" : "reasons"}, listed below.` : "";
  return `${lead}. ${reasons.join(". ")}.${rest}`;
}
