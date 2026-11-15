// Drafted replies for the meetup helper (implementation spec §4.3).
// Claude writes the reply when a key is set; otherwise a template does.
// Either way the user edits and sends it: Second Look never sends messages.

import type { DraftReplyInput, DraftReplyResponse } from "../../shared/types";
import { aiEnabled, draftReply as draftWithClaude } from "./claude";

// Things in their message that the reply should decline (a subset of spec §4.1).
const RISKY = {
  deposit: /\b(deposit|hold(ing)? (it|fee)|reserve it)\b/i,
  payApp: /\b(zelle|cash ?app|venmo|wire|western union|gift ?cards?|crypto|bitcoin|paypal)\b/i,
  offPlatform: /\b(whats ?app|telegram|signal|text me|email me|my (number|cell))\b/i,
  code: /\b(verification|verify|6[- ]digit) code\b/i,
  shipping: /\b(ship(ping)?|courier|mover|my agent|pick ?up agent)\b/i,
};

/** Template reply. Pure, tested. */
export function templateReply(input: DraftReplyInput): string {
  const place = input.spot.name;
  const t = input.theirMessage ?? "";
  const firm = input.tone === "firm";
  const parts: string[] = [];

  if (input.role === "buyer") {
    parts.push(
      firm
        ? `I can meet at ${place} on ${input.time}.`
        : `Hi! Is ${input.time} at ${place} good for you?`,
    );
    if (RISKY.deposit.test(t) || RISKY.payApp.test(t))
      parts.push("I don't send deposits or app payments ahead of time, but I'll pay in person once I've seen it.");
    else parts.push("I'll pay in person once I've seen it.");
  } else {
    parts.push(
      firm
        ? `It's available. I can meet at ${place} on ${input.time}.`
        : `Hi! Yes, it's available. Could you meet at ${place} on ${input.time}?`,
    );
    if (RISKY.code.test(t)) parts.push("I won't share any codes, but I'm happy to meet in person.");
    if (RISKY.shipping.test(t)) parts.push("It's local pickup only, in person.");
    parts.push("I'll hand it over once the payment has come through.");
  }

  if (RISKY.offPlatform.test(t)) parts.push("Let's keep chatting here.");
  else if (!firm) parts.push("Let me know!");
  return parts.join(" ");
}

export async function draftSafeReply(input: DraftReplyInput): Promise<DraftReplyResponse> {
  if (aiEnabled()) {
    try {
      const reply = await draftWithClaude(input);
      if (reply) return { reply, aiUsed: true };
    } catch (err) {
      console.error("[reply] Claude draft failed, using template:", err);
    }
  }
  return { reply: templateReply(input), aiUsed: false };
}
