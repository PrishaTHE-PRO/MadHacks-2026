import express from "express";
import { z } from "zod";
import { analyzeListing } from "./analyze";
import { addReport, communityStats, withdrawReport } from "./db";
import { aiEnabled } from "./claude";
import { findSpots, MeetupError } from "./meetup";
import { PLATFORMS, REPORT_CATEGORIES, type Listing, type ReportCategory, type ReportResponse } from "../../shared/types";
import { isPhotoHash } from "../../shared/photohash";

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "1mb" }));

// Light validation: enough to reject junk, loose enough that adapters can add fields.
const ListingBody = z.object({
  listing: z
    .object({
      platform: z.enum(PLATFORMS),
      id: z.string().min(1),
      url: z.string(),
      title: z.string(),
      price: z.number(),
      photos: z.array(z.string()),
      // Some pages (e.g. Facebook before the seller card loads) don't show a seller id.
      seller: z.object({ id: z.string(), username: z.string() }).loose(),
    })
    .loose(),
  /** dHash per photo (same order as listing.photos), null where the extension couldn't read it. */
  photoHashes: z.array(z.string().refine(isPhotoHash).nullable()).max(20).optional(),
});

// The device's random reporter id: 128+ bits as hex, never tied to an account.
const ReporterId = z.string().regex(/^[0-9a-f]{32,64}$/);

const ReportBody = z.object({
  platform: z.enum(PLATFORMS),
  sellerId: z.string().min(1).max(200),
  sellerUsername: z.string().max(200),
  listingId: z.string().max(200).optional(),
  category: z.enum(Object.keys(REPORT_CATEGORIES) as [ReportCategory, ...ReportCategory[]]),
  details: z.string().trim().max(1000).optional(),
  reporterId: ReporterId,
});

const WithdrawBody = z.object({
  platform: z.enum(PLATFORMS),
  sellerId: z.string().min(1).max(200),
  reporterId: ReporterId,
});

const SpotsBody = z
  .object({
    area: z.string().trim().max(200).default(""),
    listingLocation: z.string().trim().max(200).optional(),
    price: z.number().nonnegative().optional(),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
  })
  .refine((b) => b.area || b.listingLocation, { message: "Give an area or a listing location" });

app.get("/health", (_req, res) => {
  res.json({ ok: true, ai: aiEnabled() });
});

app.post("/analyze-listing", async (req, res) => {
  const parsed = ListingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing", issues: parsed.error.issues });
    return;
  }
  const listing = parsed.data.listing as unknown as Listing;
  const started = Date.now();
  const report = await analyzeListing(listing, parsed.data.photoHashes);
  console.log(`[analyze] ${listing.platform}/${listing.id} → ${report.score} (${report.level}) in ${Date.now() - started}ms`);
  res.json(report);
});

app.post("/report", (req, res) => {
  const parsed = ReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report", issues: parsed.error.issues });
    return;
  }
  addReport(parsed.data);
  res.json({ ok: true, community: communityStats(parsed.data.platform, parsed.data.sellerId) } satisfies ReportResponse);
});

// Undo: the reporter changed their mind or reported the wrong seller.
app.delete("/report", (req, res) => {
  const parsed = WithdrawBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const { platform, sellerId, reporterId } = parsed.data;
  withdrawReport(platform, sellerId, reporterId);
  res.json({ ok: true, community: communityStats(platform, sellerId) } satisfies ReportResponse);
});

app.post("/meetup/spots", async (req, res) => {
  const parsed = SpotsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  try {
    res.json(await findSpots(parsed.data));
  } catch (err) {
    if (err instanceof MeetupError) res.status(422).json({ error: err.message });
    else {
      console.error("[meetup] spots failed:", err);
      res.status(500).json({ error: "Couldn't look up meeting spots." });
    }
  }
});

app.listen(PORT, () => {
  console.log(`DealDig server on http://localhost:${PORT} (Claude ${aiEnabled() ? "on" : "off: set ANTHROPIC_API_KEY"})`);
});
