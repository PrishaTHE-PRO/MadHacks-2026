// SQLite (built into Node) for the shared blocklist and check history.
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
`);

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
