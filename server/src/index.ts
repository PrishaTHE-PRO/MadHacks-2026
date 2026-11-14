import express from "express";
import { z } from "zod";
import { analyzeListing } from "./analyze";
import { addReport } from "./db";
import { aiEnabled } from "./claude";
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

app.listen(PORT, () => {
  console.log(`DealDig server on http://localhost:${PORT} (Claude ${aiEnabled() ? "on" : "off: set ANTHROPIC_API_KEY"})`);
});
