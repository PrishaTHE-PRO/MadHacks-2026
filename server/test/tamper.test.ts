// Screenshot and document edit checks (spec §3.4). These run in the
// extension, on the device; the parsers are pure so they're tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFileBytes, detectKind, pdfDate, pdfString } from "../../extension/src/tamper/metadata";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const concat = (...parts: Uint8Array<ArrayBufferLike>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Little-endian TIFF with IFD0 ASCII tags and an Exif sub-IFD. */
function tiff(ifd0: Record<number, string>, exif: Record<number, string> = {}): Uint8Array {
  const buf: number[] = [];
  const u16 = (n: number) => buf.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (n: number) => buf.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  const set32 = (at: number, n: number) => {
    buf[at] = n & 0xff;
    buf[at + 1] = (n >> 8) & 0xff;
    buf[at + 2] = (n >> 16) & 0xff;
    buf[at + 3] = (n >>> 24) & 0xff;
  };
  buf.push(0x49, 0x49);
  u16(42);
  u32(8);
  const pending: { at: number; value: string }[] = [];
  const writeIfd = (tags: Record<number, string>, extraPointer: boolean) => {
    const entries = Object.entries(tags);
    u16(entries.length + (extraPointer ? 1 : 0));
    let pointerAt = -1;
    for (const [tag, value] of entries) {
      u16(Number(tag));
      u16(2);
      u32(value.length + 1);
      pending.push({ at: buf.length, value: value + "\0" });
      u32(0);
    }
    if (extraPointer) {
      u16(0x8769);
      u16(4);
      u32(1);
      pointerAt = buf.length;
      u32(0);
    }
    u32(0); // next IFD
    return pointerAt;
  };
  const pointerAt = writeIfd(ifd0, Object.keys(exif).length > 0);
  if (pointerAt >= 0) {
    set32(pointerAt, buf.length);
    writeIfd(exif, false);
  }
  for (const p of pending) {
    set32(p.at, buf.length);
    for (const c of p.value) buf.push(c.charCodeAt(0));
  }
  return Uint8Array.from(buf);
}

function jpeg(segments: { marker: number; data: Uint8Array }[]) {
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  for (const s of segments) {
    const len = s.data.length + 2;
    parts.push(Uint8Array.of(0xff, s.marker, len >> 8, len & 0xff), s.data);
  }
  parts.push(Uint8Array.of(0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9));
  return concat(...parts);
}

function png(chunks: { type: string; data: Uint8Array }[]) {
  const parts: Uint8Array[] = [enc("\x89PNG\r\n\x1a\n")];
  for (const c of [...chunks, { type: "IEND", data: new Uint8Array() }]) {
    const n = c.data.length;
    parts.push(Uint8Array.of(n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff), enc(c.type), c.data, Uint8Array.of(0, 0, 0, 0));
  }
  return concat(...parts);
}

const texts = (b: Uint8Array) => checkFileBytes(b).findings.map((f) => `${f.severity}: ${f.text}`);

