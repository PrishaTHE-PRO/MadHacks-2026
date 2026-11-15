// Outbound link cleaning (design doc 3.2–3.3). On a marketplace page, a click
// on a link that leaves the marketplace is opened by the extension instead:
// the redirector wrapper (l.facebook.com, rover.ebay.com) is unwrapped,
// tracking tags are removed, and a tab the extension opens sends no Referer,
// so the next site doesn't learn which listing the user came from.
// The page's DOM is never changed: no rewritten hrefs, no rel attributes.

import { isMarketplaceUrl, unwrapRedirector } from "../guardCore";
import type { ExtensionMessage } from "../messages";
import { openHow, type OpenHow } from "../privacy/openHow";
import { loadSettings, SETTINGS_KEY, withDefaults, type PrivacySettings } from "../privacy/settings";

let enabled = true;

function linkIn(e: MouseEvent): HTMLAnchorElement | null {
  for (const n of e.composedPath()) if (n instanceof HTMLAnchorElement && n.href) return n;
  return null;
}

function onClick(e: MouseEvent) {
  if (!enabled || e.defaultPrevented || (e.button !== 0 && e.button !== 1)) return;
  const a = linkIn(e);
  if (!a || a.hasAttribute("download")) return;
  const dest = unwrapRedirector(a.href);
  if (!/^https?:\/\//i.test(dest) || isMarketplaceUrl(dest)) return; // links within the marketplace stay with the site
  e.preventDefault();
  e.stopImmediatePropagation();
  const how = openHow(e, a.target);
  const msg: ExtensionMessage = { type: "OPEN_CLEAN", url: a.href, how };
  try {
    chrome.runtime.sendMessage(msg).catch(() => fallback(dest, how));
  } catch {
    fallback(dest, how); // extension reloaded under this page: still open it without a referrer
  }
}

function fallback(url: string, how: OpenHow) {
  if (how === "same-tab") location.assign(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function startOutboundCleaning() {
  if (!isMarketplaceUrl(location.href)) return;
  void loadSettings().then((s) => (enabled = s.cleanLinks));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) {
      enabled = withDefaults(changes[SETTINGS_KEY].newValue as Partial<PrivacySettings> | undefined).cleanLinks;
    }
  });
  // Capture phase, so we see the click before the site's own handlers.
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
}
