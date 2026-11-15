// Reads every kind of metadata a photo can carry (EXIF, GPS, XMP, IPTC, PNG
// chunks, the embedded preview) without uploading it anywhere.

import exifr from "exifr";
import { summarizeMetadata, type MetadataSummary } from "./summarize";

export interface MetadataReport extends MetadataSummary {
  /** Object URL of the hidden preview image, if the photo has one. */
  thumbnailUrl: string | null;
}

type Input = Blob | ArrayBuffer | Uint8Array;

export async function inspectMetadata(file: Input): Promise<MetadataReport> {
  const [segments, gps, thumb] = await Promise.all([
    exifr
      .parse(file, {
        tiff: true,
        ifd1: true,
        exif: true,
        gps: true,
        interop: true,
        xmp: true,
        iptc: true,
        ihdr: true,
        icc: false, // color profiles, not personal
        jfif: false,
        makerNote: false,
        userComment: true,
        mergeOutput: false,
        translateValues: true,
        reviveValues: true,
      })
      .catch(() => null),
    exifr.gps(file).catch(() => null),
    exifr.thumbnail(file).catch(() => undefined),
  ]);

  const hasThumbnail = Boolean(thumb && thumb.byteLength > 0);
  const summary = summarizeMetadata(segments, gps, hasThumbnail);
  const thumbnailUrl =
    hasThumbnail && typeof URL !== "undefined" && typeof Blob !== "undefined"
      ? URL.createObjectURL(new Blob([thumb as BlobPart], { type: "image/jpeg" }))
      : null;
  return { ...summary, thumbnailUrl };
}
