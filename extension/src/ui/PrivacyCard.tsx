// "Who knows you looked": what the tracker shield stopped on this page, who
// still sees the view (the marketplace itself, honestly), and exactly what
// Second Look sent for its check. Pure UI, so the preview can render it with mocks.

import { useState } from "react";
import { CATEGORY_LABEL, type SentSummary, type TrackerCategory } from "../../../shared/privacy";
import type { ShieldSummary } from "../privacy/shield";

const CATEGORIES: TrackerCategory[] = ["advertising", "analytics", "social"];

export interface PrivacyCardProps {
  summary: ShieldSummary | null;
  sent?: SentSummary;
  /** The marketplace's name, e.g. "Poshmark". */
  siteName?: string;
  onPause(paused: boolean): void;
}

export function PrivacyCard({ summary, sent, siteName = "This site", onPause }: PrivacyCardProps) {
  const [open, setOpen] = useState(false);
  const isFacebook = summary?.site === "facebook.com";
  const head = headline(summary);
  return (
    <section className="dd-card dd-privacy" aria-label="Who knows you looked">
      {/* Collapsed: the symbol, the title and one line. Everything else is under "See more". */}
      <div className="dd-privacy-top">
        <span className={`dd-who-mark ${head.mark}`} aria-hidden="true">{head.symbol}</span>
        <div className="dd-who-text">
          <h3>Who knows you looked</h3>
          <span className="dd-privacy-line">{head.text}</span>
        </div>
      </div>
      <div className="dd-why">
        <button className="dd-why-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>See more</span>
          <svg className="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        {open && (
          <div className="dd-why-body dd-privacy-more">
            <ShieldDetails summary={summary} isFacebook={isFacebook} onPause={onPause} />
            <ul className="dd-who">
              <li>
                <span className="dd-who-mark caution" aria-hidden="true">!</span>
                <div className="dd-who-text">
                  <span className="dd-who-title">Still sees this view: {siteName}</span>
                  <span className="dd-fine">
                    {siteName} can see you opened this listing. No extension can hide that while you're signed in.
                  </span>
                </div>
              </li>
              <SentRow sent={sent} />
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** The one line under the title: what the tracker shield did on this page. */
function headline(summary: ShieldSummary | null): { mark: "good" | "caution" | "info"; symbol: string; text: string } {
  if (!summary) return { mark: "info", symbol: "…", text: "Checking which trackers were stopped…" };
  if (!summary.on || summary.paused)
    return { mark: "caution", symbol: "!", text: `Tracker shield is ${summary.paused ? "paused on this site" : "off"}` };
  const noun = summary.total === 1 ? "tracker request" : "tracker requests";
  return {
    mark: "good",
    symbol: "✓",
    text: summary.total ? `Stopped ${summary.total} ${noun} from seeing this listing` : "No known trackers tried to load on this page",
  };
}

/** Under "See more": the shield's details, who it stopped, and the pause switch. */
function ShieldDetails({ summary, isFacebook, onPause }: { summary: ShieldSummary | null; isFacebook: boolean; onPause(paused: boolean): void }) {
  if (!summary) return null;
  const off = !summary.on || summary.paused;
  return (
    <div className="dd-shield-details">
      {off && <span className="dd-fine">Advertisers and analytics companies on this page can see which listing you opened.</span>}
      {!off && isFacebook && <span className="dd-fine">Facebook still sees this view through its own servers. Other advertisers don't.</span>}
      {!off && summary.stale && <span className="dd-fine">Chrome limits how often this list refreshes. It updates again shortly.</span>}
      {!off && summary.blocked.length > 0 && (
        <details>
          <summary>See who ({summary.blocked.length})</summary>
          {CATEGORIES.map((c) => {
            const rows = summary.blocked.filter((b) => b.category === c);
            if (!rows.length) return null;
            return (
              <div key={c}>
                <p className="dd-tracker-group">{CATEGORY_LABEL[c]}</p>
                <ul className="dd-trackers">
                  {rows.map((b) => (
                    <li key={b.domain}>
                      <code>{b.domain}</code>: {b.about}
                      {b.count > 1 ? ` (${b.count}×)` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </details>
      )}
      {summary.site && summary.on && (
        <button className="dd-link dd-small dd-shield-pause" onClick={() => onPause(!summary.paused)}>
          {summary.paused ? "Resume shield here" : "Pause shield on this site"}
        </button>
      )}
    </div>
  );
}

function SentRow({ sent }: { sent?: SentSummary }) {
  if (!sent) return null;
  const photos = sent.photoFingerprints
    ? `${sent.photoFingerprints} photo fingerprint${sent.photoFingerprints === 1 ? "" : "s"}`
    : "no photo fingerprints";
  const copies = sent.photoCopies
    ? `, plus ${sent.photoCopies} small photo cop${sent.photoCopies === 1 ? "y" : "ies"} for Claude to look at (not stored)`
    : "";
  return (
    <li>
      <span className="dd-who-mark info" aria-hidden="true">i</span>
      <div className="dd-who-text">
        <span className="dd-who-title">Second Look sent: public listing details only</span>
        <span className="dd-fine">
          {sent.fields.join(", ")}, and {photos}{copies}.
          {sent.linkTrimmed ? " Tracking tags and session codes were cut from the link." : ""}
        </span>
        <span className="dd-fine">
          Not sent: your marketplace account, your cookies, or your Second Look reporter ID. The server doesn't record who checked which listing.
          Claude (Anthropic) reviews the listing for the risk level.
          {sent.webPhotos
            ? " Photos also went to Google and Sightengine to find copies and AI fakes (you turned this on)."
            : " Photos weren't sent to Google or Sightengine."}
        </span>
      </div>
    </li>
  );
}
