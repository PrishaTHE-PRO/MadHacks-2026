// Listing tab: verdict (level only, never a number, with "See more" listing
// every reason and its proof links), community flag, AI-photo notice, earlier
// visits, listing + price, one card for copied photos
// and text, and (for local deals) the meetup helper.

import { LOCAL_PLATFORMS, type Listing, type RiskLevel, type RiskReport, type Severity, type Signal } from "../../../shared/types";
import type { HistoryEntry } from "../historyCore";
import { MeetupHelper } from "../sidepanel/Meetup";
import { Bubble, iconForLevel } from "./Bubble";
import { AiPhotoNotice, CommunityFlag, CopiesCard, EarlierVisits } from "./ListingExtras";
import { money, sellerFacts, sellerName } from "./listingFacts";
import { riskLabel } from "../../../shared/listingCheck";

/** Watch-out rows come in one after another, most serious first. */
const rowIn = (i: number) => ({ className: "dd-row-in", style: { animationDelay: `${120 + i * 40}ms` } });

const LEVELS: RiskLevel[] = ["low", "medium", "high"];
const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2, good: 3 };

export function ListingTab({ listing, report, history, onRetry }: { listing: Listing; report: RiskReport; history: HistoryEntry[]; onRetry(): void }) {
  return (
    <>
      <Verdict report={report} />
      <CommunityFlag community={report.community} />
      {report.signals.some((s) => s.id === "not-an-item") && (
        <section className="dd-card" aria-label="Listing type">
          <strong>Not a normal item listing</strong>
          <p>This appears to be an ad, service or event. These checks are designed for items for sale.</p>
        </section>
      )}
      <AiPhotoNotice report={report} listing={listing} />
      <button className="dd-btn secondary" onClick={onRetry}>Check again</button>
      <EarlierVisits listing={listing} history={history} />
      <ListingCard listing={listing} report={report} />
      <CopiesCard report={report} listing={listing} />
      {LOCAL_PLATFORMS.includes(listing.platform) && (
        // Main's meetup helper, styled for the sidebar by legacy.css.
        <div className="dd-legacy">
          <MeetupHelper listing={listing} report={report} />
        </div>
      )}
    </>
  );
}


function Verdict({ report }: { report: RiskReport }) {
  const { level } = report;
  const label = riskLabel(report);
  return (
    <section className="dd-card dd-glow dd-verdict" aria-label="Verdict">
      <div className="dd-verdict-top">
        <Bubble size={40} icon={iconForLevel(level)} />
        <div className="dd-verdict-text">
          <div className={`dd-level dd-${level} dd-word-in`}>{label}</div>
          <div className="dd-summary">{report.summary}</div>
        </div>
      </div>
      {report.aiUnavailableReason && <p className="dd-summary">AI check unavailable: {report.aiUnavailableReason}.</p>}
      <div className="dd-bar" role="img" aria-label={`Risk level: ${label}`}>
        {LEVELS.map((l) => (
          <span key={l} className={l === level ? `on ${l} dd-grow` : undefined} />
        ))}
      </div>
      <WhyScore report={report} />
    </section>
  );
}

function ListingCard({ listing, report }: { listing: Listing; report: RiskReport }) {
  // Reports aren't repeated here: the flag card already shows them.
  const allFacts = sellerFacts(listing);
  // "joined Sep 2016" goes next to the seller's name; the rest are chips.
  const joined = allFacts.find((f) => f.startsWith("joined "));
  const facts = allFacts.filter((f) => f !== joined);
  const p = report.priceCheck;
  const hasRange = p && p.typicalLow !== null && p.typicalHigh !== null;
  const who = sellerName(listing);
  const item = report.item;
  const itemName = item ? [item.brand, item.model].filter(Boolean).join(" ") || item.category : "";
  return (
    <section className="dd-card dd-listing" aria-label="Listing">
      <div className="dd-item">
        {listing.photos[0] ? (
          <img className="dd-thumb" src={listing.photos[0]} alt="" />
        ) : (
          <div className="dd-thumb" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <circle cx="9" cy="10" r="2" />
              <path d="M21 16l-5-5-9 9" />
            </svg>
          </div>
        )}
        <div className="dd-item-text">
          <div className="dd-title" title={listing.title}>
            {listing.title}
          </div>
          <div className="dd-meta">
            {listing.seller.profileUrl ? (
              <a href={listing.seller.profileUrl} target="_blank" rel="noreferrer">
                {who}
              </a>
            ) : (
              who
            )}
            {joined ? ` · ${joined}` : ""}
          </div>
        </div>
      </div>
      {item && (
        <div className="dd-identified">
          Identified as <strong>{itemName}</strong>
          {item.brand || item.model ? ` (${item.category})` : ""}
        </div>
      )}
      {facts.length > 0 && (
        <div className="dd-chips">
          {facts.map((f) => (
            <span key={f} className="dd-chip">
              {f}
            </span>
          ))}
        </div>
      )}
      {p && hasRange && (
        <div className="dd-price">
          <PriceRow low={p.typicalLow!} high={p.typicalHigh!} price={listing.price} estimate={p.basis === "ai-estimate"} />
        </div>
      )}
    </section>
  );
}

