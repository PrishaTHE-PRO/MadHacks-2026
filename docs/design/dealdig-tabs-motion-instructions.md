# DealDig tab animation: implementation instructions

Give your IDE this file along with `dealdig-tabs-demo.html`. The demo is a working reference built to match the current DealDig side panel. The motion is adapted from a reference video of a "hump" tab bar. These instructions keep that video's structure and timing, and fit them to DealDig's light top row of pill tabs.

## Scope

- Change **only** the tab row (Listing · Chat · Check image · Report) and the content area under it.
- Keep the current look **at rest**: a light grey pill (`#f0f1f3`) behind the active tab, active text `#20232f`, inactive text `#5c606f`, 15px medium text, 32px tall pills, 4px gap between tabs.
- Every change is motion. After the animation finishes, the screen should look exactly like it does today.

## The idea: four overlapping steps

The reference feels bouncy and fluid because each step starts before the previous one ends. Each step also uses a strong ease-out with a long, soft settle. Here is how each step maps onto DealDig:

| Reference video | DealDig version |
|---|---|
| The old circle darkens into the bar and disappears | The old pill **tucks in** (shrinks 3px top and bottom, 7px left and right) and fades out. Its text turns grey |
| The hump slides to the new tab | A soft **iridescent glow** (the orb logo's colors) slides behind the tabs from the old tab to the new one. It's only visible while moving |
| A dot appears, sparkles, then grows into the circle and rises | The new pill **blooms from an 8px dot** at the label's center, with 3 tiny iridescent sparkles. It grows into the full pill and rises 3px into place. While growing, it's **iridescent**, then it fades to the normal grey |
| The icon draws itself inside the circle | The label dims, then its letters do a quick **staggered wave**: each one dips 3px and springs back, left to right, as it darkens to ink |

## Timeline (ms after click)

| Step | Start → end | Easing | Details |
|---|---|---|---|
| Old pill tucks out | 0 → 200 | `cubic-bezier(.4,0,1,1)` | `clip-path: inset(0 round 999px)` → `inset(3px 7px round 999px)`, opacity 1 → 0 |
| Old label turns grey | 0 → 200 | linear | color `#20232f` → `#5c606f` |
| New label dims | 0 → 150 | linear | opacity 1 → .35, holds until 300, back to 1 by 520 |
| Glow travels | 50 → 630 | `cubic-bezier(.65,0,.35,1)` | translateX from the old tab's center to the new tab's center. Opacity 0 → .85 (at 25%) → .6 (at 70%) → 0 |
| Seed dot + sparkles | 150 → 300 | ease-out | pill clipped to an 8–10px circle at the label's center. 3 dots (3px; colors `#b9a9f5`, `#8fb6ee`, `#e9cf6b`) drift 9–14px outward and fade |
| **Pill blooms** | 150 → 560 | `cubic-bezier(.22,.9,.3,1)` | `clip-path: inset(calc(50% - 4px) calc(50% - 4px) round 999px)` → `inset(0 0 round 999px)`, translateY 3px → 0. Hold the dot size for the first ~12% |
| Iridescent sheen fades | 300 → 630 | linear | the gradient overlay inside the pill goes opacity 1 → 0, leaving the grey pill |
| Letter wave | 240 + i×18 → +380 | `cubic-bezier(.3,.7,.3,1)` | each character: translateY 0 → 3px (at 35%) → 0. `i` = character index |
| Content swaps | old out 0 → 120, new in 220 → 560 | out linear, in `cubic-bezier(.22,.9,.3,1)` | old view: opacity 1 → 0. New view: opacity 0 → 1, translateY 6px → 0 |

The whole switch takes about 630ms, the same as the reference.

Iridescent gradient (taken from the orb logo):

```css
--iri: linear-gradient(115deg, #d8d0fb 0%, #c3d6f6 38%, #f6efc6 68%, #f5d5ea 100%);
```

## How to build it

1. **Tab markup.** Each tab is a `<button role="tab">` containing:
   - `.pill`: absolute, `inset: 0`, `border-radius: 999px`, background `#f0f1f3`, `overflow: hidden`, `opacity: 0` unless active. Inside it is `.sheen`, an absolute layer with the `--iri` gradient.
   - `.label` (`aria-hidden="true"`, `white-space: pre`), with each character wrapped in `<span style="--i:N">` and set to `display: inline-block`.
   - A visually hidden span with the tab name, so screen readers read "Check image" and not letter by letter.
   - 3 `.spark` spans.
2. **Glow.** Add one `.glow` element in the tab row, behind the buttons: 46×32px, `border-radius: 50%`, `background: var(--iri)`, `filter: blur(9px)`, `pointer-events: none`. Move it with the Web Animations API (`el.animate(...)`), because its start and end positions change on every click. Compute each position as `tab.offsetLeft + tab.offsetWidth / 2`.
3. **State classes.** On select, add `.off` to the previous tab and `.on` to the new one. All CSS keyframes hang off those classes. **Restart** each class on every click (remove it, force a reflow with `void el.offsetWidth`, then add it back), so fast clicks always replay cleanly. In React, you can get the same effect by keying the pill element on a selection counter.
4. **Different pill widths.** "Check image" is about twice as wide as "Chat". The `clip-path` bloom handles any width without stretching the corners. **Don't** use `transform: scale` to grow the pill, because it squashes the rounded ends.
5. **Content panel.** Keep each tab's view mounted but `hidden`. Fade the outgoing view out and slide the incoming one up, using the timings above. Guard the "hide old view" callback, so a quick double-switch doesn't hide the view the user just came back to.
6. **First render.** Show the default tab without any animation.

## Accessibility (required)

- Use `role="tablist"` on the row, `role="tab"`, `aria-selected` and `aria-controls` on each tab, and `role="tabpanel"` with `aria-labelledby` on each view.
- Left/Right arrow keys move between tabs and select them. Only the active tab has `tabIndex=0`.
- Show a visible focus ring (`outline: 2px solid #8a90f0; outline-offset: 2px`).
- `prefers-reduced-motion: reduce`: no glow, no letter wave, no tuck. The pill just fades in over 150ms and the content swaps instantly.

## Tuning knobs

- **More bounce:** change the bloom easing to `cubic-bezier(.34,1.45,.64,1)`. Keep `clip-path` from going past `inset(0)`. If you want visible overshoot, add a 1.03 → 1 `scale` on the `.label` instead.
- **Calmer:** remove the sparkles and cut the glow's peak opacity to .5.
- **Never** give the glow an overshooting easing. A traveller that overshoots reads as a bug.

## Done when

- At rest, the panel matches the current screenshot pixel for pixel.
- Clicking Listing → Check image → Report → Chat looks like `dealdig-tabs-demo.html`.
- Clicking two tabs within 150ms of each other leaves exactly one pill visible, with nothing stuck halfway through its animation.
- Keyboard arrows work, and with reduced motion turned on, switching tabs is a plain quick fade.
