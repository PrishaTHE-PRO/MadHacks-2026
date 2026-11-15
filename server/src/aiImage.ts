// "Is this photo AI-generated?" Three sources, any of which can raise it:
//   1. Claude's look at the photos (part of the listing analysis): visible tells
//   2. an AI-image detector, when configured (Sightengine's genai model,
//      SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET)
//   3. the reverse image search finding the photo on an AI-art site
// None of this changes the score. Detectors get it wrong both ways, so we show
// the user what we found and let them decide.

import type { AiImageCheck, EvidenceLink, Listing, WebPhotoMatch } from "../../shared/types";
import { cacheGet, cacheSet } from "./db";

export const DETECTOR_PHOTOS = 2;
/** Detector score at or above which a photo is "likely" AI-generated. */
export const DETECTOR_LIKELY = 0.9;
/** ...and "possible". */
export const DETECTOR_POSSIBLE = 0.6;

export const aiDetectorEnabled = () => Boolean(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);

/** Sightengine's probability (0-1) that the image is AI-generated. Cached for a week. */
export async function detectorScore(photoUrl: string): Promise<number | null> {
  const key = `genai:${photoUrl}`;
  const cached = cacheGet<number>(key);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    url: photoUrl,
    models: "genai",
    api_user: process.env.SIGHTENGINE_API_USER ?? "",
    api_secret: process.env.SIGHTENGINE_API_SECRET ?? "",
  });
  const res = await fetch(`https://api.sightengine.com/1.0/check.json?${params}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Sightengine ${res.status}`);
  const json = (await res.json()) as { status?: string; type?: { ai_generated?: number }; error?: { message?: string } };
  if (json.status !== "success" || typeof json.type?.ai_generated !== "number")
    throw new Error(`Sightengine: ${json.error?.message ?? "no score"}`);
  cacheSet(key, json.type.ai_generated);
  return json.type.ai_generated;
}

export interface ClaudeAiPhotoView {
  verdict: "likely" | "possible" | "no";
  photo_numbers: number[];
  evidence: string[];
}

/** Combine the three sources into one notice, or undefined when nothing points to AI. Pure, tested. */
export function combineAiImage(
  listing: Listing,
  claude: ClaudeAiPhotoView | undefined,
  detector: (number | null)[],
  webMatches: WebPhotoMatch[],
): AiImageCheck | undefined {
  let likely = false;
  const photos = new Set<number>();
  const evidence: string[] = [];
  const links: EvidenceLink[] = [];

  detector.forEach((p, i) => {
    if (p === null || p < DETECTOR_POSSIBLE) return;
    photos.add(i);
    if (p >= DETECTOR_LIKELY) likely = true;
    evidence.push(`Photo ${i + 1}: an AI-image detector rates it ${Math.round(p * 100)}% likely AI-generated.`);
  });

  for (const m of webMatches.filter((w) => w.kind === "ai-art")) {
    photos.add(m.photoIndex);
    likely = true;
    evidence.push(`Photo ${m.photoIndex + 1} also appears on ${m.siteName}, a site for AI-generated images.`);
    links.push({ label: `Photo ${m.photoIndex + 1} on ${m.siteName}`, url: m.pageUrl });
  }

  if (claude && claude.verdict !== "no") {
    const valid = claude.photo_numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= listing.photos.length);
    valid.forEach((n) => photos.add(n - 1));
    if (claude.verdict === "likely") likely = true;
    evidence.push(...claude.evidence.slice(0, 4).map((e) => e.trim()).filter(Boolean));
  }

  if (!evidence.length) return undefined;
  return { verdict: likely ? "likely" : "possible", photoIndexes: [...photos].sort((a, b) => a - b), evidence, links };
}

/** One line for the summary writer. */
export function aiImageNote(check: AiImageCheck | undefined): string | undefined {
  if (!check) return undefined;
  const which = check.photoIndexes.length ? `Photo ${check.photoIndexes.map((i) => i + 1).join(", ")}` : "A photo";
  return `${which} ${check.verdict === "likely" ? "looks" : "may be"} AI-generated: ${check.evidence[0]}`;
}
