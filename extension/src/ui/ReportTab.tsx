// Report tab: the seller report form ("Report seller" opens it).

import { useState } from "react";
import type { Listing } from "../../../shared/types";
import { sellerName } from "./listingFacts";

export function ReportTab({
  listing,
  onSubmit,
  onCancel,
}: {
  listing?: Listing;
  onSubmit(reason: string): Promise<boolean>;
  onCancel(): void;
}) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (!listing)
    return <p className="dd-note">Open a listing to report its seller. Reports warn other DealDig users about them.</p>;
  if (!listing.seller.id)
    return <p className="dd-note">Couldn't identify the seller on this page, so they can't be reported yet.</p>;
  if (status === "sent")
    return (
      <section className="dd-card">
        <p className="dd-note dd-ok">Thanks. {sellerName(listing)} will be flagged for other DealDig users.</p>
      </section>
    );

  const submit = async () => {
    setStatus("sending");
    setStatus((await onSubmit(reason.trim()).catch(() => false)) ? "sent" : "error");
  };

  return (
    <section className="dd-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3>Report {sellerName(listing)}</h3>
      <p className="dd-note">Reports are shared with other DealDig users. Three reports in 30 days puts a seller on the blocklist.</p>
      <label className="dd-field">
        What happened?
        <textarea
          autoFocus // "Report seller" lands you in the form
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. asked me to pay over Zelle"
          maxLength={1000}
        />
      </label>
      {status === "error" && <p className="dd-note dd-err">Couldn't send the report. Is the server running?</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="dd-btn secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="dd-btn primary" disabled={!reason.trim() || status === "sending"} onClick={submit}>
          {status === "sending" ? "Sending…" : "Send report"}
        </button>
      </div>
    </section>
  );
}
