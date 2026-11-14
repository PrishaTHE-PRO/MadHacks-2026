// SQLite (built into Node) for the shared blocklist, check history and the
// shared photo fingerprint index.
// The file lives in server/data/ and is git-ignored.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ScamReportInput } from "../../shared/types";

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const db = new DatabaseSync(fileURLToPath(new URL("../data/dealdig.db", import.meta.url)));

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    seller_username TEXT NOT NULL,
    listing_id TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS reports_seller ON reports (platform, seller_id);

  CREATE TABLE IF NOT EXISTS listing_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    level TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per listing photo: its 64-bit dHash (16 hex chars), never the photo itself.
  CREATE TABLE IF NOT EXISTS photo_hashes (
    platform TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    photo_index INTEGER NOT NULL,
    hash TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    seller_username TEXT NOT NULL,
    listing_url TEXT NOT NULL,
    listing_title TEXT NOT NULL,
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (platform, listing_id, photo_index)
  );
`);

export interface StoredPhoto {
  platform: string;
  listingId: string;
  photoIndex: number;
  hash: string;
  sellerId: string;
  sellerUsername: string;
  listingUrl: string;
  listingTitle: string;
  seenAt: string;
}

/**
 * Every stored photo except the given listing's own. Matching is a Hamming
 * distance scan in JS, which is fine up to a few hundred thousand photos;
 * past that, bucket hashes (e.g. by 16-bit chunks) before scanning.
 */
export function otherListingPhotos(platform: string, listingId: string): StoredPhoto[] {
  return db
    .prepare(
      `SELECT platform, listing_id AS listingId, photo_index AS photoIndex, hash, seller_id AS sellerId,
              seller_username AS sellerUsername, listing_url AS listingUrl, listing_title AS listingTitle,
              seen_at AS seenAt
       FROM photo_hashes WHERE NOT (platform = ? AND listing_id = ?)`,
    )
    .all(platform, listingId) as unknown as StoredPhoto[];
}

export function savePhotoHashes(
  listing: { platform: string; id: string; url: string; title: string; sellerId: string; sellerUsername: string },
  hashes: (string | null)[],
) {
  const upsert = db.prepare(
    `INSERT INTO photo_hashes (platform, listing_id, photo_index, hash, seller_id, seller_username, listing_url, listing_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (platform, listing_id, photo_index) DO UPDATE SET
       hash = excluded.hash, seller_id = excluded.seller_id, seller_username = excluded.seller_username,
       listing_url = excluded.listing_url, listing_title = excluded.listing_title, seen_at = datetime('now')`,
  );
  hashes.forEach((hash, i) => {
    if (hash)
      upsert.run(listing.platform, listing.id, i, hash, listing.sellerId, listing.sellerUsername, listing.url, listing.title.slice(0, 200));
  });
}

export function addReport(r: ScamReportInput) {
  db.prepare(
    "INSERT INTO reports (platform, seller_id, seller_username, listing_id, reason) VALUES (?, ?, ?, ?, ?)",
  ).run(r.platform, r.sellerId, r.sellerUsername, r.listingId ?? null, r.reason);
}

export function countReports(platform: string, sellerId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE platform = ? AND seller_id = ?")
    .get(platform, sellerId) as { n: number };
  return row.n;
}

/** Total reports, and reports in the last 30 days (for the blocklist rule). */
export function communityStats(platform: string, sellerId: string): { reports: number; reportsLast30Days: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS recent
       FROM reports WHERE platform = ? AND seller_id = ?`,
    )
    .get(platform, sellerId) as { total: number; recent: number | null };
  return { reports: row.total, reportsLast30Days: row.recent ?? 0 };
}

export function recentReports(platform: string, sellerId: string, limit = 5): string[] {
  return (
    db
      .prepare("SELECT reason FROM reports WHERE platform = ? AND seller_id = ? ORDER BY id DESC LIMIT ?")
      .all(platform, sellerId, limit) as { reason: string }[]
  ).map((r) => r.reason);
}

export function saveCheck(platform: string, listingId: string, sellerId: string, score: number, level: string) {
  db.prepare("INSERT INTO listing_checks (platform, listing_id, seller_id, score, level) VALUES (?, ?, ?, ?, ?)").run(
    platform,
    listingId,
    sellerId,
    score,
    level,
  );
}