test("detectKind", () => {
  assert.equal(detectKind(jpeg([])), "jpeg");
  assert.equal(detectKind(png([])), "png");
  assert.equal(detectKind(enc("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(detectKind(enc("%PDF-1.7\n")), "pdf");
  assert.equal(detectKind(enc("hello")), "other");
});

test("JPEG: Photoshop in EXIF Software and saved after it was taken", () => {
  const exif = tiff(
    { 0x010f: "Apple", 0x0110: "iPhone 15", 0x0131: "Adobe Photoshop 25.0 (Windows)", 0x0132: "2026:11:14 10:15:00" },
    { 0x9003: "2026:11:14 09:30:00" },
  );
  const r = checkFileBytes(jpeg([{ marker: 0xe1, data: concat(enc("Exif\0\0"), exif) }]));
  assert.equal(r.kind, "jpeg");
  const f = r.findings.map((x) => `${x.severity}: ${x.text}`);
  assert.ok(f.some((t) => t.startsWith("caution: Saved with Adobe Photoshop")), f.join("\n"));
  assert.ok(f.some((t) => t.startsWith("caution: Saved again after it was taken")));
  assert.ok(f.some((t) => t.includes("camera photo (Apple iPhone 15)")));
  assert.deepEqual(r.details.find((d) => d.label === "Taken"), { label: "Taken", value: "2026:11:14 09:30:00" });
});

test("JPEG: a Photoshop resource block alone is enough", () => {
  assert.ok(texts(jpeg([{ marker: 0xed, data: enc("Photoshop 3.0\x008BIM") }])).some((t) => t.includes("Adobe Photoshop")));
});

test("JPEG with no metadata: only info, mentions chat apps and re-saving", () => {
  const f = texts(jpeg([]));
  assert.ok(f.every((t) => t.startsWith("info:")));
  assert.ok(f.some((t) => t.includes("chat apps")));
  assert.ok(f.some((t) => t.includes("usually PNG")));
});

test("PNG: GIMP in a tEXt chunk", () => {
  const f = texts(png([{ type: "tEXt", data: enc("Software\0GIMP 2.10.36") }]));
  assert.ok(f.some((t) => t.startsWith("caution: Saved with GIMP")), f.join("\n"));
});

test("PNG: XMP edit history from Canva, and an iOS screenshot tag", () => {
  const xmp = `<x:xmpmeta><rdf:li stEvt:action="saved" stEvt:softwareAgent="Canva"/><exif:UserComment>Screenshot</exif:UserComment></x:xmpmeta>`;
  const f = texts(png([{ type: "iTXt", data: concat(enc("XML:com.adobe.xmp\0\0\0\0\0"), enc(xmp)) }]));
  assert.ok(f.some((t) => t.startsWith("caution: Saved with Canva")), f.join("\n"));
  assert.ok(f.some((t) => t.includes("marked this as a screenshot")));
});

test("PNG straight from a phone: no cautions", () => {
  const f = texts(png([{ type: "eXIf", data: tiff({}, { 0x9286: "ASCII\0\0\0Screenshot" }) }]));
  assert.ok(f.every((t) => t.startsWith("info:")), f.join("\n"));
});

const pdf = (body: string) => enc(`%PDF-1.7\n${body}`);

test("PDF: online editor, saved again, modified after created", () => {
  const r = checkFileBytes(
    pdf(
      `1 0 obj << /Producer (iLovePDF) /Creator (Chase Statements) /CreationDate (D:20261101080000Z) /ModDate (D:20261113221500Z) >> endobj
trailer << >>\n%%EOF\n2 0 obj << >> endobj\ntrailer << /Prev 9 >>\n%%EOF\n`,
    ),
  );
  const f = r.findings.map((x) => `${x.severity}: ${x.text}`);
  assert.ok(f.some((t) => t.startsWith("caution: Saved with iLovePDF")), f.join("\n"));
  assert.ok(f.some((t) => t.startsWith("caution: Saved again once")));
  assert.ok(f.some((t) => t.startsWith("caution: Modified after it was created (2026-11-01 08:00 → 2026-11-13 22:15)")));
  assert.deepEqual(r.details.find((d) => d.label === "Saved by"), { label: "Saved by", value: "iLovePDF" });
});

test("PDF: a clean, linearized export has no cautions", () => {
  const f = texts(
    pdf(
      `1 0 obj << /Linearized 1 >> endobj\n%%EOF\n2 0 obj << /Producer (Bank Statement Engine 4.2) /CreationDate (D:20261101080000) /ModDate (D:20261101080000) >> endobj\n%%EOF\n`,
    ),
  );
  assert.deepEqual(f, []);
});

test("PDF: made in Word is info, not a caution; UTF-16 hex strings decode", () => {
  const hex = "<FEFF004D006900630072006F0073006F0066007400AE00200057006F00720064>"; // "Microsoft® Word"
  const f = texts(pdf(`<< /Creator ${hex} >>\n%%EOF\n`));
  assert.deepEqual(f, ["info: Made in Microsoft® Word. Normal for a lease or a letter; unusual for a store receipt, invoice or official document."]);
});

test("pdfString and pdfDate", () => {
  assert.equal(pdfString("(Acme \\(Pty\\) Ltd\\n)"), "Acme (Pty) Ltd\n");
  assert.equal(pdfString("<48656C6C6F>"), "Hello");
  assert.equal(pdfDate("D:20261114093000-06'00'"), Date.UTC(2026, 10, 14, 9, 30, 0));
  assert.equal(pdfDate("garbage"), null);
});

test("unsupported files get a helpful message", () => {
  assert.match(texts(enc("GIF89a....")).join(), /JPEG, PNG and WebP images and PDFs/);
});
