// Side panel "Chat" section: the live feed for the chat open in the current
// tab, with the "I'm buying / I'm selling" toggle (saved per thread).

import { useEffect, useState } from "react";
import { PLATFORM_NAMES, type ChatRole } from "../../../shared/types";
import { chatKey, dismissedKey, flagKey, roleKey, threadKey, type ChatTabState } from "../messages";
import { ROLES } from "./ChatCheck";
import { FlagFeed } from "./FlagFeed";

/** chrome.storage value that follows changes. */
function useStored<T>(area: "session" | "local", key: string | null): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    if (!key) return;
    void chrome.storage[area].get(key).then((r) => setValue(r[key] as T | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
      if (changedArea === area && key in changes) setValue(changes[key].newValue as T | undefined);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [area, key]);
  return value;
}

export function useChatState(tabId: number | null) {
  return useStored<ChatTabState>("session", tabId === null ? null : chatKey(tabId));
}

export function ChatPanel({ state }: { state: ChatTabState }) {
  const thread = threadKey(state.platform, state.threadId);
  const dismissed = useStored<string[]>("local", dismissedKey(thread)) ?? [];
  const role = useStored<ChatRole>("local", roleKey(thread)) ?? "unknown";
  const flags = state.flags.filter((f) => !dismissed.includes(flagKey(f)));
  const hidden = state.flags.length - flags.length;

  const note =
    state.status === "checking"
      ? "Instant check done. Asking the AI for a second look…"
      : state.status === "offline"
        ? "AI check unavailable (server not reachable). Showing the instant check only."
        : state.aiUsed
          ? "Checked with rules + Claude."
          : "Rules only (no AI key on the server).";

  return (
    <section className="card chat-panel">
      <h2>
        Chat{state.platform !== "generic" ? ` · ${PLATFORM_NAMES[state.platform]}` : ""}
        {state.otherParty?.username ? ` · ${state.otherParty.username}` : ""}
      </h2>
      <div className="seg" role="radiogroup" aria-label="Are you buying or selling?">
        {ROLES.map((r) => (
          <button
            key={r.value}
            role="radio"
            aria-checked={role === r.value}
            className={role === r.value ? "on" : ""}
            onClick={() => void chrome.storage.local.set({ [roleKey(thread)]: r.value })}
          >
            {r.label}
          </button>
        ))}
      </div>
      <FlagFeed flags={flags} quotes={state.quotes} checking={state.status === "checking"} note={note} />
      {hidden > 0 && (
        <p className="muted small">
          {hidden} warning{hidden > 1 ? "s" : ""} marked “Not a scam”.{" "}
          <button className="link" onClick={() => void chrome.storage.local.remove(dismissedKey(thread))}>
            Show again
          </button>
        </p>
      )}
    </section>
  );
}
