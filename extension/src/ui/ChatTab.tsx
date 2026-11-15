// Chat tab: summary, who the chat is with + buying/selling toggle, the live
// warnings for the chat open in this tab, and the paste box. Pure UI: the side
// panel passes the stored chat state and handles the clicks.

import { useState } from "react";
import type { ChatRole } from "../../../shared/types";
import { PLATFORM_NAMES } from "../../../shared/types";
import { flagKey, type ChatTabState } from "../messages";
import { Bubble } from "./Bubble";
import { PasteCheck, statusNote } from "./PasteCheck";
import { RoleToggle } from "./RoleToggle";
import { WarningList } from "./WarningList";

export interface ChatTabProps {
  chat: ChatTabState | null;
  role: ChatRole;
  /** flagKey()s the user marked "Not a scam" in this thread. */
  dismissed: string[];
  onRole(role: ChatRole): void;
  onShowDismissed(): void;
}

/** Warnings that count: caution and danger, not dismissed. */
export const chatWarningCount = (chat: ChatTabState | null, dismissed: string[]) =>
  chat?.flags.filter((f) => (f.severity === "caution" || f.severity === "danger") && !dismissed.includes(flagKey(f))).length ?? 0;

export function ChatTab({ chat, role, dismissed, onRole, onShowDismissed }: ChatTabProps) {
  const [pasting, setPasting] = useState(false);

  const pasteButton = (
    <button className="dd-dashed" onClick={() => setPasting(true)}>
      Check a pasted message <span className="dd-muted">· Craigslist, IG, texts</span>
    </button>
  );

  if (pasting) return <PasteCheck onClose={() => setPasting(false)} />;

  if (!chat)
    return (
      <>
        <div className="dd-state dd-state-compact">
          <Bubble size={56} />
          <h2>No chat open</h2>
          <p>Open a marketplace chat and DealDig flags scam patterns under each message as they appear.</p>
        </div>
        {pasteButton}
      </>
    );

  const flags = chat.flags.filter((f) => !dismissed.includes(flagKey(f)));
  const hidden = chat.flags.length - flags.length;
  const count = chatWarningCount(chat, dismissed);
  const danger = flags.some((f) => f.severity === "danger");
  const name = chat.otherParty?.username;
  const site = chat.platform === "generic" ? "" : PLATFORM_NAMES[chat.platform];

  return (
    <>
      <section className="dd-card dd-verdict-top" aria-label="Chat summary">
        <Bubble size={40} icon={count ? "alert" : "check"} />
        <div className="dd-verdict-text">
          <div className={`dd-level ${count ? (danger ? "dd-high" : "dd-medium") : "dd-low"}`}>
            {count ? `${count} warning sign${count > 1 ? "s" : ""}` : "No warning signs"}
          </div>
          <div className="dd-summary">
            {count
              ? danger
                ? "Don't send money, codes or personal info until you've read these."
                : "Take it slow and keep the chat on the platform."
              : "Nothing suspicious so far. DealDig keeps watching as messages arrive."}
          </div>
        </div>
      </section>

      <div className="dd-chat-row">
        <span className="dd-chat-with">
          Chat{name ? (
            <>
              {" "}
              with <strong>{name}</strong>
            </>
          ) : null}
          {site ? ` · ${site}` : ""}
        </span>
        <RoleToggle role={role} onChange={onRole} />
      </div>

      {flags.length > 0 && <WarningList flags={flags} quotes={chat.quotes} />}
      {hidden > 0 && (
        <p className="dd-note dd-center">
          {hidden} marked “Not a scam”.{" "}
          <button className="dd-link" onClick={onShowDismissed}>
            Show again
          </button>
        </p>
      )}
      <p className="dd-foot-note">{statusNote(chat.status, chat.aiUsed)}</p>
      {pasteButton}
    </>
  );
}
