// Depop conversations: www.depop.com/messages/*.
//
// TODO(selectors): no saved page yet, so this adapter is inactive (it never
// finds a thread). Save a conversation at depop.com/messages/...
// to server/test/fixtures/chat/depop.html and fill in findThread/readMessages.

import type { ChatAdapter } from "./adapter";

export const depop: ChatAdapter = {
  platform: "depop",
  matches: (url) => /^https:\/\/www\.depop\.com\/messages(\/|$)/.test(url),
  findThread: () => null, // TODO(selectors)
  readMessages: () => [], // TODO(selectors)
  readContext: () => ({ threadId: location.pathname }),
};
