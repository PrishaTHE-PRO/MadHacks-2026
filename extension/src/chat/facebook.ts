// Facebook Marketplace chats: facebook.com/messages/t/<id>, and chat popups
// over facebook.com/marketplace/*.
//
// TODO(selectors): NOT verified against a saved page yet. Save a Marketplace
// conversation to server/test/fixtures/chat/facebook.html and check these.
//
// Class names are obfuscated, so this anchors on ARIA only:
//   thread   = a role="grid"/"log" whose aria-label mentions messages or a conversation
//   message  = role="row" inside it; text = its dir="auto" blocks
//   fromMe   = the bubble sits on the right half of the row
// It stays conservative: if the thread label doesn't match, it reads nothing,
// so no warnings appear on non-chat parts of the page.

import type { ChatAdapter, ReadMessage } from "./adapter";
import { cleanText, withFallbackIds } from "./adapter";
import { isOurs } from "../content/stealth";

const THREAD_LABEL = /message|conversation|chat/i;
// Rows that are UI, not messages.
const SKIP_ROW = /^(enter|seen|delivered|sent|you sent|today|yesterday|\d{1,2}:\d{2}\s*(am|pm)?)$/i;

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export const facebook: ChatAdapter = {
  platform: "facebook",
  matches: (url) => /^https:\/\/(www\.)?facebook\.com\/(messages|marketplace)(\/|$)/.test(url),

  findThread(doc) {
    const candidates = [...doc.querySelectorAll('[role="grid"], [role="log"]')].filter(
      (el) => THREAD_LABEL.test(el.getAttribute("aria-label") ?? "") && el.querySelector('[role="row"]') && visible(el),
    );
    return candidates.at(-1) ?? null; // the most recently opened popup comes last
  },

  readMessages(thread) {
    const rows: { el: HTMLElement; fromMe: boolean; text: string }[] = [];
    for (const row of thread.querySelectorAll<HTMLElement>('[role="row"]')) {
      const blocks = [...row.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]')].filter(
        (b) => !isOurs(b) && !b.parentElement?.closest('[dir="auto"]'),
      );
      const text = cleanText(blocks.map((b) => b.innerText).join(" "));
      if (!text || SKIP_ROW.test(text)) continue;
      const rowBox = row.getBoundingClientRect();
      const bubble = blocks[0].getBoundingClientRect();
      const fromMe = bubble.left + bubble.width / 2 > rowBox.left + rowBox.width / 2;
      rows.push({ el: row, fromMe, text });
    }
    const ids = withFallbackIds(rows);
    return rows.map((r, i): ReadMessage => ({ el: r.el, msg: { id: ids[i], fromMe: r.fromMe, text: r.text } }));
  },

  readContext(doc) {
    const m = location.pathname.match(/\/(?:messages|marketplace)\/t\/([^/?#]+)/);
    const profile = doc.querySelector<HTMLAnchorElement>('[role="main"] a[href*="/marketplace/profile/"]');
    return {
      threadId: m?.[1] ?? `popup-${location.pathname}`,
      otherParty: profile
        ? { id: profile.href.match(/\/profile\/(\d+)/)?.[1], username: cleanText(profile.innerText) || undefined, profileUrl: profile.href }
        : undefined,
    };
  },
};
