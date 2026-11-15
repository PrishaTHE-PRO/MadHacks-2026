// Listing-tab cards from main's side panel, in the sidebar's style:
// community flag (spec §7.2), earlier visits from on-device history (§7.1)
// "Copies elsewhere" (stolen photos from DealDig's index and the web, plus the
// copied description, in one card) and the AI-photo notice.

import {
  PLATFORM_NAMES,
  REPORT_CATEGORY_SHORT,
  type CommunityInfo,
  type CopyOwner,
  type Listing,
  type RiskReport,
  type SiteKind,
  type TextMatch,
  type WebPhotoMatch,
} from "../../../shared/types";
import { reverseSearchLinks } from "../../../shared/photohash";
import { earlierVisits, type HistoryEntry } from "../historyCore";
import { LEVEL_LABEL, ago } from "./listingFacts";

/** Shown when 3+ different people reported the seller in 30 days. A warning, never a block. */
export function CommunityFlag({ community }: { community?: CommunityInfo }) {
  if (!community?.flagged) return null;
  return (
    <section className="dd-card dd-flag" role="alert">
      <div className="dd-flag-title">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 14V2.5m0 0h8l-1.8 3 1.8 3h-8" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Reported by {community.reportersLast30Days} people this month
      </div>
      <ul className="dd-list">
        {community.categories.slice(0, 3).map((c) => (
          <li key={c.category}>
            {c.count} said: {REPORT_CATEGORY_SHORT[c.category]}
          </li>
        ))}
      </ul>
      <p className="dd-fine">From other users. Reports can be wrong.</p>
    </section>
  );
}

