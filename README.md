# DealDig

A browser extension that checks online listings for scams and counterfeits before money changes hands. Supported sites: **Poshmark**, **eBay** and **Facebook Marketplace**.

## Run it

```bash
npm install

# 1. Server (terminal 1)
cp server/.env.example server/.env    # add ANTHROPIC_API_KEY, optionally eBay keys (rules-only without them)
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
            stores the result per tab                                  rules.ts   risk score: points per signal, no key needed
            └─ side panel (React) renders it                           claude.ts  item ID, price estimate, red flags, 1-line why
                                                                       prices.ts  eBay Browse API price comparisons
                                                                       db.ts      SQLite: reports + check history
                                                                       meetup.ts  safe spots (OSM) + daylight
                                                                       reply.ts   drafted meetup reply
```

- **Why re-fetch the page?** Poshmark puts all listing and seller data in an inline `window.__INITIAL_STATE__` script that deletes itself after running, so the content script can't read it from the DOM. Fetching the same URL again gets the HTML with that script still in it, and it keeps working when you click between listings without a full page load.
- **eBay:** title, price, condition and photos come from the JSON-LD `Product` eBay server-renders; seller name, feedback score, % positive and join date come from the seller card.
- **Facebook Marketplace:** class names are obfuscated, so the adapter only uses headings, links to `/marketplace/profile/<id>`, and text Facebook shows every user ("Listed 3 days ago in ...", "Condition", "Joined Facebook in 2015"). og: tags are used only when `og:url` is the current item, because they go stale as you click between listings. The content script waits until a new item has rendered before reading it.
- **Score** (spec §2.4): 0 is safe, 100 is very risky. It's computed in `rules.ts` as the sum of points per signal, so every point is explainable (the side panel shows them): blocklisted seller +40, price under 50% of typical or under a brand's counterfeit floor +20, account under 30 days +15, no ratings/sales/feedback +10, poor feedback +10, prior DealDig reports +10 each (max +30), text red flags up to +15, one photo +5. Bands: 0-29 low, 30-59 be careful, 60+ high. A seller counts as blocklisted with 3+ reports in 30 days.
- **Claude's part:** Sonnet 5.5 identifies the item (brand, model, category), estimates its usual price, and lists red flags in the text and photos. It can add at most 15 points, shared with the regex off-platform check, so a prompt-injected listing can't talk its way to a low score. Haiku 5.5 then writes the one-line explanation of the final score. Without a key, the summary is the level plus the biggest reason.
- **Meetup helper** (Facebook Marketplace only; Poshmark and eBay are safer kept on-platform): the side panel asks where you're coming from (text only, never GPS), geocodes that and the item's location with OpenStreetMap Nominatim, and searches halfway between with the Overpass API for police stations, libraries, grocery stores, community centers, bank lobbies and cafés. `meetup.ts` ranks them in code (kind, minus 10 points per km) and returns 3 of different kinds; items $250+ or high-risk listings put a police station first. Time options are daylight only (sunset computed from the location). Sonnet 5.5 drafts the reply in a friendly or firm tone, optionally answering the other person's pasted message (declining deposits, payment apps, codes, couriers, off-platform moves); without a key, `reply.ts` fills a template. The user copies it into the chat and sends it themselves. If Overpass is down, a curated Madison list is used.
- **Price check:** with `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` set, the server compares against the median of up to 20 similar eBay listings (Browse API, asking prices). Otherwise it uses Claude's estimate, labeled as one; a low-confidence estimate only adds half the bait points.

- **Photo privacy** (sellers only): when the active tab is a create/edit-listing page (`extension/src/sellPages.ts`), the side panel switches from the listing check to this tool and the page shows a "Check your photos before posting" badge. Sellers drop in listing photos before uploading them. Runs entirely in the extension; photos are never uploaded, and all engines and models ship inside the extension (no CDN, no remote code).
  - *Upload guard* (`extension/src/content/uploadGuard.ts`): sites upload photos the moment they're picked, so the guard catches them at that moment instead. A capture-phase `input`/`change` listener on `window` runs before any of the page's own listeners and stops the event, copies the files into memory and empties the input. The page badge says "Holding N photos" (with a Skip button), and the side panel pulls the files (one message per file, base64) and checks them. **Use N clean photos in my listing** sends back only copies that passed the metadata re-check; the guard puts them into the same `<input>` with a `DataTransfer` and fires `input` + `change` again, so the site uploads only clean files. **Skip** puts the originals back the same way. Photos that can't be cleaned (e.g. HEIC) are left out unless the seller skips. Drag-and-drop uploads aren't intercepted yet.
  - *Metadata:* `exifr` reads EXIF, GPS, XMP, IPTC, PNG chunks and the embedded preview thumbnail (which can still show a cropped-out area). Findings are explained in plain words, GPS first.
  - *Faces:* MediaPipe BlazeFace (WASM) runs on the whole photo plus a 3×3 grid of overlapping tiles so small background faces are found; duplicates are merged with non-maximum suppression.
  - *Text:* Tesseract OCR (WASM). Words are filtered by confidence, rows are split at big gaps (OCR on photos glues junk from fabric and shadows onto real lines), and each piece is checked for addresses, ZIP codes, phone numbers, emails, tracking numbers and house numbers. An address grows into the whole mailing label around it, so the name line is covered too. Other text is shown as an unchecked suggestion.
  - *Covering:* text gets solid boxes and faces are reduced to an 8×8 grid with random noise, then smoothed. Plain blur or fine pixelation can be reversed (e.g. Depix rebuilds pixelated text). Users can uncheck any box or draw their own.
  - *Clean copy:* the photo is redrawn on a fresh canvas and saved as a new JPEG, so no metadata is carried over. The clean copy is then re-read to **verify** it has 0 metadata fields and no location before the download button is shown as safe.

