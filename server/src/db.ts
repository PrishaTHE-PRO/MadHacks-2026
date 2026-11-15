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

  -- Each checked listing's description (public text), so later checks can
  -- spot the same text under another seller. One row per listing.
  CREATE TABLE IF NOT EXISTS listing_texts (
    platform TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    seller_username TEXT NOT NULL,
    listing_url TEXT NOT NULL,
    listing_title TEXT NOT NULL,
    text TEXT NOT NULL,
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (platform, listing_id)
  );

  -- Results of paid lookups (reverse image search, web text search, AI
  -- detector), so re-checking a listing doesn't pay twice.
  CREATE TABLE IF NOT EXISTS web_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

/** The seller of a listing DealDig has already checked, found by its URL. */
export function knownListingByUrl(url: string): { platform: string; sellerId: string; sellerUsername: string } | null {
  const clean = url.split(/[?#]/)[0].replace(/\/$/, "");
  const row = db
    .prepare(
      `SELECT platform, seller_id AS sellerId, seller_username AS sellerUsername FROM photo_hashes
       WHERE listing_url = ? OR listing_url = ? LIMIT 1`,
    )
    .get(clean, `${clean}/`) as { platform: string; sellerId: string; sellerUsername: string } | undefined;
  if (row) return row;
  return (
    (db
      .prepare(
        `SELECT platform, seller_id AS sellerId, seller_username AS sellerUsername FROM listing_texts
         WHERE listing_url = ? OR listing_url = ? LIMIT 1`,
      )
      .get(clean, `${clean}/`) as { platform: string; sellerId: string; sellerUsername: string } | undefined) ?? null
  );
}

export interface StoredText {
  platform: string;
  listingId: string;
  sellerId: string;
  sellerUsername: string;
  listingUrl: string;
  listingTitle: string;
  text: string;
}

/** Every stored description except this listing's own. Scanned in JS, like photos. */
export function otherListingTexts(platform: string, listingId: string): StoredText[] {
  return db
    .prepare(
      `SELECT platform, listing_id AS listingId, seller_id AS sellerId, seller_username AS sellerUsername,
              listing_url AS listingUrl, listing_title AS listingTitle, text
       FROM listing_texts WHERE NOT (platform = ? AND listing_id = ?)`,
    )
    .all(platform, listingId) as unknown as StoredText[];
}

export function saveListingText(listing: {
  platform: string;
  id: string;
  url: string;
  title: string;
  sellerId: string;
  sellerUsername: string;
  text: string;
}) {
  if (!listing.text.trim()) return;
  db.prepare(
    `INSERT INTO listing_texts (platform, listing_id, seller_id, seller_username, listing_url, listing_title, text)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (platform, listing_id) DO UPDATE SET
       seller_id = excluded.seller_id, seller_username = excluded.seller_username, listing_url = excluded.listing_url,
       listing_title = excluded.listing_title, text = excluded.text, seen_at = datetime('now')`,
  ).run(listing.platform, listing.id, listing.sellerId, listing.sellerUsername, listing.url, listing.title.slice(0, 200), listing.text.slice(0, 5000));
}

/** Days a listing's description stays in the copied-text index (design doc 1.3). */
export const LISTING_TEXT_DAYS = Number(process.env.DEALDIG_TEXT_DAYS ?? 30);

/** Drop descriptions older than LISTING_TEXT_DAYS. Returns how many were removed. */
export function purgeOldListingTexts(): number {
  return db.prepare(`DELETE FROM listing_texts WHERE seen_at < datetime('now', ?)`).run(`-${LISTING_TEXT_DAYS} days`).changes as number;
}

const CACHE_DAYS = 7;

/** A cached lookup result, or undefined when missing or older than a week. */
export function cacheGet<T>(key: string): T | undefined {
  const row = db
    .prepare(`SELECT value FROM web_cache WHERE key = ? AND created_at >= datetime('now', '-${CACHE_DAYS} days')`)
    .get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function cacheSet(key: string, value: unknown) {
  db.prepare(
    `INSERT INTO web_cache (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, created_at = datetime('now')`,
  ).run(key, JSON.stringify(value));
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
