import { useEffect, useState } from "react";
import { tabKey, type TabState } from "../messages";
import { SERVER_URL } from "../config";
import {
  LOCAL_PLATFORMS,
  PLATFORM_NAMES,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_SHORT,
  type CommunityInfo,
  type Listing,
  type ReportCategory,
  type ReportResponse,
  type RiskReport,
  type Severity,
} from "../../../shared/types";
import {
  clearHistory,
  earlierVisits,
  forgetSeller,
  HISTORY_DAYS,
  loadHistory,
  myReport,
  reporterId,
  setMyReport,
  type HistoryEntry,
  type MyReport,
} from "../history";
import { MeetupHelper } from "./Meetup";
import { DocCheck } from "./DocCheck";
import { reverseSearchLinks } from "../../../shared/photohash";

function useActiveTabState(): TabState | null {
  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<TabState | null>(null);

  useEffect(() => {
    const refreshTab = () =>
      chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTabId(t?.id ?? null));
    void refreshTab();
    chrome.tabs.onActivated.addListener(refreshTab);
    return () => chrome.tabs.onActivated.removeListener(refreshTab);
  }, []);

  useEffect(() => {
    if (tabId === null) return;
    const key = tabKey(tabId);
    void chrome.storage.session.get(key).then((r) => setState((r[key] as TabState) ?? null));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && key in changes) setState((changes[key].newValue as TabState) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [tabId]);

  return state;
}

export function App() {
  const state = useActiveTabState();
  const history = useHistory();
  return (
    <main>
      <header className="brand">DealDig</header>
      {!state && <Empty />}
      {state && <ListingCard listing={state.listing} />}
      {state?.status === "loading" && <p className="muted">Digging into this listing…</p>}
      {state?.status === "error" && <p className="error">{state.error}</p>}
      {state?.status === "done" && <Report report={state.report} listing={state.listing} history={history} />}
      <DocCheck />
      <HistoryCard history={history} />
    </main>
  );
}

function Empty() {
  return <p className="muted">Open a Poshmark, eBay or Facebook Marketplace listing and DealDig will check it automatically.</p>;
}

/** "@handle" on sites with handles; Facebook only has a display name. */
const sellerName = (l: Listing) =>
  l.platform === "facebook" ? l.seller.displayName || l.seller.username || "Unknown seller" : `@${l.seller.username}`;

function sellerFacts(l: Listing): string[] {
  const s = l.seller;
  const facts: string[] = [];
  if (s.positiveFeedbackPercent !== undefined) facts.push(`${s.positiveFeedbackPercent}% positive`);
  if (s.feedbackScore !== undefined) facts.push(`${s.feedbackScore.toLocaleString()} feedback`);
  if (s.ratingsCount !== undefined) facts.push(s.ratingsCount ? `${s.ratingsCount} ratings` : "no ratings");
  if (s.joinedAt) {
    const d = new Date(s.joinedAt);
    facts.push(
      `joined ${
        s.joinedPrecision === "year"
          ? d.getUTCFullYear()
          : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })
      }`,
    );
  }
  return facts;
}

function ListingCard({ listing }: { listing: Listing }) {
  const s = listing.seller;
  const facts = sellerFacts(listing);
  return (
    <section className="card listing">
      {listing.photos[0] && <img src={listing.photos[0]} alt="" />}
      <div>
        <div className="title">{listing.title}</div>
        <div className="muted">
          ${listing.price}
          {listing.originalPrice ? ` · listed retail $${listing.originalPrice}` : ""}
          {listing.brand ? ` · ${listing.brand}` : ""}
          {listing.condition ? ` · ${listing.condition}` : ""}
        </div>
        <div className="muted">
          {PLATFORM_NAMES[listing.platform]} · Seller{" "}
          {s.profileUrl ? (
            <a href={s.profileUrl} target="_blank" rel="noreferrer">
              {sellerName(listing)}
            </a>
          ) : (
            sellerName(listing)
          )}
          {facts.length ? ` · ${facts.join(" · ")}` : ""}
        </div>
        {listing.location && <div className="muted">{listing.location}</div>}
      </div>
    </section>
  );
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

const ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2, good: 3 };
const ICON: Record<Severity, string> = { danger: "⛔", caution: "⚠️", info: "ℹ️", good: "✅" };

