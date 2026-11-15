// The DealDig sidebar: header, Listing · Chat · Report tabs, body, footer.
// Pure UI: it renders a `PanelView` and reports clicks through callbacks, so
// the preview page can drive it with mock data and the side panel with the
// real per-tab state. It fills its container (the side panel window).

import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { Listing, RiskReport } from "../../../shared/types";
import { Bubble } from "./Bubble";
import { ListingTab } from "./ListingTab";
import { ReportTab } from "./ReportTab";
import { CantConnectState, EmptyState, ErrorState, LoadingState } from "./States";

export type PanelView =
  | { kind: "empty" }
  | { kind: "loading"; listing?: Listing }
  | { kind: "error"; message: string; offline: boolean } // offline: the server can't be reached
  | { kind: "listing"; listing: Listing; report: RiskReport };

export type PanelTab = "listing" | "chat" | "report";

export interface PanelProps {
  view: PanelView;
  /** Site pill, e.g. "Poshmark". */
  site?: string;
  /** The Chat tab's content (built by the side panel from the live chat state). */
  chatTab: ReactNode;
  /** Chat warnings count for the Chat tab pill. */
  chatCount?: number;
  initialTab?: PanelTab;
  onClose(): void;
  onRetry(): void;
  /** Send a seller report; resolves true when it was saved. */
  onSubmitReport(reason: string): Promise<boolean>;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "listing", label: "Listing" },
  { id: "chat", label: "Chat" },
  { id: "report", label: "Report" },
];

export function Panel(props: PanelProps) {
  const { view, site, chatCount = 0, onClose } = props;
  const [tab, setTab] = useState<PanelTab>(props.initialTab ?? "listing");
  const listing = view.kind === "listing" ? view.listing : undefined;

  // Arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern).
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight" ? (i + 1) % TABS.length
      : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  let body: ReactNode;
  let footer: ReactNode = null;
  if (tab === "chat") {
    body = props.chatTab;
  } else if (tab === "report") {
    body = <ReportTab listing={listing} onSubmit={props.onSubmitReport} onCancel={() => setTab("listing")} />;
  } else if (view.kind === "empty") {
    body = <EmptyState />;
  } else if (view.kind === "loading") {
    body = <LoadingState />;
  } else if (view.kind === "error") {
    body = view.offline ? <CantConnectState onRetry={props.onRetry} /> : <ErrorState message={view.message} onRetry={props.onRetry} />;
  } else {
    body = <ListingTab listing={view.listing} report={view.report} />;
    footer = (
      <button className="dd-btn secondary" onClick={() => setTab("report")}>
        Report seller
      </button>
    );
  }

  return (
    <div className="dd-pop" role="region" aria-label="DealDig">
      <header className="dd-head">
        <Bubble size={26} />
        <span className="dd-name">DealDig</span>
        {site && <span className="dd-site">{site}</span>}
        <button className="dd-close" aria-label="Close DealDig" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="dd-tabs" role="tablist" aria-label="DealDig sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`dd-tab-${t.id}`}
            className="dd-tab"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="dd-tabpanel"
            tabIndex={tab === t.id ? 0 : -1} // roving tabindex: Tab enters the list, arrows move within it
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "chat" && chatCount > 0 && (
              <span className="dd-count" aria-label={`${chatCount} warnings`}>
                {chatCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="dd-body" id="dd-tabpanel" role="tabpanel" aria-labelledby={`dd-tab-${tab}`}>
        {body}
      </div>
      {footer && <footer className="dd-foot">{footer}</footer>}
    </div>
  );
}
