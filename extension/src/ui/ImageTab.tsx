// "Check image" tab: a buyer drops in a screenshot, receipt, ID or PDF the
// seller sent, and sees whether the file shows signs of editing (spec §3.4).
// Everything runs in the side panel; the file is never uploaded.

import { useEffect, useRef, useState } from "react";
import { checkFileBytes, type FileReport } from "../tamper/metadata";
import { errorLevelHeatmap } from "../tamper/ela";

const MAX_BYTES = 25 * 1024 * 1024;

type DocType = "receipt" | "tracking" | "payment" | "id" | "lease" | "other";

const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "receipt", label: "Receipt" },
  { id: "tracking", label: "Tracking" },
  { id: "payment", label: "Payment" },
  { id: "id", label: "ID or title" },
  { id: "lease", label: "Lease" },
  { id: "other", label: "Other" },
];

/** How to check each kind of document at its source. */
const VERIFY: Record<DocType, string[]> = {
  receipt: ["Call the store yourself to confirm the order.", "Ask for a photo with today's date."],
  tracking: ["Enter the number on the carrier's own site.", "Check it's going to your city."],
  payment: ["Check your own bank app.", "Never refund an \"overpayment\"."],
  id: ["An ID doesn't prove a deal is safe. Never send yours.", "Vehicle: run the VIN on NICB VINCheck."],
  lease: ["Check the owner in county property records.", "No deposit before seeing it."],
  other: ["Confirm it with whoever issued it, using a number you found yourself."],
};

interface Checked {
  name: string;
  report: FileReport;
  previewUrl?: string;
  heatmapUrl?: string | null;
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ImageTab() {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHeat, setShowHeat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [docType, setDocType] = useState<DocType | "">("");
  const input = useRef<HTMLInputElement>(null);

  // Free the object URLs when the result is replaced or the panel closes.
  useEffect(
    () => () => {
      if (checked?.previewUrl) URL.revokeObjectURL(checked.previewUrl);
      if (checked?.heatmapUrl) URL.revokeObjectURL(checked.heatmapUrl);
    },
    [checked],
  );

  const check = async (file: File) => {
    setError("");
    setShowHeat(false);
    setShowDetails(false);
    if (file.size > MAX_BYTES) {
      setError("That file is over 25 MB. Try a smaller copy.");
      return;
    }
    setBusy(true);
    try {
      const report = checkFileBytes(new Uint8Array(await file.arrayBuffer()));
      const isImage = report.kind === "jpeg" || report.kind === "png" || report.kind === "webp";
      setChecked({
        name: file.name,
        report,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        heatmapUrl: isImage ? await errorLevelHeatmap(file) : undefined,
      });
    } catch (err) {
      setError(`Couldn't read that file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void check(f);
  };

  const cautions = checked?.report.findings.filter((f) => f.severity === "caution").length ?? 0;

  return (
    <div className="dd-image">
      <button
        type="button"
        className={`dd-drop ${dragging ? "over" : ""} ${checked ? "compact" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <UploadIcon />
        <span className="dd-drop-title">{checked ? "Check another file" : "Drop an image or PDF"}</span>
        {!checked && <span className="dd-muted">or click to choose</span>}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {!checked && !busy && (
        <p className="dd-fine dd-center">Receipts, IDs or screenshots from the seller. Never uploaded.</p>
      )}

      {busy && <p className="dd-note dd-center">Checking…</p>}
      {error && <p className="dd-err">{error}</p>}

      {checked && !busy && (
        <section className="dd-card dd-image-result" aria-live="polite">
          {checked.previewUrl && (
            <>
              <img
                className="dd-image-preview"
                src={showHeat && checked.heatmapUrl ? checked.heatmapUrl : checked.previewUrl}
                alt={showHeat ? "Edit heatmap" : checked.name}
              />
              {checked.heatmapUrl && (
                <div className="dd-seg" role="radiogroup" aria-label="Show">
                  <button role="radio" aria-checked={!showHeat} onClick={() => setShowHeat(false)}>
                    Image
                  </button>
                  <button role="radio" aria-checked={showHeat} onClick={() => setShowHeat(true)}>
                    Edit heatmap
                  </button>
                </div>
              )}
              {showHeat && <p className="dd-fine">Bright patches may be pasted in.</p>}
            </>
          )}

          <div className="dd-title" title={checked.name}>
            {checked.name}
          </div>
          <p className={`dd-image-verdict ${cautions ? "careful" : "clean"}`}>
            {cautions ? `${cautions} sign${cautions > 1 ? "s" : ""} of editing` : "No signs of editing found"}
          </p>

          <ul className="dd-rows">
            {checked.report.findings.map((f) => (
              <li key={f.text}>
                <span className={`dd-dot ${f.severity === "caution" ? "caution" : ""}`} aria-hidden="true" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>

          {checked.report.details.length > 0 && (
            <>
              <button className="dd-disclose" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
                File details
                <span className="chev" aria-hidden="true">
                  ▾
                </span>
              </button>
              {showDetails && (
                <dl className="dd-image-details">
                  {checked.report.details.map((d) => (
                    <div key={d.label + d.value}>
                      <dt>{d.label}</dt>
                      <dd>{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}

          <label className="dd-field dd-image-type">
            How to verify it
            <select className="dd-input" value={docType} onChange={(e) => setDocType(e.target.value as DocType | "")}>
              <option value="">What did they send?</option>
              {DOC_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {docType && (
            <ul className="dd-list">
              {VERIFY[docType].map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
          <p className="dd-fine">Clean files can still be fake.</p>
        </section>
      )}
    </div>
  );
}
