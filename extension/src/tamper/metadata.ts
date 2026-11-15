// Edit checks for screenshots, receipts and documents (implementation spec §3.4).
//
// Runs entirely on the device: the side panel reads the file's bytes and
// nothing is uploaded. These are pure functions over bytes, so they're tested
// in Node. They look at what the file says about itself:
//   - images (JPEG, PNG, WebP): EXIF and XMP tags for editing software, dates,
//     and camera vs screenshot
//   - PDFs: the app that made it, saves after creation, created vs modified dates
// None of this proves a file is fake or real. Findings are framed as "things
// to check", and the UI always says to confirm payments in the real app.

export type FindingSeverity = "caution" | "info";

export interface Finding {
  severity: FindingSeverity;
  text: string;
}

export interface FileReport {
  kind: "jpeg" | "png" | "webp" | "pdf" | "other";
  findings: Finding[];
  /** What we read from the file, for the "details" list. */
  details: { label: string; value: string }[];
}

// Apps that edit photos or make images from scratch. A screenshot straight
// from a phone doesn't name any of these.
const IMAGE_EDITORS =
  /\b(adobe photoshop|photoshop|lightroom|gimp|snapseed|pixelmator|affinity photo|paint\.net|picsart|canva|fotor|facetune|befunky|pixlr|photopea|meitu|vsco|polarr|picmonkey|corel|acdsee|inshot|photoroom)\b/i;

// Online and desktop PDF editors.
const PDF_EDITORS =
  /\b(ilovepdf|smallpdf|pdfescape|sejda|pdffiller|dochub|pdf-xchange|foxit phantompdf|foxit pdf editor|nitro|pdfelement|wondershare|pdf candy|soda ?pdf|canva|photoshop|pdf24|lightpdf|pdfsimpli|formswift)\b/i;

// Word processors: normal for a lease or letter, unusual for a bank statement or receipt.
const WORD_PROCESSORS = /\b(microsoft(?:®)? word|word for (?:microsoft 365|office)|pages|google docs|libreoffice|openoffice|wps (?:office|writer))\b/i;

const LATIN1 = new TextDecoder("latin1"); // one char per byte, fast for big PDFs
const latin1 = (b: Uint8Array, start = 0, end = b.length) => {
  if (end - start > 4096) return LATIN1.decode(b.subarray(start, end));
  let s = "";
  for (let i = start; i < Math.min(end, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
};
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export function detectKind(b: Uint8Array): FileReport["kind"] {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (latin1(b, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (latin1(b, 0, 4) === "RIFF" && latin1(b, 8, 12) === "WEBP") return "webp";
  if (latin1(b, 0, 1024).includes("%PDF-")) return "pdf";
  return "other";
}

// ---------------------------------------------------------------------------
// EXIF (TIFF structure), shared by JPEG, PNG eXIf and WebP EXIF chunks
// ---------------------------------------------------------------------------

export interface ImageMeta {
  make?: string;
  model?: string;
  software?: string;
  modifiedAt?: string; // EXIF DateTime: when the file was last saved
  takenAt?: string; // EXIF DateTimeOriginal
  userComment?: string;
  xmp?: string;
  pngText: Record<string, string>;
  photoshopBlock: boolean;
}

const TAGS: Record<number, keyof ImageMeta> = {
  0x010f: "make",
  0x0110: "model",
  0x0131: "software",
  0x0132: "modifiedAt",
  0x9003: "takenAt",
  0x9286: "userComment",
};
const EXIF_IFD = 0x8769;

/** Reads the few EXIF tags we care about. Tolerates truncated or odd data. */
export function parseTiff(t: Uint8Array, meta: ImageMeta) {
  if (t.length < 8) return;
  const le = t[0] === 0x49; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : 0);
  const u32 = (o: number) =>
    o + 4 <= t.length
      ? le
        ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
        : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0
      : 0;

  const readIfd = (offset: number, depth: number) => {
    if (depth > 2 || offset < 8 || offset + 2 > t.length) return;
    const n = Math.min(u16(offset), 200);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (tag === EXIF_IFD) {
        readIfd(u32(e + 8), depth + 1);
        continue;
      }
      const key = TAGS[tag];
      if (!key || (type !== 2 && type !== 7) || count === 0 || count > 4096) continue;
      const start = count <= 4 ? e + 8 : u32(e + 8);
      if (start + count > t.length) continue;
      let bytes = t.subarray(start, start + count);
      if (type === 7 && latin1(bytes, 0, 8).startsWith("ASCII")) bytes = bytes.subarray(8); // UserComment charset prefix
      const value = latin1(bytes).replace(/\0+$/, "").trim();
      if (value) (meta as unknown as Record<string, string>)[key] = value;
    }
  };
  readIfd(u32(4), 0);
}

const newMeta = (): ImageMeta => ({ pngText: {}, photoshopBlock: false });

export function readJpegMeta(b: Uint8Array): ImageMeta {
  const meta = newMeta();
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1];
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of pixel data
    const len = (b[o + 2] << 8) | b[o + 3];
    const seg = b.subarray(o + 4, o + 2 + len);
    if (marker === 0xe1 && latin1(seg, 0, 6) === "Exif\0\0") parseTiff(seg.subarray(6), meta);
    else if (marker === 0xe1 && latin1(seg, 0, 29) === "http://ns.adobe.com/xap/1.0/\0") meta.xmp = utf8(seg.subarray(29));
    else if (marker === 0xed && latin1(seg, 0, 13) === "Photoshop 3.0") meta.photoshopBlock = true;
    else if (marker === 0xfe) meta.pngText.Comment = latin1(seg);
    o += 2 + len;
  }
  return meta;
}

