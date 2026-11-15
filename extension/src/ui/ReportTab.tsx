// Report tab: main's anonymous seller report (spec §7.1, §7.2) in the sidebar's style.
// Reporters pick a reason and can add details. A random id made on this
// device makes each person count once per seller; the server stores only a
// hash. Reports can be changed or undone.

import { useEffect, useState } from "react";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_SHORT,
  type CommunityInfo,
  type Listing,
  type ReportCategory,
  type ReportResponse,
} from "../../../shared/types";
import { SERVER_URL } from "../config";
import { myReport, reporterId, setMyReport, type MyReport } from "../history";
import { ago, sellerName } from "./listingFacts";

export function ReportTab({ listing, onCancel }: { listing?: Listing; onCancel(): void }) {
  if (!listing)
    return <p className="dd-note">Open a listing to report its seller.</p>;
  if (!listing.seller.id)
    return <p className="dd-note">Can't find the seller on this page.</p>;
  return <ReportSeller listing={listing} onCancel={onCancel} />;
}

function ReportSeller({ listing, onCancel }: { listing: Listing; onCancel(): void }) {
  const { platform, id: listingId } = listing;
  const sellerId = listing.seller.id;
  const [mine, setMine] = useState<MyReport | undefined>();
  const [editing, setEditing] = useState(true);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [community, setCommunity] = useState<CommunityInfo | null>(null);

  useEffect(() => {
    setCategory(null);
    setDetails("");
    setStatus("idle");
    setCommunity(null);
    setMine(undefined);
    setEditing(true);
    void myReport(platform, sellerId).then((m) => {
      setMine(m);
      setEditing(!m); // already reported: show the summary with Change / Undo
    });
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
      // Drop the cached result so the next check includes this report.
      await chrome.storage.session.remove(`report:${platform}:${listingId}`);
      setMine(next ?? undefined);
      setCommunity(data.community);
      setEditing(!next);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const othersLine = community && (
    <p className="dd-note">
      Reported by {community.reporters} {community.reporters === 1 ? "person" : "people"}.
      {community.flagged ? " Buyers now see a warning." : ""}
    </p>
  );
  const errorLine = status === "error" && <p className="dd-note dd-err">Can't reach the DealDig server.</p>;

  if (mine && !editing)
    return (
      <section className="dd-card dd-report">
        <h3>Your report</h3>
        <p className="dd-note">
          You reported {sellerName(listing)} {ago(mine.at)}: {REPORT_CATEGORY_SHORT[mine.category]}.
        </p>
        {othersLine}
        <div className="dd-btn-row">
          <button className="dd-btn secondary" onClick={() => setEditing(true)}>
            Change reason
          </button>
          <button className="dd-btn secondary" disabled={status === "sending"} onClick={() => void send("DELETE")}>
            {status === "sending" ? "Removing…" : "Undo report"}
          </button>
        </div>
        {errorLine}
      </section>
    );

  return (
    <>
      {othersLine}
      <section className="dd-card dd-report" aria-label="Report this seller">
        <h3>Report {sellerName(listing)}</h3>
        <fieldset className="dd-options">
          <legend className="dd-sr">What happened?</legend>
          {(Object.keys(REPORT_CATEGORIES) as ReportCategory[]).map((c) => (
            <label key={c} className={category === c ? "on" : undefined}>
              <input type="radio" name="dd-category" checked={category === c} onChange={() => setCategory(c)} />
              {REPORT_CATEGORIES[c]}
            </label>
          ))}
        </fieldset>
        <label className="dd-field">
          Details (optional)
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Private: never shown to others or sent to AI"
            rows={2}
            maxLength={1000}
          />
        </label>
        {errorLine}
        <div className="dd-btn-row">
          <button className="dd-btn secondary" onClick={() => (mine ? setEditing(false) : onCancel())}>
            Cancel
          </button>
          <button className="dd-btn primary" disabled={!category || status === "sending"} onClick={() => void send("POST")}>
            {status === "sending" ? "Sending…" : mine ? "Update report" : "Submit report"}
          </button>
        </div>
        <p className="dd-fine">Anonymous, one per seller. At 3 reports buyers see a warning; no one is blocked.</p>
      </section>
    </>
  );
}
