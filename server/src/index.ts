import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { analyzeListing, listingPlan } from "./analyze";
import { addReport, communityStats, purgeOldListingTexts, withdrawReport } from "./db";
import { aiEnabled } from "./claude";
import { analyzeChat } from "./chat";
import { findSpots, MeetupError } from "./meetup";
import { draftSafeReply } from "./reply";
import { checkDestination } from "./links";
import { BlockedUrlError } from "./netGuard";
import { detonate, DetonationBusy, DetonationUnavailable } from "./detonate";
import {
  CHAT_PLATFORMS,
  PLATFORMS,
  REPORT_CATEGORIES,
  type ChatContext,
  type Listing,
  type ListingProgress,
  type ReportCategory,
  type ReportResponse,
} from "../../shared/types";
import { isPhotoHash } from "../../shared/photohash";

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "8mb" }));

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
  /** Small JPEG copies of the first photos, for Claude to look at (never stored). */
  photoData: z.array(z.string().max(1500000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).nullable()).max(4).optional(),
  /** The user's choices for this check. Photos go to outside services only with webPhotos: true. */
  options: z.object({ webPhotos: z.boolean().optional() }).optional(),
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

const ReplyBody = z.object({
  listing: z.object({ title: z.string().max(300), price: z.number(), platform: z.enum(PLATFORMS) }),
  role: z.enum(["buyer", "seller"]),
  tone: z.enum(["friendly", "firm"]),
  spot: z.object({ name: z.string().min(1).max(200), address: z.string().max(300).optional() }),
  time: z.string().trim().min(1).max(100),
  theirMessage: z.string().max(2000).optional(),
  riskReasons: z.array(z.string().max(300)).max(5).optional(),
});

const ChatBody = z.object({
  ctx: z.object({
    platform: z.enum(CHAT_PLATFORMS),
    threadId: z.string().min(1).max(500),
    url: z.string().max(2000),
    role: z.enum(["buyer", "seller", "unknown"]).default("unknown"),
    otherParty: z
      .object({
        id: z.string().max(200).optional(),
        username: z.string().max(200).optional(),
        profileUrl: z.string().max(2000).optional(),
      })
      .optional(),
    listing: z
      .object({
        title: z.string().max(500).optional(),
        price: z.number().optional(),
        url: z.string().max(2000).optional(),
      })
      .optional(),
    messages: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          fromMe: z.boolean(),
          author: z.string().max(200).optional(),
          text: z.string().max(2000),
          sentAt: z.string().max(100).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
});

// Link guard: should the extension stop this page before it loads?
// Only links opened from a marketplace tab or chat are sent here.
const CheckUrlBody = z.object({ url: z.string().trim().min(4).max(2000).regex(/^https?:\/\//i) });

app.post("/check-url", async (req, res) => {
  const parsed = CheckUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid URL", issues: parsed.error.issues });
    return;
  }
  const verdict = await checkDestination(parsed.data.url);
  console.log(`[guard] ${verdict.domain} → ${verdict.verdict}`); // the domain only, never the full link
  res.json(verdict);
});

// Safe URL detonation: open a link in the server's throwaway headless browser
// and report what it does, so the user never loads it. Only sent when the user
// asks ("Preview safely"). Private and internal addresses are refused.
app.post("/detonate", async (req, res) => {
  const parsed = CheckUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid URL", issues: parsed.error.issues });
    return;
  }
  try {
    const report = await detonate(parsed.data.url);
    console.log(`[detonate] ${report.domain} → ${report.verdict} in ${report.tookMs} ms`); // domain only
    res.json(report);
  } catch (err) {
    if (err instanceof BlockedUrlError) res.status(422).json({ error: err.message });
    else if (err instanceof DetonationBusy) res.status(429).json({ error: err.message });
    else if (err instanceof DetonationUnavailable) res.status(503).json({ error: err.message });
    else {
      console.error("[detonate] failed:", err);
      res.status(500).json({ error: "Couldn't open that link safely." });
    }
  }
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
  const photoHashes = parsed.data.photoHashes;
  // Requests without options (older extensions) don't send photos out either.
  const opts = { webPhotos: parsed.data.options?.webPhotos === true };
  // Never log which listing was checked: the platform and result are enough to debug.
  const log = (score: number, level: string) =>
    console.log(`[analyze] ${listing.platform} → ${score} (${level}) in ${Date.now() - started}ms`);

  // ?progress=1: stream newline-delimited JSON (plan, each step, then the report)
  // so the extension can show which stage is running. Otherwise, plain JSON.
  if (req.query.progress === "1") {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const send = (line: ListingProgress) => res.write(`${JSON.stringify(line)}\n`);
    send({ plan: listingPlan(opts) });
    try {
      const report = await analyzeListing(listing, photoHashes, (step) => send({ step }), opts, parsed.data.photoData);
      log(report.score, report.level);
      send({ report });
    } catch (err) {
      console.error("[analyze] failed:", err);
      send({ error: "The check failed on the server." });
    }
    res.end();
    return;
  }

  const report = await analyzeListing(listing, photoHashes, undefined, opts, parsed.data.photoData);
  log(report.score, report.level);
  res.json(report);
});

app.post("/analyze-chat", async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chat", issues: parsed.error.issues });
    return;
  }
  const ctx: ChatContext = parsed.data.ctx;
  const started = Date.now();
  const report = await analyzeChat(ctx);
  // Counts and pattern ids only: chat text is never logged or stored.
  const patterns = report.flags.map((f) => `${f.pattern}${f.source === "ai" ? "*" : ""}`).join(",") || "none";
  console.log(
    `[chat] ${ctx.platform} ${ctx.messages.length} msgs → ${report.flags.length} flags [${patterns}]${
      report.aiUsed ? " (+AI)" : ""
    } in ${Date.now() - started}ms`,
  );
  res.json(report);
});

// The demo chat page (extension/demo/chat.html); the extension's demo adapter reads it.
const DEMO_CHAT = fileURLToPath(new URL("../../extension/demo/chat.html", import.meta.url));
app.get("/demo/chat", (_req, res) => res.sendFile(DEMO_CHAT));
// A made-up fishy invoice for the demo chat (extension/demo/make-fake-invoice.py).
const DEMO_INVOICE = fileURLToPath(new URL("../../extension/demo/fake-invoice.jpg", import.meta.url));
app.get("/demo/fake-invoice.jpg", (_req, res) => res.sendFile(DEMO_INVOICE));

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

app.post("/meetup/reply", async (req, res) => {
  const parsed = ReplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  res.json(await draftSafeReply(parsed.data));
});

// Listing descriptions are kept only for the copied-text check, and not forever.
purgeOldListingTexts();
setInterval(purgeOldListingTexts, 24 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Second Look server on http://localhost:${PORT} (Claude ${aiEnabled() ? "on" : "off: set ANTHROPIC_API_KEY"})`);
});
