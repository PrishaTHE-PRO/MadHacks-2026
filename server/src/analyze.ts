import type { Listing, RiskReport, Signal } from "../../shared/types";
import { runRules, clamp, levelFor } from "./rules";
import { reviewListing, aiEnabled } from "./claude";
import { countReports, recentReports, saveCheck } from "./db";

export async function analyzeListing(listing: Listing): Promise<RiskReport> {
  const sellerId = listing.seller.id;
  const communityReports = sellerId ? countReports(listing.platform, sellerId) : 0;
  const rules = runRules(listing, communityReports);

  let score = rules.score;
  let summary = summarizeRules(rules.signals, score);
  let signals: Signal[] = rules.signals;
  let priceCheck: RiskReport["priceCheck"];
  let aiUsed = false;

  if (aiEnabled()) {
    try {
      const verdict = await reviewListing(listing, rules.signals, sellerId ? recentReports(listing.platform, sellerId) : []);
      if (verdict) {
        aiUsed = true;
        // Rules are hard evidence, Claude is judgment: blend them, and never let
        // the AI talk a seller with community reports below the rules' floor.
        score = clamp(communityReports > 0 ? Math.max(rules.score, verdict.score) : 0.4 * rules.score + 0.6 * verdict.score);
        summary = verdict.summary;
        signals = [
          ...rules.signals,
          ...verdict.signals.map((s, i) => ({ id: `ai-${i}`, severity: s.severity, text: s.text, source: "ai" as const })),
        ];
        priceCheck = {
          typicalLow: verdict.price.typical_low,
          typicalHigh: verdict.price.typical_high,
          note: verdict.price.note,
          basis: "ai-estimate",
        };
      }
    } catch (err) {
      console.error("[analyze] Claude review failed, using rules only:", err);
    }
  }

  const level = levelFor(score);
  saveCheck(listing.platform, listing.id, listing.seller.id, score, level);

  return {
    listingId: listing.id,
    platform: listing.platform,
    score,
    level,
    summary,
    signals,
    priceCheck,
    communityReports,
    aiUsed,
    checkedAt: new Date().toISOString(),
  };
}

function summarizeRules(signals: Signal[], score: number): string {
  const worst = signals.find((s) => s.severity === "danger") ?? signals.find((s) => s.severity === "caution");
  if (worst) return worst.text;
  return score < 30 ? "No red flags found in the listing or seller history." : "A few things are worth double-checking.";
}
