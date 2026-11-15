// Community reports (spec §7.1, §7.2): anonymous, one per person per seller,
// undo, 12-month window, and the 3-people-in-30-days flag.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEALDIG_DB = ":memory:";
const { addReport, communityStats, db, reporterHash, withdrawReport } = await import("../src/db");

const person = (n: number) => n.toString(16).padStart(32, "0");
const report = (who: number, category: "deposit-before-viewing" | "off-platform-payment" = "deposit-before-viewing", sellerId = "s1") =>
  addReport({ platform: "facebook", sellerId, sellerUsername: "Seller", category, reporterId: person(who), details: "typed text" });

test("one person counts once per seller, however many times they report", () => {
  report(1);
  report(1, "off-platform-payment"); // changes their reason instead of adding a report
  const c = communityStats("facebook", "s1");
  assert.equal(c.reporters, 1);
  assert.deepEqual(c.categories, [{ category: "off-platform-payment", count: 1 }]);
  assert.equal(c.flagged, false);
});

test("3 different people in 30 days flags the seller; undo takes it back", () => {
  report(2);
  report(3);
  let c = communityStats("facebook", "s1");
  assert.equal(c.reporters, 3);
  assert.equal(c.flagged, true);
  assert.deepEqual(c.categories, [
    { category: "deposit-before-viewing", count: 2 },
    { category: "off-platform-payment", count: 1 },
  ]);

  assert.equal(withdrawReport("facebook", "s1", person(3)), true);
  assert.equal(withdrawReport("facebook", "s1", person(3)), false);
  c = communityStats("facebook", "s1");
  assert.equal(c.reporters, 2);
  assert.equal(c.flagged, false);
});

test("reports older than 30 days don't flag; older than 12 months don't count", () => {
  for (const who of [10, 11, 12]) report(who, "deposit-before-viewing", "s2");
  db.prepare("UPDATE reports SET created_at = datetime('now', '-60 days') WHERE seller_id = 's2'").run();
  let c = communityStats("facebook", "s2");
  assert.equal(c.reporters, 3);
  assert.equal(c.reportersLast30Days, 0);
  assert.equal(c.flagged, false);

  db.prepare("UPDATE reports SET created_at = datetime('now', '-400 days') WHERE seller_id = 's2'").run();
  c = communityStats("facebook", "s2");
  assert.equal(c.reporters, 0);
});

test("only a salted hash of the reporter id is stored", () => {
  const rows = db.prepare("SELECT reporter_hash FROM reports WHERE seller_id = 's1'").all() as { reporter_hash: string }[];
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.reporter_hash) && r.reporter_hash !== person(1)));
  assert.equal(rows.some((r) => r.reporter_hash === reporterHash(person(1))), true);
});
