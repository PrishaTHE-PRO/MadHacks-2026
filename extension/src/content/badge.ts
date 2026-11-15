// Small floating badge on listing pages (docs/ui-redesign-task.md, Phase 4).
// A white pill: bubble · verdict (level only), with a hover card showing the top
// reason. Clicking opens the DealDig sidebar. Lives in a shadow root so the
// site's CSS can't break it (and ours can't break the site).

import type { RiskReport } from "../../../shared/types";
import { riskLabel } from "../../../shared/listingCheck";
import { bubbleSvg } from "../ui/bubbleSvg";
import tokens from "../ui/tokens.css";
import motion from "../ui/motion.css";
import badgeCss from "./badge.css";
import { makeHost, rootOf } from "./stealth";

export type BadgeState =
  | { state: "loading" }
  | { state: "done"; report: RiskReport }
  | { state: "error"; message: string }
  // Sell pages: a reminder, or photos held by the upload guard (with Skip).
  | { state: "sell" }
  | { state: "held"; count: number; onSkip: () => void };

export const BADGE_CSS = [tokens, motion, badgeCss].join("\n");

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const mark = (size: number, icon: Parameters<typeof bubbleSvg>[1], id: string) => {
  const span = el("span", "dd-mark");
  span.innerHTML = bubbleSvg(size, icon, { id }); // our own constant SVG
  return span;
};

/**
 * Draw the badge into `root` (replacing what was there). `onOpen` runs when the
 * pill or "See details" is clicked. `fixed: false` draws it in place (preview page).
 */
export function renderBadge(
  root: ShadowRoot,
  s: BadgeState,
  onOpen: () => void,
  opts: { fixed?: boolean; showCard?: boolean; arrive?: boolean } = {},
) {
  const style = el("style");
  style.textContent = BADGE_CSS;
  const wrap = el("div", "dd-badge");
  if (opts.fixed === false) wrap.classList.add("static");
  if (opts.showCard) wrap.classList.add("show-card");
  // The verdict replacing "Checking…": fade it in rather than swapping instantly.
  if (opts.arrive) wrap.classList.add("arrive");

  const pill = el("button", "dd-pill");
  pill.type = "button";
  pill.addEventListener("click", onOpen);

  if (s.state === "loading") {
    pill.append(mark(28, "none", "pl"), el("span", "dd-word sheen dd-sheen", "Checking…"));
    pill.setAttribute("aria-label", "DealDig is checking this listing");
  } else if (s.state === "sell") {
    pill.append(mark(28, "check", "ps"), el("span", "dd-word", "Check your photos before posting"));
    pill.setAttribute("aria-label", "DealDig: check your photos before posting. Open DealDig");
  } else if (s.state === "held") {
    const photos = `${s.count} photo${s.count === 1 ? "" : "s"}`;
    pill.append(mark(28, "alert", "ph"), el("span", "dd-word medium", `Holding ${photos}`), el("span", "dd-sub", "Click to check"));
    pill.setAttribute("aria-label", `DealDig is holding ${photos} before upload. Open DealDig to check them`);
    // A sibling of the pill (buttons can't be nested).
    const skip = el("button", "dd-skip", "Skip");
    skip.type = "button";
    skip.title = "Upload the original photos without cleaning them";
    skip.addEventListener("click", s.onSkip);
    wrap.append(pill, skip);
    root.replaceChildren(style, wrap);
    return;
  } else if (s.state === "error") {
    pill.append(mark(28, "dash", "pe"), el("span", "dd-word", "Can't check this page"));
    pill.setAttribute("aria-label", `DealDig: can't check this page. ${s.message}. Open DealDig`);
    pill.title = s.message;
  } else {
    // Levels only: the score picks the level but is never shown.
    const { level } = s.report;
    const label = riskLabel(s.report);
    pill.append(mark(28, level === "low" ? "check" : "alert", "pd"), el("span", `dd-word ${level}`, label));
    pill.setAttribute("aria-label", `DealDig: ${label}. Open details`);

    // Hover card: bubble + level, the top reason, "See details".
    const card = el("div", "dd-hover");
    card.setAttribute("role", "note");
    const top = el("div", "dd-hover-top");
    const words = el("div");
    // Same shape as the pill: the level in color (levels only, never a number).
    const head = el("div", "dd-hover-head");
    head.append(el("span", `dd-hover-level dd-word ${level}`, label));
    words.append(head);
    top.append(mark(28, level === "low" ? "check" : "alert", "hc"), words);
    const reason = s.report.topReasons[0] ?? s.report.summary;
    const link = el("button", "dd-hover-link", "See details");
    link.type = "button";
    link.addEventListener("click", onOpen);
    card.append(top, el("p", "dd-hover-reason", reason), link);
    wrap.append(card);
  }
  wrap.append(pill);
  root.replaceChildren(style, wrap);
}

// --- The live badge on the page ---

let host: HTMLDivElement | null = null; // unmarked, closed shadow root (stealth.ts)
let lastState: BadgeState["state"] | null = null;

const openPanel = () => {
  chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
};

export function showBadge(s: BadgeState) {
  if (!host?.isConnected) {
    host = makeHost();
    document.documentElement.appendChild(host);
  }
  renderBadge(rootOf(host), s, openPanel, { arrive: lastState === "loading" && s.state !== "loading" });
  lastState = s.state;
}

export function hideBadge() {
  host?.remove();
  host = null;
  lastState = null;
}
