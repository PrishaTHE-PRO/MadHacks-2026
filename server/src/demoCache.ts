// DEMO_MODE=1: replay cached Claude chat flags for the demo script, so the
// demo works on bad venue Wi-Fi or without an API key (spec §9 "Backups").
//
// Cache: demo/chat-cache.json, keyed by the redacted message text. When every
// message in a request is cached, the cached flags are returned and Claude
// isn't called. On a miss (with a key), the live result is recorded per
// message. To re-record from scratch, delete the file and run the demo once
// with DEMO_MODE=1 and an API key.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHAT_PATTERN_IDS, type ChatPatternId } from "../../shared/types";
import type { ChatInputMessage } from "./claude";

type CachedFlag = { pattern: ChatPatternId; severity: "info" | "caution" | "danger"; reason: string };
type Cache = Record<string, CachedFlag[]>;

// The file can be hand-edited, so drop entries that don't fit the schema.
const valid = (f: CachedFlag) =>
  (CHAT_PATTERN_IDS as readonly string[]).includes(f.pattern) &&
  ["info", "caution", "danger"].includes(f.severity) &&
  typeof f.reason === "string";

const FILE = fileURLToPath(new URL("../demo/chat-cache.json", import.meta.url));

export const demoMode = () => process.env.DEMO_MODE === "1";

function load(): Cache {
  if (!existsSync(FILE)) return {};
  const { _note, ...raw } = JSON.parse(readFileSync(FILE, "utf8")) as Cache & { _note?: string };
  return Object.fromEntries(
    Object.entries(raw).map(([text, flags]) => [text, Array.isArray(flags) ? flags.filter(valid) : []]),
  );
}

/** Cached flags for these messages, or null if any message isn't cached. */
export function demoReplay(messages: ChatInputMessage[]) {
  const cache = load();
  if (!messages.every((m) => m.text in cache)) return null;
  return messages.flatMap((m) => cache[m.text].map((f) => ({ ...f, message_id: m.id })));
}

/** Store a live result per message text. */
export function demoRecord(messages: ChatInputMessage[], flags: (CachedFlag & { message_id: string })[]) {
  const cache = load();
  for (const m of messages) {
    cache[m.text] = flags
      .filter((f) => f.message_id === m.id)
      .map(({ pattern, severity, reason }) => ({ pattern, severity, reason }));
  }
  mkdirSync(fileURLToPath(new URL("../demo/", import.meta.url)), { recursive: true });
  writeFileSync(
    FILE,
    JSON.stringify({ _note: "DEMO_MODE cache for the demo chat (server/src/demoCache.ts). The first entries were written by hand for the scripted messages; delete this file and run the demo once with DEMO_MODE=1 and an API key to record real Claude output.", ...cache }, null, 2) + "\n",
  );
}
