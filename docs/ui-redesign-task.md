# Task: Frosted "bubble" UI redesign (pop-up, badge, chips, states)

Read this whole file, then `README.md`. The visual reference is the design canvas "DealDig UI preview" (artboards: Frosted pop-up · Listing tab, Frosted pop-up · Chat tab, Inline chat warning chips, On-page badge, Loading · empty · can't connect). Everything you need to build it is written below, so you don't need to open the canvas.

Work in the phases at the end and stop after each one so I can look at it in Chrome.

## The one big decision: an in-page pop-up, not Chrome's popup window

The design is a **frosted glass** pop-up: the page behind it shows through, blurred. Chrome's built-in `action` popup is its own window, so `backdrop-filter` there only blurs the popup's own background, never the page. To get the real effect:

- Render the pop-up **inside the page** from the content script, in a **shadow root** (like `content/badge.ts` already does), fixed to the top-right corner: `top: 12px; right: 12px; width: 380px; height: 600px`.
- Clicking the toolbar icon toggles it: in `background.ts`, remove `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, add `chrome.action.onClicked` → `chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" })`. Clicking the on-page badge also toggles it. `Esc` and the close button hide it.
- On pages with no content script (chrome:// pages, unsupported sites), fall back to opening the existing side panel so the icon never does nothing.
- Keep `extension/src/sidepanel/` working (it becomes the fallback). Move the shared React pieces into `extension/src/ui/` and import them from both.

### Data for the pop-up

The content script already gets the `RiskReport` back from `ANALYZE_LISTING` (`content/main.ts`). Keep the latest `{ listing, report | error | loading }` (and chat state, when chat safety lands) in a tiny store in the content script and render the pop-up from it. No new server calls.

## Design tokens (`extension/src/ui/tokens.css`)

```css
:host, .dd-root {
  --dd-font: "Nunito", system-ui, -apple-system, sans-serif;
  --dd-ink: #2A2B3A;          /* body text */
  --dd-ink-2: #3D3F52;        /* secondary text */
  --dd-muted: #4A4D63;        /* labels, meta (passes 4.5:1 on the glass) */
  --dd-accent: #4F62C4;       /* the only accent: primary button, active pin, count badge */
  --dd-accent-ink: #2F3C86;   /* links, secondary button text */
  --dd-accent-wash: rgba(79,98,196,.10);  /* point tags */
  --dd-glass: rgba(255,255,255,.55);      /* pop-up */
  --dd-glass-card: rgba(255,255,255,.62); /* cards inside it */
  --dd-glass-chip: rgba(255,255,255,.72);
  --dd-glass-edge: rgba(255,255,255,.80);
  --dd-track: rgba(42,43,58,.08);         /* empty bar segments */
  --dd-blur: blur(22px) saturate(160%);
  --dd-shadow: 0 24px 60px rgba(60,72,150,.28);
  /* Color only where it means something: */
  --dd-careful: #E5A93A; --dd-careful-ink: #6E4700;
  --dd-high: #E86A55;    --dd-high-ink: #8E2A1A;
  --dd-low-ink: #1E6B45;
  --dd-r-panel: 18px; --dd-r-card: 14px; --dd-r-ctrl: 10px;
}
```

Rules: surfaces are neutral frosted white. The **only** colored things are the verdict word, small 8px severity dots, the active risk-bar segment, and the periwinkle accent. No colored card backgrounds.

### Font

Nunito (SIL Open Font License). Download `Nunito` variable woff2 into `extension/public/fonts/`, list it in `web_accessible_resources` in `public/manifest.json`, and inject one `@font-face` into the **document** `<head>` once (fonts declared only inside a shadow root don't load reliably). Use `chrome.runtime.getURL("fonts/…")` for the `src`. Fallback stays `system-ui`.

### CSS in the shadow root

Add a text loader to `extension/build.mjs` (`loader: { ".css": "text" }`) so `import css from "./panel.css"` gives a string to put in a `<style>` inside the shadow root. Add a `declare module "*.css"` type.

## The bubble mark (`extension/src/ui/Bubble.tsx`)

**Visual reference:** `docs/design/bubble-reference.png` (open it before drawing the bubble). Match its feel: purple glow top-left, light yellow top-right, teal-blue bottom-left, a white outer ring with a thin blue inner ring, a curved white highlight on the right, a faint horizontal streak, and a light sparkle texture. Use it as reference only; do not ship the PNG in the extension. The SVG below is the version to build from.

One component used everywhere (logo, verdict, badge, chips, states). Props: `size` (px), `icon?: "none" | "alert" | "check" | "dash"`, `animate?: boolean` (default true when size ≥ 28). Gradient and filter ids must be unique per instance: use `useId()` and strip `:` from it.

```tsx
import { useId } from "react";

type Icon = "none" | "alert" | "check" | "dash";

export function Bubble({ size, icon = "none", animate = size >= 28 }: { size: number; icon?: Icon; animate?: boolean }) {
  const id = useId().replace(/:/g, "");
  const glyph = (color: string) =>
    icon === "alert" ? (
      <>
        <path d="M32 21.5 v12" stroke={color} strokeWidth={5.4} strokeLinecap="round" />
        <circle cx={32} cy={41.8} r={3.2} fill={color} />
      </>
    ) : icon === "check" ? (
      <path d="M23 32.5 l6.5 6.5 l11.5 -13" stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ) : icon === "dash" ? (
      <path d="M24.5 32 h15" stroke={color} strokeWidth={5} strokeLinecap="round" />
    ) : null;
  const glow = (n: string, cx: number, cy: number, r: number, c: string, o: number) => (
    <radialGradient id={`${n}${id}`} cx={cx} cy={cy} r={r}>
      <stop offset="0" stopColor={c} stopOpacity={o} />
      <stop offset="1" stopColor={c} stopOpacity="0" />
    </radialGradient>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={animate ? "dd-bubble" : undefined}>
      <defs>
        <radialGradient id={`m${id}`} cx=".5" cy=".55" r=".62">
          <stop offset="0" stopColor="#C9DDF6" stopOpacity=".95" />
          <stop offset="1" stopColor="#EDF2FD" stopOpacity=".8" />
        </radialGradient>
        {glow("p", 0.27, 0.28, 0.52, "#B7A6F0", 0.95) /* purple, top-left */}
        {glow("y", 0.78, 0.26, 0.44, "#F7F1B5", 0.95) /* light yellow, top-right */}
        {glow("t", 0.3, 0.82, 0.6, "#7FD0DF", 0.9) /* teal-blue, bottom-left */}
        <filter id={`f${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      {["m", "p", "y", "t"].map((n) => (
        <circle key={n} cx={32} cy={32} r={27.5} fill={`url(#${n}${id})`} />
      ))}
      <path d="M9.5 33 C9.5 21 18 11.5 29 9.5" stroke="#6F98D6" strokeOpacity=".5" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d="M54.5 33 C54 44 47 52 37 54.5" stroke="#6F98D6" strokeOpacity=".42" strokeWidth={2} fill="none" strokeLinecap="round" />
      <circle cx={32} cy={32} r={28.6} fill="none" stroke="#FFFFFF" strokeWidth={2.2} />
      <circle cx={32} cy={32} r={27.2} fill="none" stroke="#86ACE2" strokeWidth={0.9} />
      <g className="dd-shine">
        <ellipse cx={43} cy={15.5} rx={3.2} ry={2.2} transform="rotate(-20 43 15.5)" fill="#FFFFFF" opacity={0.95} />
        <path d="M43.8 19.5 C47 23.5 48.5 29.5 47.4 36" stroke="#FFFFFF" strokeOpacity=".9" strokeWidth={2.6} fill="none" strokeLinecap="round" />
      </g>
      <path d="M15 38 C23 40.5 33 38.5 41 33" stroke="#FFFFFF" strokeOpacity=".7" strokeWidth={1} fill="none" strokeLinecap="round" />
      {[[20, 22, 0.8], [24, 46, 0.7], [37, 25, 0.6], [48, 44, 0.7]].map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#FFFFFF" opacity={0.72} />
      ))}
      {icon !== "none" && (
        <>
          <g transform="translate(0 1)" opacity={0.28}>{glyph("#5470B8")}</g>   {/* soft shadow so the white reads */}
          <g filter={`url(#f${id})`} opacity={0.9}>{glyph("#FFFFFF")}</g>      {/* frosted glow */}
          <g opacity={0.82}>{glyph("#FFFFFF")}</g>                               {/* frosted white glyph */}
        </>
      )}
    </svg>
  );
}
```

Which icon: `level === "low"` → `check`, `medium` or `high` → `alert`, error/can't check → `dash`, logo → `none`. The bubble itself is never tinted by risk.

Also export the same SVG as a string helper (`bubbleSvg(size, icon)`) for `content/badge.ts`, which builds DOM without React. Make the toolbar icon PNGs (16, 32, 48, 128) from the logo bubble and add `"icons"` + `action.default_icon` to the manifest.

## Motion (`extension/src/ui/motion.css`)

```css
@keyframes dd-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes dd-shine { 0%,100% { opacity: .5 } 50% { opacity: 1 } }
@keyframes dd-grow  { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes dd-pulse { 0%,100% { box-shadow: 0 8px 22px rgba(60,72,150,.22) } 50% { box-shadow: 0 8px 30px rgba(232,106,85,.38) } }
@keyframes dd-rise  { 0% { transform: translateY(0); opacity: 0 } 20% { opacity: .9 } 100% { transform: translateY(-70px); opacity: 0 } }
@keyframes dd-sheen { from { background-position: -200px 0 } to { background-position: 200px 0 } }
@keyframes dd-in    { from { opacity: 0; transform: translateY(-6px) scale(.98) } to { opacity: 1; transform: none } }

.dd-bubble { animation: dd-float 4.5s ease-in-out infinite; overflow: visible }
.dd-bubble .dd-shine { animation: dd-shine 3s ease-in-out infinite }
.dd-card { transition: transform .2s ease, box-shadow .2s ease }
.dd-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(60,72,150,.14) }
.dd-grow { transform-origin: left center; animation: dd-grow .9s cubic-bezier(.2,.8,.2,1) both }
.dd-pulse { animation: dd-pulse 2.4s ease-in-out infinite }
.dd-rise { animation: dd-rise 3.2s ease-in infinite }
.dd-sheen { background-image: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.9), rgba(255,255,255,0)); background-size: 200px 100%; background-repeat: no-repeat; animation: dd-sheen 1.6s linear infinite }
.dd-panel { animation: dd-in .22s ease-out both }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }
```

## The pop-up shell

**Visual reference:** `docs/design/panel-reference.png` (an AI-assistant card from another product: use it for mood only, never copy its name, text or layout literally). Take these qualities from it:
- Mostly white, very calm surface; the color lives in a **soft pastel glow** (pink, butter yellow, mint, teal, lavender) blurred low in the panel, behind the content, not in the cards.
- Generous corner radius on the outer shell (try 28–32px instead of 18px) and soft, wide shadows instead of hard borders.
- Fully rounded pill chips in light gray (`rgba(42,43,58,.06)`, 13px, 600) and a pill-shaped input with a round button beside it.
- Lots of white space; one larger, lighter headline (e.g. the verdict word at 22px) with quiet gray supporting text.
To get the glow in our pop-up: add an absolutely positioned layer behind the body with 3–4 large blurred radial gradients in our bubble colors (purple `#B7A6F0`, teal-blue `#7FD0DF`, butter `#F7F1B5`, a touch of pink `#F3C6DE`) at ~35% opacity, `filter: blur(40px)`, anchored to the bottom half. Keep the cards above it frosted white so text stays readable.

