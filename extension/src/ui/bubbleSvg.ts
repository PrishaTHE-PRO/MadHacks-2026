// The DealDig bubble mark as an SVG string: the one source for the artwork.
// The React <Bubble> renders it, and the on-page badge and chat chips (plain
// DOM, no React) insert it directly. All values are our own constants, so the
// string is safe to insert as HTML.
//
// Visual reference: docs/design/bubble-reference.png. Soft pastel glows
// (purple top-left, light yellow top-right, teal-blue bottom-left, a hint of
// pink bottom-right), a light center and lower band, darker blue crescents
// inside the rim, a white outer ring with a thin blue inner ring, a dot +
// tapered highlight on the right, a sweeping streak, and a light sparkle.

export type BubbleIcon = "none" | "alert" | "check" | "dash";

const glyph = (icon: BubbleIcon, color: string) =>
  icon === "alert"
    ? `<path d="M32 21.5 v12" stroke="${color}" stroke-width="5.4" stroke-linecap="round"/><circle cx="32" cy="41.8" r="3.2" fill="${color}"/>`
    : icon === "check"
      ? `<path d="M23 32.5 l6.5 6.5 l11.5 -13" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      : icon === "dash"
        ? `<path d="M24.5 32 h15" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
        : "";

const glow = (n: string, id: string, cx: number, cy: number, r: number, c: string, o: number) =>
  `<radialGradient id="${n}${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;

// Fine sparkle texture: [cx, cy, r, opacity], denser on the left and across the middle.
const SPARKLES: [number, number, number, number][] = [
  [23.5, 15.2, 0.2, 0.56], [25.6, 10.8, 0.19, 0.52], [28.4, 47.7, 0.23, 0.6], [53.5, 35.7, 0.41, 0.37], [49.2, 21.9, 0.21, 0.47],
  [38.7, 25.9, 0.2, 0.37], [17.9, 40.7, 0.26, 0.58], [29.8, 22.4, 0.35, 0.45], [13.7, 28.1, 0.22, 0.55], [23.1, 41.4, 0.32, 0.53],
  [30.8, 39.9, 0.35, 0.61], [21.7, 26.5, 0.19, 0.53], [14.2, 19.9, 0.39, 0.38], [29.6, 34.4, 0.38, 0.7], [21.4, 27.9, 0.39, 0.73],
  [15.2, 16.5, 0.24, 0.54], [36.3, 20.6, 0.28, 0.5], [32.7, 37.6, 0.19, 0.71], [26.8, 27.2, 0.33, 0.37], [15.8, 24.3, 0.18, 0.41],
  [12.9, 25.5, 0.39, 0.6], [15.1, 20.1, 0.27, 0.4], [30.4, 31.2, 0.2, 0.49], [20.7, 47.8, 0.19, 0.73], [33.4, 15.0, 0.19, 0.56],
  [41.4, 20.5, 0.22, 0.66], [33.6, 45.4, 0.23, 0.67], [18.9, 32.8, 0.19, 0.36], [21.4, 20.4, 0.41, 0.53], [53.8, 25.5, 0.23, 0.43],
  [17.8, 38.0, 0.38, 0.54], [39.3, 46.4, 0.34, 0.71], [45.6, 44.0, 0.22, 0.67], [24.0, 46.4, 0.28, 0.51], [24.8, 34.3, 0.18, 0.74],
  [28.8, 49.8, 0.23, 0.45], [22.1, 19.5, 0.24, 0.52], [25.0, 30.0, 0.4, 0.52], [52.1, 32.1, 0.31, 0.36], [29.1, 16.8, 0.37, 0.42],
  [30.7, 42.8, 0.26, 0.56], [34.7, 45.6, 0.31, 0.45], [21.3, 45.1, 0.31, 0.65], [51.8, 29.3, 0.3, 0.55], [41.3, 29.7, 0.29, 0.73],
  [20.5, 34.9, 0.38, 0.4], [13.8, 29.2, 0.24, 0.38], [15.4, 42.4, 0.21, 0.7], [53.7, 27.1, 0.42, 0.68], [15.8, 28.7, 0.26, 0.43],
  [23.3, 42.7, 0.31, 0.53], [37.9, 32.6, 0.42, 0.67], [45.4, 21.0, 0.28, 0.71], [47.3, 20.4, 0.4, 0.58], [41.6, 12.3, 0.35, 0.52],
  [38.5, 46.5, 0.39, 0.38],
];

let counter = 0;

/**
 * @param id Unique per instance within a document or shadow root (gradient and
 *   filter ids). Defaults to a fresh counter value.
 * @param animate Adds the "dd-bubble" class (default false; the UI keeps the mark static).
 */
export function bubbleSvg(size: number, icon: BubbleIcon = "none", opts: { id?: string; animate?: boolean } = {}): string {
  const id = (opts.id ?? `b${++counter}`).replace(/[^\w-]/g, "");
  const animate = opts.animate ?? false;
  // Fine texture only where it can be seen; at icon sizes it's just noise.
  const sparkles =
    size >= 40
      ? SPARKLES.map(([cx, cy, r, o]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" opacity="${o}"/>`).join("")
      : "";
  const icons =
    icon === "none"
      ? ""
      : // soft shadow so the white reads · frosted glow · frosted white glyph
        `<g transform="translate(0 1)" opacity="0.28">${glyph(icon, "#5470B8")}</g>` +
        `<g filter="url(#f${id})" opacity="0.9">${glyph(icon, "#FFFFFF")}</g>` +
        `<g opacity="0.85">${glyph(icon, "#FFFFFF")}</g>`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"${animate ? ' class="dd-bubble"' : ""}>` +
    `<defs>` +
    // Base: a light, slightly lavender center fading to soft blue at the edge.
    `<radialGradient id="m${id}" cx=".55" cy=".45" r=".62"><stop offset="0" stop-color="#F3F4FC" stop-opacity=".92"/><stop offset=".7" stop-color="#D3E0F6" stop-opacity=".9"/><stop offset="1" stop-color="#B7CEF1" stop-opacity=".92"/></radialGradient>` +
    glow("p", id, 0.3, 0.24, 0.46, "#B6A4F1", 0.85) + // purple, top-left
    glow("y", id, 0.76, 0.3, 0.34, "#F6F0B2", 0.95) + // light yellow, top-right
    glow("t", id, 0.24, 0.8, 0.52, "#8ED5EE", 0.85) + // teal-blue, bottom-left
    glow("b", id, 0.36, 0.55, 0.32, "#9DBDEB", 0.55) + // bluer middle-left
    glow("k", id, 0.72, 0.78, 0.3, "#E7C9E8", 0.5) + // pink hint, bottom-right
    `<filter id="f${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>` +
    `<filter id="s${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>` +
    `<filter id="c${id}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".35"/></filter>` +
    `</defs>` +
    ["m", "p", "y", "t", "b", "k"].map((n) => `<circle cx="32" cy="32" r="28.1" fill="url(#${n}${id})"/>`).join("") +
    // Lighter band across the lower half (the bubble's reflection).
    `<ellipse cx="33" cy="43" rx="21" ry="8.5" fill="#FFFFFF" opacity=".2" filter="url(#s${id})"/>` +
    // Darker blue crescents inside the rim: top-left and bottom-right, tapered at the ends.
    `<g filter="url(#c${id})">` +
    `<path d="M6.37 26.55 A26.2 26.2 0 0 1 26.55 6.37 A53.8 53.8 0 0 0 6.37 26.55Z" fill="#6E96D4" opacity=".52"/>` +
    `<path d="M56.29 41.81 A26.2 26.2 0 0 1 28.35 57.95 A45.53 45.53 0 0 0 56.29 41.81Z" fill="#6E96D4" opacity=".46"/>` +
    `</g>` +
    // Rings: white outer, thin blue inner.
    // Thinner at large sizes (like the reference); thick enough to read at icon sizes.
    `<circle cx="32" cy="32" r="29.2" fill="none" stroke="#FFFFFF" stroke-width="${size >= 96 ? 1.1 : 1.7}"/>` +
    `<circle cx="32" cy="32" r="28.1" fill="none" stroke="#7FA6DE" stroke-width=".6"/>` +
    // Sweeping streak across the middle-left, and a short one top-right.
    `<path d="M8.6 35.2 C19 36.4 31 34.4 41.5 29.4 C31 35.2 19 37 8.6 35.2Z" fill="#FFFFFF" opacity=".62"/>` +
    `<path d="M50.4 26.2 L54.8 23.8" stroke="#FFFFFF" stroke-opacity=".5" stroke-width=".7" stroke-linecap="round"/>` +
    sparkles +
    // Highlight: an oval dot, then a long tapered streak curving down the right side.
    `<g class="dd-shine">` +
    `<ellipse cx="44.6" cy="17.4" rx="2.7" ry="1.85" transform="rotate(-12 44.6 17.4)" fill="#FFFFFF" opacity=".9"/>` +
    `<path d="M43.3 21.3 C47.4 25.4 48.8 32.6 45.4 42.6 C46.2 33 45.4 26.6 41.9 22.3Z" fill="#FFFFFF" opacity=".78"/>` +
    `</g>` +
    icons +
    `</svg>`
  );
}
