// Claude reviews the listing text + photos and returns a structured verdict.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Listing, Signal } from "../../shared/types";

const MODEL = "claude-opus-5-5";
const MAX_PHOTOS = 4;

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

const Verdict = z.object({
  score: z.number().describe("0 = clearly safe, 100 = almost certainly a scam or counterfeit"),
  summary: z.string().describe("One or two plain sentences for the buyer"),
  signals: z
    .array(
      z.object({
        severity: z.enum(["good", "info", "caution", "danger"]),
        text: z.string().describe("One line, specific to this listing"),
      }),
    )
    .describe("New findings only; don't repeat the rule checks you were given"),
  price: z.object({
    typical_low: z.number().nullable(),
    typical_high: z.number().nullable(),
    note: z.string(),
  }),
});
export type Verdict = z.infer<typeof Verdict>;

const SYSTEM = `You are DealDig, a scam and counterfeit checker for second-hand marketplaces. You are reviewing a Poshmark listing for a buyer.

Context about Poshmark:
- Payment through Poshmark is protected (Posh Protect). Any push to pay or talk off-platform (Venmo, Zelle, PayPal F&F, text, email) is the biggest red flag.
- Orders over $500 get free authentication; cheaper luxury items don't.
- The "original price" is typed in by the seller and isn't verified.

Look at:
1. Photos: stock or catalog images instead of real photos, another shop's watermark, photos that don't match the title/brand, missing tag/serial/label shots for brand items, visible counterfeit tells.
2. Price: what this exact item usually sells for used, and whether this price is believable.
3. Text: pressure tactics, off-platform contact, vague or copy-pasted descriptions, wording that doesn't match the item.
4. Seller: account age, sales and reviews, given as facts below.

Be calibrated. Most listings are fine: a normal listing from an established seller should score under 25. Only score above 60 when there is real evidence. Keep every signal to one specific line a buyer can act on.`;

export async function reviewListing(listing: Listing, ruleSignals: Signal[], pastReports: string[]): Promise<Verdict | null> {
  const facts = {
    title: listing.title,
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    size: listing.size,
    price: listing.price,
    seller_entered_original_price: listing.originalPrice ?? null,
    listed_at: listing.listedAt,
    likes: listing.likes,
    description: listing.description,
    seller: {
      joined_at: listing.seller.joinedAt,
      last_active_at: listing.seller.lastActiveAt,
      orders_shipped: listing.seller.ordersShipped,
      five_star_reviews: listing.seller.fiveStarReviews,
      listings: listing.seller.listingsCount,
      location: listing.seller.location,
    },
    rule_checks_already_shown: ruleSignals.map((s) => `${s.severity}: ${s.text}`),
    community_reports_about_seller: pastReports,
    today: new Date().toISOString().slice(0, 10),
  };

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...listing.photos.slice(0, MAX_PHOTOS).map(
      (url): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "url", url } }),
    ),
    {
      type: "text",
      text: `Listing photos are above (${Math.min(listing.photos.length, MAX_PHOTOS)} of ${listing.photos.length}). Listing data:\n${JSON.stringify(facts, null, 2)}`,
    },
  ];

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if a safety check declines, the API retries on a fallback model
    output_config: { effort: "medium", format: betaZodOutputFormat(Verdict) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    console.warn("[claude] declined to review listing", listing.id, response.stop_details);
    return null;
  }
  return response.parsed_output ?? null;
}
