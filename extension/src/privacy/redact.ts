// Draws the cleaned photo. Re-drawing the pixels onto a fresh canvas and
// saving a new JPEG drops ALL metadata (EXIF, GPS, XMP, IPTC, the hidden
// preview), because none of it is copied over.
//
// How regions are hidden matters. Plain blur and small-block pixelation can be
// partly reversed (tools like Depix rebuild pixelated text), so:
//   text  → covered with a solid box: nothing of the original is left
//   faces → shrunk to an 8×8 grid of colors with random noise added, then
//           smoothed: no detail survives that a model could rebuild a face from

import { pad, type Box } from "./geometry";
import type { Region } from "./detect";

const FACE_GRID = 8;
const NOISE = 28; // ± per color channel

function hideFace(ctx: OffscreenCanvasRenderingContext2D, b: Box) {
  const small = new OffscreenCanvas(FACE_GRID, FACE_GRID);
  const sctx = small.getContext("2d")!;
  sctx.drawImage(ctx.canvas, b.x, b.y, b.w, b.h, 0, 0, FACE_GRID, FACE_GRID);

  const px = sctx.getImageData(0, 0, FACE_GRID, FACE_GRID);
  const rand = new Uint8Array(px.data.length);
  crypto.getRandomValues(rand);
  for (let i = 0; i < px.data.length; i++) {
    if (i % 4 === 3) continue; // alpha
    px.data[i] = Math.max(0, Math.min(255, px.data[i] + ((rand[i] / 255) * 2 - 1) * NOISE));
  }
  sctx.putImageData(px, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `blur(${Math.max(2, Math.round(Math.max(b.w, b.h) / 40))}px)`;
  ctx.drawImage(small, b.x, b.y, b.w, b.h);
  ctx.restore();
}

function hideText(ctx: OffscreenCanvasRenderingContext2D, b: Box) {
  ctx.save();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.12);
  ctx.fill();
  ctx.restore();
}

export async function renderClean(image: ImageBitmap, regions: Region[], quality = 0.92): Promise<Blob> {
  const { width, height } = image;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);

  for (const r of regions) {
    if (!r.enabled) continue;
    if (r.kind === "face") hideFace(ctx, pad(r, 0.2, width, height));
    else hideText(ctx, pad(r, 0.08, width, height));
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}
