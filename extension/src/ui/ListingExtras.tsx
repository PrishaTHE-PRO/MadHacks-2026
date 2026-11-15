// Listing-tab cards from main's side panel, in the sidebar's style:
// community flag (spec §7.2), earlier visits from on-device history (§7.1)
// and the stolen-photo check with reverse-search links (§3.1).

import { PLATFORM_NAMES, REPORT_CATEGORY_SHORT, type CommunityInfo, type Listing, type RiskReport } from "../../../shared/types";
import { reverseSearchLinks } from "../../../shared/photohash";
import { earlierVisits, type HistoryEntry } from "../historyCore";
import { LEVEL_LABEL, ago } from "./listingFacts";

/** Shown when 3+ different people reported the seller in 30 days. A warning, never a block. */
export function CommunityFlag({ community }: { community?: CommunityInfo }) {
  if (!community?.flagged) return null;
  return (
    <section className="dd-card dd-flag" role="alert">
      <div className="dd-flag-title">⚑ Flagged by {community.reportersLast30Days} people in the last 30 days</div>
      <ul className="dd-list">
        {community.categories.slice(0, 3).map((c) => (
          <li key={c.category}>
            {c.count} said: {REPORT_CATEGORY_SHORT[c.category]}
          </li>
        ))}
      </ul>
      <p className="dd-fine">
        Reports come from other DealDig users and can be wrong. DealDig doesn't block sellers, so weigh this with everything else.
      </p>
    </section>
  );
}

/** "You looked at this 3 days ago" and other listings from the same seller. */
export function EarlierVisits({ listing, history }: { listing: Listing; history: HistoryEntry[] }) {
  const { previous, otherListings } = earlierVisits(history, listing);
  if (!previous && !otherListings.length) return null;
  return (
    <section className="dd-card dd-earlier" aria-label="Earlier visits">
      {previous && (
        <p>
          You looked at this listing {ago(previous.seenAt)}. It was {LEVEL_LABEL[previous.level]} then.
        </p>
      )}
      {otherListings.length > 0 && (
        <>
          <p>
            You've seen {otherListings.length === 1 ? "another listing" : `${otherListings.length} other listings`} from this
            seller:
          </p>
          <ul className="dd-list">
            {otherListings.slice(0, 3).map((h) => (
              <li key={h.listingId}>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>{" "}
                <span className="dd-muted">
                  · {LEVEL_LABEL[h.level]} · {ago(h.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="dd-fine">From your history on this device.</p>
    </section>
  );
}

const SEARCHABLE_PHOTOS = 4;

/** Stolen-photo check: matches from the shared index, plus free web search links. */
export function PhotoCheck({ report, listing }: { report: RiskReport; listing: Listing }) {
  const matches = report.photoMatches;
  const photos = listing.photos.slice(0, SEARCHABLE_PHOTOS);
  if (!photos.length) return null;
  return (
    <section className="dd-card dd-photos" aria-label="Photos">
      <h3>Photos</h3>
      {matches === undefined && <p className="dd-fine">Couldn't fingerprint these photos, so they weren't compared.</p>}
      {matches?.length === 0 && <p className="dd-fine">No other listing checked with DealDig uses these photos.</p>}
      {matches && matches.length > 0 && (
        <ul className="dd-list dd-matches">
          {matches.map((m) => (
            <li key={`${m.photoIndex}-${m.platform}-${m.listingUrl}`}>
              Photo {m.photoIndex + 1}
              {m.mirrored ? " (flipped)" : ""} is also in{" "}
              <a href={m.listingUrl} target="_blank" rel="noreferrer">
                {m.listingTitle || "another listing"}
              </a>{" "}
              <span className="dd-muted">
                · {PLATFORM_NAMES[m.platform]} · {m.platform === "facebook" ? m.sellerUsername : `@${m.sellerUsername}`} · checked{" "}
                {new Date(m.seenAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="dd-note">Search the web for a photo, to see if it was taken from somewhere else:</p>
      <div className="dd-photo-grid">
        {photos.map((url, i) => {
          const links = reverseSearchLinks(url);
          return (
            <figure key={url}>
              <img src={url} alt={`Photo ${i + 1}`} />
              <figcaption>
                <a href={links.lens} target="_blank" rel="noreferrer">
                  Lens
                </a>{" "}
                ·{" "}
                <a href={links.tineye} target="_blank" rel="noreferrer">
                  TinEye
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
