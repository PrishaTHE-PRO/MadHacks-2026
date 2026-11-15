// Small floating badge on listing pages (docs/ui-redesign-task.md, Phase 4).
// A white pill: bubble · verdict · score out of 100, with a hover card showing the top
// reason. Clicking opens the DealDig sidebar. Lives in a shadow root so the
// site's CSS can't break it (and ours can't break the site).

import type { RiskLevel, RiskReport } from "../../../shared/types";
import { bubbleSvg } from "../ui/bubbleSvg";
import tokens from "../ui/tokens.css";
import motion from "../ui/motion.css";
import badgeCss from "./badge.css";

export type BadgeState =
  | { state: "loading" }
  | { state: "done"; report: RiskReport }
  | { state: "error"; message: string };

const LEVEL_WORD: Record<RiskLevel, string> = { low: "Low risk", medium: "Be careful", high: "High risk" };

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
  } else if (s.state === "error") {
    pill.append(mark(28, "dash", "pe"), el("span", "dd-word", "Can't check this page"));
    pill.setAttribute("aria-label", `DealDig: can't check this page. ${s.message}. Open DealDig`);
    pill.title = s.message;
  } else {
    // The level, then the score out of 100 so the scale is clear.
    const { level, score } = s.report;
    const max = s.report.maxScore ?? 100;
    pill.append(
      mark(28, level === "low" ? "check" : "alert", "pd"),
      el("span", `dd-word ${level}`, LEVEL_WORD[level]),
      el("span", "dd-score", `${score}/${max}`),
    );
    pill.setAttribute("aria-label", `DealDig: ${LEVEL_WORD[level]}, risk score ${score} out of ${max}. Open details`);

    // Hover card: bubble + level, the top reason, "See details".
    const card = el("div", "dd-hover");
    card.setAttribute("role", "note");
    const top = el("div", "dd-hover-top");
    const words = el("div");
    words.append(el("div", `dd-hover-level dd-word ${level}`, `${LEVEL_WORD[level]} · ${score}/${max}`));
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

let host: HTMLDivElement | null = null;
let lastState: BadgeState["state"] | null = null;

const openPanel = () => {
  chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
};

export function showBadge(s: BadgeState) {
  if (!host?.isConnected) {
    host = document.createElement("div");
    host.id = "dealdig-badge-host";
    host.setAttribute("data-dealdig", "badge");
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  renderBadge(host.shadowRoot!, s, openPanel, { arrive: lastState === "loading" && s.state !== "loading" });
  lastState = s.state;
}

export function hideBadge() {
  host?.remove();
  host = null;
  lastState = null;
}
