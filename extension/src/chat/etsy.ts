// Etsy conversations: www.etsy.com/messages/*.
//
// TODO(selectors): no saved page yet, so this adapter is inactive (it never
// finds a thread). Save a conversation at etsy.com/messages/...
// to server/test/fixtures/chat/etsy.html and fill in findThread/readMessages.

import type { ChatAdapter } from "./adapter";

export const etsy: ChatAdapter = {
  platform: "etsy",
  matches: (url) => /^https:\/\/www\.etsy\.com\/messages(\/|$)/.test(url),
  findThread: () => null, // TODO(selectors)
  readMessages: () => [], // TODO(selectors)
  readContext: () => ({ threadId: location.pathname }),
};
