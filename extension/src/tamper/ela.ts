// Edit heatmap (error level analysis, spec §3.4), on the device.
//
// Re-save the image as a JPEG at a known quality and look at how much each
// pixel changes. Parts that went through the same saves change by about the
// same amount; a pasted-in number or a retouched area often changes more or
// less than its surroundings and stands out. It's noisy: text and sharp edges
// are always bright. So it's shown as a picture to look at, never as a verdict.

const MAX_SIDE = 1400;
const QUALITY = 0.9;
const GAIN = 18;

const toBitmap = (blob: Blob) => createImageBitmap(blob);

function draw(bitmap: ImageBitmap, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, ctx };
}

/** Returns an object URL of the heatmap PNG (revoke it when done), or null if the image can't be decoded. */
export async function errorLevelHeatmap(file: Blob): Promise<string | null> {
  let original: ImageBitmap;
  try {
    original = await toBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(original.width, original.height));
  const w = Math.max(1, Math.round(original.width * scale));
  const h = Math.max(1, Math.round(original.height * scale));

  const a = draw(original, w, h);
  original.close();
  const resaved = await toBitmap(await a.canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY }));
  const b = draw(resaved, w, h);
  resaved.close();

  const pa = a.ctx.getImageData(0, 0, w, h).data;
  const pb = b.ctx.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    const v = Math.min(255, d * GAIN);
    // Dark blue (unchanged) → yellow/white (changed a lot).
    out.data[i] = v;
    out.data[i + 1] = Math.min(255, v * 0.85);
    out.data[i + 2] = 60 + (v >> 2);
    out.data[i + 3] = 255;
  }
  const heat = new OffscreenCanvas(w, h);
  heat.getContext("2d")!.putImageData(out, 0, 0);
  return URL.createObjectURL(await heat.convertToBlob({ type: "image/png" }));
}
