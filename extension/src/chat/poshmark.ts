// Poshmark has no direct messages: its chat surfaces are listing comments
// (most Poshmark scams start with "text me at..." or "Venmo me" there) and
// offer notes. This adapter will read comments on poshmark.com/listing/*.
//
// TODO(selectors): no saved page yet, so this adapter is inactive (it never
// finds a thread). Save a poshmark.com/listing/... page with a few comments
// to server/test/fixtures/chat/poshmark.html and fill in findThread/readMessages.

import type { ChatAdapter } from "./adapter";

export const poshmark: ChatAdapter = {
  platform: "poshmark",
  matches: (url) => /^https:\/\/poshmark\.com\/listing\//.test(url),
  findThread: () => null, // TODO(selectors)
  readMessages: () => [], // TODO(selectors)
  readContext: () => ({ threadId: location.pathname }),
};