- Root: `width 380px; height 600px; border-radius 18px; overflow hidden; background var(--dd-glass); backdrop-filter var(--dd-blur); -webkit-backdrop-filter var(--dd-blur); border 1px solid var(--dd-glass-edge); box-shadow var(--dd-shadow); font-family var(--dd-font); color var(--dd-ink)`; column flex; class `dd-panel`. `z-index: 2147483647`.
- Header (padding 12px 14px, bottom border `rgba(255,255,255,.7)`): `Bubble size 30`, "DealDig" (17px, 800), site pill (12px 700, `--dd-glass-chip`, e.g. "Poshmark"), close button (32×32, `aria-label="Close DealDig"`).
- Tabs: segmented control, margin `10px 14px 0`, track `rgba(255,255,255,.4)` + 1px `rgba(255,255,255,.6)` border, radius 11px, padding 3px. Tabs **Listing · Chat · Report** (real `<button role="tab">`); active = `rgba(255,255,255,.92)`, 800 weight, shadow `0 1px 3px rgba(60,72,150,.15)`. Chat shows a count pill (`--dd-accent`, white 11px) when there are chat warnings.
- Body: scrolls (`overflow: auto`), padding `10px 14px 12px`, gap 10px.
- Footer (padding 10px 14px, top border): two buttons, height 40, radius 10: secondary (`--dd-glass-card` bg, white border, `--dd-accent-ink` text) and primary (`--dd-accent` bg, white text).
- Cards: `background var(--dd-glass-card); border 1px solid rgba(255,255,255,.85); border-radius 14px`; class `dd-card`.

