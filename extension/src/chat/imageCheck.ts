// Images in a chat: invoices, receipts and payment screenshots the other
// person sends. Each one is checked on the device with the same edit checks
// as the old "Check image" tab (tamper/metadata.ts): the file's own data says
// which app saved it. The image is never uploaded anywhere.
//
// Limits: sites that re-encode uploads (Facebook, for one) strip this data, so
// on those a clean result means "nothing to see", not "genuine".

import { checkFileBytes, type FileReport } from "../tamper/metadata";
import type { ChatFlag } from "../../../shared/types";

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 8000;

/** The chat warning for one checked image, or null when nothing points to editing. Pure, tested. */
export function imageFlag(report: FileReport, messageId: string): ChatFlag | null {
  const edited = report.findings.find((f) => f.severity === "caution");
  if (!edited) return null;
  return {
    pattern: "edited_image",
    severity: "caution",
    reason: `The image they sent: ${edited.text}`,
    messageId,
    source: "rules",
  };
}

/** Read an image the page shows (same-site, data: or blob: addresses). Null if it can't be read. */
async function readImage(src: string): Promise<Uint8Array | null> {
  if (!/^(https?:|data:image\/|blob:)/i.test(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null; // another site's image without CORS, or a dead link: skip it
  }
}

/** Check a message's images; the first one that looks edited raises the warning. */
export async function checkMessageImages(srcs: string[], messageId: string): Promise<ChatFlag | null> {
  for (const src of srcs.slice(0, 4)) {
    const bytes = await readImage(src);
    if (!bytes) continue;
    const flag = imageFlag(checkFileBytes(bytes), messageId);
    if (flag) return flag;
  }
  return null;
}
