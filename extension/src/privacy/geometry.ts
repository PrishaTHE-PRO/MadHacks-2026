// Box math for photo redaction. Pure functions, tested in Node.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** How much of `inner` lies inside `outer` (0-1). */
export function containment(inner: Box, outer: Box): number {
  const x0 = Math.max(inner.x, outer.x);
  const y0 = Math.max(inner.y, outer.y);
  const x1 = Math.min(inner.x + inner.w, outer.x + outer.w);
  const y1 = Math.min(inner.y + inner.h, outer.y + outer.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return area(inner) > 0 ? inter / area(inner) : 0;
}

/**
 * Non-maximum suppression: keep the highest-scoring box out of each group of
 * overlapping detections (the same face found in several tiles).
 */
export function nms<T extends Box & { score: number }>(boxes: T[], threshold = 0.3): T[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const b of sorted) {
    if (kept.every((k) => iou(k, b) < threshold && containment(b, k) < 0.4 && containment(k, b) < 0.4)) kept.push(b);
  }
  return kept;
}

/**
 * Face detection models look at a small, downscaled copy of the whole image,
 * so small faces (a reflection in a mirror, a person in the background) get
 * missed. We also scan overlapping tiles so each face is big enough to find.
 */
export function tiles(width: number, height: number, grid = 3, overlap = 0.25): Box[] {
  const out: Box[] = [{ x: 0, y: 0, w: width, h: height }];
  if (Math.max(width, height) < 800) return out;
  const tw = width / (grid - (grid - 1) * overlap);
  const th = height / (grid - (grid - 1) * overlap);
  const stepX = tw * (1 - overlap);
  const stepY = th * (1 - overlap);
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      out.push({
        x: Math.round(c * stepX),
        y: Math.round(r * stepY),
        w: Math.round(Math.min(tw, width - c * stepX)),
        h: Math.round(Math.min(th, height - r * stepY)),
      });
    }
  }
  return out;
}

/** Grow a box by `frac` on every side, clamped to the image. */
export function pad(b: Box, frac: number, width: number, height: number): Box {
  const dx = b.w * frac;
  const dy = b.h * frac;
  const x = Math.max(0, b.x - dx);
  const y = Math.max(0, b.y - dy);
  return {
    x,
    y,
    w: Math.min(width, b.x + b.w + dx) - x,
    h: Math.min(height, b.y + b.h + dy) - y,
  };
}

/** Box from two drag points, normalized so w/h are positive. */
export function fromPoints(x0: number, y0: number, x1: number, y1: number): Box {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Merge word boxes on the same line into one box. */
export function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