## Layout

| Path | What |
|---|---|
| `shared/types.ts` | `Listing`, `RiskReport`, etc. Every site adapter produces a `Listing`. |
| `extension/src/adapters/` | One file per site. Pure functions (HTML or `PageData` → `Listing`), testable in Node. `page.ts` has the shared `PageData` type and parsing helpers. |
| `extension/src/content/` | The content script (`main.ts`), the DOM collector (`collect.ts`) and the on-page badge. |
| `extension/src/sidepanel/` | React side panel. |
| `server/src/rules.ts` | The risk score: `POINTS` table, rule checks, top reasons. |
| `server/src/prices.ts` | Price reference: eBay Browse API comps, or Claude's estimate. |
| `server/src/claude.ts` | Claude prompts and output schemas (listing analysis, score explanation). |
| `server/src/db.ts` | SQLite tables `reports` and `listing_checks`. |
| `server/src/meetup.ts` | Meeting spots: geocoding, Overpass lookup, ranking, sunrise/sunset, curated Madison spots. |
| `server/src/reply.ts` | Drafted meetup reply: Claude, or a template without a key. |
| `extension/src/sidepanel/Meetup.tsx` | The "Meet safely" card. |
| `extension/src/sidepanel/PhotoPrivacy.tsx` | The photo privacy tool (shown on sell pages). |
| `extension/src/content/uploadGuard.ts` | Holds photos picked on sell pages until they're cleaned (or skipped). |
| `extension/src/sellPages.ts` | URL patterns for each site's create/edit-listing pages. |
| `extension/src/privacy/` | Photo privacy: `metadata.ts`/`summarize.ts` (hidden data), `detect.ts` (faces, text), `pii.ts` (which text is personal, label grouping), `redact.ts` (clean copy), `geometry.ts` (box math). |
| `extension/public/models/` | BlazeFace face model (MediaPipe). WASM engines and OCR data are copied from `node_modules` by `build.mjs`. |

## API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /health` | | `{ ok, ai }` |
| `POST /analyze-listing` | `{ listing: Listing }` | `RiskReport` |
| `POST /report` | `{ platform, sellerId, sellerUsername, listingId?, reason }` | `{ ok }` |
| `POST /meetup/spots` | `{ area, listingLocation?, price?, riskLevel? }` | `MeetupSpotsResponse`: 3 spots, center, daylight, notes |
| `POST /meetup/reply` | `DraftReplyInput`: listing, role, tone, spot, time, theirMessage? | `{ reply, aiUsed }` |

## Adding another site

1. Add the platform to `PLATFORMS` and `PLATFORM_NAMES` in `shared/types.ts`.
2. Write `extension/src/adapters/<site>.ts`: a URL matcher and a pure parser that returns a `Listing` (from `PageData` for DOM-rendered sites).
3. Add a `SiteReader` for it in `extension/src/content/main.ts` and add the site to `content_scripts.matches` in `public/manifest.json`.
4. Add the platform's context to `PLATFORM_CONTEXT` in `server/src/claude.ts`. If people meet in person there, add it to `LOCAL_PLATFORMS` to show the meetup helper.
5. Add a test in `server/test/` with a fixture shaped like the real page.

## Next up

- Chat/offer checks (`/analyze-chat`): flag off-platform pushes, overpayment, and deposit requests in messages.
- Upload guard: also catch drag-and-drop photo uploads; confirm it on the live Poshmark, eBay and Facebook sell forms.
- Document check for payment screenshots and receipts.
- Handshake link and receipts.
- Real price comps; image fingerprinting to catch reused photos.
