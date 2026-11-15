// Chat warning rows: severity dot · pattern name · Why? · reason · quoted message.
// Shared by the live chat and the paste box in the Chat tab.

import { useEffect, useRef, useState } from "react";
import { CHAT_PATTERN_BY_ID } from "../../../shared/chatPatterns";
import type { ChatFlag } from "../../../shared/types";
import { flagKey } from "../messages";

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function WarningList({ flags, quotes }: { flags: ChatFlag[]; quotes: Record<string, string> }) {
  const newestFirst = [...flags].reverse();
  // Warnings already on screen when the list first rendered don't animate;
  // ones that arrive later slide in with a brief highlight.
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(flags.map(flagKey));
  const fresh = new Set(flags.map(flagKey).filter((k) => !seen.current!.has(k)));
  useEffect(() => {
    for (const k of fresh) seen.current!.add(k);
  });
  // Stays mounted while empty, so the first warning in a quiet chat still animates in.
  if (!flags.length) return null;
  return (
    <ul className="dd-card dd-warnings" aria-label="Chat warnings" aria-live="polite">
      {newestFirst.map((f) => (
        <Warning key={flagKey(f)} flag={f} quote={quotes[f.messageId] ?? ""} isNew={fresh.has(flagKey(f))} />
      ))}
    </ul>
  );
}

function Warning({ flag, quote, isNew }: { flag: ChatFlag; quote: string; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  // Keep the highlight for this mount even after the parent marks it seen.
  const [arrived] = useState(isNew);
  const p = CHAT_PATTERN_BY_ID[flag.pattern];
  return (
    <li className={arrived ? "dd-new" : undefined}>
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
