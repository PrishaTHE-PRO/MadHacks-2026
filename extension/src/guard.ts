// Link guard: stops a dangerous site before it loads, when it was opened from
// a marketplace tab or chat (the "DNS-level" layer on top of chat warnings).
//
// Two ways a site gets stopped:
//   1. A domain a chat check already flagged red gets a Chrome blocking rule
//      (declarativeNetRequest session rule) for the rest of this browser
//      session, so clicking it never loads.
//   2. Any other page opened from a marketplace tab is checked as it starts
//      loading: on the device for look-alikes, then the server's /check-url
//      (domain age, Safe Browsing, Cloudflare's security resolver). A bad
//      verdict sends the tab to Second Look's warning page.
// Everything else the user browses is never checked. "Continue anyway"
// allows that site for the session. If the server is down, pages load as normal.

import { suspiciousLinks } from "../../shared/chatPatterns";
import { checkLookalike } from "../../shared/linkCheck";
import { LINK_CHECK_PATTERNS, type ChatContext, type ChatFlag } from "../../shared/types";
import { SERVER_URL } from "./config";
import { blockedPagePath, destinationToCheck, domainOf, isMarketplaceUrl, ruleIdFor, type BlockedInfo } from "./guardCore";

const CHECK_TIMEOUT_MS = 6000;
const GUARDED = "guard:tabs"; // tab ids opened from a marketplace
const VERDICT = (d: string) => `guard:verdict:${d}`;
const ALLOWED = (d: string) => `guard:allow:${d}`;

type Verdict = { verdict: "block" | "ok"; reasons: string[]; url?: string };

async function guardedTabs(): Promise<Set<number>> {
  return new Set(((await chrome.storage.session.get(GUARDED))[GUARDED] as number[] | undefined) ?? []);
}
async function setGuarded(tabId: number, on: boolean) {
  const tabs = await guardedTabs();
  if (on) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ [GUARDED]: [...tabs] });
}

const isAllowed = async (domain: string) => Boolean((await chrome.storage.session.get(ALLOWED(domain)))[ALLOWED(domain)]);

async function showWarning(tabId: number, info: BlockedInfo) {
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(blockedPagePath(info)) });
}

/** Block a domain for this browser session, with the reasons to show if someone opens it. */
export async function blockDomain(domain: string, reasons: string[]) {
  if (await isAllowed(domain)) return;
  await chrome.storage.session.set({ [VERDICT(domain)]: { verdict: "block", reasons } satisfies Verdict });
  const id = ruleIdFor(domain);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{ id, priority: 1, action: { type: "block" as chrome.declarativeNetRequest.RuleActionType }, condition: { requestDomains: [domain], resourceTypes: ["main_frame" as chrome.declarativeNetRequest.ResourceType] } }],
  });
}

/** After a chat check: red link warnings become blocking rules for those domains. */
export async function guardChatFlags(ctx: ChatContext, flags: ChatFlag[]) {
  for (const f of flags) {
    if (f.severity !== "danger" || !LINK_CHECK_PATTERNS.includes(f.pattern)) continue;
    const msg = ctx.messages.find((m) => m.id === f.messageId);
    if (!msg || msg.fromMe) continue;
    for (const link of suspiciousLinks(msg.text, ctx.platform)) {
      const domain = domainOf(link);
      if (domain) await blockDomain(domain, [f.reason]).catch((e) => console.warn("[Second Look guard] rule failed", e));
    }
  }
}

/** Check one destination: look-alikes on the device first, then the server. */
async function verdictFor(url: string, domain: string): Promise<Verdict> {
  const known = (await chrome.storage.session.get(VERDICT(domain)))[VERDICT(domain)] as Verdict | undefined;
  if (known) return known;
  const look = checkLookalike(url);
  let verdict: Verdict = look ? { verdict: "block", reasons: [look.text] } : { verdict: "ok", reasons: [] };
  if (!look) {
    try {
      const res = await fetch(`${SERVER_URL}/check-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (res.ok) verdict = (await res.json()) as Verdict;
    } catch {
      return { verdict: "ok", reasons: [] }; // server down: don't cache, don't block
    }
  }
  await chrome.storage.session.set({ [VERDICT(domain)]: verdict });
  return verdict;
}

async function maybeStop(tabId: number, url: string) {
  const domain = domainOf(url);
  if (!domain || (await isAllowed(domain))) return;
  const v = await verdictFor(url, domain);
  if (v.verdict === "block") await showWarning(tabId, { url, domain, reasons: v.reasons });
}

export function startLinkGuard() {
  // A new tab or window opened from a marketplace tab is guarded until the user navigates on their own.
  chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
    void (async () => {
      const source = await chrome.tabs.get(d.sourceTabId).catch(() => null);
      const sourceGuarded = (await guardedTabs()).has(d.sourceTabId);
      if (sourceGuarded || isMarketplaceUrl(source?.url)) await setGuarded(d.tabId, true);
      const to = destinationToCheck({ fromUrl: source?.url, toUrl: d.url, guardedTab: sourceGuarded });
      if (to) await maybeStop(d.tabId, to);
    })();
  });

  chrome.webNavigation.onBeforeNavigate.addListener((d) => {
    if (d.frameId !== 0) return;
    void (async () => {
      const tab = await chrome.tabs.get(d.tabId).catch(() => null);
      const to = destinationToCheck({ fromUrl: tab?.url, toUrl: d.url, guardedTab: (await guardedTabs()).has(d.tabId) });
      if (to) await maybeStop(d.tabId, to);
    })();
  });

  // Typing an address or using a bookmark is the user's own choice: stop guarding that tab.
  chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0) return;
    if (["typed", "auto_bookmark", "generated", "keyword"].includes(d.transitionType)) void setGuarded(d.tabId, false);
  });

  // A blocking rule fired: replace Chrome's plain error page with Second Look's warning.
  chrome.webNavigation.onErrorOccurred.addListener((d) => {
    if (d.frameId !== 0 || !d.error.includes("ERR_BLOCKED_BY_CLIENT")) return;
    void (async () => {
      const domain = domainOf(d.url);
      if (!domain) return;
      const v = (await chrome.storage.session.get(VERDICT(domain)))[VERDICT(domain)] as Verdict | undefined;
      if (v?.verdict === "block") await showWarning(d.tabId, { url: d.url, domain, reasons: v.reasons });
    })();
  });

  chrome.tabs.onRemoved.addListener((tabId) => void setGuarded(tabId, false));
}

/**
 * A tab Second Look itself opened for a link clicked on a marketplace (outbound
 * link cleaning). Chrome doesn't report it as opened from that page, so mark
 * it guarded and check the destination here.
 */
export async function guardOpenedTab(tabId: number, url: string) {
  await setGuarded(tabId, true);
  const to = destinationToCheck({ toUrl: url, guardedTab: true });
  if (to) await maybeStop(tabId, to);
}

/** "Continue anyway" on the warning page: allow this site for the session and open it. */
export async function allowSite(tabId: number, domain: string, url: string) {
  await chrome.storage.session.set({ [ALLOWED(domain)]: true });
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleIdFor(domain)] });
  await chrome.tabs.update(tabId, { url });
}