export function readPngMeta(b: Uint8Array): ImageMeta {
  const meta = newMeta();
  let o = 8;
  while (o + 12 <= b.length) {
    const len = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const type = latin1(b, o + 4, o + 8);
    const data = b.subarray(o + 8, Math.min(b.length, o + 8 + len));
    if (type === "tEXt") {
      const z = data.indexOf(0);
      if (z > 0) meta.pngText[latin1(data, 0, z)] = latin1(data, z + 1);
    } else if (type === "iTXt") {
      // keyword \0 compressed? method language \0 translated \0 text
      const z = data.indexOf(0);
      if (z > 0 && data[z + 1] === 0) {
        let p = data.indexOf(0, z + 3); // end of language tag
        p = data.indexOf(0, p + 1); // end of translated keyword
        if (p > 0) {
          const key = latin1(data, 0, z);
          const text = utf8(data.subarray(p + 1));
          if (key === "XML:com.adobe.xmp") meta.xmp = text;
          else meta.pngText[key] = text;
        }
      }
    } else if (type === "eXIf") parseTiff(data, meta);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  return meta;
}

export function readWebpMeta(b: Uint8Array): ImageMeta {
  const meta = newMeta();
  let o = 12;
  while (o + 8 <= b.length) {
    const type = latin1(b, o, o + 4);
    const len = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
    const data = b.subarray(o + 8, Math.min(b.length, o + 8 + len));
    if (type === "EXIF") parseTiff(latin1(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data, meta);
    else if (type === "XMP ") meta.xmp = utf8(data);
    o += 8 + len + (len & 1);
  }
  return meta;
}

/** "2026:11:14 09:30:00" → ms since epoch (local time is fine: we only compare two of them). */
export function exifTime(s?: string): number | null {
  const m = s?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

const xmpValue = (xmp: string | undefined, name: string) =>
  xmp?.match(new RegExp(`${name}(?:="([^"]*)"|>([^<]*)<)`))?.slice(1).find(Boolean);

function imageFindings(meta: ImageMeta, kind: FileReport["kind"]): FileReport {
  const findings: Finding[] = [];
  const details: FileReport["details"] = [];
  const creatorTool = xmpValue(meta.xmp, "xmp:CreatorTool");
  const historyAgents = [...(meta.xmp?.matchAll(/stEvt:softwareAgent(?:="([^"]*)"|>([^<]*)<)/g) ?? [])].map((m) => m[1] ?? m[2]);
  const pngSoftware = meta.pngText.Software;

  const camera = [meta.make, meta.model].filter(Boolean).join(" ");
  if (camera) details.push({ label: "Camera", value: camera });
  if (meta.software) details.push({ label: "Software", value: meta.software });
  if (pngSoftware) details.push({ label: "Software", value: pngSoftware });
  if (creatorTool) details.push({ label: "Made with", value: creatorTool });
  if (meta.takenAt) details.push({ label: "Taken", value: meta.takenAt });
  if (meta.modifiedAt) details.push({ label: "Last saved", value: meta.modifiedAt });

  // 1. Editing software named anywhere in the metadata.
  const sources = [meta.software, pngSoftware, creatorTool, ...historyAgents, meta.pngText.Comment].filter(Boolean) as string[];
  const editor = sources.map((s) => s.match(IMAGE_EDITORS)?.[0]).find(Boolean);
  if (editor || meta.photoshopBlock) {
    findings.push({
      severity: "caution",
      text: `Saved with ${editor ?? "Adobe Photoshop"}. A screenshot straight from a phone wouldn't name an editing app.`,
    });
  }

  // 2. Saved again later than it was taken.
  const taken = exifTime(meta.takenAt ?? xmpValue(meta.xmp, "xmp:CreateDate"));
  const modified = exifTime(meta.modifiedAt ?? xmpValue(meta.xmp, "xmp:ModifyDate"));
  if (taken !== null && modified !== null && modified - taken > 60_000) {
    findings.push({ severity: "caution", text: "Saved again after it was taken, so it may have been changed." });
  }

  // 3. What kind of image this is.
  const screenshotTag = /screenshot/i.test(`${meta.userComment ?? ""} ${xmpValue(meta.xmp, "exif:UserComment") ?? ""} ${meta.pngText.Description ?? ""}`);
  if (screenshotTag) findings.push({ severity: "info", text: "The phone marked this as a screenshot (easy to fake, so it's only a hint)." });
  else if (camera) findings.push({ severity: "info", text: `This is a camera photo (${camera}), not a screenshot.` });

  const hasAny = sources.length || camera || meta.takenAt || meta.modifiedAt || meta.xmp || Object.keys(meta.pngText).length;
  if (!hasAny) {
    findings.push({
      severity: "info",
      text: "No hidden details in the file. That's normal for images sent through chat apps, which strip them, so it doesn't tell us much.",
    });
  }
  if (kind === "jpeg" && !camera) {
    findings.push({ severity: "info", text: "Saved as JPEG. Phone screenshots are usually PNG, so this copy was probably re-saved or sent through an app." });
  }
  return { kind, findings, details };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Decodes a PDF string: (literal) with escapes, or <FEFF...> UTF-16BE hex. */
export function pdfString(raw: string): string {
  if (raw.startsWith("<")) {
    const hex = raw.slice(1, -1).replace(/\s+/g, "");
    const bytes = hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let s = "";
      for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return s;
    }
    return String.fromCharCode(...bytes);
  }
  let s = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) =>
    /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e,
  );
  if (s.startsWith("\xfe\xff")) {
    let out = "";
    for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    s = out;
  }
  return s;
}

/** "D:20261114093000-06'00'" → ms since epoch (UTC fields; we only compare two). */
export function pdfDate(s?: string): number | null {
  const m = s?.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  return Date.UTC(+m[1], +(m[2] ?? 1) - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

const fmtPdfDate = (s: string) => {
  const m = s.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5] ?? "00"}` : ""}` : s;
};

export function checkPdf(b: Uint8Array): FileReport {
  const text = latin1(b);
  const findings: Finding[] = [];
  const details: FileReport["details"] = [];

  // Info dictionary entries (literal or hex strings), with XMP as a fallback.
  const infoValue = (key: string) => {
    const m = text.match(new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`));
    return m ? pdfString(m[1]).trim() : undefined;
  };
  const producer = infoValue("Producer") ?? xmpValue(text, "pdf:Producer");
  const creator = infoValue("Creator") ?? xmpValue(text, "xmp:CreatorTool");
  const created = infoValue("CreationDate");
  const modified = infoValue("ModDate");
  if (creator) details.push({ label: "Made with", value: creator });
  if (producer) details.push({ label: "Saved by", value: producer });
  if (created) details.push({ label: "Created", value: fmtPdfDate(created) });
  if (modified) details.push({ label: "Modified", value: fmtPdfDate(modified) });

  // 1. The app that made or last saved it.
  const tools = [creator, producer].filter(Boolean).join(" · ");
  const editor = tools.match(PDF_EDITORS)?.[0];
  const wordProcessor = tools.match(WORD_PROCESSORS)?.[0];
  if (editor) {
    findings.push({ severity: "caution", text: `Saved with ${editor}, a PDF or image editor. Real receipts, invoices and statements come straight from the store or bank.` });
  } else if (wordProcessor) {
    findings.push({
      severity: "info",
      text: `Made in ${wordProcessor}. Normal for a lease or a letter; unusual for a store receipt, invoice or official document.`,
    });
  } else if (!tools) {
    findings.push({ severity: "info", text: "The PDF doesn't say which app made it." });
  }

  // 2. Saved again after it was first made (incremental updates). A linearized
  //    ("fast web view") PDF legitimately has two end markers.
  const eofs = text.match(/%%EOF/g)?.length ?? 0;
  const linearized = /\/Linearized\b/.test(text.slice(0, 2048));
  const updates = Math.max(0, eofs - 1 - (linearized ? 1 : 0));
  if (updates > 0) {
    details.push({ label: "Saves after creation", value: String(updates) });
    findings.push({
      severity: "caution",
      text: `Saved again ${updates === 1 ? "once" : `${updates} times`} after it was first made. That happens when a PDF is edited, filled in, or signed.`,
    });
  }

  // 3. Modified later than created.
  const c = pdfDate(created);
  const m = pdfDate(modified);
  if (c !== null && m !== null && m - c > 60_000) {
    findings.push({ severity: "caution", text: `Modified after it was created (${fmtPdfDate(created!)} → ${fmtPdfDate(modified!)}).` });
  }

  if (/\/Encrypt\b/.test(text)) findings.push({ severity: "info", text: "The PDF is encrypted, so some details may be hidden." });
  return { kind: "pdf", findings, details };
}

// ---------------------------------------------------------------------------

export function checkFileBytes(b: Uint8Array): FileReport {
  const kind = detectKind(b);
  if (kind === "jpeg") return imageFindings(readJpegMeta(b), kind);
  if (kind === "png") return imageFindings(readPngMeta(b), kind);
  if (kind === "webp") return imageFindings(readWebpMeta(b), kind);
  if (kind === "pdf") return checkPdf(b);
  return {
    kind,
    findings: [{ severity: "info", text: "Second Look can check JPEG, PNG and WebP images and PDFs. Try a screenshot or a PDF." }],
    details: [],
  };
}
