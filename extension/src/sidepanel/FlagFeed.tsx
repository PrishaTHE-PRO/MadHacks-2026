// The chat warning feed, shared by the live chat section and the paste box.

import { useState } from "react";
import { CHAT_PATTERN_BY_ID } from "../../../shared/chatPatterns";
import type { ChatFlag, Severity } from "../../../shared/types";
import { flagKey } from "../messages";

const ICON: Record<Severity, string> = { danger: "⛔", caution: "⚠️", info: "ℹ️", good: "✅" };

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function FlagFeed({
  flags,
  quotes,
  checking,
  note,
}: {
  flags: ChatFlag[];
  quotes: Record<string, string>;
  checking: boolean;
  note: string;
}) {
  const newestFirst = [...flags].reverse();
  return (
    <div className="chat-feed">
      {newestFirst.length === 0 ? (
        <p className="muted">{checking ? "No obvious warning signs. Double-checking…" : "No warning signs in this chat so far."}</p>
      ) : (
        <ul>
          {newestFirst.map((f) => (
            <FlagItem key={flagKey(f)} flag={f} quote={quotes[f.messageId] ?? ""} />
          ))}
        </ul>
      )}
      <p className="muted small">{note}</p>
    </div>
  );
}

function FlagItem({ flag, quote }: { flag: ChatFlag; quote: string }) {
  const [open, setOpen] = useState(false);
  const pattern = CHAT_PATTERN_BY_ID[flag.pattern];
  return (
    <li className={flag.severity}>
      <div className="flag-head">
        <span aria-hidden>{ICON[flag.severity]}</span>
        <strong className="grow">{pattern.name}</strong>
        {flag.source === "ai" && <span className="tag">AI</span>}
      </div>
      <div>{flag.reason}</div>
      {quote && <blockquote>“{truncate(quote)}”</blockquote>}
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Why?"}
      </button>
      {open && (
        <p className="why">
          {flag.source === "ai" ? `${pattern.reason} ` : ""}
          {pattern.tip}
        </p>
      )}
    </li>
  );
}