## Listing tab (map to `RiskReport`)

1. **Verdict card**: `Bubble size 48` (icon from level) · level word 18px 800 in that level's ink (`low` → "Low risk" `--dd-low-ink`, `medium` → "Be careful" `--dd-careful-ink`, `high` → "High risk" `--dd-high-ink`) · `score / 100` right-aligned 13px 800 same ink · `report.summary` 13px. Below: 3-segment bar (5px tall, gap 3px): the segment for the current level is solid (`--dd-low-ink` at 60% / `--dd-careful` / `--dd-high`) with class `dd-grow`; the other two are `--dd-track`.
2. **Listing card**: 42px rounded thumb (first photo, `object-fit: cover`; placeholder icon if none) · title (14px 800, one line, ellipsis) · `$price · size · @seller` (12px `--dd-muted`, seller is a link). Then neutral chips (12px 700, `--dd-glass-chip`, `--dd-ink-2`) from `sellerFacts()` + "N DealDig reports". Then the **price row** when `priceCheck` has a range: label "Price" + "usually $low–$high · **this one $price**", and a 4px track (`--dd-track`) with the typical range in `rgba(79,98,196,.35)` (`dd-grow`) and a 12px `--dd-accent` dot with 2px white border at the asking price. Scale the track from 0 to `max(high, price) * 1.3`.
3. **Watch out card**: header "Watch out" + total points. One row per signal with `points > 0`, biggest first: point tag `+15` (12px 800, `--dd-accent-wash` bg, `--dd-accent-ink`) + `signal.text` 13px. Last row is a disclosure button "✓ N good signs ⌄" that expands the `good`/`info` signals.
4. Footnote 11px centered: "Score = the points above, added up · rules + Claude · <time>" (or "rules only" when `aiUsed` is false).
5. Footer buttons: **Report seller** (opens the existing report form in the Report tab) and **Full report** (opens the side panel).

