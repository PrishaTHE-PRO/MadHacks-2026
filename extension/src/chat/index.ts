// All chat adapters. The first one whose matches() accepts the URL is used.

import type { ChatAdapter } from "./adapter";
import { demo } from "./demo";
import { facebook } from "./facebook";
import { ebay } from "./ebay";
import { etsy } from "./etsy";
import { depop } from "./depop";
import { mercari } from "./mercari";
import { poshmark } from "./poshmark";

export const CHAT_ADAPTERS: ChatAdapter[] = [demo, facebook, ebay, etsy, depop, mercari, poshmark];

export const findChatAdapter = (url: string) => CHAT_ADAPTERS.find((a) => a.matches(url)) ?? null;
