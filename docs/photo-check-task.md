# Task: Catch AI-generated / non-item photos, placeholder prices, and "partial" checks

Read this whole file first, then `server/src/analyze.ts`, `server/src/rules.ts`, `server/src/claude.ts` (the listing analysis part), `shared/types.ts`, and `extension/src/adapters/facebook.ts`. Work in the phases below and stop after each one.

## The bug report

Facebook Marketplace listing "Food/comida", **$1**, condition New, description "UWGB!", listed 8 weeks ago in Green Bay. The only photo is an obviously AI-generated event flyer (big text, garbled details, festival poster), not a photo of an item. DealDig showed **Low risk**: "Mostly fine: Only one photo. Ask for more angles and a tag or serial photo." The seller showed as **Unknown seller**.

## What went wrong (diagnosis from the code)

1. **Claude almost certainly never ran for this listing.** The summary text "Mostly fine: …" is exactly what `fallbackSummary()` returns when `explainScore` doesn't run or fails, and the only signal is the rules-only `few-photos` one. So either the API key isn't set, or `analyzeWithClaude` threw. The most likely throw: we pass Facebook CDN image URLs straight to the API (`source: { type: "url", url }`). Those URLs are signed, short-lived and sometimes blocked for outside fetchers, and **one bad image URL fails the whole call**, so the listing silently falls back to rules only.
2. **Missing data counts as "safe."** The seller wasn't read (Unknown seller, no id), so every seller rule (new account, no ratings, community reports) silently added 0 points. Same for the AI check failing. The report still says "Low risk" with full confidence.
3. **No rule for placeholder prices.** $1, $0, $123, $1234, $9999 are classic "price not real" values (ads, bait, "message me for price"). Nothing scores them.
4. **The AI prompt never asks about the photo itself.** It asks about counterfeits, stock photos and watermarks, but not: is this a real photo of the item at all? Is it AI-generated, a flyer, a screenshot, a graphic? Is this even an item for sale, or an ad, event promo, service or job?
5. **AI red flags are capped at +15 total** (`POINTS.textRedFlagsMax`), shared with the off-platform regex. So even if Claude had flagged the photo, 15 + 5 (one photo) = 20, still Low risk. That cap is right for free-text red flags (it limits prompt injection), so photo findings should be **structured fields scored in code** with their own fixed points, not more free-text points.

## Phase 0: confirm the diagnosis (no behavior change yet)

- Add a clear server log line in `analyze.ts` when the AI step is skipped or fails, with the reason (`no API key`, `image fetch failed`, `refusal`, other error). Never log listing text or image URLs in full; log the listing id and platform.
- Reproduce with a saved copy of this listing: add `server/test/fixtures/facebook-flyer.json` (a `Listing` object with the fields above; for the photo use a local test image in `server/test/fixtures/images/`, not the real Facebook URL). If I haven't saved the real listing HTML yet, tell me to save it to `server/test/fixtures/facebook-flyer.html` so the adapter can be tested against it.
- Tell me what the log says for the real listing when I run `npm run server` and reload the page.

## Phase 1: make the AI check robust and honest

1. **Fetch photos on the server, send them as base64.** New `server/src/images.ts`:
   - `loadPhotos(urls: string[], max = 4)`: fetch each URL with a 5 s timeout, only `image/jpeg|png|webp|gif`, max 5 MB each; skip any that fail (log a count, not the URL). Return `{ media_type, data }[]` plus how many failed.
   - Only fetch `https:` URLs on the marketplace's own image hosts (Facebook `*.fbcdn.net`, Poshmark, eBay `i.ebayimg.com`, Etsy, Depop). Refuse anything else, including private/loopback IPs, so a listing can't make our server fetch arbitrary URLs.
   - In `claude.ts`, send `source: { type: "base64", media_type, data }`. If zero photos loaded, still run the text analysis and tell Claude "photos could not be loaded".
   - Better still (if easy): the extension already has the images loaded on the page and computes dHashes from them. Have it also send a downscaled JPEG (max 1024px, quality 0.8) of up to 4 photos as data URLs, and use those first; fall back to server fetch. Note in the README that photos are sent to the server only for the check and are not stored.
2. **Coverage, so missing data never reads as "safe".** Add to `RiskReport` in `shared/types.ts`:
   ```ts
   coverage: { seller: boolean; photos: { checked: number; total: number }; ai: boolean; price: boolean };
   ```
   - `seller` is false when the adapter found no seller id/username.
   - Add an `info` signal (0 points) for each gap, e.g. "Couldn't read the seller's profile, so seller history wasn't checked." / "The photo check didn't run."
   - In the extension, when any of `seller`, `ai` or photos is missing, show the level as **"Low risk · partial check"** (never plain "Low risk") with a one-line list of what wasn't checked. Medium and high stay as they are.
   - `fallbackSummary` must not say "Mostly fine" when coverage is partial: use "Partial check: …".

## Phase 2: teach the AI to look at the photos

Extend the `Analysis` zod schema in `claude.ts` with structured fields (keep `red_flags` and `risk_adjust` as they are):

