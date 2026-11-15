// "Check a pasted message": for chats Second Look can't read (Craigslist, Instagram,
// texts, email). Regex warnings show instantly; the server's answer (regex +
// Claude) replaces them when it arrives. If the server is down, they stay.

import { useState } from "react";
import { prefilter } from "../../../shared/chatPatterns";
import {
  CHAT_PLATFORMS,
  PLATFORM_NAMES,
  type ChatContext,
  type ChatFlag,
  type ChatPlatform,
  type ChatReport,
  type ChatRole,
} from "../../../shared/types";
import { SERVER_URL } from "../config";
import { RoleToggle } from "./RoleToggle";
import { WarningList } from "./WarningList";

const MAX_MESSAGES = 10;
const MAX_CHARS = 2000;
const SERVER_TIMEOUT_MS = 20_000;

const platformLabel = (p: ChatPlatform) => (p === "generic" ? "Other (text, email, IG…)" : PLATFORM_NAMES[p]);

type Result = { ctx: ChatContext; flags: ChatFlag[]; status: "checking" | "done" | "offline"; aiUsed: boolean };

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

export function statusNote(status: Result["status"], aiUsed: boolean) {
  return status === "checking"
    ? "Double-checking with AI…"
    : status === "offline"
      ? "Server offline: quick check only."
      : aiUsed
        ? "Rules + AI"
        : "Rules only";
}

export function PasteCheck({ onClose }: { onClose(): void }) {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<ChatPlatform>("generic");
  const [role, setRole] = useState<ChatRole>("unknown");
  const [result, setResult] = useState<Result | null>(null);

  // Changing the inputs makes the old result stale.
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setResult(null);
    };

  const check = async () => {
    const ctx = toContext(text, platform, role);
    if (!ctx.messages.length) return;
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
      setResult((r) => (r?.ctx === ctx ? { ctx, flags: report.flags, status: "done", aiUsed: report.aiUsed } : r));
    } catch {
      setResult((r) => (r?.ctx === ctx ? { ...r, status: "offline" } : r));
    }
  };

  const quotes = result ? Object.fromEntries(result.ctx.messages.map((m) => [m.id, m.text])) : {};

  return (
    <>
      <section className="dd-card dd-paste" aria-label="Check a pasted message">
        <div className="dd-paste-head">
          <h3>Paste a chat</h3>
          <button className="dd-link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="dd-fine">Blank line between messages.</p>
        <textarea
          className="dd-input"
          value={text}
          onChange={(e) => edit(setText)(e.target.value)}
          placeholder={"e.g. Send a $300 deposit on Zelle to hold it, I'm out of town"}
          rows={4}
          aria-label="Messages to check"
        />
        <select
          className="dd-input"
          value={platform}
          onChange={(e) => edit(setPlatform)(e.target.value as ChatPlatform)}
          aria-label="Where is this chat?"
        >
          {CHAT_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
        <RoleToggle role={role} onChange={edit(setRole)} />
        <button className="dd-btn primary" disabled={!text.trim() || result?.status === "checking"} onClick={check}>
          Check
        </button>
      </section>
      {result &&
        (result.flags.length ? (
          <WarningList flags={result.flags} quotes={quotes} />
        ) : (
          <p className="dd-note dd-center">
            {result.status === "checking" ? "Nothing yet. Double-checking…" : "No warning signs."}
          </p>
        ))}
      {result && <p className="dd-foot-note">{statusNote(result.status, result.aiUsed)}</p>}
    </>
  );
}