## Chat tab (only the look; behavior comes from `docs/chat-safety-task.md`)

- Summary card: `Bubble size 48 icon="alert"` + "N warning signs" (17px 800, `--dd-high-ink` if any danger, else `--dd-careful-ink`) + one-line advice.
- Row: "Chat with **Name** · item" + small segmented toggle **I'm buying / I'm selling** (12px).
- One card holding all warnings, rows split by a white 1px line. Each row: 8px severity dot (`--dd-high` for danger, `--dd-careful` for caution) · pattern name 14px 800 · "Why?" link right · reason 13px `--dd-ink-2` · quoted message 12px `--dd-muted`.
- Dashed button "Check a pasted message · Craigslist, IG, texts" (44px tall).
- Footer: **Report <name>** and **Draft a safe reply**.

## On-page badge (`content/badge.ts`)

- A pill, bottom-right (`right 20px; bottom 20px`), min-height 44px, radius 999px, padding `0 14px 0 6px`, frosted (`rgba(255,255,255,.55)` + `backdrop-filter: blur(16px) saturate(160%)`, 1px `rgba(255,255,255,.85)` border, shadow `0 8px 22px rgba(60,72,150,.22)`): 32px bubble + level word (13px 800 in level ink) + score (700, `--dd-ink-2`). High risk adds `dd-pulse`.
- On hover, show a 196px frosted card above it: 30px bubble + level + `score/100`, top reason (12px), "See details" link. Click opens the pop-up.
- Loading: 32px bubble + "Checking…" with `dd-sheen` on the label. Error: `dash` bubble + "Can't check this page".

