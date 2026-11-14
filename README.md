# DealDig

A browser extension that checks online listings for scams and counterfeits before money changes hands. The first supported site is **Poshmark**.

## Run it

```bash
npm install

# 1. Server (terminal 1)
cp server/.env.example server/.env    # add ANTHROPIC_API_KEY (optional: rules-only without it)
npm run server                        # http://localhost:8787

# 2. Extension (terminal 2)
npm run ext                           # rebuilds extension/dist on save
```

Then in Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/dist`. Open any `poshmark.com/listing/...` page: a badge appears at the bottom right, and the toolbar icon opens the side panel with the full report.

After you change extension code, click the reload icon on the extension card and refresh the page.

`npm test` runs the parser and rule tests. `npm run typecheck` checks both packages.

## How it works

```
poshmark.com page
  └─ content script (extension/src/content/poshmark.ts)
       re-fetches the page HTML → adapter parses it into a Listing
       └─ background worker (extension/src/background.ts) ── POST /analyze-listing ──▶ server
            stores the result per tab                                  rules.ts   instant checks, no key needed
            └─ side panel (React) renders it                           claude.ts  photos + text review (Claude)
                                                                       db.ts      SQLite: reports + check history
```

- **Why re-fetch the page?** Poshmark puts all listing and seller data in an inline `window.__INITIAL_STATE__` script that deletes itself after running, so the content script can't read it from the DOM. Fetching the same URL again gets the HTML with that script still in it, and it keeps working when you click between listings without a full page load.
- **Score:** 0 is safe, 100 is very risky. Rule checks give a base score. When Claude is on, the final score blends the two (40% rules, 60% Claude). If a seller has community reports, the score never drops below the rules score.
- **Price check:** right now this is Claude's estimate, labeled as such in the UI. Swapping in real sold-listing data (e.g. the eBay Browse API) is a good next step.

## Layout

| Path | What |
|---|---|
| `shared/types.ts` | `Listing`, `RiskReport`, etc. Every site adapter produces a `Listing`. |
| `extension/src/adapters/` | One file per site. Pure functions (HTML → `Listing`), testable in Node. |
| `extension/src/content/` | Content scripts + the on-page badge. |
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

1. Add the platform name to `Platform` in `shared/types.ts` (and the `z.literal` checks in `server/src/index.ts`).
2. Write `extension/src/adapters/<site>.ts` that returns a `Listing`.
3. Add a content script in `extension/src/content/` and register it in `public/manifest.json` (plus `host_permissions`) and `build.mjs`.
4. Tweak the platform context in the Claude system prompt.

## Next up

- Chat/offer checks (`/analyze-chat`): flag off-platform pushes, overpayment, and deposit requests in messages.
- Seller privacy tools: strip photo metadata, blur faces and addresses on the device.
- Document check for payment screenshots and receipts.
- Handshake link and receipts; safe meeting spots for local deals.
- Real price comps; image fingerprinting to catch reused photos.
