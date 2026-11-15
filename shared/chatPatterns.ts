// Chat scam patterns (docs/chat-safety-task.md, spec §4.1).
//
// One source of truth for pattern ids, severities and the one-line reasons,
// shared by the extension (instant regex warnings) and the server (the
// authoritative regex flags that Claude's findings are merged into).
//
// Pure TypeScript: no DOM, no Node APIs, so both bundles can import it.
// When unsure, a pattern is amber (caution) rather than red: false alarms on
// honest people are a real harm.

import type { ChatContext, ChatFlag, ChatMessage, ChatPatternId, ChatPlatform, Severity } from "./types";

// --- Off-platform regexes, shared with the listing check (server/src/rules.ts) ---

/** Paying outside the platform. */
export const OFF_PLATFORM_PAYMENT: RegExp[] = [
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bcash ?app\b/i,
  /\bpaypal\b/i,
  /\bf\s?&\s?f\b|friends (and|&) family/i,
  /\bgift ?cards?\b/i,
  /\bwire transfer\b|\bwestern union\b/i,
];

/** Talking outside the platform. */
export const OFF_PLATFORM_CONTACT: RegExp[] = [
  /\bwhats ?app\b/i,
  /\btelegram\b/i,
  /\b(text|call|email|dm) me\b/i,
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/, // phone number
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email address
  /\b(ig|insta(gram)?)\s*[:@]/i,
];

/** Everything the listing check treats as "off-platform" (payment or contact). */
export const OFF_PLATFORM: RegExp[] = [...OFF_PLATFORM_PAYMENT, ...OFF_PLATFORM_CONTACT];

// --- Payment methods, split by how risky they are ---

/** Reversible-ish or commonly used for local pickup. */
const SOFT_PAYMENT = /\bvenmo\b|\bpaypal\b/i;
/** Can't be reversed, or a known scam rail. Friends & Family is checked here so "PayPal F&F" counts as hard. */
const HARD_PAYMENT: RegExp[] = [
  /\bzelle\b/i,
  /\bcash ?app\b/i,
  /\bf\s?&\s?f\b|friends (and|&) family/i,
  /\bgift ?cards?\b|\b(apple|google play|steam|amazon|itunes) cards?\b/i,
  /\bwire (transfer|me|the money|it|the deposit)\b|\bbank wire\b|\bwestern union\b|\bmoney ?gram\b/i,
  /\b(bitcoin|btc|crypto(currency)?|usdt|tether|ethereum)\b/i,
];

/** Sites with their own checkout and buyer protection: any off-platform payment voids it. */
const PROTECTED_CHECKOUT: ChatPlatform[] = ["poshmark", "ebay", "etsy", "depop"];
/** Sites where deals are usually local pickup, so shipping-only requests are odd. */
const LOCAL_DEALS: ChatPlatform[] = ["facebook", "generic"];

// --- Links ---

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"')]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|ly|me|app|link|xyz|info|top|site|online|shop|gl|cc|to|us|gd|at|click|live)(?:\/[^\s<>"')]*)?(?![\w@])/gi;

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "rb.gy", "cutt.ly", "shorturl.at", "tiny.cc", "buff.ly", "rebrand.ly"];

/** Domains that are fine to link to from a marketplace chat. */
const PLATFORM_DOMAINS: Record<ChatPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me", "messenger.com"],
  poshmark: ["poshmark.com", "posh.mk"],
  ebay: ["ebay.com"],
  etsy: ["etsy.com", "etsy.me"],
  depop: ["depop.com"],
  mercari: ["mercari.com"],
  generic: [],
};
const MARKETPLACE_DOMAINS = [...new Set(Object.values(PLATFORM_DOMAINS).flat()), "craigslist.org"];

