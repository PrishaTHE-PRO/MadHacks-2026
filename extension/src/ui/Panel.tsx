// The DealDig sidebar: header, Listing · Chat · Check image · Report tabs, body, footer.
// Pure UI: it renders a `PanelView` and reports clicks through callbacks, so
// the preview page can drive it with mock data and the side panel with the
// real per-tab state. It fills its container (the side panel window).

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { Listing, ListingStep, RiskReport } from "../../../shared/types";
import type { HistoryEntry } from "../historyCore";
import { Bubble } from "./Bubble";
import { ImageTab } from "./ImageTab";
import { ListingTab } from "./ListingTab";
import { ReportTab } from "./ReportTab";
import { CantConnectState, EmptyState, ErrorState, LoadingState } from "./States";

export type PanelView =
  | { kind: "empty" }
  | { kind: "loading"; listing?: Listing; plan?: ListingStep[]; step?: ListingStep }
  | { kind: "error"; message: string; offline: boolean } // offline: the server can't be reached
  | { kind: "listing"; listing: Listing; report: RiskReport };

export type PanelTab = "listing" | "chat" | "image" | "report";

export interface PanelProps {
  view: PanelView;
  /** The site being checked, shown under the title, e.g. "Poshmark". */
  site?: string;
  /** The Chat tab's content (built by the side panel from the live chat state). */
  chatTab: ReactNode;
  /** Chat warnings count for the Chat tab pill. */
  chatCount?: number;
  initialTab?: PanelTab;
  /** This device's check history (earlier visits on the Listing tab). */
  history: HistoryEntry[];
  /** Always available under the Listing tab, whatever its state: history, privacy settings. */
  tools?: ReactNode;
  /** "Who knows you looked", shown with a listing result. */
  privacy?: ReactNode;
  onClose(): void;
  onRetry(): void;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "listing", label: "Listing" },
  { id: "chat", label: "Chat" },
  { id: "image", label: "Check image" },
  { id: "report", label: "Report" },
];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Panel(props: PanelProps) {
  const { view, site, chatCount = 0, onClose } = props;
  const [tab, setTab] = useState<PanelTab>(props.initialTab ?? "listing");
  // The tab just left (its pill tucks out), and its view while it fades out.
  const [prev, setPrev] = useState<PanelTab | null>(null);
  const [leaving, setLeaving] = useState<PanelTab | null>(null);
  // Bumped on every switch: keys the pills and labels so their animations replay
  // cleanly even on fast clicks. 0 = first render, shown without animation.
  const [switches, setSwitches] = useState(0);
  const listing = view.kind === "listing" ? view.listing : undefined;

  const tabRefs = useRef(new Map<PanelTab, HTMLButtonElement>());

  const select = (next: PanelTab) => {
    if (next === tab) return;
    setPrev(tab);
    setLeaving(reducedMotion() ? null : tab);
    setTab(next);
    setSwitches((n) => n + 1);
  };

  // Hide the old view once its 120ms fade is done. Guarded: only clears the view
  // it was set for, so a quick switch back never hides the tab the user returned to.
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setLeaving((l) => (l === leaving ? null : l)), 130);
    return () => clearTimeout(id);
  }, [leaving, switches]);

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
    select(TABS[next].id);
    tabRefs.current.get(TABS[next].id)?.focus();
  };

  // Every view stays mounted (just hidden), so a half-written report or a
  // checked image survives a trip to another tab.
  let listingBody: ReactNode;
  let footer: ReactNode = null;
  if (view.kind === "empty") {
    listingBody = (
      <>
        <EmptyState />
        {props.tools}
      </>
    );
  } else if (view.kind === "loading") {
    listingBody = <LoadingState plan={view.plan} step={view.step} />;
  } else if (view.kind === "error") {
    listingBody = (
      <>
        {view.offline ? <CantConnectState onRetry={props.onRetry} /> : <ErrorState message={view.message} onRetry={props.onRetry} />}
        {props.tools}
      </>
    );
  } else {
    listingBody = (
      <>
        <ListingTab listing={view.listing} report={view.report} history={props.history} onRetry={props.onRetry} />
        {props.privacy}
        {props.tools}
      </>
    );
    footer = (
      <button className="dd-btn secondary" onClick={() => select("report")}>
        Report seller
      </button>
    );
  }

  const bodies: Record<PanelTab, ReactNode> = {
    listing: listingBody,
    chat: props.chatTab,
    image: <ImageTab />,
    report: <ReportTab listing={listing} onCancel={() => select("listing")} />,
  };

  return (
    // Keyed by tab/page in the side panel, so switching browser tabs crossfades.
    <div className="dd-pop dd-fade-in" role="region" aria-label="DealDig">
      <header className="dd-head">
        <Bubble size={36} />
        <div className="dd-head-text">
          <div className="dd-name">DealDig</div>
          <div className="dd-site">{site ? `Checking ${site}` : "Scam checks for listings and chats"}</div>
        </div>
        <button className="dd-close" aria-label="Close DealDig" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="dd-tabs" role="tablist" aria-label="DealDig sections" onKeyDown={onTabKey}>
        {TABS.map((t) => {
          const motion = t.id === tab ? (switches ? "on" : "static") : t.id === prev ? "off" : "";
          return (
            <button
              key={t.id}
              ref={(b) => {
                if (b) tabRefs.current.set(t.id, b);
                else tabRefs.current.delete(t.id);
              }}
              id={`dd-tab-${t.id}`}
              className={`dd-tab ${motion}`}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`dd-tabpanel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} // roving tabindex: Tab enters the list, arrows move within it
              onClick={() => select(t.id)}
            >
              {/* Keyed by the switch count so each switch replays the animations from the start. */}
              <span key={`pill${switches}`} className="dd-tab-pill" aria-hidden="true">
                <span className="dd-tab-sheen" />
              </span>
              <span key={`label${switches}`} className="dd-tab-label" aria-hidden="true">
                {[...t.label].map((ch, i) => (
                  <span key={i} style={{ "--i": i } as CSSProperties}>
                    {ch}
                  </span>
                ))}
              </span>
              <span className="dd-sr">{t.label}</span>
              {t.id === "chat" && chatCount > 0 && (
                // key: remount (and bump) whenever the count changes
                <span key={chatCount} className="dd-count dd-bump" aria-label={`${chatCount} warnings`}>
                  {chatCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="dd-views">
        {TABS.map((t) => {
          const active = t.id === tab;
          const out = !active && t.id === leaving;
          return (
            <div
              key={t.id}
              className={`dd-body${active && switches ? " dd-view-in" : ""}${out ? " dd-view-out" : ""}`}
              id={`dd-tabpanel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`dd-tab-${t.id}`}
              hidden={!active && !out}
            >
              {bodies[t.id]}
            </div>
          );
        })}
      </div>
      {footer && tab === "listing" && <footer className="dd-foot">{footer}</footer>}
    </div>
  );
}
