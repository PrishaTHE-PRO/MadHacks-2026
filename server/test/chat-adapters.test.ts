// Chat adapter tests against saved pages (docs/chat-safety-task.md, Phase 4-5).
// Real site fixtures go in test/fixtures/chat/<site>.html; the demo chat page
// doubles as the demo adapter's fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { demo } from "../../extension/src/chat/demo";
import { findChatAdapter } from "../../extension/src/chat";
import { prefilter } from "../../shared/chatPatterns";
import { redact } from "../src/chat";
import { demoReplay } from "../src/demoCache";
import type { ChatContext } from "../../shared/types";

const DEMO_HTML = readFileSync(new URL("../../extension/demo/chat.html", import.meta.url), "utf8");
const demoDoc = () => parseHTML(DEMO_HTML).document as unknown as Document;

/** The scripted scam messages, read from the page so the test follows edits to it. */
const SCRIPT: string[] = JSON.parse(
  `[${DEMO_HTML.match(/const SCRIPT = \[([\s\S]*?)\];/)![1].replace(/,\s*$/, "")}]`,
);

test("demo adapter: matches only the demo page", () => {
  assert.equal(findChatAdapter("http://localhost:8787/demo/chat"), demo);
  assert.equal(findChatAdapter("http://localhost:8787/health"), null);
  assert.equal(findChatAdapter("https://www.facebook.com/messages/t/123")?.platform, "facebook");
  assert.equal(findChatAdapter("https://www.ebay.com/mesg/abc")?.platform, "ebay");
  assert.equal(findChatAdapter("https://poshmark.com/listing/abc-123")?.platform, "poshmark");
  assert.equal(findChatAdapter("https://www.ebay.com/itm/123"), null);
});

test("demo adapter: reads the messages, who sent them, and the thread context", () => {
  const doc = demoDoc();
  const thread = demo.findThread(doc)!;
  assert.ok(thread);
  const msgs = demo.readMessages(thread).map((m) => m.msg);
  assert.equal(msgs.length, 3);
  assert.deepEqual(
    msgs.map((m) => [m.id, m.fromMe]),
    [
      ["m1", true],
      ["m2", false],
      ["m3", true],
    ],
  );
  assert.equal(msgs[0].text, "Hi! Is the room still available for spring?");
  assert.equal(msgs[1].author, "Jordan Reyes");
  const ctx = demo.readContext(doc);
  assert.equal(ctx.threadId, "demo-sublet");
  assert.equal(ctx.listing?.price, 650);
  assert.equal(ctx.otherParty?.username, "Jordan Reyes");
});

test("demo script: the regex check flags the scripted scam", () => {
  const ctx: ChatContext = {
    platform: "generic",
    threadId: "demo-sublet",
    url: "",
    role: "buyer",
    messages: SCRIPT.map((text, i) => ({ id: `s${i}`, fromMe: false, text })),
  };
  const byMessage = SCRIPT.map((_, i) =>
    prefilter(ctx)
      .filter((f) => f.messageId === `s${i}`)
      .map((f) => f.pattern)
      .sort(),
  );
  assert.deepEqual(byMessage, [
    [], // "can't show it, but I can hold it": no money asked yet (Claude's job)
    ["deposit_before_viewing", "off_platform", "unprotected_payment"],
    [], // "three other students are asking": pressure the regexes miss (Claude's job)
    ["unprotected_payment"],
  ]);
});

test("demo script: DEMO_MODE has a cached Claude result for every demo message", () => {
  const doc = demoDoc();
  const initial = demo.readMessages(demo.findThread(doc)!).map((m) => m.msg.text);
  const texts = [...initial, ...SCRIPT];
  const replay = demoReplay(texts.map((t, i) => ({ id: String(i + 1), from_me: false, text: redact(t) })));
  assert.ok(replay, "every message is cached");
  assert.deepEqual(replay.map((f) => f.pattern).sort(), ["deposit_before_viewing", "urgency_pressure"]);
});
