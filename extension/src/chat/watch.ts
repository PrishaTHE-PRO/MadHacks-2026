// Watches an open chat and flags scam patterns as messages appear.
//
//   new messages (MutationObserver, debounced ~800 ms)
//     → prefilter() right away → chips          (instant, works offline)
//     → ANALYZE_CHAT to the background worker   (server: regex + Claude)
//     → CHAT_RESULT back → chips updated
//
// Each message id is sent to the server once; chips are re-attached if the
// site re-renders a message. DealDig never types or sends anything.

import { prefilter } from "../../../shared/chatPatterns";
import type { ChatContext, ChatFlag, ChatRole } from "../../../shared/types";
import { dismissedKey, flagKey, roleKey, threadKey, type ContentMessage } from "../messages";
import type { ChatAdapter } from "./adapter";
import { removeAllChips, removeChips, showChips } from "./chips";
import { isOurs } from "../content/stealth";

const DEBOUNCE_MS = 800;
const TICK_MS = 1000;
const WINDOW = 10; // messages sent for classification
const UNDO_MS = 6000; // how long "Not a scam" offers Undo

/** Mutations from our own chips shouldn't trigger a rescan. */
const ours = (n: Node) => isOurs(n);
const onlyOurs = (records: MutationRecord[]) =>
  records.every((r) => ours(r.target) || ([...r.addedNodes, ...r.removedNodes].length > 0 && [...r.addedNodes, ...r.removedNodes].every(ours)));

