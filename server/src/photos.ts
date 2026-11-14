// Stolen or reused photo check (implementation spec §3.1).
//
// The extension fingerprints each listing photo (a 64-bit dHash, see
// shared/photohash.ts) and sends only the hashes. Here we compare them against
// every other listing DealDig users have checked, then store this listing's
// hashes so later checks can match against it. The index gets stronger with
// every user, like the shared blocklist.

import { hamming, isPhotoHash, MATCH_DISTANCE, mirrorHash } from "../../shared/photohash";
import type { Listing, PhotoMatch, Platform } from "../../shared/types";
import type { StoredPhoto } from "./db";

/** Match each of this listing's hashes against stored photos. Pure, tested. */
export function matchPhotos(hashes: (string | null)[], stored: StoredPhoto[]): PhotoMatch[] {
  const matches: PhotoMatch[] = [];
  const seen = new Set<string>(); // one match per (photo, other listing)
  hashes.forEach((hash, photoIndex) => {
    if (!isPhotoHash(hash)) return;
    const mirrored = mirrorHash(hash);
    for (const s of stored) {
      const direct = hamming(hash, s.hash) <= MATCH_DISTANCE;
      const isMirror = !direct && hamming(mirrored, s.hash) <= MATCH_DISTANCE;
      if (!direct && !isMirror) continue;
      const key = `${photoIndex}|${s.platform}|${s.listingId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        photoIndex,
        platform: s.platform as Platform,
        sellerId: s.sellerId,
        sellerUsername: s.sellerUsername,
        listingUrl: s.listingUrl,
        listingTitle: s.listingTitle,
        seenAt: s.seenAt.includes("T") ? s.seenAt : `${s.seenAt.replace(" ", "T")}Z`, // SQLite datetime() is UTC
        mirrored: isMirror,
      });
    }
  });
  return matches;
}

/**
 * Same seller relisting or crossposting their own photos is normal, so only
 * other sellers count. Without a seller id on either side we can't tell, so
 * those matches are left out rather than risk accusing an honest seller.
 */
export function otherSellerMatches(listing: Listing, matches: PhotoMatch[]): PhotoMatch[] {
  const me = listing.seller.id;
  const myName = listing.seller.username.trim().toLowerCase();
  return matches.filter((m) => {
    if (!me || !m.sellerId) return false;
    if (m.platform === listing.platform) return m.sellerId !== me;
    // Same handle on another site: most likely the seller crossposting.
    return !myName || m.sellerUsername.trim().toLowerCase() !== myName;
  });
}
