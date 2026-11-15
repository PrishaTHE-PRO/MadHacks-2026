// Chat warning rows: severity dot · pattern name · Why? · reason · quoted message.
// Shared by the live chat and the paste box in the Chat tab.

import { useState } from "react";
import { CHAT_PATTERN_BY_ID } from "../../../shared/chatPatterns";
import type { ChatFlag } from "../../../shared/types";
import { flagKey } from "../messages";

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function WarningList({ flags, quotes }: { flags: ChatFlag[]; quotes: Record<string, string> }) {
  const newestFirst = [...flags].reverse();
  return (
    <ul className="dd-card dd-warnings" aria-label="Chat warnings">
      {newestFirst.map((f) => (
        <Warning key={flagKey(f)} flag={f} quote={quotes[f.messageId] ?? ""} />
      ))}
    </ul>
  );
}

function Warning({ flag, quote }: { flag: ChatFlag; quote: string }) {
  const [open, setOpen] = useState(false);
  const p = CHAT_PATTERN_BY_ID[flag.pattern];
  return (
    <li>
      <div className="dd-warn-head">
        <span className={`dd-sev ${flag.severity}`} aria-label={flag.severity === "danger" ? "Danger" : flag.severity === "caution" ? "Caution" : "Note"} />
        <span className="dd-warn-name">{p.name}</span>
        {flag.source === "ai" && <span className="dd-ai">AI</span>}
        <button className="dd-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Why?"}
        </button>
      </div>
      <div className="dd-warn-reason">{flag.reason}</div>
      {open && (
        <div className="dd-warn-why">
          {flag.source === "ai" ? `${p.reason} ` : ""}
          {p.tip}
        </div>
      )}
      {quote && <div className="dd-warn-quote">“{truncate(quote)}”</div>}
    </li>
  );
}
