// Mercari messages: www.mercari.com/transaction/* and item/message pages.
//
// TODO(selectors): no saved page yet, so this adapter is inactive (it never
// finds a thread). Save a transaction or item message thread on mercari.com
// to server/test/fixtures/chat/mercari.html and fill in findThread/readMessages.

import type { ChatAdapter } from "./adapter";

export const mercari: ChatAdapter = {
  platform: "mercari",
  matches: (url) => /^https:\/\/www\.mercari\.com\/(transaction|messages|us\/item\/[^/]+\/messages?)(\/|$)/.test(url),
  findThread: () => null, // TODO(selectors)
  readMessages: () => [], // TODO(selectors)
  readContext: () => ({ threadId: location.pathname }),
};
