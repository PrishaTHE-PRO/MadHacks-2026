import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { analyzeListing, listingPlan } from "./analyze";
import { addReport } from "./db";
import { aiEnabled } from "./claude";
import { analyzeChat } from "./chat";
import { CHAT_PLATFORMS, PLATFORMS, type ChatContext, type Listing, type ListingProgress } from "../../shared/types";

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
  const log = (score: number, level: string) =>
    console.log(`[analyze] ${listing.platform}/${listing.id} → ${score} (${level}) in ${Date.now() - started}ms`);

  // ?progress=1: stream newline-delimited JSON (plan, each step, then the report)
  // so the extension can show which stage is running. Otherwise, plain JSON.
  if (req.query.progress === "1") {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const send = (line: ListingProgress) => res.write(`${JSON.stringify(line)}\n`);
    send({ plan: listingPlan() });
    try {
      const report = await analyzeListing(listing, (step) => send({ step }));
      log(report.score, report.level);
      send({ report });
    } catch (err) {
      console.error("[analyze] failed:", err);
      send({ error: "The check failed on the server." });
    }
    res.end();
    return;
  }

  const report = await analyzeListing(listing);
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
