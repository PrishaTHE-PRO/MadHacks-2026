// Upload guard: on sell pages, catch photos at the moment the seller picks
// them, BEFORE the site sees them (sites upload photos as soon as they're
// picked, so waiting until the listing is published is too late).
//
//   1. The seller picks photos in the site's own "Add photos" button.
//   2. We listen in the capture phase on window, which runs before any of the
//      page's own listeners (React, Vue, plain JS), and stop the event there.
//      The files are copied into memory and the input is emptied.
//   3. The side panel pulls the files, cleans them on the device, and sends
//      the clean copies back.
//   4. We put the clean files into the same input and fire the input/change
//      events again, so the site uploads only the clean versions.
//   Skip: the originals are put back the same way.
//
// Drag-and-drop uploads aren't intercepted yet (only the file picker).

import { sellPagePlatform } from "../sellPages";
import { PLATFORM_NAMES } from "../../../shared/types";
import {
  fileToWire,
  wireToFile,
  type GuardEvent,
  type GuardRequest,
  type GuardResponse,
  type HeldBatch,
} from "../messages";
import { showBadge } from "./badge";

interface Batch {
  id: string;
  input: HTMLInputElement;
  originals: File[];
  cleaned: Map<number, File>;
}

let batch: Batch | null = null;
/** Events we dispatch ourselves; let them through to the page. */
const ours = new WeakSet<Event>();
/** Inputs whose "input" event we just held; their trailing "change" must be held too. */
const justHeld = new WeakSet<HTMLInputElement>();

const isImage = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

function describe(b: Batch): HeldBatch {
  const platform = sellPagePlatform(location.href);
  return {
    batchId: b.id,
    count: b.originals.length,
    names: b.originals.map((f) => f.name),
    platform: platform ? PLATFORM_NAMES[platform] : location.hostname,
  };
}

function announce(event: GuardEvent) {
  chrome.runtime.sendMessage(event).catch(() => {
    // No extension page is listening (side panel closed): the badge covers it.
  });
}

/** Badge for sell pages: either the reminder, or "holding N photos" with Skip. */
export function showSellBadge() {
  if (batch) {
    const id = batch.id;
    showBadge({ state: "held", count: batch.originals.length, onSkip: () => void release(id, "originals") });
  } else {
    showBadge({ state: "sell" });
  }
}

function onPick(e: Event) {
  if (ours.has(e)) return;
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return;

  // The "change" that follows an "input" we already held.
  if (justHeld.has(input) && (input.files?.length ?? 0) === 0) {
    e.stopImmediatePropagation();
    justHeld.delete(input);
    return;
  }

  if (!sellPagePlatform(location.href)) return;
  const files = [...(input.files ?? [])];
  if (files.length === 0 || !files.some(isImage)) return; // videos, documents: not ours to touch

  // Stop the site from seeing these files.
  e.stopImmediatePropagation();
  justHeld.add(input);
  input.value = "";

  if (batch) {
    batch.originals.push(...files);
    batch.input = input;
  } else {
    batch = { id: crypto.randomUUID(), input, originals: files, cleaned: new Map() };
  }
  showSellBadge();
  announce({ type: "GUARD_HELD", batch: describe(batch) });
  chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
}

/** Put files into the site's input as if the seller had picked them. */
function deliver(input: HTMLInputElement, files: File[]): HTMLInputElement {
  // Sites sometimes replace the <input> after a pick; fall back to one that's still on the page.
  const target = input.isConnected
    ? input
    : document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]') ??
      document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!target) throw new Error("The listing's photo button isn't on the page anymore. Pick the photos again.");

  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  target.files = dt.files;
  for (const ev of [new Event("input", { bubbles: true, composed: true }), new Event("change", { bubbles: true })]) {
    ours.add(ev);
    target.dispatchEvent(ev);
  }
  return target;
}

async function release(batchId: string, which: "clean" | "originals"): Promise<number> {
  if (!batch || batch.id !== batchId) throw new Error("Those photos aren't on hold anymore.");
  const b = batch;
  const files =
    which === "originals"
      ? b.originals
      : b.originals.map((_, i) => b.cleaned.get(i)).filter((f): f is File => Boolean(f));
  if (files.length > 0) deliver(b.input, files);
  batch = null;
  showSellBadge();
  announce({ type: "GUARD_RELEASED", batchId });
  return files.length;
}

async function handle(msg: GuardRequest): Promise<GuardResponse> {
  switch (msg.type) {
    case "GUARD_QUERY":
      return { ok: true, batch: batch ? describe(batch) : null };
    case "GUARD_GET_FILE": {
      const f = batch?.id === msg.batchId ? batch.originals[msg.index] : undefined;
      if (!f) return { ok: false, error: "No such photo on hold." };
      return { ok: true, file: await fileToWire(f, f.name) };
    }
    case "GUARD_PUT_FILE":
      if (batch?.id !== msg.batchId) return { ok: false, error: "Those photos aren't on hold anymore." };
      batch.cleaned.set(msg.index, wireToFile(msg.file));
      return { ok: true };
    case "GUARD_COMMIT":
      return { ok: true, delivered: await release(msg.batchId, "clean") };
    case "GUARD_SKIP":
      return { ok: true, delivered: await release(msg.batchId, "originals") };
  }
}

export function installUploadGuard() {
  // Capture phase on window runs before every listener the page can add.
  window.addEventListener("input", onPick, true);
  window.addEventListener("change", onPick, true);

  chrome.runtime.onMessage.addListener((msg: GuardRequest, sender, sendResponse) => {
    // Only our own side panel may pull or replace photos.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (!msg?.type?.startsWith("GUARD_")) return false;
    handle(msg).then(sendResponse, (err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies GuardResponse),
    );
    return true;
  });
}
