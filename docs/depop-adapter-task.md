# Task: Depop listing adapter

Add a Depop adapter so DealDig scores Depop product pages the same way it already scores Poshmark, eBay and Facebook listings.

**Fixture:** `server/test/fixtures/depop-listing.html` is a real Depop product page, saved from the browser on Nov 15, 2026. The listing is "grey and white striped long sleeve top with v neck…", $8, sold by `slugbug_v`. The logged-in buyer's account details in the page were replaced with fake values (`test_buyer`, `buyer@example.com`). Keep it that way, and don't commit any other saved page without scrubbing it first.

## Already in place

- `"depop"` is in `PLATFORMS` (`shared/types.ts`).
- `SellerInfo` already has Depop fields: `reviewsCount`, `rating`, `itemsSold`.
- `extension/public/manifest.json` already matches `https://*.depop.com/*`.
- The pattern to follow is `extension/src/adapters/ebay.ts`: a pure `parseXPage(data: PageData)` that reads JSON-LD first, then named DOM sections, then text, plus a reader in `extension/src/content/main.ts`.

## What to build

### 1. `extension/src/adapters/depop.ts`

- `isDepopListingUrl(url)`: matches the host `depop.com` or `www.depop.com` with the path `/products/<slug>/`. Reject look-alike hosts such as `evil-depop.com`.
- `DEPOP_SECTIONS`: CSS selectors for `collectPageData({ sections })`. Depop's class names are hashed (`mDCFLG_sellerDetails`), so **don't use classes**. Hook onto these instead:
  - **Seller card:** the `<a aria-label="<username>'s shop">` link and its parent. The text below it holds `"194 sold"`, `"Active today"` and `"(49)"`.
  - **Rating:** `[role="img"][aria-label^="shop rating"]`. Its label reads `"shop rating 5 stars, see reviews"`.
  - **Attributes:** `[data-testid="productPrimaryAttributes"]` (size and condition) and `[aria-description="Colours"]`.
- `parseDepopPage(data: PageData): Listing | null`.

### 2. Where each field comes from (verified against the fixture)

| Listing field | Source | Value in the fixture |
|---|---|---|
| `title` | Visible product title in the text (`"Women's Grey Shirt"`). Fall back to JSON-LD `name`, which is cut off with "..." | |
| `description` | JSON-LD `Product.description` (full text, with hashtags) | "grey and white striped … #feminine" |
| `price`, `currency` | JSON-LD `offers.price` and `offers.priceCurrency` | 8, USD |
| `photos` | JSON-LD `image[]` (full-size `…/P0.jpg`) | 2 photos |
| `brand` | JSON-LD `brand.name`. **Treat `"Other"` as no brand** | undefined |
| `condition` | Text line ending in "condition" | "Like new condition" |
| `size` | Text line `"Size S"` | "S" |
| `id` | The `productId` query parameter on the seller links (`…/slugbug_v/?brandIds=1667&productId=979850109`). Fall back to the URL slug | "979850109" |
| `url` | Page URL without the query string | |
| `status` | JSON-LD `offers.availability` (`…/InStock`) | |
| `seller.username` | Shop link aria-label (`"slugbug_v's shop"`), or `og:description`, which ends in `"Sold by @slugbug_v"` | "slugbug_v" |
| `seller.profileUrl` | `https://www.depop.com/<username>/` | |
| `seller.itemsSold` | `"194 sold"` | 194 |
| `seller.reviewsCount` | `"(49)"` in the seller card | 49 |
| `seller.rating` | The rating aria-label (`"shop rating 5 stars"`) | 5 |
| `seller.lastActiveAt` | `"Active today"` / `"Active 3 days ago"` through `relativeAgo()` in `page.ts` | today |
| Shipping speed (optional) | `"This seller often ships in 2 days"` | 2 days |

### 3. Traps this page actually contains

1. **Don't get the seller from the URL slug.** The slug's prefix is `stugbug_v`, but the real username is `slugbug_v`. Depop slugs can be off by a character, so always take the username from the shop link or `og:description`.
2. **Don't read the embedded Next.js data (`self.__next_f.push`).** In this saved page, its `product_basic_by_slug` query describes a *different* product (a No Boundaries top from another seller). That data goes stale after Depop's client-side navigation. Use only JSON-LD, og meta tags and the visible DOM. Also check that `og:url` matches the current URL before trusting the og tags, as the Facebook adapter does.
3. **Ignore the "More from this seller" and "You might also like" grids.** They contain other prices (`$3.00`, `$18.00`…). Only take the first price, or the JSON-LD price.

### 4. Hook it up

- In `content/main.ts`, add a `depop` `SiteReader`. Use `poll(url, 6000, () => parseDepopPage(collectPageData({ sections: DEPOP_SECTIONS })), (l) => Boolean(l.seller.username) && l.photos.length > 0)`, then add it to `READERS`.
- If the score rules use Poshmark-only seller fields (`ordersShipped`, `fiveStarReviews`), map the Depop equivalents in `server/src/rules.ts`: `itemsSold` for sales history, and `reviewsCount` + `rating` for reputation. A seller with no sales or no reviews should count as "new seller", the same as on the other platforms.

### 5. Test: `server/test/depop.test.ts`

Load the fixture with `readFileSync(new URL("./fixtures/depop-listing.html", import.meta.url), "utf8")`, parse it with `linkedom`'s `parseHTML` (already a dev dependency, used in `chat-adapters.test.ts`), and build a `PageData` from it. Either reuse `collectPageData`, if it runs against a linkedom document, or write a small helper that copies meta, JSON-LD, text, links, images and sections. Assert:

- `isDepopListingUrl` is true for the og:url, and false for `https://www.depop.com/slugbug_v/` and `https://evil-depop.com/products/x/`
- `title` "Women's Grey Shirt", `price` 8, `currency` "USD", `brand` undefined, `size` "S", `condition` "Like new condition"
- `photos.length === 2`, all ending in `/P0.jpg`
- `id` "979850109"
- `seller.username` "slugbug_v" (**not** "stugbug_v"), `itemsSold` 194, `reviewsCount` 49, `rating` 5
- Nothing from the other product leaks in: no "No Boundaries" and no "ashkabash" anywhere in the result
- `runRules(listing)` runs without throwing

Run `npm test` from the repo root.

## Done when

- `npm run typecheck` and `npm test` pass.
- On a live Depop product page, the badge shows a score, and the side panel shows the right seller, price and photos.
- Clicking from one Depop product to another updates the score, with nothing stale left over from the previous item.