## Inline chat chips (when chat safety lands)

- Expanded chip under the message: `rgba(248,249,253,.92)` + `backdrop-filter: blur(12px)`, 1px `#E3E6F0` border, radius 14px, shadow `0 4px 14px rgba(60,72,150,.08)`, class `dd-card`. 24px `alert` bubble · title 13px 800 in severity ink · reason 13px · divider · "why this matters" 13px · links "Hide details · Report · Not a scam".
- Compact chip: same surface as a pill (radius 999px, padding `5px 12px 5px 6px`): 22px bubble · "**Pattern** · reason" · "Why?".
- Use the site's own font for nothing; chips use `--dd-font`.

## States (inside the pop-up body)

- **Loading**: 72px floating bubble with three small rising bubbles (`dd-rise`, delays 0s / 1.1s / 2s; 10/7/5px circles, 1.5px white border, faint purple/teal/yellow fill) · "Checking this listing…" 17px 800 · "Seller, price and photos. Usually 2–4 seconds." · two `dd-sheen` skeleton lines on `--dd-track`.
- **Empty**: 80px bubble · "Open a listing or a chat" · "DealDig checks it for scam signs automatically." · neutral site chips.
- **Can't connect**: 72px `dash` bubble · "Can't reach the DealDig server" · "Chat warnings still work. Listing checks need the server running in your project folder:" · dark code chip `npm run server` · **Try again** (re-sends the last analyze request).

## Preview page (so we can see it without a marketplace)

Add `extension/src/preview/main.tsx` + `public/preview.html` (a new esbuild entry). It renders the pop-up with **mock data** for each state (low / medium / high / loading / empty / error, and the Chat tab), over a soft periwinkle backdrop (`#C3CCFB` with a few blurred shapes) so the frosting is visible, plus the badge in each state. Add a small state switcher at the top. Open it at `chrome-extension://<extension id>/preview.html`. Mock data lives in `src/preview/mocks.ts`; use made-up sellers.

## Accessibility

- Real `<button>`s, `aria-label` on icon-only buttons, `role="tablist"`/`"tab"` with `aria-selected`.
- Pop-up gets `role="dialog"`, `aria-label="DealDig"`; focus the close button when it opens; `Esc` closes; return focus to the badge.
- Text colors above pass 4.5:1 on the glass over a light page. Check the pop-up on a dark page (Facebook dark mode): if the backdrop is dark, raise `--dd-glass` to `rgba(255,255,255,.82)` (detect with `matchMedia("(prefers-color-scheme: dark)")`).
- Respect `prefers-reduced-motion` (already in `motion.css`).

## Build order (stop after each)

1. `ui/tokens.css`, `ui/motion.css`, `Bubble.tsx`, CSS text loader, font. Preview page showing just the bubble in all four icon variants at 20/30/48/80px.
2. Pop-up shell + Listing tab, rendered in the **preview page** with mock data for low/medium/high/loading/empty/error.
3. Mount it in the page from the content script (shadow root), toolbar icon + badge toggle it, real data from the store. Side panel fallback for pages without the content script.
4. New badge + hover card.
5. Chat tab look and inline chips (static mock in the preview page until chat safety is wired).
6. Polish: focus handling, dark-page check, icons in the manifest, README screenshots section.

After each phase: `npm run typecheck`, and tell me exactly what to open to see it.