export function startChatWatcher(adapter: ChatAdapter): { stop(): void } {
  let thread: Element | null = null;
  let observer: MutationObserver | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let lastUrl = "";

  // Per-thread state, reset when the thread changes.
  let threadId = "";
  let key = "";
  let role: ChatRole = "unknown";
  let dismissed = new Set<string>();
  const sent = new Set<string>(); // message ids already sent to the server
  const flags = new Map<string, ChatFlag>(); // flagKey → flag
  let elById = new Map<string, HTMLElement>();
  /** Warnings just marked "Not a scam": shown as an Undo line for a few seconds. */
  const undoable = new Map<string, { flag: ChatFlag; timer: ReturnType<typeof setTimeout> }>();
  let announced = ""; // threadId we've told the background we're watching

  /** Tell the background whether this thread is being watched (the sidebar's live dot). */
  const announce = (watching: boolean) => {
    if (!threadId || (watching ? announced === threadId : !announced)) return;
    announced = watching ? threadId : "";
    chrome.runtime.sendMessage({ type: "CHAT_WATCHING", threadId, watching }).catch(() => {});
  };

  const render = () => {
    const byMessage = new Map<string, ChatFlag[]>();
    for (const f of flags.values()) {
      // Inline chips are for real warnings; info notes only appear in the side panel.
      if (f.severity !== "caution" && f.severity !== "danger") continue;
      if (dismissed.has(flagKey(f))) continue;
      byMessage.set(f.messageId, [...(byMessage.get(f.messageId) ?? []), f]);
    }
    const undoBy = new Map<string, ChatFlag[]>();
    for (const [k, { flag }] of undoable) {
      if (dismissed.has(k)) undoBy.set(flag.messageId, [...(undoBy.get(flag.messageId) ?? []), flag]);
    }
    for (const [id, el] of elById) {
      const list = byMessage.get(id) ?? [];
      const undo = undoBy.get(id) ?? [];
      if (list.length || undo.length) showChips(el, id, list, actions, undo);
      else removeChips(id);
    }
  };

  const saveDismissed = () => void chrome.storage.local.set({ [dismissedKey(key)]: [...dismissed] });

  const actions = {
    report: (_flag: ChatFlag) => {
      chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
    },
    dismiss: (flag: ChatFlag) => {
      const k = flagKey(flag);
      dismissed.add(k);
      clearTimeout(undoable.get(k)?.timer);
      undoable.set(k, {
        flag,
        timer: setTimeout(() => {
          undoable.delete(k);
          render();
        }, UNDO_MS),
      });
      render();
      saveDismissed();
    },
    undo: (flag: ChatFlag) => {
      const k = flagKey(flag);
      clearTimeout(undoable.get(k)?.timer);
      undoable.delete(k);
      dismissed.delete(k);
      render();
      saveDismissed();
    },
  };

  async function switchThread(id: string) {
    threadId = id;
    key = threadKey(adapter.platform, id);
    sent.clear();
    flags.clear();
    for (const { timer } of undoable.values()) clearTimeout(timer);
    undoable.clear();
    removeAllChips();
    const stored = await chrome.storage.local.get([roleKey(key), dismissedKey(key)]);
    role = (stored[roleKey(key)] as ChatRole) ?? "unknown";
    dismissed = new Set((stored[dismissedKey(key)] as string[]) ?? []);
  }

  async function scan() {
    if (!thread?.isConnected) return;
    const partial = adapter.readContext(document);
    const id = partial.threadId || location.pathname;
    if (id !== threadId) await switchThread(id);

    const items = adapter.readMessages(thread);
    elById = new Map(items.map((i) => [i.msg.id, i.el]));
    const messages = items.map((i) => i.msg).slice(-WINDOW);
    if (!messages.length) return;

    const ctx: ChatContext = {
      ...partial,
      platform: adapter.platform,
      threadId,
      url: location.href,
      role,
      messages,
    };

    // Instant regex flags; a server flag for the same pattern + message wins.
    for (const f of prefilter(ctx)) if (!flags.has(flagKey(f))) flags.set(flagKey(f), f);
    render();

    if (messages.some((m) => !sent.has(m.id))) {
      messages.forEach((m) => sent.add(m.id));
      chrome.runtime.sendMessage({ type: "ANALYZE_CHAT", ctx }).catch(() => {});
      announced = threadId; // ANALYZE_CHAT marks the thread as watched
    } else {
      announce(true);
    }
  }

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void scan(), DEBOUNCE_MS);
  };

  function attach(next: Element) {
    observer?.disconnect();
    thread = next;
    observer = new MutationObserver((records) => {
      if (!onlyOurs(records)) schedule();
    });
    observer.observe(next, { childList: true, subtree: true, characterData: true });
    void scan(); // read what's already there right away
  }

  function tick() {
    const found = adapter.findThread(document);
    if (found && found !== thread) attach(found);
    else if (!found && thread) {
      observer?.disconnect();
      observer = null;
      thread = null;
      removeAllChips();
      announce(false);
    } else if (found && location.href !== lastUrl) {
      void scan(); // SPA navigation to another thread in the same list element
    } else if ([...elById.values()].some((el) => !el.isConnected)) {
      void scan(); // the site re-rendered messages; re-attach chips
    }
    lastUrl = location.href;
  }

  // Background → content: merged regex + server flags for this thread.
  const onMessage = (msg: ContentMessage) => {
    if (msg.type !== "CHAT_RESULT" || msg.threadId !== threadId) return;
    for (const f of msg.flags) flags.set(flagKey(f), f);
    render();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // Side panel toggles (role) and "Not a scam" from another tab.
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !key) return;
    const r = changes[roleKey(key)];
    if (r) {
      role = (r.newValue as ChatRole) ?? "unknown";
      flags.clear();
      sent.clear(); // re-check the whole window for the new side
      removeAllChips();
      void scan();
    }
    const d = changes[dismissedKey(key)];
    if (d) {
      dismissed = new Set((d.newValue as string[]) ?? []);
      render();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);

  tick();
  const interval = setInterval(tick, TICK_MS);

  return {
    stop() {
      announce(false);
      clearInterval(interval);
      clearTimeout(debounce);
      observer?.disconnect();
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
      removeAllChips();
    },
  };
}
