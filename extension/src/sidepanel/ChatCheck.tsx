// "Check a message" paste box (docs/chat-safety-task.md, Phase 3).
// For chats DealDig can't read itself: Craigslist email, Instagram DMs, texts.
// Regex warnings show instantly; the server's answer (regex + Claude) replaces
// them when it arrives. If the server is down, the regex warnings stay.

import { useState } from "react";
import { SERVER_URL } from "../config";
import { prefilter } from "../../../shared/chatPatterns";
import { FlagFeed } from "./FlagFeed";
import {
  CHAT_PLATFORMS,
  PLATFORM_NAMES,
  type ChatContext,
  type ChatFlag,
  type ChatPlatform,
  type ChatReport,
  type ChatRole,
} from "../../../shared/types";

const MAX_MESSAGES = 10;
const MAX_CHARS = 2000;
const SERVER_TIMEOUT_MS = 20_000;

const PLATFORM_LABEL = (p: ChatPlatform) =>
  p === "generic" ? "Other (Craigslist, Instagram, text, email)" : PLATFORM_NAMES[p];

export const ROLES: { value: ChatRole; label: string }[] = [
  { value: "buyer", label: "I'm buying" },
  { value: "seller", label: "I'm selling" },
  { value: "unknown", label: "Not sure" },
];

type Result = {
  ctx: ChatContext;
  flags: ChatFlag[];
  status: "checking" | "done" | "offline";
  aiUsed: boolean;
};

/** Each blank-line-separated block is one message from the other person; keep the last 10. */
function toContext(text: string, platform: ChatPlatform, role: ChatRole): ChatContext {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(-MAX_MESSAGES);
  return {
    platform,
    threadId: `paste-${Date.now()}`,
    url: "",
    role,
    messages: blocks.map((b, i) => ({ id: `p${i + 1}`, fromMe: false, text: b.slice(0, MAX_CHARS) })),
  };
}

export function ChatCheck({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<ChatPlatform>("generic");
  const [role, setRole] = useState<ChatRole>("unknown");
  const [result, setResult] = useState<Result | null>(null);

  // Changing the inputs makes the old result stale.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setResult(null);
  };

  const check = async () => {
    const ctx = toContext(text, platform, role);
    if (!ctx.messages.length) return;
    // Instant regex warnings.
    setResult({ ctx, flags: prefilter(ctx), status: "checking", aiUsed: false });
    try {
      const res = await fetch(`${SERVER_URL}/analyze-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctx }),
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const report = (await res.json()) as ChatReport;
      // The server's flags already include the regex ones (its copy wins).
      setResult((r) => (r?.ctx === ctx ? { ctx, flags: report.flags, status: "done", aiUsed: report.aiUsed } : r));
    } catch {
      setResult((r) => (r?.ctx === ctx ? { ...r, status: "offline" } : r));
    }
  };

  if (!open)
    return (
      <button className="secondary-plain" onClick={() => setOpen(true)}>
        Check a message from another chat…
      </button>
    );

  return (
    <section className="card chat-check">
      <h2>Check a message</h2>
      <p className="muted small">
        Paste messages from a chat DealDig can't read (Craigslist, Instagram, texts, email). Put a blank line between
        messages.
      </p>
      <textarea
        value={text}
        onChange={(e) => edit(setText)(e.target.value)}
        placeholder={"e.g. Send a $300 deposit on Zelle to hold it, I'm out of town"}
        rows={4}
      />
      <div className="chat-options">
        <select value={platform} onChange={(e) => edit(setPlatform)(e.target.value as ChatPlatform)} aria-label="Where is this chat?">
          {CHAT_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL(p)}
            </option>
          ))}
        </select>
        <div className="seg" role="radiogroup" aria-label="Are you buying or selling?">
          {ROLES.map((r) => (
            <button
              key={r.value}
              role="radio"
              aria-checked={role === r.value}
              className={role === r.value ? "on" : ""}
              onClick={() => edit(setRole)(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <button disabled={!text.trim() || result?.status === "checking"} onClick={check}>
        Check
      </button>
      {result && <ChatFeed result={result} />}
    </section>
  );
}

function ChatFeed({ result }: { result: Result }) {
  const quotes = Object.fromEntries(result.ctx.messages.map((m) => [m.id, m.text]));
  const note =
    result.status === "checking"
      ? "Instant check done. Asking the AI for a second look…"
      : result.status === "offline"
        ? "AI check unavailable (server not reachable). Showing the instant check only."
        : result.aiUsed
          ? "Checked with rules + Claude."
          : "Rules only (no AI key on the server).";
  return <FlagFeed flags={result.flags} quotes={quotes} checking={result.status === "checking"} note={note} />;
}
