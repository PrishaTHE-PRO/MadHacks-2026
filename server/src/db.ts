// SQLite (built into Node) for community reports, check history and the
// shared photo fingerprint index.
// The file lives in server/data/ and is git-ignored.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPORT_CATEGORIES, type CommunityInfo, type ReportCategory, type ScamReportInput } from "../../shared/types";

/** 3+ different people reporting a seller in 30 days flags them for other buyers. A warning, not a block. */
export const COMMUNITY_FLAG_REPORTERS = 3;

// DEALDIG_DB=":memory:" gives tests a throwaway database.
const DB_PATH = process.env.DEALDIG_DB ?? fileURLToPath(new URL("../data/dealdig.db", import.meta.url));
if (DB_PATH !== ":memory:") mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

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

// Older databases: add the anonymous reporter and category columns.
const reportColumns = (db.prepare("PRAGMA table_info(reports)").all() as { name: string }[]).map((c) => c.name);
if (!reportColumns.includes("reporter_hash")) db.exec("ALTER TABLE reports ADD COLUMN reporter_hash TEXT");
if (!reportColumns.includes("category")) db.exec("ALTER TABLE reports ADD COLUMN category TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS reports_one_per_reporter ON reports (platform, seller_id, reporter_hash)");

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

// --- Community reports ---------------------------------------------------
// Anonymous: the extension sends a random id made on the device, and we store
// only a salted hash of it, so a report can't be traced back to a person but
// one person counts once per seller. Reports older than 12 months stop
// counting (spec §7.1). Details text is kept for moderation only: it is never
// shown to other users or sent to the AI.

const REPORT_WINDOW = "-365 days";
const REPORTER_SALT = process.env.REPORTER_SALT ?? "dealdig-reporter-v1";

export const reporterHash = (reporterId: string) =>
  createHash("sha256").update(`${REPORTER_SALT}:${reporterId}`).digest("hex");

/** Add or update this person's report about the seller. */
export function addReport(r: ScamReportInput) {
  db.prepare(
    `INSERT INTO reports (platform, seller_id, seller_username, listing_id, reason, category, reporter_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (platform, seller_id, reporter_hash) DO UPDATE SET
       seller_username = excluded.seller_username, listing_id = excluded.listing_id, reason = excluded.reason,
       category = excluded.category, created_at = datetime('now')`,
  ).run(r.platform, r.sellerId, r.sellerUsername, r.listingId ?? null, r.details ?? "", r.category, reporterHash(r.reporterId));
}

/** Undo: remove this person's report about the seller. Returns true if there was one. */
export function withdrawReport(platform: string, sellerId: string, reporterId: string): boolean {
  return (
    db.prepare("DELETE FROM reports WHERE platform = ? AND seller_id = ? AND reporter_hash = ?").run(platform, sellerId, reporterHash(reporterId))
      .changes > 0
  );
}

// Reports from before reporter ids existed each count as their own person.
const WHO = "COALESCE(reporter_hash, 'legacy:' || id)";

export function communityStats(platform: string, sellerId: string): CommunityInfo {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT ${WHO}) AS total,
              COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN ${WHO} END) AS recent
       FROM reports WHERE platform = ? AND seller_id = ? AND created_at >= datetime('now', '${REPORT_WINDOW}')`,
    )
    .get(platform, sellerId) as { total: number; recent: number };
  const categories = (
    db
      .prepare(
        `SELECT COALESCE(category, 'other') AS category, COUNT(DISTINCT ${WHO}) AS count
         FROM reports WHERE platform = ? AND seller_id = ? AND created_at >= datetime('now', '${REPORT_WINDOW}')
         GROUP BY 1 ORDER BY count DESC, category`,
      )
      .all(platform, sellerId) as { category: string; count: number }[]
  ).map((c) => ({ category: (c.category in REPORT_CATEGORIES ? c.category : "other") as ReportCategory, count: c.count }));
  return {
    reporters: row.total,
    reportersLast30Days: row.recent,
    flagged: row.recent >= COMMUNITY_FLAG_REPORTERS,
    categories,
  };
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
