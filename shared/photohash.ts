// Perceptual photo fingerprints (implementation spec §3.1).
//
// A dHash: shrink the photo to a 9×8 grid of brightness values and record, for
// each row, whether each cell is brighter than the one to its right. That's 64
// bits, written as 16 hex characters. Resizing, recompression and small color
// changes barely move it, so the same photo re-uploaded to another listing
// lands within a few bits. The extension computes it from the listing photo;
// the server only ever sees the hash.

export const HASH_W = 9;
export const HASH_H = 8;

/** Hamming distance at or below which two photos count as the same picture. */
export const MATCH_DISTANCE = 8;

/**
 * dHash from RGBA pixels (e.g. ImageData.data). The image is box-averaged down
 * to 9×8 here, so any input size works; larger inputs give steadier hashes.
 * Returns null for a flat image (blank or a solid color), which can't be matched.
 */
export function dhashFromRgba(data: ArrayLike<number>, width: number, height: number): string | null {
  const grid = new Float64Array(HASH_W * HASH_H);
  const counts = new Float64Array(HASH_W * HASH_H);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(HASH_H - 1, Math.floor((y * HASH_H) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(HASH_W - 1, Math.floor((x * HASH_W) / width));
      const i = (y * width + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      grid[gy * HASH_W + gx] += gray;
      counts[gy * HASH_W + gx] += 1;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] /= counts[i] || 1;

  let hex = "";
  let differences = 0;
  for (let y = 0; y < HASH_H; y++) {
    let byte = 0;
    for (let x = 0; x < HASH_W - 1; x++) {
      const left = grid[y * HASH_W + x];
      const right = grid[y * HASH_W + x + 1];
      if (Math.abs(left - right) > 1) differences++;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return differences < 4 ? null : hex;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/**
 * The hash of the same photo flipped left-to-right, derived from the hash
 * itself: mirroring reverses each row and swaps "brighter than its right
 * neighbour" for "darker", so each row's bits are reversed and inverted.
 * Scammers often mirror stolen photos to dodge exact-match checks.
 */
export function mirrorHash(hash: string): string {
  let out = "";
  for (let row = 0; row < 8; row++) {
    const byte = parseInt(hash.slice(row * 2, row * 2 + 2), 16);
    let rev = 0;
    for (let bit = 0; bit < 8; bit++) rev |= ((byte >> bit) & 1) << (7 - bit);
    out += (~rev & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

export const isPhotoHash = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{16}$/.test(s);

/** Free "search the web for this photo" links. The user clicks; nothing runs automatically. */
export const reverseSearchLinks = (photoUrl: string) => ({
  lens: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(photoUrl)}`,
  tineye: `https://tineye.com/search?url=${encodeURIComponent(photoUrl)}`,
});
