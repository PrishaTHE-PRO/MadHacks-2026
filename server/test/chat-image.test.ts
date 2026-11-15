import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkFileBytes } from "../../extension/src/tamper/metadata";
import { imageFlag } from "../../extension/src/chat/imageCheck";
import { AI_CHAT_PATTERN_IDS, CHAT_PATTERN_IDS } from "../../shared/types";
import { CHAT_PATTERNS } from "../../shared/chatPatterns";

const bytes = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));

test("the demo's fake invoice is flagged as an edited image", () => {
  const flag = imageFlag(checkFileBytes(bytes("../../extension/demo/fake-invoice.jpg")), "m9");
  assert.equal(flag?.pattern, "edited_image");
  assert.equal(flag?.messageId, "m9");
  assert.match(flag?.reason ?? "", /Adobe Photoshop/);
});

test("a camera photo with no editing app is not flagged", () => {
  assert.equal(imageFlag(checkFileBytes(bytes("./fixtures/gps.jpg")), "m1"), null);
});

test("edited_image is raised by code only, and has a pattern entry", () => {
  assert.ok(CHAT_PATTERN_IDS.includes("edited_image"));
  assert.ok(!(AI_CHAT_PATTERN_IDS as readonly string[]).includes("edited_image"));
  assert.ok(CHAT_PATTERNS.some((p) => p.id === "edited_image"));
});
