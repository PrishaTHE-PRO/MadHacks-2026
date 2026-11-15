// Listing-tab cards from main's side panel, in the sidebar's style:
// community flag (spec §7.2), earlier visits from on-device history (§7.1)
// the stolen-photo check (DealDig's index + reverse image search on the web),
// the copied-description check and the AI-photo notice.

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

const PHOTO_STATUS = {
  off: "Web photo search isn't turned on for this server, so only listings checked with DealDig were compared.",
  failed: "The web photo search didn't finish this time; only listings checked with DealDig were compared.",
} as const;

/** Stolen-photo check: matches from DealDig's index and from the web, plus free search links. */
export function PhotoCheck({ report, listing }: { report: RiskReport; listing: Listing }) {
  const matches = report.photoMatches;
  const web = [...(report.webPhotoMatches ?? [])].sort(byRisk);
  const photos = listing.photos.slice(0, SEARCHABLE_PHOTOS);
  if (!photos.length) return null;
  const webStatus = report.webCheck?.photos;
  return (
    <section className="dd-card dd-photos" aria-label="Photos">
      <h3>Photos</h3>
      {web.length > 0 && (
        <>
          <p className="dd-note">Found on the web:</p>
          <ul className="dd-matches">
            {web.map((m: WebPhotoMatch) => (
              <li key={m.pageUrl}>
                <OwnerTag owner={m.owner} kind={m.kind} />
                <span>
                  Photo {m.photoIndex + 1}
                  {m.match === "partial" ? " (cropped or edited)" : ""} on{" "}
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
          </ul>
        </>
      )}
      {webStatus === "done" && !web.length && <p className="dd-fine">No other page on the web shows these photos.</p>}
      {(webStatus === "off" || webStatus === "failed") && <p className="dd-fine">{PHOTO_STATUS[webStatus]}</p>}
      {matches === undefined && <p className="dd-fine">Couldn't fingerprint these photos, so they weren't compared with other DealDig checks.</p>}
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
      <p className="dd-note">Search the web yourself for a photo:</p>
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

const TEXT_STATUS = {
  off: "Web search for the description isn't turned on for this server.",
  skipped: "The description is too short or generic to search the web for.",
  failed: "The web search for the description didn't finish this time.",
} as const;

/** Copied description: the same text in other listings or pages, quoted and linked. */
export function CopiedText({ report }: { report: RiskReport }) {
  const matches = [...(report.textMatches ?? [])].sort(byRisk);
  const status = report.webCheck?.text;
  if (!matches.length && status !== "done") {
    return status && status !== "off" ? (
      <section className="dd-card dd-photos" aria-label="Description">
        <h3>Description</h3>
        <p className="dd-fine">{TEXT_STATUS[status]}</p>
      </section>
    ) : null;
  }
  return (
    <section className="dd-card dd-photos" aria-label="Description">
      <h3>Description</h3>
      {matches.length ? (
        <ul className="dd-matches">
          {matches.map((t: TextMatch) => (
            <li key={t.url}>
              <OwnerTag owner={t.owner} kind={t.kind} />
              <span>
                {Math.round(t.overlap * 100)}% the same as{" "}
                <a href={t.url} target="_blank" rel="noreferrer noopener">
                  {t.title || t.siteName}
                </a>{" "}
                <span className="dd-muted">
                  · {t.siteName}
                  {who(t) ? ` · ${who(t)}` : ""} · {t.source === "web" ? "web search, confirmed on the page" : "checked with DealDig"}
                </span>
                <q className="dd-quote">{t.excerpt}</q>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dd-fine">This description doesn't appear in other listings or on the web.</p>
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
        Not counted in the score: AI checks can be wrong, so it's your call. If it matters, ask the seller for a new photo of
        the item next to a note with today's date and their username.
      </p>
    </section>
  );
}
