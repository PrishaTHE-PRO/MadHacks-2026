// The Second Look demo chat (extension/demo/chat.html, served by the server at
// /demo/chat). A backup for the live demo if a real site's DOM breaks.

import type { ChatAdapter } from "./adapter";
import { cleanText } from "./adapter";

export const demo: ChatAdapter = {
  platform: "generic",
  matches: (url) => /^http:\/\/(localhost|127\.0\.0\.1):8787\/demo\/chat\b/.test(url),
  findThread: (doc) => doc.querySelector('[data-demo="thread"]'),
  readMessages: (thread) =>
    [...thread.querySelectorAll<HTMLElement>("[data-msg-id]")].map((el) => ({
      el,
      msg: {
        id: el.dataset.msgId!,
        fromMe: el.dataset.from === "me",
        author: cleanText(el.querySelector(".author")?.textContent) || undefined,
        text: cleanText(el.querySelector(".text")?.textContent),
      },
      images: [...el.querySelectorAll<HTMLImageElement>(".text img")].map((img) => img.src),
    })),
  readContext: (doc) => {
    const thread = doc.querySelector<HTMLElement>('[data-demo="thread"]');
    const price = Number(doc.querySelector<HTMLElement>("[data-listing-price]")?.dataset.listingPrice);
    return {
      threadId: thread?.dataset.threadId ?? "demo",
      otherParty: { username: cleanText(doc.querySelector(".other-party")?.textContent) || undefined },
      listing: {
        title: cleanText(doc.querySelector(".listing-title")?.textContent) || undefined,
        price: Number.isFinite(price) ? price : undefined,
      },
    };
  },
};