function PriceRow({ low, high, price, estimate }: { low: number; high: number; price: number; estimate: boolean }) {
  const max = Math.max(high, price) * 1.3 || 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  return (
    <>
      <div className="dd-price-line">
        <span className="dd-label">Price</span>
        <span className="dd-muted">
          usually {money(low)}–{money(high)}
          {estimate ? " (est.)" : ""} · <strong className="dd-ink">this one {money(price)}</strong>
        </span>
      </div>
      <div className="dd-track" role="img" aria-label={`Asking ${money(price)}; usually ${money(low)} to ${money(high)}`}>
        <span className="dd-range" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <span className={`dd-pin${price < low ? " under" : ""}`} style={{ left: pct(price) }} />
      </div>
      <div className="dd-track-labels" aria-hidden="true">
        <span style={{ left: pct(price) }}>{money(price)}</span>
        {/* Only when the pin sits outside the range; otherwise the two labels collide. */}
        {(price < low || price > high) && (
          <span className="range" style={{ left: `calc((${pct(low)} + ${pct(high)}) / 2)` }}>
            typical
          </span>
        )}
      </div>
    </>
  );
}

/** Site name for a proof link: the reason text above already says what it is. */
const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
};

/** Proof links under a reason: the duplicate listing, the page with the same text... */
function Proof({ signal }: { signal: Signal }) {
  if (!signal.links?.length) return null;
  return (
    <span className="dd-proof">
      {signal.links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" title={l.label}>
          {siteOf(l.url)} ↗
        </a>
      ))}
    </span>
  );
}

/**
 * The bottom of the verdict box, always shown: every warning, biggest first
 * (a red or yellow "!"), then good signs (a green "+") and notes in the same
 * list. No numbers: users see the level only.
 */
function WhyScore({ report }: { report: RiskReport }) {
  // Points only set the order (biggest reason first); users never see numbers.
  const risky = report.signals
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  // Everything else: good signs first, then notes (e.g. "account is about 73 days old").
  const order = { good: 0, caution: 1, info: 2, danger: 3 } as const;
  const rest = report.signals.filter((s) => s.points === 0).sort((a, b) => order[a.severity] - order[b.severity]);
  if (!risky.length && !rest.length) return null;
  return (
    <div className="dd-why dd-why-open" aria-label="Why this level">
    <div className="dd-why-body">
        <ul className="dd-rows">
          {risky.map((s, i) => (
            <li key={s.id} {...rowIn(i)}>
              <span className={`dd-points ${s.severity}`} aria-label={s.severity === "danger" ? "Red flag" : "Warning"}>
                !
              </span>
              <span className="dd-row-text">
                <span>{s.text}</span>
                <Proof signal={s} />
              </span>
            </li>
          ))}
          {rest.map((s, i) => (
            <li key={s.id} {...rowIn(risky.length + i)}>
              {s.severity === "good" ? (
                <span className="dd-points good" aria-label="Good sign">
                  +
                </span>
              ) : (
                // Notes have no marker; the empty slot keeps the text lined up.
                <span className="dd-points blank" aria-hidden="true" />
              )}
              <span className="dd-row-text">
                <span>{s.text}</span>
                <Proof signal={s} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
