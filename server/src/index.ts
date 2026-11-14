import express from "express";
import { z } from "zod";
import { analyzeListing } from "./analyze";
import { addReport } from "./db";
import { aiEnabled } from "./claude";
import { findSpots, MeetupError } from "./meetup";
import { draftSafeReply } from "./reply";
import { PLATFORMS, type Listing } from "../../shared/types";

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
});

const ReportBody = z.object({
  platform: z.enum(PLATFORMS),
  sellerId: z.string().min(1),
  sellerUsername: z.string(),
  listingId: z.string().optional(),
  reason: z.string().trim().min(1).max(1000),
});

const SpotsBody = z
  .object({
    area: z.string().trim().max(200).default(""),
    listingLocation: z.string().trim().max(200).optional(),
    price: z.number().nonnegative().optional(),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
  })
  .refine((b) => b.area || b.listingLocation, { message: "Give an area or a listing location" });

const ReplyBody = z.object({
  listing: z.object({ title: z.string().max(300), price: z.number(), platform: z.enum(PLATFORMS) }),
  role: z.enum(["buyer", "seller"]),
  tone: z.enum(["friendly", "firm"]),
  spot: z.object({ name: z.string().min(1).max(200), address: z.string().max(300).optional() }),
  time: z.string().trim().min(1).max(100),
  theirMessage: z.string().max(2000).optional(),
  riskReasons: z.array(z.string().max(300)).max(5).optional(),
});

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
  const report = await analyzeListing(listing);
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
  res.json({ ok: true });
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

app.post("/meetup/reply", async (req, res) => {
  const parsed = ReplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  res.json(await draftSafeReply(parsed.data));
});

app.listen(PORT, () => {
  console.log(`DealDig server on http://localhost:${PORT} (Claude ${aiEnabled() ? "on" : "off: set ANTHROPIC_API_KEY"})`);
});
