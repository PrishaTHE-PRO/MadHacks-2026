// Chat adapters: one per site, like the listing adapters. Each one knows where
// the site keeps its message list and how to read messages out of it. The
// watcher (watch.ts) does everything else.

import type { ChatContext, ChatMessage, ChatPlatform } from "../../../shared/types";

export interface ReadMessage {
  msg: ChatMessage;
  /** Where to attach the warning chip (appended as the last child). */
  el: HTMLElement;
  /** Addresses of images in the message (invoices, screenshots), checked on the device. */
  images?: string[];
}

export interface ChatAdapter {
  platform: ChatPlatform;
  matches(url: string): boolean;
  /** The scrollable message list, or null if this page has no chat open. */
  findThread(doc: Document): Element | null;
  readMessages(thread: Element): ReadMessage[];
  /** threadId, otherParty and listing, where the page shows them. */
  readContext(doc: Document): Partial<ChatContext>;
}

/** FNV-1a, enough for stable message ids. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable ids for sites without message ids: hash(author + text + n), where n
 * counts earlier messages with the same author and text. Unlike the list
 * index, this doesn't shift when the site loads older messages above.
 */
export function withFallbackIds(items: { fromMe: boolean; author?: string; text: string; id?: string }[]) {
  const counts = new Map<string, number>();
  return items.map((m) => {
    if (m.id) return m.id;
    const base = `${m.fromMe ? "me" : m.author ?? "them"}\u0000${m.text}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return `h${hash(`${base}\u0000${n}`)}`;
  });
}

export const cleanText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
