import { isMarketplacePhotoUrl } from "../../shared/photoHosts";

const MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];
export interface LoadedPhoto { index: number; media_type: MediaType; data: string }

/** Browser-resized JPEGs are preferred; URL fetches never follow redirects. */
export async function loadPhotos(urls: string[], max = 4, photoData: (string | null)[] = []) {
  const results = await Promise.all(urls.slice(0, max).map(async (url, index): Promise<LoadedPhoto | null> => {
    try {
      const supplied = photoData[index]?.match(/^data:(image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (supplied && supplied[2].length <= Math.ceil(MAX_BYTES / 3) * 4) {
        const bytes = Buffer.from(supplied[2], "base64");
        if (bytes.length && bytes.length <= MAX_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8)
          return { index, media_type: "image/jpeg", data: bytes.toString("base64") };
      }
      if (!isMarketplacePhotoUrl(url)) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
      const media_type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() as MediaType;
      if (!response.ok || !MEDIA_TYPES.includes(media_type) || Number(response.headers.get("content-length")) > MAX_BYTES) {
        await response.body?.cancel();
        return null;
      }
      if (!response.body) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      if (!size) return null;
      return { index, media_type, data: Buffer.concat(chunks).toString("base64") };
    } catch {
      return null;
    }
  }));
  const photos = results.filter((photo): photo is LoadedPhoto => photo !== null);
  const failed = results.length - photos.length;
  if (failed) console.warn(`[images] Could not load ${failed} of ${results.length} photo(s)`);
  return { photos, failed };
}
