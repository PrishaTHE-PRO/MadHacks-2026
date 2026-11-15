// Which URLs are single listings (for history scrubbing and private peek).
// Pure, so Node tests can import it. Reuses each adapter's own matcher.

import { isEbayListingUrl } from "../adapters/ebay";
import { isFacebookListingUrl } from "../adapters/facebook";
import { isPoshmarkListingUrl } from "../adapters/poshmark";

const OTHER_LISTINGS: { host: RegExp; path: RegExp }[] = [
  { host: /(^|\.)mercari\.com$/, path: /^\/(us\/)?item\/m\d+/ },
  { host: /(^|\.)etsy\.com$/, path: /^\/([a-z]{2}(-[a-z]{2})?\/)?listing\/\d+/ },
  { host: /(^|\.)depop\.com$/, path: /^\/products\/[^/]+/ },
];

export function isListingUrl(url: string): boolean {
  if (isEbayListingUrl(url) || isFacebookListingUrl(url) || isPoshmarkListingUrl(url)) return true;
  try {
    const u = new URL(url);
    return OTHER_LISTINGS.some((s) => s.host.test(u.hostname) && s.path.test(u.pathname));
  } catch {
    return false;
  }
}

/** Facebook needs a login to show a listing, so a logged-out private window can't open it. */
export const canPeekPrivately = (url: string) => isListingUrl(url) && !isFacebookListingUrl(url);
