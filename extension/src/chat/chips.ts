// Inline warning chips under chat messages. Each message gets one shadow-DOM
// host (so the site's CSS can't break it), marked data-dealdig so the watcher
// ignores it. We only ever append our host; the site's own message text is
// never edited or hidden.

import { CHAT_PATTERN_BY_ID } from "../../../shared/chatPatterns";
import type { ChatFlag } from "../../../shared/types";

export interface ChipActions {
  report(flag: ChatFlag): void;
  dismiss(flag: ChatFlag): void;
}

const ICON = { danger: "⛔", caution: "⚠️", info: "ℹ️", good: "✅" } as const;

const STYLE = `
  :host { all: initial; display: block; }
  .chips { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px; max-width: 420px;
    font: 13px/1.35 system-ui, -apple-system, sans-serif; }
  .chip { border-radius: 10px; padding: 6px 9px; border: 1px solid; }
  .chip.caution { background: #fffbeb; border-color: #f59e0b; color: #78350f; }
  .chip.danger { background: #fef2f2; border-color: #ef4444; color: #7f1d1d; }
  .head { display: flex; gap: 6px; align-items: flex-start; }
  .reason { flex: 1; }
  .brand { font-weight: 700; }
  .actions { display: flex; gap: 10px; margin-top: 4px; padding-left: 22px; }
  button { all: unset; cursor: pointer; font-weight: 600; font-size: 12px; text-decoration: underline; opacity: .85; }
  button:hover, button:focus-visible { opacity: 1; }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px; }
  .why { margin-top: 4px; padding-left: 22px; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    .chip.caution { background: #2b2108; border-color: #b45309; color: #fde68a; }
    .chip.danger { background: #2b0f0f; border-color: #b91c1c; color: #fecaca; }
  }
`;

/** messageId → our host element. */
const hosts = new Map<string, { host: HTMLElement; sig: string }>();

const signature = (flags: ChatFlag[]) => flags.map((f) => `${f.pattern}|${f.severity}|${f.reason}`).join("\n");

function render(root: ShadowRoot, flags: ChatFlag[], actions: ChipActions) {
  root.innerHTML = `<style>${STYLE}</style><div class="chips"></div>`;
  const list = root.querySelector(".chips")!;
  for (const flag of flags) {
    const p = CHAT_PATTERN_BY_ID[flag.pattern];
    const chip = document.createElement("div");
    chip.className = `chip ${flag.severity}`;
    chip.setAttribute("role", "note");
    chip.innerHTML = `
      <div class="head"><span aria-hidden="true"></span><span class="reason"><span class="brand">DealDig:</span> </span></div>
      <div class="actions"><button class="why-btn" aria-expanded="false">Why?</button><button class="report">Report</button><button class="dismiss">Not a scam</button></div>`;
    chip.querySelector(".head > span")!.textContent = ICON[flag.severity];
    chip.querySelector(".reason")!.append(flag.reason);
    const whyBtn = chip.querySelector<HTMLButtonElement>(".why-btn")!;
    whyBtn.addEventListener("click", () => {
      const open = chip.querySelector(".why");
      if (open) {
        open.remove();
        whyBtn.textContent = "Why?";
        whyBtn.setAttribute("aria-expanded", "false");
        return;
      }
      const why = document.createElement("div");
      why.className = "why";
      why.textContent = `${p.name}. ${flag.source === "ai" ? `${p.reason} ` : ""}${p.tip}`;
      chip.append(why);
      whyBtn.textContent = "Hide";
      whyBtn.setAttribute("aria-expanded", "true");
    });
    chip.querySelector(".report")!.addEventListener("click", () => actions.report(flag));
    chip.querySelector(".dismiss")!.addEventListener("click", () => actions.dismiss(flag));
    list.append(chip);
  }
}

/** Show (or update) the chips for one message. Re-attaches if the site re-rendered the message. */
export function showChips(el: HTMLElement, messageId: string, flags: ChatFlag[], actions: ChipActions) {
  if (!flags.length) return removeChips(messageId);
  const sig = signature(flags);
  let entry = hosts.get(messageId);
  if (!entry || !entry.host.isConnected || entry.host.parentElement !== el) {
    entry?.host.remove();
    const host = document.createElement("div");
    host.dataset.dealdig = "chip";
    host.attachShadow({ mode: "open" });
    el.append(host);
    entry = { host, sig: "" };
    hosts.set(messageId, entry);
  }
  if (entry.sig !== sig) {
    render(entry.host.shadowRoot!, flags, actions);
    entry.sig = sig;
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
