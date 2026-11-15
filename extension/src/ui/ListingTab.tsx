// Listing tab: community flag, verdict (score out of 100 + level), AI-photo
// notice, earlier visits, listing + price, "What we found" (every reason with its
// points and proof links, summing to the score), photo and description checks
// and (for local deals) the meetup helper.

import { useState } from "react";
import { LOCAL_PLATFORMS, type Listing, type RiskLevel, type RiskReport, type Severity, type Signal } from "../../../shared/types";
import type { HistoryEntry } from "../historyCore";
import { MeetupHelper } from "../sidepanel/Meetup";
import { Bubble, iconForLevel } from "./Bubble";
import { AiPhotoNotice, CommunityFlag, CopiedText, EarlierVisits, PhotoCheck } from "./ListingExtras";
import { money, sellerFacts, sellerName } from "./listingFacts";
import { coverageGaps, riskLabel } from "../../../shared/listingCheck";

/** Watch-out rows come in one after another, most serious first. */
const rowIn = (i: number) => ({ className: "dd-row-in", style: { animationDelay: `${120 + i * 40}ms` } });

const LEVELS: RiskLevel[] = ["low", "medium", "high"];
const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2, good: 3 };

export function ListingTab({ listing, report, history, onRetry }: { listing: Listing; report: RiskReport; history: HistoryEntry[]; onRetry(): void }) {
  return (
    <>
      <CommunityFlag community={report.community} />
      {report.signals.some((s) => s.id === "not-an-item") && (
        <section className="dd-card" aria-label="Listing type">
          <strong>Not a normal item listing</strong>
          <p>This appears to be an ad, service or event. These checks are designed for items for sale.</p>
        </section>
      )}
      <Verdict report={report} />
      <AiPhotoNotice report={report} listing={listing} />
      <button className="dd-btn secondary" onClick={onRetry}>Check again</button>
      <EarlierVisits listing={listing} history={history} />
      <ListingCard listing={listing} report={report} />
      <WhyScore report={report} />
      <PhotoCheck report={report} listing={listing} />
      <CopiedText report={report} />
      {LOCAL_PLATFORMS.includes(listing.platform) && (
        // Main's meetup helper, styled for the sidebar by legacy.css.
        <div className="dd-legacy">
          <MeetupHelper listing={listing} report={report} />
        </div>
      )}
      <p className="dd-foot-note">
        Most serious first · {report.coverage?.ai ? "rules + Claude" : "rules only · AI analysis unavailable"} ·{" "}
        {new Date(report.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </p>
    </>
  );
}

/** Where each level starts on the 0-100 scale (rules.ts levelFor). */
const LEVEL_FROM: Record<RiskLevel, number> = { low: 0, medium: 30, high: 60 };

function Verdict({ report }: { report: RiskReport }) {
  const { level } = report;
  const label = riskLabel(report);
  const gaps = coverageGaps(report.coverage);
  return (
    <section className="dd-card dd-glow dd-verdict" aria-label="Verdict">
      <div className="dd-verdict-top">
        <Bubble size={40} icon={iconForLevel(level)} />
        <div className="dd-verdict-text">
          <div className={`dd-level dd-${level} dd-word-in`}>{label}</div>
          <div className="dd-summary">{report.summary}</div>
        </div>
      </div>
      {gaps.length > 0 && <p className="dd-summary">Partial check: {gaps.join("; ")}.</p>}
      {report.aiUnavailableReason && <p className="dd-summary">AI check unavailable: {report.aiUnavailableReason}.</p>}
      {report.photoAssessments?.filter((p) => p.note && (p.ai_generated !== "no" || !p.shows_listed_item)).map((p) => (
        <p className="dd-summary" key={p.index}>Photo {p.index + 1}: {p.note}</p>
      ))}
      <div className="dd-bar" role="img" aria-label={`Risk level: ${label}`}>
        {LEVELS.map((l) => (
          <span key={l} className={l === level ? `on ${l} dd-grow` : undefined} />
        ))}
      </div>
    </section>
  );
}

function ListingCard({ listing, report }: { listing: Listing; report: RiskReport }) {
  const facts = sellerFacts(listing);
  if (report.communityReports > 0)
    facts.push(`reported by ${report.communityReports} ${report.communityReports === 1 ? "person" : "people"}`);
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
            {money(listing.price)}
            {listing.size ? ` · ${listing.size}` : ""} ·{" "}
            {listing.seller.profileUrl ? (
              <a href={listing.seller.profileUrl} target="_blank" rel="noreferrer">
                {who}
              </a>
            ) : (
              who
            )}
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
      {p && (hasRange || p.note) && (
        <div className="dd-price">
          {hasRange && <PriceRow low={p.typicalLow!} high={p.typicalHigh!} price={listing.price} />}
          {p.note && (
            <p className="dd-price-note">
              {p.note}{" "}
              {p.basis === "ai-estimate"
                ? `(AI estimate, ${p.confidence} confidence, not live sales data.)`
                : `(${p.sampleSize ? `${p.sampleSize} eBay listings, ` : ""}${p.confidence} confidence.)`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PriceRow({ low, high, price }: { low: number; high: number; price: number }) {
  const max = Math.max(high, price) * 1.3 || 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  return (
    <>
      <div className="dd-price-line">
        <span className="dd-label">Price</span>
        <span className="dd-muted">
          usually {money(low)}–{money(high)} · <strong className="dd-ink">this one {money(price)}</strong>
        </span>
      </div>
      <div className="dd-track" role="img" aria-label={`Asking ${money(price)}; usually ${money(low)} to ${money(high)}`}>
        <span className="dd-range" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <span className="dd-pin" style={{ left: pct(price) }} />
      </div>
    </>
  );
}

/** Proof links under a reason: the duplicate listing, the page with the same text... */
function Proof({ signal }: { signal: Signal }) {
  if (!signal.links?.length) return null;
  return (
    <span className="dd-proof">
      {signal.links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>
          {l.label} ↗
        </a>
      ))}
    </span>
  );
}

/** Every reason, biggest first, with its proof. No numbers: users see the level only. */
function WhyScore({ report }: { report: RiskReport }) {
  const [open, setOpen] = useState(false);
  // Points only set the order (biggest reason first); users never see numbers.
  const risky = report.signals
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  // Everything else: good signs first, then notes (e.g. "account is about 73 days old").
  const order = { good: 0, caution: 1, info: 2, danger: 3 } as const;
  const rest = report.signals.filter((s) => s.points === 0).sort((a, b) => order[a.severity] - order[b.severity]);
  const goodCount = rest.filter((s) => s.severity === "good").length;
  const noteCount = rest.length - goodCount;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const restLabel = [goodCount && `✓ ${plural(goodCount, "good sign")}`, noteCount && plural(noteCount, "note")]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="dd-card" aria-label="What we found">
      <div className="dd-watch-head">
        <h3>What we found</h3>
      </div>
      {risky.length ? (
        <>
          <ul className="dd-rows">
            {risky.map((s, i) => (
              <li key={s.id} {...rowIn(i)}>
                <span className={`dd-dot ${s.severity}`} aria-hidden="true" />
                <span className="dd-row-text">
                  <span>{s.text}</span>
                  <Proof signal={s} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="dd-note">No warning signs found.</p>
      )}
      {rest.length > 0 && (
        <>
          <button className="dd-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
            {restLabel}
            <svg className="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {open && (
            <ul className="dd-rows dd-good">
              {rest.map((s) => (
                <li key={s.id}>
                  <span className={`dd-dot ${s.severity}`} aria-hidden="true" />
                  <span className="dd-row-text">
                    <span>{s.text}</span>
                    <Proof signal={s} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
