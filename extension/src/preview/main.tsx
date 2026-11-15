// UI preview page: chrome-extension://<extension id>/preview.html
// Renders the DealDig sidebar with mock data in a sidebar-sized frame, so it
// can be checked without a marketplace or the server.

import { useEffect, useState } from "react";
import { PLATFORM_NAMES, type ChatRole } from "../../../shared/types";
import { flagKey } from "../messages";
import { Bubble, type BubbleIcon } from "../ui/Bubble";
import { ChatTab, chatWarningCount } from "../ui/ChatTab";
import { Panel, type PanelTab, type PanelView } from "../ui/Panel";
import { mountInShadow } from "../ui/shadow";
import { arrivingFlag, highListing, highReport, lowListing, lowReport, mediumListing, mediumReport, mockChat } from "./mocks";
import type { ListingStep } from "../../../shared/types";

const PLAN: ListingStep[] = ["seller", "item", "price", "summary"];
import { OnPagePreview } from "./OnPage";

const PREVIEW_CSS = `
  .pv { min-height: 100vh; font-family: var(--dd-font); color: var(--dd-ink); background: #EEF0F4;
    display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px 16px 40px; }
  .pv-bar { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 760px;
    background: var(--dd-surface); border: 1px solid var(--dd-border); border-radius: 10px; padding: 4px; }
  .pv-bar button { border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; cursor: pointer;
    font: 500 13px var(--dd-font); color: var(--dd-muted); }
  .pv-bar button:hover { color: var(--dd-ink); }
  .pv-bar button[aria-pressed="true"] { background: var(--dd-surface-2); color: var(--dd-ink); font-weight: 600; }
  .pv-title { margin: 0; font-size: 12px; font-weight: 500; color: var(--dd-muted); text-align: center; }
  .pv-frame { width: 380px; max-width: 100%; height: 680px; border-radius: 10px; overflow: hidden;
    border: 1px solid var(--dd-border); box-shadow: 0 10px 30px rgba(16,24,40,.12); }
  .pv-grid { display: grid; grid-template-columns: auto repeat(4, minmax(64px, auto)); gap: 18px 20px;
    align-items: center; justify-items: center; background: var(--dd-surface); border: 1px solid var(--dd-border);
    border-radius: 10px; padding: 20px 24px; }
  .pv-grid .h { font-size: 12px; font-weight: 600; color: var(--dd-muted); }
  .pv-toast { font-size: 13px; background: var(--dd-surface); border: 1px solid var(--dd-border); border-radius: 8px; padding: 6px 12px; }
  .pv-onpage { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 640px; }
  .pv-panel { background: var(--dd-surface); border: 1px solid var(--dd-border); border-radius: 10px; padding: 16px; }
  .pv-h { margin: 0; font-size: 15px; font-weight: 600; }
  .pv-sub { margin: 2px 0 12px; font-size: 13px; color: var(--dd-muted); }
  .pv-badges { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 18px 16px; padding: 14px; border-radius: 8px; background: #F7F7F5; }
  .pv-badge-slot { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .pv-badge-slot.tall { padding-top: 150px; margin-left: auto; align-items: flex-end; order: 9; }
  .pv-cap { font-size: 11px; font-weight: 500; color: var(--dd-muted); }
  .pv-chat { display: flex; flex-direction: column; gap: 4px; padding: 14px; border-radius: 8px; background: #F7F8FA; }
  .pv-msg { max-width: 80%; padding: 8px 12px; border-radius: 16px; font-size: 14px; margin-top: 8px; }
  .pv-msg.them { align-self: flex-start; background: #e4e6eb; color: #050505; border-bottom-left-radius: 4px; }
  .pv-mock { font-size: 12px; }
  .pv-mocks { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; }
  .pv-msg.me { align-self: flex-end; background: #0866ff; color: #fff; border-bottom-right-radius: 4px; }
`;

type StateId = "bubbles" | "onpage" | "low" | "medium" | "high" | "chat" | "nochat" | "loading" | "empty" | "offline" | "unreadable";

const STATES: { id: StateId; label: string }[] = [
  { id: "bubbles", label: "Bubble mark" },
  { id: "onpage", label: "Badge & chips" },
  { id: "low", label: "Low risk" },
  { id: "medium", label: "Be careful" },
  { id: "high", label: "High risk" },
  { id: "chat", label: "Chat" },
  { id: "nochat", label: "Chat: none open" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "offline", label: "Can't connect" },
  { id: "unreadable", label: "Can't read page" },
];

