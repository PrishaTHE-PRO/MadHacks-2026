// Photo privacy: metadata findings, PII text classification, box math.
// fixtures/gps.jpg is a generated 64x48 image with iPhone-style EXIF + GPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectMetadata } from "../../extension/src/privacy/metadata";
import { summarizeMetadata } from "../../extension/src/privacy/summarize";
import { classifyText, groupText } from "../../extension/src/privacy/pii";
import { nms, tiles, pad, iou, fromPoints } from "../../extension/src/privacy/geometry";

const gpsJpg = readFileSync(new URL("./fixtures/gps.jpg", import.meta.url));

test("finds GPS, device, serial, owner and date in a phone photo", async () => {
  const r = await inspectMetadata(new Uint8Array(gpsJpg));
  assert.ok(r.gps);
  assert.ok(Math.abs(r.gps.latitude - 43.0731) < 0.001, `lat ${r.gps.latitude}`);
  assert.ok(Math.abs(r.gps.longitude - -89.4012) < 0.001, `lng ${r.gps.longitude}`);
  const ids = r.findings.map((f) => f.id);
  for (const id of ["gps", "device", "serial", "owner", "date", "software"]) assert.ok(ids.includes(id), `missing ${id}: ${ids}`);
  assert.equal(r.findings[0].id, "gps", "GPS is listed first");
  assert.equal(r.findings.find((f) => f.id === "device")!.detail, "Apple iPhone 15 Pro");
  assert.ok(r.fieldCount >= 8, `fieldCount ${r.fieldCount}`);
});

test("a photo with no metadata has no findings", () => {
  const r = summarizeMetadata(null, null, false);
  assert.deepEqual(r.findings, []);
  assert.equal(r.fieldCount, 0);
  assert.equal(r.gps, null);
});

test("ignores 0,0 GPS (cameras write it when they have no fix)", () => {
  assert.equal(summarizeMetadata({}, { latitude: 0, longitude: 0 }, false).gps, null);
});

test("image format fields alone don't count as personal metadata", () => {
  assert.equal(summarizeMetadata({ ihdr: { ImageWidth: 10, ImageHeight: 10, BitDepth: 8 } }, null, false).fieldCount, 0);
});

test("classifies personal text found in photos", () => {
  const cases: [string, string | null][] = [
    ["1234 Elm Street Apt 5", "address"],
    ["742 Evergreen Terrace", "address"],
    ["PO Box 1182", "address"],
    ["Madison, WI 53703", "postal"],
    ["(608) 555-0142", "phone"],
    ["jane.seller@gmail.com", "email"],
    ["1Z999AA10123456784", "tracking"],
    ["9400 1000 0000 0000 0000 00", "tracking"],
    ["1234", "number"],
    ["Vintage leather bag", null],
    ["SIZE M", null],
    ["Made in Italy", null],
  ];
  for (const [text, kind] of cases) assert.equal(classifyText(text)?.kind ?? null, kind, text);
});

test("groups a mailing label (name + address) and ignores OCR junk on the same row", () => {
  const w = (text: string, x: number, y: number, confidence = 90, width = text.length * 22) => ({
    text,
    confidence,
    box: { x, y, w: width, h: 44 },
  });
  const lines = [
    [w("JANE", 860, 340), w("SELLER", 960, 340)],
    // OCR read junk off the left half of the photo onto the same row as the address
    [w("0", 20, 430, 30), w("N\\", 120, 430, 60), w("1234", 860, 430), w("Elm", 970, 430), w("Street", 1050, 430), w("Apt", 1190, 430), w("5", 1270, 430)],
    [w("£", 300, 520, 20), w("Madison,", 860, 520), w("WI", 1050, 520), w("53703", 1110, 520)],
    [w("Vintage", 860, 760), w("leather", 1030, 760), w("bag", 1190, 760)],
  ];
  const groups = groupText(lines);
  const label = groups.find((g) => g.isLabel)!;
  assert.ok(label, "found a label");
  assert.equal(label.text, "JANE SELLER / 1234 Elm Street Apt 5 / Madison, WI 53703");
  assert.equal(label.box.x, 860, "junk on the left isn't part of the label");
  assert.ok(label.box.y <= 340 && label.box.y + label.box.h >= 564);
  // Low-confidence and single-character junk is dropped; real text stays as a suggestion.
  const other = groups.filter((g) => !g.isLabel);
  assert.deepEqual(
    other.map((g) => [g.text, g.match]),
    [["Vintage leather bag", null]],
  );
});

test("tiles cover the whole image and small images aren't tiled", () => {
  assert.equal(tiles(640, 480).length, 1);
  const t = tiles(4000, 3000);
  assert.equal(t.length, 10);
  const last = t[t.length - 1];
  assert.ok(Math.abs(last.x + last.w - 4000) <= 1 && Math.abs(last.y + last.h - 3000) <= 1);
});

test("nms keeps one box per face found in overlapping tiles", () => {
  const kept = nms([
    { x: 100, y: 100, w: 50, h: 50, score: 0.9 },
    { x: 102, y: 98, w: 52, h: 50, score: 0.8 },
    { x: 110, y: 110, w: 30, h: 30, score: 0.7 }, // inside the first
    { x: 400, y: 100, w: 50, h: 50, score: 0.6 },
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].score, 0.9);
});

test("box helpers", () => {
  assert.deepEqual(pad({ x: 0, y: 0, w: 10, h: 10 }, 0.5, 12, 100), { x: 0, y: 0, w: 12, h: 15 });
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.deepEqual(fromPoints(10, 20, 4, 5), { x: 4, y: 5, w: 6, h: 15 });
});