const hostOf = (raw: string) => {
  const s = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return s.split(/[/?#:]/)[0].toLowerCase().replace(/\.+$/, "");
};
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Links in the text that point off the marketplace (or through a URL shortener). */
export function suspiciousLinks(text: string, platform: ChatPlatform): string[] {
  // A link to any known marketplace is fine in the paste box; elsewhere only the current site's.
  const allowed = platform === "generic" ? MARKETPLACE_DOMAINS : PLATFORM_DOMAINS[platform];
  return (text.match(URL_RE) ?? []).filter((url) => {
    const host = hostOf(url);
    if (SHORTENERS.some((d) => onDomain(host, d))) return true;
    return !allowed.some((d) => onDomain(host, d));
  });
}

// --- Pattern table ---

export type ChatTarget = "buyer" | "seller" | "both";

export interface ChatPattern {
  id: ChatPatternId;
  /** Short name for the side panel feed. */
  name: string;
  targets: ChatTarget;
  severity: Severity;
  /** Fixed one-line reason. Regex flags always use this text. */
  reason: string;
  /** One extra tip for the "Why?" button. */
  tip: string;
  /** Messages from the other party. Any match raises the flag. */
  regexes: RegExp[];
  /** Like `regexes`, but only on sites where deals are local (see LOCAL_DEALS). */
  localOnly?: RegExp[];
  /** Extra checks that need more than one regex. */
  test?: (text: string, platform: ChatPlatform) => boolean;
  /** Per-platform (and per-match) severity. Defaults to `severity`. */
  severityFor?: (text: string, platform: ChatPlatform) => Severity;
  /** "Protect me" patterns: my own messages that match raise `selfReason`. */
  self?: { regexes: RegExp[]; reason: string };
}

/** Same sentence, within `gap` characters. Keeps two-part triggers from matching across a whole chat. */
const near = (a: string, b: string, gap = 40) =>
  new RegExp(`\\b(?:${a})\\b[^.!?\\n]{0,${gap}}?\\b(?:${b})\\b`, "i");

/** Asking for money now (narrower than "pay", which also covers "pay cash when you pick it up"). */
const MONEY_NOW = "deposit|zelle|venmo|cash ?app|paypal|wire|send (me )?(the )?(money|\\d+)";

export const CHAT_PATTERNS: ChatPattern[] = [
  {
    id: "deposit_before_viewing",
    name: "Deposit before viewing",
    targets: "buyer",
    severity: "danger",
    reason: "Asking for money before you've seen the item or place is the most common rental and big-item scam.",
    tip: "Only pay once you've seen it in person, and never for a key or a hold by mail.",
    regexes: [
      near("send|wire|transfer|zelle|venmo|cash ?app", "deposit|holding fee"),
      near("deposit|holding fee", "hold|reserve|secure|save|before|first|upfront|up front"),
      near("hold|reserve|save", MONEY_NOW), // "I'll hold it if you Zelle me..."
      /\bfirst month'?s?( rent)?\s*(\+|and|&|plus)\s*(last|deposit|security)/i,
    ],
    // "I'm out of town" / "can't show it" only counts together with a money ask.
    test: (text) =>
      /\b(out of (town|the country|state)|traveling|travelling|can'?t (show|meet|do a (viewing|tour)))\b/i.test(text) &&
      new RegExp(`\\b(${MONEY_NOW})\\b`, "i").test(text),
  },
  {
    id: "overpayment_refund",
    name: "Overpayment + refund",
    targets: "seller",
    severity: "danger",
    reason: "They paid more than asked and want the difference back; the original payment will likely be reversed.",
    tip: "Never refund an overpayment. Cancel the deal and let the payment app reverse it.",
    regexes: [
      near("accidentally|mistakenly|by mistake|wrongly", "sent|paid|transferred|overpaid", 30),
      // Money words only: "I sent extra photos" is fine.
      /\b(sent|paid|transferred)\b[^.!?\n]{0,30}(\btoo much\b|\bmore than\b|\binstead of\b|\bby mistake\b|\baccidentally\b|\bextra \$?\d)/i,
      near("refund|send back|give back|pay back", "difference|extra|excess|balance|rest|remaining", 30),
      /\boverpa(id|y|yment)\b/i,
    ],
  },
  {
    id: "off_platform",
    name: "Move off-platform",
    targets: "both",
    severity: "caution",
    reason: "Moving the chat off the platform removes its buyer and seller protection and is common before a scam.",
    tip: "Keep talking in the site's own chat so there's a record if something goes wrong.",
    regexes: [...OFF_PLATFORM_CONTACT, /\bsignal\s+(me|app)\b|\bkik\b|\bsnap(chat)?\s*[:@]/i],
  },
  {
    id: "verification_code",
    name: "Verification code request",
    targets: "seller",
    severity: "danger",
    reason: "Never share a code sent to your phone; it's used to take over your accounts (Google Voice scam).",
    tip: "No real buyer needs a code from your phone. If you already sent one, change that account's password now.",
    regexes: [
      near("verification|verify|confirmation|security|google( voice)?|\\d[- ]?digit|six[- ]digit|one[- ]time|otp", "code", 30),
      // Not "a code": buyers ask Etsy/Depop sellers for discount codes.
      near("send|give|tell|read|share|forward", "the code|that code|your code", 20),
      /\bcode\b[^.!?\n]{0,30}\b(you (got|received|get|will get)|(sent|texted) (to )?you)\b/i,
    ],
    self: {
      reason: "You're about to share a verification code. Never send it; it's used to take over your accounts.",
      regexes: [
        /\b(the|my|your) (verification |security )?code (is|was)\b/i,
        /\bhere'?s the code\b/i,
        /(?<!\b(zip|postal|promo|discount|coupon|area) )\bcode\s*[:=]?\s*\d{4,8}\b/i,
        /^\s*G-\d{6}\b/, // Google Voice format
        /^\s*\d{6}\s*$/, // a bare 6-digit message
      ],
    },
  },
  {
    id: "fake_payment_notice",
    name: "Fake payment confirmation",
    targets: "seller",
    severity: "danger",
    reason: 'Payment apps don\'t email you to "release" funds; check the app itself before you hand anything over.',
    tip: "Open the payment app directly (not a link) and confirm the money is in your balance.",
    regexes: [
      // Not "what's your PayPal email?", which honest buyers ask.
      near("zelle|venmo|paypal|cash ?app|bank", "emailed you|sent you an? (email|notification|confirmation)|(confirmation|notification) email", 40),
      near("pending|on hold|held|frozen|released?", "until you|once you|after you|when you", 40),
      near("check your (email|inbox|spam)", "payment|zelle|paypal|venmo|money|funds|sent", 40),
      /\bupgrade (your|to a) (business|premium) account\b/i,
    ],
  },
  {
    id: "shipping_agent",
    name: "Shipping-only / agent pickup",
    targets: "both",
    severity: "caution",
    reason: "A courier or shipping-only request for a local item is a common setup for overpayment fraud.",
    tip: "For local items, insist on meeting in person and paying on the spot.",
    regexes: [
      // "my/our": on shipping sites "the courier will pick it up" can just mean UPS.
      /\b(my|our) (mover|movers|courier|shipping agent|pickup agent|agent|shipper|delivery (guy|person|service))\b[^.!?\n]{0,40}\b(pick|collect|come|get|grab)/i,
      /\b(pay|cover)\b[^.!?\n]{0,20}\b(mover|movers|courier|agent|shipper)'?s?\b[^.!?\n]{0,10}\b(fees?|costs?|charges?)\b/i,
      /\b(pay|cover) (the |his |their )?(extra )?(for )?(his|their|the) (fee|fees)\b/i,
    ],
    localOnly: [
      /\b(i'?m|i am|currently|we'?re)\s+(overseas|abroad|out of the country|offshore|deployed|on (a |an )?(ship|oil rig))\b/i,
      /\b(ship|mail|send) it to (me|my)\b/i,
    ],
  },
  {
    id: "unprotected_payment",
    name: "Unprotected payment method",
    targets: "buyer",
    severity: "caution",
    reason: "This payment method can't be reversed; use cash in person or the platform's checkout.",
    tip: "Pay with cash when you meet, or through the site's checkout so you're covered if it never arrives.",
    regexes: [SOFT_PAYMENT, ...HARD_PAYMENT],
    severityFor: (text, platform) => {
      const hard = HARD_PAYMENT.some((re) => re.test(text));
      // Protected checkouts (Poshmark, eBay, Etsy, Depop) themselves accept PayPal
      // or Venmo, so a bare mention there is only amber; anything else is red.
      if (PROTECTED_CHECKOUT.includes(platform)) return hard ? "danger" : "caution";
      // Facebook local pickup: Venmo / PayPal goods-and-services are normal-ish.
      if (platform === "facebook" && !hard) return "info";
      return "caution";
    },
  },
  {
    id: "urgency_pressure",
    name: "Urgency / pressure",
    targets: "both",
    severity: "info", // raised to caution when the same message has another warning sign
    reason: "Pressure to decide fast is a manipulation tactic; a real deal will wait an hour.",
    tip: "Take your time. If they won't wait an hour, walk away.",
    regexes: [
      /\b(answer|decide|decision|respond|reply|pay|payment|confirm|deposit)\b[^.!?\n]{0,25}\b(within|in the next|in)\s+\d+\s*(min(ute)?s?|hrs?|hours?)\b/i,
      /\b(other|another|many|lots of|several|\d+)\s+(buyers?|people|persons)\b[^.!?\n]{0,30}\b(waiting|interested|lined up|asking|want it)\b/i,
      /\b(pay|deposit|transfer|zelle|venmo|decide)\b[^.!?\n]{0,20}\b(right now|now|asap|immediately|urgent(ly)?)\b/i,
      /\b(last chance|going fast|won'?t last|act fast|today only)\b/i,
    ],
  },
  {
    id: "suspicious_link",
    name: "Suspicious link",
    targets: "both",
    severity: "danger",
    reason: "Links outside the marketplace can steal your login or card details.",
    tip: "Don't click it. Open the site or payment app yourself instead.",
    regexes: [
      /\b(fill (out|in)|complete|click|open|submit)\b[^.!?\n]{0,30}\b(form|link|page)\b[^.!?\n]{0,40}\b(paid|payment|receive|claim|release|money|funds)\b/i,
    ],
    test: (text, platform) => suspiciousLinks(text, platform).length > 0,
  },
  {
    id: "personal_info_request",
    name: "Personal info request",
    targets: "both",
    severity: "caution",
    reason: "They're asking for more personal info than this deal needs.",
    tip: "A deal only needs a meeting spot or a shipping address through checkout. Don't share IDs or account details.",
    regexes: [
      /\b(ssn|social security( number)?)\b/i,
      /\b(bank|banking)\s+(login|log-in|username|password|credentials|pin)\b/i,
      /\b(photo|picture|pic|copy|scan|image)\s+of\s+(your|ur)\s+(id|license|licence|passport|driver'?s licen[cs]e|(credit |debit )?card)\b/i,
      /\b(your|ur) (home )?address\b[^.!?\n]{0,30}\b(verify|confirm|first|before)\b/i,
      /\b(your|ur) home address\b/i,
      /\b(mother'?s maiden name|date of birth|card number|cvv|cvc|security code on)\b/i,
    ],
    self: {
      reason: "You're about to share sensitive personal info this deal doesn't need.",
      regexes: [
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN format
        /\bmy (ssn|social security( number)?|bank (login|password|pin)|password|cvv|card number)\b/i,
        /\b(here'?s|attached|sending|sent you) (a )?(photo|pic|picture|copy|scan) of my (id|license|licence|passport|driver'?s licen[cs]e)\b/i,
      ],
    },
  },
];

export const CHAT_PATTERN_BY_ID = Object.fromEntries(CHAT_PATTERNS.map((p) => [p.id, p])) as Record<
  ChatPatternId,
  ChatPattern
>;

/** Does this pattern apply given which side the user is on? Unknown role: every pattern applies. */
export const appliesTo = (p: ChatPattern, role: ChatContext["role"]) =>
  role === "unknown" || p.targets === "both" || p.targets === role;

/** Patterns that may flag my own messages ("You're about to share..."). */
export const PROTECT_ME_PATTERNS = CHAT_PATTERNS.filter((p) => p.self).map((p) => p.id);

function matchesOther(p: ChatPattern, text: string, platform: ChatPlatform): boolean {
  if (p.regexes.some((re) => re.test(text))) return true;
  if (p.localOnly && LOCAL_DEALS.includes(platform) && p.localOnly.some((re) => re.test(text))) return true;
  return p.test?.(text, platform) ?? false;
}

/** Flags for one message. */
function flagMessage(msg: ChatMessage, ctx: ChatContext): ChatFlag[] {
  const flags: ChatFlag[] = [];
  for (const p of CHAT_PATTERNS) {
    if (msg.fromMe) {
      // My own messages never raise a flag against the other person,
      // only the "protect me" warnings before I send something.
      if (p.self?.regexes.some((re) => re.test(msg.text)))
        flags.push({ pattern: p.id, severity: p.severity, reason: p.self.reason, messageId: msg.id, source: "rules" });
      continue;
    }
    if (!appliesTo(p, ctx.role) || !matchesOther(p, msg.text, ctx.platform)) continue;
    const severity = p.severityFor?.(msg.text, ctx.platform) ?? p.severity;
    flags.push({ pattern: p.id, severity, reason: p.reason, messageId: msg.id, source: "rules" });
  }
  // Pressure on its own is just info; next to another warning sign it's amber.
  const urgency = flags.find((f) => f.pattern === "urgency_pressure");
  if (urgency && flags.some((f) => f.pattern !== "urgency_pressure" && f.severity !== "info"))
    urgency.severity = "caution";
  return flags;
}

/**
 * The instant regex check. Runs over messages from the other party (and my
 * own messages for the "protect me" patterns), one flag per pattern per
 * message, in message order.
 */
export function prefilter(ctx: ChatContext): ChatFlag[] {
  const seen = new Set<string>();
  const out: ChatFlag[] = [];
  for (const msg of ctx.messages) {
    for (const flag of flagMessage(msg, ctx)) {
      const key = `${flag.pattern}:${flag.messageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(flag);
    }
  }
  return out;
}
