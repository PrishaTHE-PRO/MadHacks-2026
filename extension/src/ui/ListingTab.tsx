// Listing tab: verdict, listing + price, "Watch out" signals. Maps a RiskReport.

import { useState } from "react";
import type { Listing, RiskLevel, RiskReport } from "../../../shared/types";
import { Bubble, iconForLevel } from "./Bubble";
import { money, sellerFacts, sellerName } from "./listingFacts";

const LEVEL_WORD: Record<RiskLevel, string> = { low: "Low risk", medium: "Be careful", high: "High risk" };
const LEVELS: RiskLevel[] = ["low", "medium", "high"];

export function ListingTab({ listing, report }: { listing: Listing; report: RiskReport }) {
  return (
    <>
      <Verdict report={report} />
      <ListingCard listing={listing} report={report} />
      <WatchOut report={report} />
      <p className="dd-foot-note">
        Score = the points above, added up · {report.aiUsed ? "rules + Claude" : "rules only"} ·{" "}
        {new Date(report.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </p>
    </>
  );
}

function Verdict({ report }: { report: RiskReport }) {
  const { level } = report;
  return (
    <section className="dd-card dd-verdict" aria-label="Verdict">
      <div className="dd-verdict-top">
        <Bubble size={40} icon={iconForLevel(level)} />
        <div className="dd-verdict-text">
          <div className="dd-level-row">
            <span className={`dd-level dd-${level}`}>{LEVEL_WORD[level]}</span>
            <span className={`dd-score dd-${level}`}>{report.score} / 100</span>
          </div>
          <div className="dd-summary">{report.summary}</div>
        </div>
      </div>
      <div className="dd-bar" role="img" aria-label={`Risk: ${LEVEL_WORD[level]}`}>
        {LEVELS.map((l) => (
          <span key={l} className={l === level ? `on ${l}` : undefined} />
        ))}
      </div>
    </section>
  );
}

function ListingCard({ listing, report }: { listing: Listing; report: RiskReport }) {
  const facts = sellerFacts(listing);
  if (report.communityReports > 0)
    facts.push(`${report.communityReports} DealDig report${report.communityReports > 1 ? "s" : ""}`);
  const p = report.priceCheck;
  const hasRange = p && p.typicalLow !== null && p.typicalHigh !== null;
  const who = sellerName(listing);
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
      {facts.length > 0 && (
        <div className="dd-chips">
          {facts.map((f) => (
            <span key={f} className="dd-chip">
              {f}
            </span>
          ))}
        </div>
      )}
      {hasRange && <PriceRow low={p.typicalLow!} high={p.typicalHigh!} price={listing.price} />}
    </section>
  );
}

function PriceRow({ low, high, price }: { low: number; high: number; price: number }) {
  const max = Math.max(high, price) * 1.3 || 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  return (
    <div className="dd-price">
      <div className="dd-price-line">
        <span className="dd-label">Price</span>
        <span className="dd-muted">
          usually {money(low)}–{money(high)} · <strong className="dd-ink">this one {money(price)}</strong>
        </span>
      </div>
      <div
        className="dd-track"
        role="img"
        aria-label={`Asking ${money(price)}; usually ${money(low)} to ${money(high)}`}
      >
        <span className="dd-range" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <span className="dd-pin" style={{ left: pct(price) }} />
      </div>
    </div>
  );
}

function WatchOut({ report }: { report: RiskReport }) {
  const [open, setOpen] = useState(false);
  const risky = report.signals.filter((s) => s.points > 0).sort((a, b) => b.points - a.points);
  // Everything that didn't add points: good signs first, then notes (e.g. "account is about 73 days old").
  const order = { good: 0, caution: 1, info: 2, danger: 3 } as const;
  const rest = report.signals.filter((s) => s.points === 0).sort((a, b) => order[a.severity] - order[b.severity]);
  const goodCount = rest.filter((s) => s.severity === "good").length;
  const noteCount = rest.length - goodCount;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const restLabel = [goodCount && `✓ ${plural(goodCount, "good sign")}`, noteCount && plural(noteCount, "note")]
    .filter(Boolean)
    .join(" · ");
  const total = risky.reduce((n, s) => n + s.points, 0);
  return (
    <section className="dd-card" aria-label="Watch out">
      <div className="dd-watch-head">
        <h3>Watch out</h3>
        {total > 0 && <span className="dd-total">+{total} points</span>}
      </div>
      {risky.length ? (
        <ul className="dd-rows">
          {risky.map((s) => (
            <li key={s.id}>
              <span className="dd-pts">+{s.points}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dd-note">Nothing added to the score.</p>
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
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