```ts
listing_type: z.enum(["item_for_sale", "rental", "service", "event_or_promo", "job", "wanted_post", "unclear"])
  .describe("What this post actually is, judged from title, description and photos together"),
photos: z.array(z.object({
  index: z.number().describe("0-based, matching the photo order"),
  kind: z.enum(["real_photo_of_item", "stock_or_catalog", "graphic_flyer_or_ad", "screenshot", "likely_ai_generated", "unclear"]),
  ai_generated: z.enum(["no", "possible", "likely"]).describe("Only 'likely' when there are clear tells"),
  shows_listed_item: z.boolean().describe("Does this photo actually show the item in the title?"),
  note: z.string().describe("One short line, max 15 words, on what you see. Empty if nothing notable."),
})),
price_looks_placeholder: z.boolean().describe("True if the price looks like a stand-in rather than the real price (e.g. $1 for food or a car, $0, $1234, $9999)"),
```

Add to the analysis system prompt (keep it one block per platform so caching still works):

- Look at every photo and fill `photos`. A real listing photo is usually taken by the seller: uneven lighting, a real background, the actual item. Flyers, posters, menus, ads and graphics with lots of overlaid text are `graphic_flyer_or_ad`, not photos of an item.
- `likely_ai_generated` tells: garbled or misspelled text in the image, warped logos, impossible or melted details (food, hands, fabric), too-perfect lighting, repeated textures, inconsistent shadows. AI detection is uncertain: use `possible` when unsure and `likely` only with clear tells. Never call the seller a scammer for this; describe what you see.
- Decide `listing_type` from everything together. An event flyer posted as "Food/comida $1" is `event_or_promo`, not an item.
- Food, services and events listed for $1 or $0 usually mean the price isn't real.

## Phase 3: score it in code (`rules.ts`), not with more free AI points

Add these to `AiFindings` (passed from `analyze.ts`) and score them in `runRules` with fixed points in `POINTS`:

| id | When | Severity | Points | Text shown |
|---|---|---|---|---|
| `no-real-photo` | `listing_type` is `item_for_sale` or `rental` and **no** photo has `shows_listed_item` true | caution | +20 | "None of the photos show the actual item. Ask for a real photo before paying." |
| `ai-photo-likely` | any photo `ai_generated: "likely"` | caution | +7 | "A photo is likely altered or AI-generated." |
| `ai-photo-possible` | any photo `possible`, none `likely` | info | +3 | "A photo may be altered or AI-generated." |
| `placeholder-price` | price is 0 or 1, or matches /^(1234|12345|9999|99999)$/, **or** Claude says `price_looks_placeholder` | caution | +10 | "The price looks like a placeholder, so the real price is unknown. Ask before meeting." |
| `not-an-item` | `listing_type` is `event_or_promo`, `service`, `job` or `wanted_post` | info | 0 | "This looks like an ad or event promo, not an item for sale. DealDig's checks are built for item listings." |

Rules:
- The placeholder-price rule must also work **without** Claude (deterministic check on the number), so rules-only mode still catches $1.
- The `no-real-photo` and `ai-photo-*` points are separate from `textRedFlagsMax` (they come from structured fields, not free text, so injected text can't inflate them beyond these fixed values).
- Don't double count: if an AI `red_flags` line says the same thing as one of these, drop that line (simple keyword check on "AI", "generated", "flyer", "stock", "placeholder").
- For `not-an-item`, the extension shows a neutral banner at the top of the Listing tab ("Not a normal item listing") instead of a scary score; the other signals still show.

Expected result for the bug listing: one photo (+5) + placeholder price (+10) + likely AI-looking flyer (+7) = **22 = Low risk**, marked as a partial check for the missing seller. Add no-real-photo (+20) only if Claude calls it `item_for_sale`, bringing the score to 42 (Be careful). If Claude calls it `event_or_promo`, show the "Not a normal item listing" banner. For either possible or likely AI-image findings, show a separate disclaimer regardless of the risk level: the automated assessment may be wrong, and the buyer can decide whether to ask the seller for an original photo.

## Phase 4: Facebook seller parsing

"Unknown seller" means `facebook.ts` didn't find a `/marketplace/profile/<id>` link. This listing was opened in the **modal/overlay view** (photo on the left, details on the right, with an X in the corner), which has a different DOM from the full item page. Using the saved fixture, make the adapter find the seller in both layouts (the seller block is usually further down in the right column, below "Seller information" / "Seller details"). If it still can't, return an empty seller so Phase 1's coverage flag shows "partial check".

## Tests (`server/test/photos-ai.test.ts`, run with `npm test`, no API key needed)

Unit-test `runRules` with hand-built `AiFindings`:
- The bug listing (flyer, `$1`, one photo, no seller) → score 22, level low, signals include `placeholder-price` and `ai-photo-likely`, coverage.seller false.
- `$1` with no AI at all → `placeholder-price` still fires.
- A normal used bike, 4 real photos, $180 → none of the new signals.
- A new item with a stock photo on eBay → no `no-real-photo` (stock photos show the item).
- `event_or_promo` → `not-an-item` info signal, no extra points.
- An AI red-flag line "looks AI-generated" alongside `ai-photo-likely` → counted once.

And one `images.ts` test: a non-allowlisted host and a `http://127.0.0.1` URL are refused.

After each phase run `npm run typecheck` and `npm test`, and tell me exactly how to re-check the Food/comida listing in Chrome.