/** "You looked at this 3 days ago" and other listings from the same seller. */
export function EarlierVisits({ listing, history }: { listing: Listing; history: HistoryEntry[] }) {
  const { previous, otherListings } = earlierVisits(history, listing);
  if (!previous && !otherListings.length) return null;
  return (
    <section className="dd-card dd-earlier" aria-label="Earlier visits">
      <h3>Earlier visits</h3>
      {previous && (
        <p>
          Seen {ago(previous.seenAt)} <span className="dd-muted">· {LEVEL_LABEL[previous.level]} then</span>
        </p>
      )}
      {otherListings.length > 0 && (
        <>
          <p>Also from this seller:</p>
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
      <p className="dd-fine">History on this device only.</p>
    </section>
  );
}

const SEARCHABLE_PHOTOS = 4;

/** Who posted the copy, as a small tag. */
function OwnerTag({ owner, kind }: { owner: CopyOwner; kind: SiteKind }) {
  const [label, tone] =
    kind === "stock"
      ? ["Stock photo site", "info"]
      : kind === "ai-art"
        ? ["AI-image site", "caution"]
        : owner === "same-seller"
          ? ["Same seller", "good"]
          : owner === "other-seller"
            ? ["Different seller", "danger"]
            : kind === "other"
              ? ["Other website", "info"]
              : ["Seller unknown", "caution"];
  return <span className={`dd-owner ${tone}`}>{label}</span>;
}

const who = (m: { username?: string; siteName: string }) =>
  !m.username ? "" : /^\d+$/.test(m.username) || m.username.includes(" ") ? m.username : `@${m.username.replace(/^@/, "")}`;

/** Show the riskiest copies first: other sellers, unknown, other sites, then the seller's own. */
const OWNER_ORDER: Record<CopyOwner, number> = { "other-seller": 0, unknown: 1, "same-seller": 2 };
const byRisk = <T extends { owner: CopyOwner; kind: SiteKind }>(a: T, b: T) =>
  OWNER_ORDER[a.owner] - OWNER_ORDER[b.owner] || Number(a.kind === "other") - Number(b.kind === "other");

/** Short status lines when a web search didn't finish (nothing is said when it's off). */
const WEB_STATUS = {
  failed: "Web search didn't finish; only DealDig listings were compared.",
  skipped: "Description too short to search the web.",
} as const;

/**
 * Copies of this listing elsewhere: photos (DealDig's index + reverse image
 * search on the web) and the description, each match linked as proof, plus
 * free Lens / TinEye links per photo.
 */
export function CopiesCard({ report, listing }: { report: RiskReport; listing: Listing }) {
  // Matches a reason already links to (in "Why N/100") aren't listed again here.
  const linked = new Set(report.signals.flatMap((s) => s.links?.map((l) => l.url) ?? []));
  const allWeb = report.webPhotoMatches ?? [];
  const allText = report.textMatches ?? [];
  const indexMatches = report.photoMatches?.filter((m) => !linked.has(m.listingUrl));
  const web = allWeb.filter((m) => !linked.has(m.pageUrl)).sort(byRisk);
  const text = allText.filter((t) => !linked.has(t.url)).sort(byRisk);
  const photos = listing.photos.slice(0, SEARCHABLE_PHOTOS);
  const photoStatus = report.webCheck?.photos;
  const textStatus = report.webCheck?.text;
  if (!photos.length && !text.length && (!textStatus || textStatus === "off")) return null;

  const found = web.length + (indexMatches?.length ?? 0) + text.length;
  const foundAnywhere = allWeb.length + (report.photoMatches?.length ?? 0) + allText.length;
  const notes = [
    photoStatus === "failed" ? WEB_STATUS.failed : "", // "off" isn't mentioned
    indexMatches === undefined && photos.length ? "Couldn't fingerprint these photos." : "",
    textStatus === "skipped" || textStatus === "failed" ? WEB_STATUS[textStatus] : "",
  ].filter(Boolean);

  return (
    <section className="dd-card dd-photos" aria-label="Copies elsewhere">
      <h3>{found || !foundAnywhere ? "Copies elsewhere" : "Search photos yourself"}</h3>
      {foundAnywhere === 0 && <p className="dd-note">✓ Photos and description not found anywhere else.</p>}

      {(web.length > 0 || !!indexMatches?.length) && (
        <ul className="dd-matches">
          {web.map((m: WebPhotoMatch) => (
            <li key={m.pageUrl}>
              <OwnerTag owner={m.owner} kind={m.kind} />
              <span>
                Photo {m.photoIndex + 1}
                {m.match === "partial" ? " (edited)" : ""} ·{" "}
                <a href={m.pageUrl} target="_blank" rel="noreferrer noopener">
                  {m.pageTitle || m.siteName}
                </a>{" "}
                <span className="dd-muted">
                  · {m.siteName}
                  {who(m) ? ` · ${who(m)}` : ""}
                </span>
              </span>
            </li>
          ))}
          {indexMatches?.map((m) => (
            <li key={`${m.photoIndex}-${m.platform}-${m.listingUrl}`}>
              <span>
                Photo {m.photoIndex + 1}
                {m.mirrored ? " (flipped)" : ""} ·{" "}
                <a href={m.listingUrl} target="_blank" rel="noreferrer">
                  {m.listingTitle || "another listing"}
                </a>{" "}
                <span className="dd-muted">
                  · {PLATFORM_NAMES[m.platform]} · {m.platform === "facebook" ? m.sellerUsername : `@${m.sellerUsername}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {text.length > 0 && (
        <ul className="dd-matches">
          {text.map((t: TextMatch) => (
            <li key={t.url}>
              <OwnerTag owner={t.owner} kind={t.kind} />
              <span>
                Description {Math.round(t.overlap * 100)}% same ·{" "}
                <a href={t.url} target="_blank" rel="noreferrer noopener">
                  {t.title || t.siteName}
                </a>{" "}
                <span className="dd-muted">
                  · {t.siteName}
                  {who(t) ? ` · ${who(t)}` : ""}
                </span>
                <q className="dd-quote">{t.excerpt}</q>
              </span>
            </li>
          ))}
        </ul>
      )}

      {notes.map((n) => (
        <p key={n} className="dd-fine">
          {n}
        </p>
      ))}

      {photos.length > 0 && (
        <div className="dd-photo-grid" aria-label="Search a photo yourself">
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
      )}
    </section>
  );
}

/**
 * "This photo may be AI-generated": what we saw, with the photo and any proof
 * link. Not part of the score; the user decides what to make of it.
 */
export function AiPhotoNotice({ report, listing }: { report: RiskReport; listing: Listing }) {
  const ai = report.aiImage;
  if (!ai) return null;
  const nums = ai.photoIndexes.map((i) => i + 1);
  const which = nums.length === 0 ? "A photo" : nums.length === 1 ? `Photo ${nums[0]}` : `Photos ${nums.join(", ")}`;
  return (
    <section className="dd-card dd-ai-notice" role="note" aria-label="Possible AI-generated photo">
      <div className="dd-ai-title">
        {which} {ai.verdict === "likely" ? (nums.length > 1 ? "look" : "looks") : "may be"} AI-generated
      </div>
      <div className="dd-ai-body">
        {ai.photoIndexes.slice(0, 3).map((i) =>
          listing.photos[i] ? <img key={i} className="dd-thumb" src={listing.photos[i]} alt={`Photo ${i + 1}`} /> : null,
        )}
        <ul className="dd-list">
          {ai.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
          {ai.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer noopener">
                {l.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="dd-fine">
        Not scored: AI checks can be wrong. Ask for a new photo with today's date and their username.
      </p>
    </section>
  );
}
