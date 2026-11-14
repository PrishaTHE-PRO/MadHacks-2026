# DealDig

A browser extension that checks online listings for scams and counterfeits before money changes hands. Supported sites: **Poshmark**, **eBay** and **Facebook Marketplace**.

## Run it

```bash
npm install

# 1. Server (terminal 1)
cp server/.env.example server/.env    # add ANTHROPIC_API_KEY (optional: rules-only without it)
npm run server                        # http://localhost:8787

# 2. Extension (terminal 2)
npm run ext                           # rebuilds extension/dist on save
```

Then in Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/dist`. Open a `poshmark.com/listing/...`, `ebay.com/itm/...` or `facebook.com/marketplace/item/...` page: a badge appears at the bottom right, and the toolbar icon opens the side panel with the full report.

After you change extension code, click the reload icon on the extension card and refresh the page.

`npm test` runs the parser and rule tests. `npm run typecheck` checks both packages.

## How it works

```
marketplace page
  └─ content script (extension/src/content/main.ts) picks the reader for the URL
       Poshmark: re-fetches the page HTML → adapters/poshmark.ts
       eBay, Facebook: content/collect.ts copies the DOM into PageData → adapters/ebay.ts, facebook.ts
       └─ background worker (extension/src/background.ts) ── POST /analyze-listing ──▶ server
            stores the result per tab                                  rules.ts   instant checks, no key needed
            └─ side panel (React) renders it                           claude.ts  photos + text review (Claude)
                                                                       db.ts      SQLite: reports + check history
```

- **Why re-fetch the page?** Poshmark puts all listing and seller data in an inline `window.__INITIAL_STATE__` script that deletes itself after running, so the content script can't read it from the DOM. Fetching the same URL again gets the HTML with that script still in it, and it keeps working when you click between listings without a full page load.
- **eBay:** title, price, condition and photos come from the JSON-LD `Product` eBay server-renders; seller name, feedback score, % positive and join date come from the seller card.
- **Facebook Marketplace:** class names are obfuscated, so the adapter only uses headings, links to `/marketplace/profile/<id>`, and text Facebook shows every user ("Listed 3 days ago in ...", "Condition", "Joined Facebook in 2015"). og: tags are used only when `og:url` is the current item, because they go stale as you click between listings. The content script waits until a new item has rendered before reading it.
- **Score:** 0 is safe, 100 is very risky. Rule checks give a base score. When Claude is on, the final score blends the two (40% rules, 60% Claude). If a seller has community reports, the score never drops below the rules score.
- **Price check:** right now this is Claude's estimate, labeled as such in the UI. Swapping in real sold-listing data (e.g. the eBay Browse API) is a good next step.

## Layout

| Path | What |
|---|---|
| `shared/types.ts` | `Listing`, `RiskReport`, etc. Every site adapter produces a `Listing`. |
| `extension/src/adapters/` | One file per site. Pure functions (HTML or `PageData` → `Listing`), testable in Node. `page.ts` has the shared `PageData` type and parsing helpers. |
| `extension/src/content/` | The content script (`main.ts`), the DOM collector (`collect.ts`) and the on-page badge. |
| `extension/src/sidepanel/` | React side panel. |
| `server/src/rules.ts` | Rule checks (account age, counterfeit price floors, off-platform payment, ...). |
| `server/src/claude.ts` | Claude prompt and output schema. |
| `server/src/db.ts` | SQLite tables `reports` and `listing_checks`. |

## API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /health` | | `{ ok, ai }` |
| `POST /analyze-listing` | `{ listing: Listing }` | `RiskReport` |
| `POST /report` | `{ platform, sellerId, sellerUsername, listingId?, reason }` | `{ ok }` |

## Adding another site

1. Add the platform to `PLATFORMS` and `PLATFORM_NAMES` in `shared/types.ts`.
2. Write `extension/src/adapters/<site>.ts`: a URL matcher and a pure parser that returns a `Listing` (from `PageData` for DOM-rendered sites).
3. Add a `SiteReader` for it in `extension/src/content/main.ts` and add the site to `content_scripts.matches` in `public/manifest.json`.
4. Add the platform's context to `PLATFORM_CONTEXT` in `server/src/claude.ts`.
5. Add a test in `server/test/` with a fixture shaped like the real page.

## Next up

- Chat/offer checks (`/analyze-chat`): flag off-platform pushes, overpayment, and deposit requests in messages.
- Seller privacy tools: strip photo metadata, blur faces and addresses on the device.
- Document check for payment screenshots and receipts.
- Handshake link and receipts; safe meeting spots for local deals.
- Real price comps; image fingerprinting to catch reused photos.
