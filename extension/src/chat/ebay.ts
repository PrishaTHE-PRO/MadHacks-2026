// eBay messages: www.ebay.com/mesg/* and mesg.ebay.com.
//
// TODO(selectors): no saved page yet, so this adapter is inactive (it never
// finds a thread). Save a message thread at ebay.com/mesg/... (with a buyer or seller)
// to server/test/fixtures/chat/ebay.html and fill in findThread/readMessages.

import type { ChatAdapter } from "./adapter";

export const ebay: ChatAdapter = {
  platform: "ebay",
  matches: (url) => /^https:\/\/(www\.ebay\.com\/mesg|mesg\.ebay\.com)(\/|$)/.test(url),
  findThread: () => null, // TODO(selectors)
  readMessages: () => [], // TODO(selectors)
  readContext: () => ({ threadId: location.pathname }),
};
