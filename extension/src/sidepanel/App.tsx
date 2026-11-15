// The DealDig sidebar (Chrome side panel). Renders the redesigned UI from the
// per-tab state the background worker keeps in chrome.storage:
//   tab:<tabId>   listing check (loading / done / error)
//   chat:<tabId>  chat warnings for the chat open in that tab
// It follows the active tab, so switching tabs switches what it shows.
// On a sell page (the user creating their own listing) it shows the seller
// view instead: the photo privacy tool and any photos the upload guard holds.

import { useEffect, useState } from "react";
import { PLATFORM_NAMES, type ChatRole } from "../../../shared/types";
import { chatKey, dismissedKey, roleKey, tabKey, threadKey, type ChatTabState, type TabState } from "../messages";
import { ChatTab, chatWarningCount } from "../ui/ChatTab";
import { HistoryCard, useHistory } from "../ui/HistoryCard";
import { Panel, type PanelView } from "../ui/Panel";
import { SellerPanel } from "../ui/SellerPanel";
import { PhotoPrivacy } from "./PhotoPrivacy";
import { sellPagePlatform } from "../sellPages";

/** The active browser tab (id + URL), kept up to date as the user navigates. */
function useActiveTab(): { id: number | null; url: string | null } {
  const [tab, setTab] = useState<{ id: number | null; url: string | null }>({ id: null, url: null });
  useEffect(() => {
    const refresh = () =>
      chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
        const next = { id: t?.id ?? null, url: t?.url ?? null };
        setTab((prev) => (prev.id === next.id && prev.url === next.url ? prev : next));
      });
    void refresh();
    // onUpdated also fires for single-page-app navigation (history.pushState).
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => {
      if (t.active && change.url) void refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
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

export function App() {
  const activeTab = useActiveTab();
  const tabId = activeTab.id;
  const sellingOn = sellPagePlatform(activeTab.url);
  const listingState = useStored<TabState>("session", tabId === null ? null : tabKey(tabId));
  const chat = useStored<ChatTabState>("session", tabId === null ? null : chatKey(tabId)) ?? null;
  const thread = chat ? threadKey(chat.platform, chat.threadId) : null;
  const role = useStored<ChatRole>("local", thread && roleKey(thread)) ?? "unknown";
  const dismissed = useStored<string[]>("local", thread && dismissedKey(thread)) ?? [];
  const history = useHistory();

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
    <>
      {/* Seller view. Always mounted (just hidden) so photos being checked or
          held survive switching browser tabs. */}
      <div style={{ display: sellingOn ? "contents" : "none" }}>
        <SellerPanel site={sellingOn ? PLATFORM_NAMES[sellingOn] : undefined} onClose={() => window.close()}>
          <PhotoPrivacy tabId={sellingOn ? tabId : null} />
        </SellerPanel>
      </div>
      {!sellingOn && (
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
      history={history}
      tools={
<HistoryCard history={history} />
      }
      onClose={() => window.close()}
      onRetry={() => tabId !== null && void chrome.runtime.sendMessage({ type: "RETRY_LISTING", tabId })}
    />
      )}
    </>
  );
}
