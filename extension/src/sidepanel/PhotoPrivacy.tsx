// "Photo privacy" tab: check listing photos before posting them.
// Everything here runs on this device; photos are never uploaded.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { fileToWire, wireToFile, type GuardEvent, type GuardRequest, type GuardResponse, type HeldBatch } from "../messages";
import { inspectMetadata, type MetadataReport } from "../privacy/metadata";
import { detectFaces, detectText, manualRegion, type Region } from "../privacy/detect";
import { renderClean } from "../privacy/redact";
import { fromPoints, type Box } from "../privacy/geometry";
import type { FindingSeverity } from "../privacy/summarize";

const ACCEPT = "image/jpeg,image/png,image/webp";
let fileId = 0;

/** What each photo card reports up, so the parent can hand clean copies to the listing. */
type CardStatus = { state: "working" } | { state: "ready"; blob: Blob } | { state: "failed" };

interface Item {
  id: number;
  file: File;
  /** Set for photos the upload guard held back from the listing form. */
  fromListing?: { tabId: number; batchId: string; index: number };
}

const send = (tabId: number, msg: GuardRequest) =>
  (chrome.tabs.sendMessage(tabId, msg) as Promise<GuardResponse>).catch(
    (err: unknown): GuardResponse => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );

export function PhotoPrivacy({ tabId }: { tabId: number | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Record<number, CardStatus>>({});
  const [held, setHeld] = useState<{ tabId: number; batch: HeldBatch } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const requested = useRef(new Set<string>());

  const add = (list: FileList | null) => {
    if (!list) return;
    const images = [...list].filter((f) => f.type.startsWith("image/"));
    setItems((prev) => [...prev, ...images.map((file) => ({ id: ++fileId, file }))]);
  };

  const dropBatch = useCallback((batchId: string) => {
    setItems((prev) => prev.filter((i) => i.fromListing?.batchId !== batchId));
    setHeld((h) => (h?.batch.batchId === batchId ? null : h));
  }, []);

  // Pull any held photos we don't have yet, one message per photo.
  const sync = useCallback(async (tab: number, batch: HeldBatch | null) => {
    if (!batch) {
      setHeld((h) => (h?.tabId === tab ? null : h));
      setItems((prev) => prev.filter((i) => i.fromListing?.tabId !== tab));
      return;
    }
    setHeld({ tabId: tab, batch });
    setNotice(null);
    setItems((prev) => prev.filter((i) => !i.fromListing || i.fromListing.batchId === batch.batchId));
    for (let index = 0; index < batch.count; index++) {
      const key = `${batch.batchId}:${index}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const res = await send(tab, { type: "GUARD_GET_FILE", batchId: batch.batchId, index });
      if (res.ok && res.file) {
        const file = wireToFile(res.file);
        setItems((prev) => [...prev, { id: ++fileId, file, fromListing: { tabId: tab, batchId: batch.batchId, index } }]);
      } else {
        requested.current.delete(key);
        setNotice({ kind: "error", text: "Couldn't load a photo from the listing. Try picking it again." });
      }
    }
  }, []);

  // When a sell page becomes active, ask it whether it's holding photos.
  useEffect(() => {
    if (tabId === null) return;
    void send(tabId, { type: "GUARD_QUERY" }).then((res) => {
      if (res.ok) void sync(tabId, res.batch ?? null);
    });
  }, [tabId, sync]);

  // Live updates: the seller picks photos (or hits Skip on the page badge).
  useEffect(() => {
    const onMessage = (msg: GuardEvent, sender: chrome.runtime.MessageSender) => {
      const tab = sender.tab?.id;
      if (tab === undefined || sender.id !== chrome.runtime.id) return;
      if (msg.type === "GUARD_HELD") void sync(tab, msg.batch);
      if (msg.type === "GUARD_RELEASED") dropBatch(msg.batchId);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [sync, dropBatch]);

  const report = useCallback((id: number, s: CardStatus) => setStatus((prev) => ({ ...prev, [id]: s })), []);

  const listing = held ? items.filter((i) => i.fromListing?.batchId === held.batch.batchId) : [];
  const ready = listing.filter((i) => status[i.id]?.state === "ready");
  const failed = listing.filter((i) => status[i.id]?.state === "failed");
  const allChecked = held !== null && listing.length === held.batch.count && ready.length + failed.length === listing.length;

  const sendClean = async () => {
    if (!held) return;
    const { tabId: tab, batch } = held;
    setBusy(true);
    try {
      for (const item of ready) {
        const s = status[item.id] as Extract<CardStatus, { state: "ready" }>;
        const name = item.file.name.replace(/\.[^.]+$/, "") + ".jpg";
        const res = await send(tab, {
          type: "GUARD_PUT_FILE",
          batchId: batch.batchId,
          index: item.fromListing!.index,
          file: await fileToWire(s.blob, name),
        });
        if (!res.ok) throw new Error(res.error);
      }
      const res = await send(tab, { type: "GUARD_COMMIT", batchId: batch.batchId });
      if (!res.ok) throw new Error(res.error);
      const n = res.delivered ?? ready.length;
      setNotice({
        kind: "ok",
        text: `✓ Added ${n} clean photo${n === 1 ? "" : "s"} to your ${batch.platform} listing. The originals were never uploaded.`,
      });
      dropBatch(batch.batchId);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!held) return;
    setBusy(true);
    const res = await send(held.tabId, { type: "GUARD_SKIP", batchId: held.batch.batchId });
    setBusy(false);
    if (!res.ok) return setNotice({ kind: "error", text: res.error });
    setNotice({ kind: "ok", text: "Uploaded your original photos without changes." });
    dropBatch(held.batch.batchId);
  };

  return (
    <div className="privacy">
      {held && (
        <section className="card held">
          <strong>
            {held.batch.count} photo{held.batch.count === 1 ? " is" : "s are"} on hold.
          </strong>
          <span className="muted small">
            {held.batch.platform} hasn't received {held.batch.count === 1 ? "it" : "them"} yet. Check below, then send the clean
            copies to your listing.
          </span>
          <button disabled={!allChecked || busy || ready.length === 0} onClick={sendClean}>
            {!allChecked
              ? "Checking photos…"
              : busy
                ? "Sending…"
                : `Use ${ready.length} clean photo${ready.length === 1 ? "" : "s"} in my listing`}
          </button>
          {allChecked && failed.length > 0 && (
            <p className="note">
              {failed.length} photo{failed.length === 1 ? " can't" : "s can't"} be cleaned (iPhone HEIC?) and will be left out.
              Export as JPEG and add {failed.length === 1 ? "it" : "them"} again, or upload the originals.
            </p>
          )}
          <button className="secondary" disabled={busy} onClick={skip}>
            Skip, upload originals
          </button>
        </section>
      )}

      {notice && <p className={notice.kind === "ok" ? "verified" : "error"}>{notice.text}</p>}

      {!held && (
        <p className="muted">
          Pick photos in the listing's own photo button and DealDig holds them here first. Or drop photos below.{" "}
          <strong>Photos never leave this device.</strong>
        </p>
      )}

      <div
        className={`drop ${dragging ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <strong>Drop photos here</strong>
        <span className="muted small">or click to choose (JPEG, PNG, WebP)</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.map(({ id, file, fromListing }) => (
        <PhotoCard
          key={id}
          file={file}
          fromListing={Boolean(fromListing)}
          onStatus={(s) => report(id, s)}
          onRemove={fromListing ? undefined : () => setItems((prev) => prev.filter((f) => f.id !== id))}
        />
      ))}
    </div>
  );
}

type Step = "reading" | "faces" | "text" | "ready" | "error";

const STEP_TEXT: Record<Step, string> = {
  reading: "Reading hidden data…",
  faces: "Looking for faces…",
  text: "Looking for addresses and other text… (the first photo takes longer)",
  ready: "",
  error: "",
};

interface Clean {
  url: string;
  fieldCount: number;
  hasGps: boolean;
}

function PhotoCard({
  file,
  fromListing,
  onStatus,
  onRemove,
}: {
  file: File;
  fromListing: boolean;
  onStatus: (s: CardStatus) => void;
  /** Photos held from the listing can't be removed one by one (use Skip instead). */
  onRemove?: () => void;
}) {
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [originalUrl] = useState(() => URL.createObjectURL(file));
  const [meta, setMeta] = useState<MetadataReport | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [step, setStep] = useState<Step>("reading");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clean, setClean] = useState<Clean | null>(null);
  const [drawMode, setDrawMode] = useState(false);

  // Scan once when the photo is added.
  useEffect(() => {
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    void (async () => {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        setError("Can't open this photo. If it's HEIC (iPhone), export it as JPEG first.");
        setStep("error");
        statusRef.current({ state: "failed" });
        return;
      }
      if (cancelled) return;
      setImage(bitmap);
      setMeta(await inspectMetadata(file));

      setStep("faces");
      try {
        const faces = await detectFaces(bitmap);
        if (!cancelled) setRegions((r) => [...r, ...faces]);
      } catch (err) {
        console.error("[DealDig] face detection failed", err);
        setWarnings((w) => [...w, "Face detection didn't run. Draw boxes over any faces yourself."]);
      }

      if (cancelled) return;
      setStep("text");
      try {
        const text = await detectText(bitmap);
        if (!cancelled) setRegions((r) => [...r, ...text]);
      } catch (err) {
        console.error("[DealDig] text detection failed", err);
        setWarnings((w) => [...w, "Text detection didn't run. Draw boxes over any addresses yourself."]);
      }
      if (!cancelled) setStep("ready");
    })();
    return () => {
      cancelled = true;
      bitmap?.close();
    };
  }, [file]);

  // Re-render the cleaned copy whenever the boxes change, then re-read its
  // metadata to prove nothing survived.
  useEffect(() => {
    if (!image || step !== "ready") return;
    let cancelled = false;
    statusRef.current({ state: "working" });
    void (async () => {
      const blob = await renderClean(image, regions);
      const check = await inspectMetadata(blob);
      if (check.thumbnailUrl) URL.revokeObjectURL(check.thumbnailUrl);
      if (cancelled) return;
      // Only a copy that passed the re-check may be sent to the listing.
      const verified = check.fieldCount === 0 && !check.gps;
      statusRef.current(verified ? { state: "ready", blob } : { state: "failed" });
      const url = URL.createObjectURL(blob);
      // Swap URLs only once the new copy exists, so the preview never flashes blank.
      setClean((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, fieldCount: check.fieldCount, hasGps: Boolean(check.gps) };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [image, regions, step]);

  const cleanUrl = useRef<string | null>(null);
  cleanUrl.current = clean?.url ?? null;
  useEffect(() => () => {
    if (cleanUrl.current) URL.revokeObjectURL(cleanUrl.current);
  }, []);

  useEffect(
    () => () => {
      URL.revokeObjectURL(originalUrl);
      if (meta?.thumbnailUrl) URL.revokeObjectURL(meta.thumbnailUrl);
    },
    [originalUrl, meta],
  );

  const toggle = (id: string) => setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const addBox = (b: Box) => setRegions((rs) => [...rs, manualRegion(b)]);
  const removeBox = (id: string) => setRegions((rs) => rs.filter((r) => r.id !== id));

  const hidden = regions.filter((r) => r.enabled);
  const cleanName = file.name.replace(/\.[^.]+$/, "") + "-dealdig.jpg";

  return (
    <section className="card photo">
      <div className="photo-head">
        <div className="title" title={file.name}>
          {file.name}
        </div>
        {fromListing && <span className="tag">From your listing</span>}
        {onRemove && (
          <button className="icon" onClick={onRemove} aria-label={`Remove ${file.name}`}>
            ×
          </button>
        )}
      </div>

      {error ? (
        <p className="error">{error}</p>
      ) : (
        <>
          <Preview
            src={step === "ready" && clean ? clean.url : originalUrl}
            image={image}
            regions={regions}
            drawMode={drawMode}
            onToggle={toggle}
            onDraw={(b) => {
              addBox(b);
              setDrawMode(false);
            }}
          />

          {step !== "ready" && <p className="muted small scanning">{STEP_TEXT[step]}</p>}
          {warnings.map((w) => (
            <p key={w} className="note">
              {w}
            </p>
          ))}

          {meta && <MetadataFindings meta={meta} />}

          {step === "ready" && (
            <>
              <div className="regions">
                <h2>Covered in the clean copy</h2>
                {regions.length === 0 && <p className="muted small">No faces or text found.</p>}
                <ul>
                  {regions.map((r) => (
                    <li key={r.id} className={r.enabled ? "" : "off"}>
                      <label>
                        <input type="checkbox" checked={r.enabled} onChange={() => toggle(r.id)} />
                        <span className="grow">
                          <strong>{r.label}</strong>
                          {r.kind === "face" && r.score !== undefined && (
                            <span className="muted"> {Math.round(r.score * 100)}% sure</span>
                          )}
                          {r.text && <span className="muted"> “{r.text}”</span>}
                        </span>
                      </label>
                      {r.kind === "manual" && (
                        <button className="icon small" onClick={() => removeBox(r.id)} aria-label="Delete box">
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <button className={`chip ${drawMode ? "on" : ""}`} onClick={() => setDrawMode((d) => !d)}>
                  {drawMode ? "Drag on the photo…" : "+ Cover something else"}
                </button>
              </div>

              {clean && (
                <div className="clean">
                  <p className={clean.fieldCount === 0 && !clean.hasGps ? "verified" : "error"}>
                    {clean.fieldCount === 0 && !clean.hasGps
                      ? `✓ Checked the clean copy: no location, 0 metadata fields${hidden.length ? `, ${hidden.length} area${hidden.length > 1 ? "s" : ""} covered` : ""}.`
                      : `Clean copy still has ${clean.fieldCount} metadata fields. Don't post it.`}
                  </p>
                  <a className="button" href={clean.url} download={cleanName}>
                    Download clean photo
                  </a>
                  <p className="muted small">
                    Text is covered with solid boxes and faces are scrambled, not just blurred: blurred text can be
                    recovered.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function Preview({
  src,
  image,
  regions,
  drawMode,
  onToggle,
  onDraw,
}: {
  src: string;
  image: ImageBitmap | null;
  regions: Region[];
  drawMode: boolean;
  onToggle: (id: string) => void;
  onDraw: (b: Box) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const toImage = (e: ReactPointerEvent) => {
    const rect = wrap.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x: x * image!.width, y: y * image!.height };
  };

  const pct = (b: Box) =>
    image
      ? {
          left: `${(b.x / image.width) * 100}%`,
          top: `${(b.y / image.height) * 100}%`,
          width: `${(b.w / image.width) * 100}%`,
          height: `${(b.h / image.height) * 100}%`,
        }
      : {};

  const draft = drag ? fromPoints(drag.x0, drag.y0, drag.x1, drag.y1) : null;

  return (
    <div
      ref={wrap}
      className={`preview ${drawMode ? "drawing" : ""}`}
      onPointerDown={(e) => {
        if (!drawMode || !image) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toImage(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toImage(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (draft && draft.w > 8 && draft.h > 8) onDraw(draft);
        setDrag(null);
      }}
    >
      <img src={src} alt="" draggable={false} />
      {image &&
        regions.map((r) => (
          <button
            key={r.id}
            className={`box ${r.kind} ${r.enabled ? "on" : "off"}`}
            style={pct(r)}
            title={`${r.label}: click to ${r.enabled ? "show" : "cover"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!drawMode) onToggle(r.id);
            }}
          />
        ))}
      {draft && <div className="box draft" style={pct(draft)} />}
    </div>
  );
}

const SEVERITY_ICON: Record<FindingSeverity, string> = { danger: "📍", caution: "⚠️", info: "ℹ️" };

function MetadataFindings({ meta }: { meta: MetadataReport }) {
  return (
    <div className="findings">
      <h2>Hidden data in the original</h2>
      {meta.findings.length === 0 ? (
        <p className="muted small">No location or personal metadata found. The clean copy still removes everything.</p>
      ) : (
        <ul>
          {meta.findings.map((f) => (
            <li key={f.id} className={f.severity}>
              <span aria-hidden>{SEVERITY_ICON[f.severity]}</span>
              <span className="grow">
                <strong>{f.title}</strong>
                <span className="muted small"> {f.detail}</span>
                {f.id === "gps" && meta.gps && (
                  <>
                    {" "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${meta.gps.latitude}&mlon=${meta.gps.longitude}#map=17/${meta.gps.latitude}/${meta.gps.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="small"
                    >
                      See it on a map
                    </a>
                    <span className="muted small"> (opens OpenStreetMap)</span>
                  </>
                )}
                {f.id === "thumbnail" && meta.thumbnailUrl && (
                  <img className="thumb" src={meta.thumbnailUrl} alt="Hidden preview stored inside the photo" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {meta.fieldCount > 0 && <p className="muted small">{meta.fieldCount} metadata fields in total.</p>}
    </div>
  );
}
