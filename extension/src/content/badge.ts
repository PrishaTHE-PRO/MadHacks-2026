// Small floating badge on the page itself. Lives in a shadow root so the
// site's CSS can't break it (and ours can't break the site).

import type { RiskReport } from "../../../shared/types";

type BadgeState =
  | { state: "loading" }
  | { state: "done"; report: RiskReport }
  | { state: "error"; message: string };

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;

const COLORS = { low: "#1f9d55", medium: "#d97706", high: "#dc2626" } as const;

function ensure(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement("div");
  host.id = "dealdig-badge-host";
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        display: flex; align-items: center; gap: 8px; padding: 10px 14px;
        border-radius: 999px; background: #111827; color: #fff; cursor: pointer;
        font: 600 13px/1.2 system-ui, -apple-system, sans-serif;
        box-shadow: 0 6px 20px rgba(0,0,0,.25); }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; }
      .loading .dot { animation: pulse 1s infinite ease-in-out; }
      @keyframes pulse { 50% { opacity: .3; } }
      .sub { font-weight: 400; opacity: .75; }
    </style>
    <div class="pill" title="Open DealDig for details"><span class="dot"></span><span class="label"></span></div>`;
  root.querySelector(".pill")!.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
  });
  return root;
}

export function showBadge(s: BadgeState) {
  const r = ensure();
  const pill = r.querySelector<HTMLDivElement>(".pill")!;
  const dot = r.querySelector<HTMLSpanElement>(".dot")!;
  const label = r.querySelector<HTMLSpanElement>(".label")!;
  pill.className = "pill " + s.state;

  if (s.state === "loading") {
    dot.style.background = "#9ca3af";
    label.innerHTML = `DealDig <span class="sub">checking…</span>`;
  } else if (s.state === "error") {
    dot.style.background = "#6b7280";
    label.innerHTML = `DealDig <span class="sub"></span>`;
    label.querySelector(".sub")!.textContent = s.message;
  } else {
    const { level } = s.report;
    dot.style.background = COLORS[level];
    const word = level === "low" ? "Low risk" : level === "medium" ? "Be careful" : "High risk";
    label.innerHTML = `DealDig <span class="sub">${word}</span>`;
  }
}

export function hideBadge() {
  host?.remove();
  host = null;
  root = null;
}