function Report({ report, listing, history }: { report: RiskReport; listing: Listing; history: HistoryEntry[] }) {
  const signals = [...report.signals].sort((a, b) => b.points - a.points || ORDER[a.severity] - ORDER[b.severity]);
  const p = report.priceCheck;
  return (
    <>
      <CommunityFlag community={report.community} />
      <section className={`card score ${report.level}`}>
        <div className="num">{report.score}</div>
        <div>
          <div className="level">
            {report.level === "low" ? "Low risk" : report.level === "medium" ? "Be careful" : "High risk"}
          </div>
          <div className="summary">{report.summary}</div>
          {report.topReasons.length > 0 && (
            <ol className="reasons">
              {report.topReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <EarlierVisits listing={listing} history={history} />

      {report.item && (
        <p className="muted small">
          Identified as{" "}
          <strong>
            {[report.item.brand, report.item.model].filter(Boolean).join(" ") || report.item.category}
          </strong>
          {report.item.brand || report.item.model ? ` (${report.item.category})` : ""}
        </p>
      )}

      <section className="card">
        <h2>What we found</h2>
        <ul className="signals">
          {signals.map((s) => (
            <li key={s.id} className={s.severity}>
              <span aria-hidden>{ICON[s.severity]}</span>
              <span className="grow">{s.text}</span>
              {s.points > 0 && <span className="points">+{s.points}</span>}
            </li>
          ))}
        </ul>
        <p className="muted small">Score = sum of the points above, capped at 100.</p>
      </section>

      {p && (p.median !== null || p.note) && (
        <section className="card">
          <h2>Price check</h2>
          {p.typicalLow !== null && p.typicalHigh !== null && (
            <p>
              Usually {fmt(p.typicalLow)}–{fmt(p.typicalHigh)}
              {p.median !== null ? ` (typical ${fmt(p.median)})` : ""}. This one: {fmt(listing.price)}.
            </p>
          )}
          <p className="muted">
            {p.note}{" "}
            {p.basis === "ai-estimate"
              ? `(AI estimate, ${p.confidence} confidence, not live sales data.)`
              : `(${p.confidence} confidence.)`}
          </p>
        </section>
      )}

      <PhotoCheck report={report} listing={listing} />

      {LOCAL_PLATFORMS.includes(listing.platform) && <MeetupHelper listing={listing} report={report} />}

      <ReportSeller listing={listing} />
      <p className="muted small">
        {report.aiUsed ? "Checked with rules + Claude." : "Rules only (no AI key on the server)."}{" "}
        {new Date(report.checkedAt).toLocaleTimeString()}
      </p>
    </>
  );
}

const SEARCHABLE_PHOTOS = 4;

/** Stolen-photo check (spec §3.1): matches from the shared index, plus free web search links. */
function PhotoCheck({ report, listing }: { report: RiskReport; listing: Listing }) {
  const matches = report.photoMatches;
  const photos = listing.photos.slice(0, SEARCHABLE_PHOTOS);
  if (!photos.length) return null;
  return (
    <section className="card">
      <h2>Photos</h2>
      {matches === undefined && <p className="muted small">Couldn't fingerprint these photos, so they weren't compared.</p>}
      {matches?.length === 0 && <p className="muted small">No other listing checked with DealDig uses these photos.</p>}
      {matches && matches.length > 0 && (
        <ul className="matches">
          {matches.map((m) => (
            <li key={`${m.photoIndex}-${m.platform}-${m.listingUrl}`}>
              Photo {m.photoIndex + 1}
              {m.mirrored ? " (flipped)" : ""} is also in{" "}
              <a href={m.listingUrl} target="_blank" rel="noreferrer">
                {m.listingTitle || "another listing"}
              </a>{" "}
              <span className="muted">
                · {PLATFORM_NAMES[m.platform]} · {m.platform === "facebook" ? m.sellerUsername : `@${m.sellerUsername}`} · checked{" "}
                {new Date(m.seenAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="small">Search the web for a photo, to see if it was taken from somewhere else:</p>
      <div className="photo-search">
        {photos.map((url, i) => {
          const links = reverseSearchLinks(url);
          return (
            <figure key={url}>
              <img src={url} alt={`Photo ${i + 1}`} />
              <figcaption className="small">
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

const ago = (ms: number) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
};

const LEVEL_LABEL = { low: "low risk", medium: "be careful", high: "high risk" } as const;

/** Live view of this device's history (it changes when the background saves a check). */
function useHistory(): HistoryEntry[] {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void loadHistory().then(setHistory);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && "history" in changes) void loadHistory().then(setHistory);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return history;
}

/** "You looked at this 3 days ago" and other listings from the same seller (spec §7.1). */
function EarlierVisits({ listing, history }: { listing: Listing; history: HistoryEntry[] }) {
  const { previous, otherListings } = earlierVisits(history, listing);
  if (!previous && !otherListings.length) return null;
  return (
    <section className="card earlier">
      {previous && (
        <p>
          You looked at this listing {ago(previous.seenAt)}: score {previous.score} ({LEVEL_LABEL[previous.level]}).
        </p>
      )}
      {otherListings.length > 0 && (
        <>
          <p>
            You've seen {otherListings.length === 1 ? "another listing" : `${otherListings.length} other listings`} from this
            seller:
          </p>
          <ul>
            {otherListings.slice(0, 3).map((h) => (
              <li key={h.listingId}>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>{" "}
                <span className="muted">
                  · score {h.score} · {ago(h.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">From your history on this device.</p>
    </section>
  );
}

/** Shown when 3+ different people reported the seller in 30 days. A warning, never a block. */
function CommunityFlag({ community }: { community?: CommunityInfo }) {
  if (!community?.flagged) return null;
  return (
    <section className="card flag">
      <div className="title">⚑ Flagged by {community.reportersLast30Days} people in the last 30 days</div>
      <ul>
        {community.categories.slice(0, 3).map((c) => (
          <li key={c.category}>
            {c.count} said: {REPORT_CATEGORY_SHORT[c.category]}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Reports come from other DealDig users and can be wrong. DealDig doesn't block sellers, so weigh this with everything
        else.
      </p>
    </section>
  );
}

function ReportSeller({ listing }: { listing: Listing }) {
  const { platform, id: listingId } = listing;
  const sellerId = listing.seller.id;
  const [mine, setMine] = useState<MyReport | undefined>();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [community, setCommunity] = useState<CommunityInfo | null>(null);

  useEffect(() => {
    setOpen(false);
    setCategory(null);
    setDetails("");
    setStatus("idle");
    setCommunity(null);
    setMine(undefined);
    if (sellerId) void myReport(platform, sellerId).then(setMine);
  }, [platform, sellerId, listingId]);

  const send = async (method: "POST" | "DELETE") => {
    setStatus("sending");
    try {
      const id = await reporterId();
      const body =
        method === "POST"
          ? { platform, sellerId, sellerUsername: listing.seller.username, listingId, category, details: details.trim() || undefined, reporterId: id }
          : { platform, sellerId, reporterId: id };
      const res = await fetch(`${SERVER_URL}/report`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ReportResponse;
      const next = method === "POST" && category ? { category, at: Date.now() } : null;
      await setMyReport(platform, sellerId, next);
      // Drop the cached score so the next check includes this report.
      await chrome.storage.session.remove(`report:${platform}:${listingId}`);
      setMine(next ?? undefined);
      setCommunity(data.community);
      setOpen(false);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  if (!sellerId)
    return <p className="muted small">Couldn't identify the seller on this page, so they can't be reported yet.</p>;

  const othersLine = community && (
    <p className="muted small">
      {community.reporters} {community.reporters === 1 ? "person has" : "people have"} reported this seller.
      {community.flagged ? " Other buyers will see a warning." : ""}
    </p>
  );
  const errorLine = status === "error" && <p className="error">Couldn't reach the DealDig server. Is it running?</p>;

  if (mine && !open)
    return (
      <section className="card">
        <p>
          You reported this seller {ago(mine.at)}: {REPORT_CATEGORY_SHORT[mine.category]}.
        </p>
        {othersLine}
        <div className="row">
          <button className="ghost" onClick={() => setOpen(true)}>
            Change reason
          </button>
          <button className="secondary" disabled={status === "sending"} onClick={() => void send("DELETE")}>
            {status === "sending" ? "Removing…" : "Undo report"}
          </button>
        </div>
        {errorLine}
      </section>
    );

  if (!open)
    return (
      <>
        {othersLine}
        <button className="secondary" onClick={() => setOpen(true)}>
          Report this seller
        </button>
      </>
    );

  return (
    <section className="card report-form">
      <h2>Report {sellerName(listing)}</h2>
      <p className="muted small">
        Anonymous: DealDig doesn't know who you are. A random code on this device makes sure you count once per seller.
      </p>
      <div className="options">
        {(Object.keys(REPORT_CATEGORIES) as ReportCategory[]).map((c) => (
          <label key={c}>
            <input type="radio" name="category" checked={category === c} onChange={() => setCategory(c)} />
            {REPORT_CATEGORIES[c]}
          </label>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Optional details. Only used to review reports; never shown to other users or sent to AI."
        rows={2}
        maxLength={1000}
      />
      <div className="row">
        <button disabled={!category || status === "sending"} onClick={() => void send("POST")}>
          {status === "sending" ? "Sending…" : mine ? "Update report" : "Submit report"}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="muted small">When 3 different people report a seller, other buyers see a warning. Sellers aren't blocked.</p>
      {errorLine}
    </section>
  );
}

/** Everything this device has checked, with Forget seller and Clear all (spec §7.1). */
function HistoryCard({ history }: { history: HistoryEntry[] }) {
  const [confirmClear, setConfirmClear] = useState(false);
  if (!history.length) return null;
  return (
    <details className="card history">
      <summary>
        <h2>Your history ({history.length})</h2>
      </summary>
      <p className="muted small">Saved only on this device for {HISTORY_DAYS} days. Clearing it doesn't remove reports you've sent.</p>
      <ul>
        {history.slice(0, 30).map((h) => (
          <li key={`${h.platform}:${h.listingId}`}>
            <span className={`pill ${h.level}`}>{h.score}</span>
            <div className="grow">
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              <div className="muted small">
                {PLATFORM_NAMES[h.platform]} · {h.sellerName || "unknown seller"} · {ago(h.lastSeenAt)}
              </div>
            </div>
            <button className="link small" onClick={() => void forgetSeller(h.platform, h.sellerId, h.listingId)}>
              Forget seller
            </button>
          </li>
        ))}
      </ul>
      {confirmClear ? (
        <div className="row">
          <button
            className="secondary"
            onClick={() => {
              void clearHistory();
              setConfirmClear(false);
            }}
          >
            Yes, clear all
          </button>
          <button className="ghost" onClick={() => setConfirmClear(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button className="secondary" onClick={() => setConfirmClear(true)}>
          Clear all history
        </button>
      )}
    </details>
  );
}
