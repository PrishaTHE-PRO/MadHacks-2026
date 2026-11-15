// The DealDig bubble mark as an SVG string: the one source for the artwork.
// The React <Bubble> renders it, and the on-page badge and chat chips (plain
// DOM, no React) insert it directly. All values are our own constants, so the
// string is safe to insert as HTML.

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

let counter = 0;

/**
 * @param id Unique per instance within a document or shadow root (gradient and
 *   filter ids). Defaults to a fresh counter value.
 * @param animate Adds the "dd-bubble" class (default false; the UI keeps the mark static).
 */
export function bubbleSvg(size: number, icon: BubbleIcon = "none", opts: { id?: string; animate?: boolean } = {}): string {
  const id = (opts.id ?? `b${++counter}`).replace(/[^\w-]/g, "");
  const animate = opts.animate ?? false;
  const dots = [
    [20, 22, 0.8],
    [24, 46, 0.7],
    [37, 25, 0.6],
    [48, 44, 0.7],
  ]
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" opacity="0.72"/>`)
    .join("");
  const icons =
    icon === "none"
      ? ""
      : // soft shadow so the white reads · frosted glow · frosted white glyph
        `<g transform="translate(0 1)" opacity="0.28">${glyph(icon, "#5470B8")}</g>` +
        `<g filter="url(#f${id})" opacity="0.9">${glyph(icon, "#FFFFFF")}</g>` +
        `<g opacity="0.82">${glyph(icon, "#FFFFFF")}</g>`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"${animate ? ' class="dd-bubble"' : ""}>` +
    `<defs>` +
    `<radialGradient id="m${id}" cx=".5" cy=".55" r=".62"><stop offset="0" stop-color="#C9DDF6" stop-opacity=".95"/><stop offset="1" stop-color="#EDF2FD" stop-opacity=".8"/></radialGradient>` +
    glow("p", id, 0.27, 0.28, 0.52, "#B7A6F0", 0.95) + // purple, top-left
    glow("y", id, 0.78, 0.26, 0.44, "#F7F1B5", 0.95) + // light yellow, top-right
    glow("t", id, 0.3, 0.82, 0.6, "#7FD0DF", 0.9) + // teal-blue, bottom-left
    `<filter id="f${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>` +
    `</defs>` +
    ["m", "p", "y", "t"].map((n) => `<circle cx="32" cy="32" r="27.5" fill="url(#${n}${id})"/>`).join("") +
    `<path d="M9.5 33 C9.5 21 18 11.5 29 9.5" stroke="#6F98D6" stroke-opacity=".5" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    `<path d="M54.5 33 C54 44 47 52 37 54.5" stroke="#6F98D6" stroke-opacity=".42" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="32" cy="32" r="28.6" fill="none" stroke="#FFFFFF" stroke-width="2.2"/>` +
    `<circle cx="32" cy="32" r="27.2" fill="none" stroke="#86ACE2" stroke-width="0.9"/>` +
    `<g class="dd-shine"><ellipse cx="43" cy="15.5" rx="3.2" ry="2.2" transform="rotate(-20 43 15.5)" fill="#FFFFFF" opacity="0.95"/>` +
    `<path d="M43.8 19.5 C47 23.5 48.5 29.5 47.4 36" stroke="#FFFFFF" stroke-opacity=".9" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>` +
    `<path d="M15 38 C23 40.5 33 38.5 41 33" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="1" fill="none" stroke-linecap="round"/>` +
    dots +
    icons +
    `</svg>`
  );
}
