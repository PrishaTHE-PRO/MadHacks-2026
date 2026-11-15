// Finds faces and personal text in a photo, on this device.
//   Faces: MediaPipe BlazeFace (WASM), run on the whole photo plus overlapping
//          tiles so small faces in the background are found too.
//   Text:  Tesseract OCR (WASM); each line is checked by classifyText().
// All model files ship inside the extension; nothing is downloaded or uploaded.

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { createWorker, type Worker as OcrWorker } from "tesseract.js";
import { nms, tiles, type Box } from "./geometry";
import { groupText, type OcrWord } from "./pii";

export type RegionKind = "face" | "text" | "manual";

export interface Region extends Box {
  id: string;
  kind: RegionKind;
  label: string;
  /** Hidden in the cleaned photo when true. */
  enabled: boolean;
  text?: string;
  score?: number;
}

const asset = (path: string) => chrome.runtime.getURL(path);
let nextId = 0;
const newId = (kind: string) => `${kind}-${++nextId}`;

// ---------------------------------------------------------------- faces

const TILE_MIN_SCORE = 0.75;
let faceDetector: Promise<FaceDetector> | null = null;

function getFaceDetector(): Promise<FaceDetector> {
  faceDetector ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(asset("vendor/mediapipe"));
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: asset("models/blaze_face_short_range.tflite"), delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.55,
    });
  })();
  faceDetector.catch(() => (faceDetector = null)); // allow a retry after a failure
  return faceDetector;
}

export async function detectFaces(image: ImageBitmap): Promise<Region[]> {
  const detector = await getFaceDetector();
  const found: (Box & { score: number })[] = [];

  tiles(image.width, image.height).forEach((t, i) => {
    const canvas = new OffscreenCanvas(t.w, t.h);
    canvas.getContext("2d")!.drawImage(image, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    for (const d of detector.detect(canvas).detections) {
      const bb = d.boundingBox;
      const score = d.categories[0]?.score ?? 0;
      if (!bb || bb.width < 12 || bb.height < 12) continue;
      // Tiles cut faces in half, and half a face gives weak, misplaced hits.
      if (i > 0 && score < TILE_MIN_SCORE) continue;
      found.push({ x: t.x + bb.originX, y: t.y + bb.originY, w: bb.width, h: bb.height, score });
    }
  });

  return nms(found).map((b) => ({
    ...b,
    id: newId("face"),
    kind: "face" as const,
    label: "Face",
    enabled: true,
  }));
}

// ---------------------------------------------------------------- text

const OCR_MAX_SIDE = 2400; // bigger is slower without finding much more
let ocrWorker: Promise<OcrWorker> | null = null;

function getOcr(): Promise<OcrWorker> {
  ocrWorker ??= createWorker("eng", 1 /* LSTM only */, {
    workerPath: asset("vendor/tesseract/worker.min.js"),
    corePath: asset("vendor/tesseract-core/"),
    langPath: asset("vendor/tessdata"),
    workerBlobURL: false, // extension CSP doesn't allow blob: workers
    gzip: true,
    cacheMethod: "none", // don't keep anything in IndexedDB
  });
  ocrWorker.catch(() => (ocrWorker = null));
  return ocrWorker;
}

export async function detectText(image: ImageBitmap): Promise<Region[]> {
  const ocr = await getOcr();
  const scale = Math.min(1, OCR_MAX_SIDE / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/png" });

  const { data } = await ocr.recognize(blob, {}, { blocks: true, text: false });
  const toImage = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({
    x: b.x0 / scale,
    y: b.y0 / scale,
    w: (b.x1 - b.x0) / scale,
    h: (b.y1 - b.y0) / scale,
  });

  const lines: OcrWord[][] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines)
        lines.push(line.words.map((w) => ({ text: w.text, confidence: w.confidence, box: toImage(w.bbox) })));

  return groupText(lines).map((g) => ({
    ...g.box,
    id: newId("text"),
    kind: "text" as const,
    // Personal info is covered by default; other text is only a suggestion.
    label: g.match?.label ?? "Other text",
    enabled: Boolean(g.match),
    text: g.text,
  }));
}

export function manualRegion(box: Box): Region {
  return { ...box, id: newId("manual"), kind: "manual", label: "Your box", enabled: true };
}
