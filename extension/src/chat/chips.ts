// Inline warning chips under chat messages (docs/ui-redesign-task.md, Phase 5).
// Compact pill: bubble · pattern name · Why? (the reason is in the tooltip and the card).
// Why? expands it: bubble · title · reason · why this matters · Hide details · Report · Not a scam.
//
// Each message gets one shadow-DOM host (so the site's CSS can't break it),
// marked data-dealdig so the watcher ignores it. We only ever append our host;
// the site's own message text is never edited or hidden.

import { CHAT_PATTERN_BY_ID } from "../../../shared/chatPatterns";
import type { ChatFlag } from "../../../shared/types";
import { flagKey } from "../messages";
import { bubbleSvg } from "../ui/bubbleSvg";
import tokens from "../ui/tokens.css";
import motion from "../ui/motion.css";
import chipsCss from "./chips.css";

export interface ChipActions {
  report(flag: ChatFlag): void;
  dismiss(flag: ChatFlag): void;
  /** Bring back a warning just marked "Not a scam". */
  undo(flag: ChatFlag): void;
}

const CHIPS_CSS = [tokens, motion, chipsCss].join("\n");

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (className: string, text: string, onClick: () => void) => {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

const mark = (size: number, id: string) => {
  const span = el("span", "dd-mark");
  span.innerHTML = bubbleSvg(size, "alert", { id, animate: false }); // our own constant SVG
  return span;
};

/**
 * Draw the chips for one message into `root`. `expanded` holds the flagKeys
 * shown as full cards; it's kept by the caller so re-renders don't collapse them.
 * `undo` are warnings just marked "Not a scam", shown as a short "Undo" line.
 */
export function renderChips(root: ShadowRoot, flags: ChatFlag[], actions: ChipActions, expanded: Set<string>, undo: ChatFlag[] = []) {
  const style = el("style");
  style.textContent = CHIPS_CSS;
  const list = el("div", "dd-chips");
  const rerender = () => renderChips(root, flags, actions, expanded, undo);

  flags.forEach((flag, i) => {
    const p = CHAT_PATTERN_BY_ID[flag.pattern];
    const key = flagKey(flag);
    const sev = flag.severity === "danger" ? "danger" : "caution";

    if (!expanded.has(key)) {
      const chip = el("div", `dd-surface dd-compact ${sev}`);
      chip.setAttribute("role", "note");
      chip.setAttribute("aria-label", `DealDig warning: ${p.name}. ${flag.reason}`);
      const text = el("span", "dd-text");
      text.title = flag.reason;
      // Just the pattern name: a reason cut off mid-word reads worse than none. Why? has it.
      text.append(el("span", "dd-pattern", p.name));
      const why = button("dd-why", "Why?", () => {
        expanded.add(key);
        rerender();
        root.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"] .dd-hide`)?.focus();
      });
      why.setAttribute("aria-expanded", "false");
      chip.append(mark(22, `c${i}`), text, why);
      list.append(chip);
      return;
    }

    const card = el("div", `dd-surface dd-card dd-expanded ${sev}`);
    card.dataset.key = key;
    card.setAttribute("role", "note");
    const top = el("div", "dd-ex-top");
    const words = el("div");
    words.append(el("div", "dd-ex-title", p.name), el("div", "dd-ex-reason", flag.reason));
    top.append(mark(24, `e${i}`), words);
    // Why this matters: for Claude's own wording, also show the fixed reason.
    const matters = el("div", "dd-ex-matters", `${flag.source === "ai" ? `${p.reason} ` : ""}${p.tip}`);
    const links = el("div", "dd-ex-links");
    const hide = button("dd-hide", "Hide details", () => {
      expanded.delete(key);
      rerender();
    });
    hide.setAttribute("aria-expanded", "true");
    links.append(
      hide,
      button("", "Report", () => actions.report(flag)),
      button("dd-quiet", "Not a scam", () => actions.dismiss(flag)),
    );
    card.append(top, el("div", "dd-ex-divider"), matters, links);
    list.append(card);
  });

  for (const flag of undo) {
    const row = el("div", "dd-undo");
    row.setAttribute("role", "status");
    row.append(
      el("span", "", `Marked “${CHAT_PATTERN_BY_ID[flag.pattern].name}” not a scam`),
      button("dd-undo-btn", "Undo", () => actions.undo(flag)),
    );
    list.append(row);
  }

  root.replaceChildren(style, list);
}

// --- Live chips on chat pages ---

/** messageId → our host element. */
const hosts = new Map<string, { host: HTMLElement; sig: string; expanded: Set<string> }>();

const signature = (flags: ChatFlag[]) => flags.map((f) => `${f.pattern}|${f.severity}|${f.reason}`).join("\n");

/** Show (or update) the chips for one message. Re-attaches if the site re-rendered the message. */
export function showChips(el: HTMLElement, messageId: string, flags: ChatFlag[], actions: ChipActions, undo: ChatFlag[] = []) {
  if (!flags.length && !undo.length) return removeChips(messageId);
  const sig = `${signature(flags)}\nundo:${undo.map(flagKey).join(",")}`;
  let entry = hosts.get(messageId);
  let created = false;
  if (!entry || !entry.host.isConnected || entry.host.parentElement !== el) {
    created = !entry; // a re-attach after the site re-rendered isn't "new"
    entry?.host.remove();
    const host = document.createElement("div");
    host.dataset.dealdig = "chip";
    host.attachShadow({ mode: "open" });
    el.append(host);
    entry = { host, sig: "", expanded: entry?.expanded ?? new Set() };
    hosts.set(messageId, entry);
  }
  if (entry.sig !== sig) {
    renderChips(entry.host.shadowRoot!, flags, actions, entry.expanded, undo);
    entry.sig = sig;
    if (created) entry.host.shadowRoot!.querySelector(".dd-chips")?.classList.add("enter");
  }
}

export function removeChips(messageId: string) {
  hosts.get(messageId)?.host.remove();
  hosts.delete(messageId);
}

export function removeAllChips() {
  for (const { host } of hosts.values()) host.remove();
  hosts.clear();
}
