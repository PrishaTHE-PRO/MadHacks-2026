import { useEffect, useState } from "react";
import { tabKey, type TabState } from "../messages";
import { SERVER_URL } from "../config";
import { PLATFORM_NAMES, type Listing, type RiskReport, type Severity } from "../../../shared/types";

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
  return (
    <main>
      <header className="brand">DealDig</header>
      {!state && <Empty />}
      {state && <ListingCard listing={state.listing} />}
      {state?.status === "loading" && <p className="muted">Digging into this listing…</p>}
      {state?.status === "error" && <p className="error">{state.error}</p>}
      {state?.status === "done" && <Report report={state.report} listing={state.listing} />}
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

function Report({ report, listing }: { report: RiskReport; listing: Listing }) {
  const signals = [...report.signals].sort((a, b) => b.points - a.points || ORDER[a.severity] - ORDER[b.severity]);
  const p = report.priceCheck;
  return (
    <>
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

      <ReportSeller listing={listing} />
      <p className="muted small">
        {report.aiUsed ? "Checked with rules + Claude." : "Rules only (no AI key on the server)."}{" "}
        {new Date(report.checkedAt).toLocaleTimeString()}
      </p>
    </>
  );
}

function ReportSeller({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async () => {
    setStatus("sending");
    try {
      const res = await fetch(`${SERVER_URL}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: listing.platform,
          sellerId: listing.seller.id,
          sellerUsername: listing.seller.username,
          listingId: listing.id,
          reason,
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (!listing.seller.id)
    return <p className="muted small">Couldn't identify the seller on this page, so they can't be reported yet.</p>;
  if (status === "sent") return <p className="muted">Thanks. This seller will be flagged for other DealDig users.</p>;
  if (!open)
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Report this seller
      </button>
    );
  return (
    <section className="card">
      <h2>Report {sellerName(listing)}</h2>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What happened? e.g. asked me to pay over Zelle"
        rows={3}
      />
      <button disabled={!reason.trim() || status === "sending"} onClick={submit}>
        {status === "sending" ? "Sending…" : "Submit report"}
      </button>
      {status === "error" && <p className="error">Couldn't send the report. Is the server running?</p>}
    </section>
  );
}
