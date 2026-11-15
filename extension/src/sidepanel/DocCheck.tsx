// "Check something the seller sent you" (spec §3.4): a buyer got a receipt,
// tracking screenshot, ID, title or lease from the seller and wants to know
// whether to trust it. The file is read in the side panel and never uploaded:
// no fetch happens anywhere in this flow.

import { useEffect, useRef, useState } from "react";
import { checkFileBytes, type FileReport } from "../tamper/metadata";
import { errorLevelHeatmap } from "../tamper/ela";

const MAX_BYTES = 25 * 1024 * 1024;
const ICON = { caution: "⚠️", info: "ℹ️" } as const;

type DocType = "receipt" | "tracking" | "payment" | "id" | "lease" | "other";

const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "receipt", label: "Receipt or proof of purchase" },
  { id: "tracking", label: "Shipping or tracking" },
  { id: "payment", label: "Payment or refund" },
  { id: "id", label: "ID or vehicle title" },
  { id: "lease", label: "Lease or rental papers" },
  { id: "other", label: "Something else" },
];

/** How to check each kind of document at its source, which no file check can replace. */
const VERIFY: Record<DocType, string[]> = {
  receipt: [
    "Find the store's phone number yourself (not from the receipt) and ask them to confirm the order number.",
    "Check the item, price, date and store match what the seller told you.",
    "A receipt doesn't prove this is the same item. Ask for a photo of the item next to a note with today's date and their name.",
  ],
  tracking: [
    "Type the tracking number into the carrier's own website (USPS, UPS, FedEx). Don't use a link the seller sent: fake tracking sites look real.",
    "Check the destination city is yours and the dates make sense.",
    "On a shipping platform, only accept shipping through the platform's own label.",
  ],
  payment: [
    "Screenshots of payments and refunds are easy to fake. Open your own bank or payment app and check.",
    "If they say they sent too much and ask for the difference back, don't send anything. That's a common scam.",
  ],
  id: [
    "Scammers send stolen IDs to seem trustworthy. An ID doesn't make a deal safe, and never send yours in return.",
    "For a vehicle, check the VIN on the title matches the car itself, and run it through NICB's free VINCheck for theft records.",
    "Meet in person. The name should match the person you meet and the name on the title.",
  ],
  lease: [
    "Look up the address on the county's property records site and check the owner's name matches the person you're talking to.",
    "Never pay a deposit before you've seen the place in person. \"I'm out of town, I'll mail the keys\" is a classic rental scam.",
  ],
  other: ["Ask where it came from, and check it with whoever issued it, using contact details you find yourself."],
};

interface Checked {
  name: string;
  report: FileReport;
  previewUrl?: string;
  heatmapUrl?: string | null;
}

export function DocCheck() {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHeat, setShowHeat] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [docType, setDocType] = useState<DocType | null>(null);
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
    <section
      className={`card doccheck ${dragging ? "dragging" : ""}`}
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
      <h2>Check something the seller sent you</h2>
      <p className="small">
        A receipt, tracking screenshot, ID, title or lease? See if it was edited. Drop the file here or{" "}
        <button className="link" onClick={() => input.current?.click()}>
          choose one
        </button>
        .
      </p>
      <p className="muted small">Checked on this device. The file is never uploaded.</p>
      <div className="field">
        <span className="small">What did they send?</span>
        <div className="chips">
          {DOC_TYPES.map((t) => (
            <button key={t.id} className={`chip ${docType === t.id ? "on" : ""}`} onClick={() => setDocType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
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
      {busy && <p className="muted">Checking…</p>}
      {error && <p className="error">{error}</p>}

      {checked && !busy && (
        <>
          <div className="title">{checked.name}</div>
          <p className={cautions ? "note" : "muted small"}>
            {cautions
              ? `${cautions} thing${cautions > 1 ? "s" : ""} to check. This doesn't prove it's fake, but look closer.`
              : "No signs of editing in the file's data. That doesn't prove it's real."}
          </p>
          <ul className="signals">
            {checked.report.findings.map((f) => (
              <li key={f.text} className={f.severity}>
                <span aria-hidden>{ICON[f.severity]}</span>
                <span className="grow">{f.text}</span>
              </li>
            ))}
          </ul>

          {checked.report.details.length > 0 && (
            <>
              <dl className="details small">
                {checked.report.details.map((d) => (
                  <div key={d.label + d.value}>
                    <dt className="muted">{d.label}</dt>
                    <dd>{d.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">Compare these with what the seller told you, e.g. when they say they bought it.</p>
            </>
          )}

          {checked.previewUrl && (
            <div className="ela">
              <div className="chips">
                <button className={`chip ${!showHeat ? "on" : ""}`} onClick={() => setShowHeat(false)}>
                  Image
                </button>
                <button
                  className={`chip ${showHeat ? "on" : ""}`}
                  disabled={!checked.heatmapUrl}
                  onClick={() => setShowHeat(true)}
                >
                  Edit heatmap
                </button>
              </div>
              <img src={showHeat && checked.heatmapUrl ? checked.heatmapUrl : checked.previewUrl} alt="" />
              {showHeat && (
                <p className="muted small">
                  Bright patches that don't match their surroundings, like one number brighter than the text around it, can mean
                  that part was pasted in. Text and sharp edges are always bright, so compare similar areas.
                </p>
              )}
            </div>
          )}

        </>
      )}

      {(checked || docType) && !busy && (
        <div className="note small">
          <strong>Check it at the source.</strong> A clean file can still be fake, and the seller chose what to send you.
          {docType ? (
            <ul className="verify">
              {VERIFY[docType].map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          ) : (
            <span> Pick what they sent above for how to check it.</span>
          )}
        </div>
      )}
    </section>
  );
}
