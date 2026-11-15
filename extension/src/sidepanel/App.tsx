// The DealDig sidebar (Chrome side panel). Renders the redesigned UI from the
// per-tab state the background worker keeps in chrome.storage:
//   tab:<tabId>   listing check (loading / done / error)
//   chat:<tabId>  chat warnings for the chat open in that tab
// It follows the active tab, so switching tabs switches what it shows.

import { useEffect, useState } from "react";
import { PLATFORM_NAMES, type ChatRole } from "../../../shared/types";
import { SERVER_URL } from "../config";
import { chatKey, dismissedKey, roleKey, tabKey, threadKey, type ChatTabState, type TabState } from "../messages";
import { ChatTab, chatWarningCount } from "../ui/ChatTab";
import { Panel, type PanelView } from "../ui/Panel";

function useActiveTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTabId(t?.id ?? null));
    void refresh();
    chrome.tabs.onActivated.addListener(refresh);
    return () => chrome.tabs.onActivated.removeListener(refresh);
  }, []);
  return tabId;
}

/** A chrome.storage value that follows changes. */
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

function viewFor(state: TabState | undefined): PanelView {
  if (!state) return { kind: "empty" };
  if (state.status === "loading") return { kind: "loading", listing: state.listing, plan: state.plan, step: state.step };
  if (state.status === "error") return { kind: "error", message: state.error, offline: Boolean(state.offline) };
  return { kind: "listing", listing: state.listing, report: state.report };
}

async function sendReport(state: TabState | undefined, reason: string): Promise<boolean> {
  if (!state) return false;
  const { listing } = state;
  const res = await fetch(`${SERVER_URL}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: listing.platform,
      sellerId: listing.seller.id,
      sellerUsername: listing.seller.username,
      listingId: listing.id,
      reason,
    }),
  });
  return res.ok;
}

export function App() {
  const tabId = useActiveTabId();
  const listingState = useStored<TabState>("session", tabId === null ? null : tabKey(tabId));
  const chat = useStored<ChatTabState>("session", tabId === null ? null : chatKey(tabId)) ?? null;
  const thread = chat ? threadKey(chat.platform, chat.threadId) : null;
  const role = useStored<ChatRole>("local", thread && roleKey(thread)) ?? "unknown";
  const dismissed = useStored<string[]>("local", thread && dismissedKey(thread)) ?? [];

  // Esc closes the sidebar, like the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && window.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const view = viewFor(listingState);
  const site = listingState
    ? PLATFORM_NAMES[listingState.listing.platform]
    : chat && chat.platform !== "generic"
      ? PLATFORM_NAMES[chat.platform]
      : undefined;

  return (
    <Panel
      // A different page or chat starts on its own tab.
      key={`${tabId}:${listingState?.listing.id ?? ""}:${chat?.threadId ?? ""}`}
      view={view}
      site={site}
      initialTab={!listingState && chat ? "chat" : "listing"}
      chatCount={chatWarningCount(chat, dismissed)}
      chatTab={
        <ChatTab
          chat={chat}
          role={role}
          dismissed={dismissed}
          onRole={(r) => thread && void chrome.storage.local.set({ [roleKey(thread)]: r })}
          onShowDismissed={() => thread && void chrome.storage.local.remove(dismissedKey(thread))}
        />
      }
      onClose={() => window.close()}
      onRetry={() => tabId !== null && void chrome.runtime.sendMessage({ type: "RETRY_LISTING", tabId })}
      onSubmitReport={(reason) => sendReport(listingState, reason)}
    />
  );
}
