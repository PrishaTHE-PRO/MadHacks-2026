// Chat safety check (docs/chat-safety-task.md, spec §4.1).
//
//   1. prefilter: the shared regex patterns. Authoritative and always on.
//   2. classifyChat: Claude Haiku 5.5 looks for what the regexes missed.
//   3. merge: regex flags are kept as-is; Claude's flags are only added for
//      known patterns on real messages, and never against my own messages
//      except the two "protect me" patterns.
//
// Privacy: phone numbers, emails and long numbers are redacted before the
// chat goes to Claude, chat text is never stored, and only counts and pattern
// ids are logged.

import {
  CHAT_PATTERN_BY_ID,
  PROTECT_ME_PATTERNS,
  appliesTo,
  prefilter,
} from "../../shared/chatPatterns";
import { PLATFORMS, type ChatContext, type ChatFlag, type ChatReport, type Platform, type Severity } from "../../shared/types";
import { aiEnabled, classifyChat, type ChatInputMessage } from "./claude";
import { communityStats } from "./db";
import { demoMode, demoRecord, demoReplay } from "./demoCache";

const RANK: Record<Severity, number> = { good: 0, info: 1, caution: 2, danger: 3 };
const MAX_REASON_WORDS = 20;

// Same shapes the regex library treats as phone numbers and emails, plus any
// run of 6+ digits (card numbers, codes, account numbers).
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}/gi;
const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const LONG_NUMBER = /\d[\d\s-]{4,}\d/g;

/** Replace contact details and long numbers before text leaves the server. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(LONG_NUMBER, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m));
}

const clipWords = (s: string, n: number) => {
  const words = s.trim().split(/\s+/);
  return words.length <= n ? s.trim() : `${words.slice(0, n).join(" ")}…`;
};

export async function analyzeChat(ctx: ChatContext): Promise<ChatReport> {
  const regexFlags = prefilter(ctx);
  const flags: ChatFlag[] = [...regexFlags];
  let aiUsed = false;

  if ((aiEnabled() || demoMode()) && ctx.messages.length > 0) {
    // Short ids for the model; map back to the real message ids afterwards.
    const byShortId = new Map(ctx.messages.map((m, i) => [String(i + 1), m]));
    const shortIdOf = new Map(ctx.messages.map((m, i) => [m.id, String(i + 1)]));
    const input: ChatInputMessage[] = ctx.messages.map((m, i) => ({
      id: String(i + 1),
      from_me: m.fromMe,
      text: redact(m.text),
    }));

    try {
      // DEMO_MODE: cached results for the demo script, recorded from live calls.
      let aiFlags = demoMode() ? demoReplay(input) : null;
      if (!aiFlags && aiEnabled()) {
        aiFlags = await classifyChat(
          ctx,
          input,
          regexFlags.map((f) => ({ pattern: f.pattern, message_id: shortIdOf.get(f.messageId) ?? "" })),
        );
        if (aiFlags && demoMode()) demoRecord(input, aiFlags);
      }
      if (aiFlags) {
        aiUsed = true;
        const seen = new Set(flags.map((f) => `${f.pattern}:${f.messageId}`));
        for (const f of aiFlags) {
          const msg = byShortId.get(f.message_id);
          if (!msg) continue; // not a real message
          const pattern = CHAT_PATTERN_BY_ID[f.pattern];
          if (msg.fromMe ? !PROTECT_ME_PATTERNS.includes(f.pattern) : !appliesTo(pattern, ctx.role)) continue;
          const key = `${f.pattern}:${msg.id}`;
          if (seen.has(key)) continue; // regex flag wins
          seen.add(key);
          // Claude can't go above what the pattern allows on this platform
          // (pressure tops out at caution).
          const ceiling =
            f.pattern === "urgency_pressure" ? "caution" : (pattern.severityFor?.(msg.text, ctx.platform) ?? pattern.severity);
          const severity = RANK[f.severity] > RANK[ceiling] ? ceiling : f.severity;
          const reason = f.reason.trim() ? clipWords(f.reason, MAX_REASON_WORDS) : pattern.reason;
          flags.push({ pattern: f.pattern, severity, reason, messageId: msg.id, source: "ai" });
        }
      }
    } catch (err) {
      console.warn("[chat] AI check failed, returning regex flags only:", err instanceof Error ? err.message : err);
    }
  }

  // Keep the feed in message order.
  const order = new Map(ctx.messages.map((m, i) => [m.id, i]));
  flags.sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0));

  const report: ChatReport = {
    threadId: ctx.threadId,
    platform: ctx.platform,
    flags,
    aiUsed,
    checkedAt: new Date().toISOString(),
  };
  const otherId = ctx.otherParty?.id;
  if (otherId && (PLATFORMS as readonly string[]).includes(ctx.platform)) {
    // Distinct people who reported them (main's anonymous reports, last 12 months).
    report.communityReports = communityStats(ctx.platform as Platform, otherId).reporters;
  }
  return report;
}
