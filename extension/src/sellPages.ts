// Pages where the user is creating or editing their own listing. On these, the
// side panel shows the photo privacy tool instead of the listing check.
//
// These URLs sit behind a login, so they're from how the sites are known to
// route their sell flows. If a site changes its URL, fix it here (and in
// public/manifest.json content_scripts.matches) and add a case to the test.

import type { Platform } from "../../shared/types";

const SELL_PAGES: { platform: Platform; host: RegExp; path: RegExp }[] = [
  // poshmark.com/create-listing, poshmark.com/edit-listing/<id>
  { platform: "poshmark", host: /(^|\.)poshmark\.com$/, path: /^\/(create-listing|edit-listing)(\/|$)/ },
  // ebay.com/sl/sell, /sl/prelist/..., /sl/list..., and the newer /lstng?mode=AddItem form
  { platform: "ebay", host: /(^|\.)ebay\.com$/, path: /^\/(sl\/(sell|prelist|list)|lstng)(\/|$|\?)/ },
  // facebook.com/marketplace/create/item (also /create/vehicle, /create/rental), /marketplace/edit/?listing_id=...
  { platform: "facebook", host: /(^|\.)facebook\.com$/, path: /^\/marketplace\/(create|edit)(\/|$)/ },
];

/** The platform whose sell page this is, or null if it isn't one. */
export function sellPagePlatform(url: string | undefined | null): Platform | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  return SELL_PAGES.find((p) => p.host.test(u.hostname) && p.path.test(u.pathname))?.platform ?? null;
}