function viewFor(id: Exclude<StateId, "bubbles" | "onpage">): { view: PanelView; site?: string; tab?: PanelTab; chat?: boolean } {
  switch (id) {
    case "low":
      return { view: { kind: "listing", listing: lowListing, report: lowReport }, site: PLATFORM_NAMES.ebay };
    case "medium":
      return { view: { kind: "listing", listing: mediumListing, report: mediumReport }, site: PLATFORM_NAMES.poshmark };
    case "high":
      return { view: { kind: "listing", listing: highListing, report: highReport }, site: "Facebook", chat: true };
    case "chat":
      return { view: { kind: "listing", listing: highListing, report: highReport }, site: "Facebook", tab: "chat", chat: true };
    case "nochat":
      return { view: { kind: "empty" }, tab: "chat" };
    case "loading":
      return { view: { kind: "loading", plan: PLAN, step: "seller" }, site: PLATFORM_NAMES.poshmark };
    case "empty":
      return { view: { kind: "empty" } };
    case "offline":
      return { view: { kind: "error", message: "Can't reach the DealDig server. Is it running?", offline: true }, site: PLATFORM_NAMES.ebay };
    case "unreadable":
      return { view: { kind: "error", message: "Couldn't read this listing.", offline: false }, site: "Facebook" };
  }
}

const initial = (): StateId => {
  const h = location.hash.slice(1) as StateId;
  return STATES.some((s) => s.id === h) ? h : "high";
};

function Preview() {
  const [state, setState] = useState<StateId>(initial);
  const [toast, setToast] = useState("");
  const [open, setOpen] = useState(true);
  const [role, setRole] = useState<ChatRole>("buyer");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [replay, setReplay] = useState(0); // remounts the panel to replay arrival animations
  const [arrived, setArrived] = useState(false); // mock: a new chat warning came in
  const [stepIndex, setStepIndex] = useState(0);
  const pick = (id: StateId) => {
    setState(id);
    setOpen(true);
    setToast("");
    setArrived(false);
    setStepIndex(0);
    history.replaceState(null, "", `#${id}`);
  };

  // Loading: walk through the server's steps like a real check does.
  useEffect(() => {
    if (state !== "loading") return;
    const t = setInterval(() => setStepIndex((i) => (i + 1) % (PLAN.length + 1)), 1100);
    return () => clearInterval(t);
  }, [state]);

  let v = state === "bubbles" || state === "onpage" ? null : viewFor(state);
  if (v && state === "loading")
    v = { ...v, view: { kind: "loading", plan: PLAN, step: stepIndex ? PLAN[stepIndex - 1] : undefined } };
  const chat = v?.chat
    ? arrived
      ? {
          ...mockChat,
          flags: [...mockChat.flags, arrivingFlag.flag],
          quotes: { ...mockChat.quotes, m7: arrivingFlag.message },
        }
      : mockChat
    : null;

  return (
    <div className="pv">
      <nav className="pv-bar" aria-label="Preview state">
        {STATES.map((s) => (
          <button key={s.id} aria-pressed={state === s.id} onClick={() => pick(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <p className="pv-title">DealDig sidebar preview · mock data, made-up sellers</p>
      {toast && (
        <div className="pv-toast" role="status">
          {toast}
        </div>
      )}

      {state === "onpage" ? (
        <OnPagePreview />
      ) : !v ? (
        <BubbleGrid />
      ) : open ? (
        <div className="pv-frame dd-backdrop">
          <div className="dd-fill">
            <Panel
              key={`${state}:${replay}`}
              view={v.view}
              site={v.site}
              initialTab={v.tab}
              chatCount={chatWarningCount(chat, dismissed)}
              chatTab={
                <ChatTab
                  chat={chat}
                  role={role}
                  dismissed={dismissed}
                  onRole={setRole}
                  onShowDismissed={() => setDismissed([])}
                />
              }
              onClose={() => setOpen(false)}
              onRetry={() => setToast("Try again: would re-run the listing check.")}
              onSubmitReport={async () => {
                await new Promise((r) => setTimeout(r, 600));
                return true;
              }}
            />
          </div>
        </div>
      ) : (
        <button className="dd-btn primary" style={{ width: 180, flex: "none" }} onClick={() => setOpen(true)}>
          Reopen sidebar
        </button>
      )}
      {v && (
        <div className="pv-mocks">
          <button className="dd-link pv-mock" onClick={() => setReplay((n) => n + 1)}>
            Replay animations
          </button>
          {chat && (
            <button className="dd-link pv-mock" onClick={() => setArrived(!arrived)}>
              {arrived ? "Mock: remove the new warning" : "Mock: a new warning arrives"}
            </button>
          )}
          {chat && (
            <button
              className="dd-link pv-mock"
              onClick={() => setDismissed(dismissed.length ? [] : [flagKey(mockChat.flags[4])])}
            >
              {dismissed.length ? "Undo mock “Not a scam”" : "Mock: mark one warning “Not a scam”"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BubbleGrid() {
  const icons: BubbleIcon[] = ["none", "check", "alert", "dash"];
  const sizes = [20, 30, 48, 80];
  return (
    <div className="pv-grid">
      <span />
      {icons.map((i) => (
        <span key={i} className="h">
          {i}
        </span>
      ))}
      {sizes.map((size) => (
        <Row key={size} size={size} icons={icons} />
      ))}
    </div>
  );
}

function Row({ size, icons }: { size: number; icons: BubbleIcon[] }) {
  return (
    <>
      <span className="h">{size}px</span>
      {icons.map((i) => (
        <Bubble key={i} size={size} icon={i} />
      ))}
    </>
  );
}

mountInShadow(document.getElementById("root")!, PREVIEW_CSS).render(<Preview />);
