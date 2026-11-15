// Decides which text found in a photo is personal info worth hiding.
// Pure functions, tested in Node.

import { union, type Box } from "./geometry";

export type PiiKind = "address" | "phone" | "email" | "tracking" | "postal" | "number";

export interface PiiMatch {
  kind: PiiKind;
  label: string; // shown to the user, e.g. "Street address"
}

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|ter|terrace|cir|circle|pkwy|parkway|hwy|highway|trl|trail)\b\.?/i;
const UNIT = /\b(apt|apartment|unit|suite|ste|#\s?\d+)\b/i;
const PO_BOX = /\bp\.?\s?o\.?\s?box\b/i;
const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const CITY_STATE_ZIP = new RegExp(`\\b(${STATES})\\b[\\s,]*\\d{5}(-\\d{4})?\\b`);
const ZIP = /\b\d{5}(-\d{4})\b/; // ZIP+4 on its own is distinctive enough
const PHONE = /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
// UPS (1Z...), USPS (20-22 digits / 9400...), FedEx (12-15 digits)
const TRACKING = /\b(1Z[0-9A-Z]{16}|9[2-5]\d{18,20}|\d{12,15})\b/;
const LEADING_NUMBER = /^\s*\d{1,6}[a-z]?\s+\S+/i;
const BARE_NUMBER = /^\s*\d{1,6}[a-z]?\s*$/i; // house numbers on doors, mailboxes

/** Tidy OCR output: unify look-alike characters, drop invisible ones, collapse spaces. */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyText(raw: string): PiiMatch | null {
  const text = normalize(raw);
  if (text.length < 2) return null;

  if (EMAIL.test(text)) return { kind: "email", label: "Email address" };
  if (TRACKING.test(text.replace(/\s/g, ""))) return { kind: "tracking", label: "Tracking or account number" };
  if (PHONE.test(text)) return { kind: "phone", label: "Phone number" };
  if (PO_BOX.test(text)) return { kind: "address", label: "PO box" };
  if ((LEADING_NUMBER.test(text) && STREET_SUFFIX.test(text)) || (UNIT.test(text) && /\d/.test(text)))
    return { kind: "address", label: "Street address" };
  if (CITY_STATE_ZIP.test(text) || ZIP.test(text)) return { kind: "postal", label: "City, state and ZIP" };
  if (BARE_NUMBER.test(text)) return { kind: "number", label: "House or unit number" };
  return null;
}

// ---------------------------------------------------------------------------
// Grouping OCR words into things to cover.

export interface OcrWord {
  text: string;
  confidence: number; // 0-100
  box: Box;
}

export interface TextGroup {
  box: Box;
  text: string;
  match: PiiMatch | null;
  /** A mailing label: an address plus the lines around it (usually a name). */
  isLabel: boolean;
}

const MIN_WORD_CONFIDENCE = 55;

/**
 * OCR on a photo (not a scanned page) reads a whole row of the image as one
 * "line", gluing real text to junk it hallucinated from fabric or shadows.
 * So: drop low-confidence junk, split lines at big horizontal gaps, check each
 * piece, then grow every address into the full label around it.
 */
export function groupText(lines: OcrWord[][]): TextGroup[] {
  type Piece = { box: Box; text: string; h: number; match: PiiMatch | null };
  const pieces: Piece[] = [];

  for (const words of lines) {
    const good = words
      .filter((w) => w.confidence >= MIN_WORD_CONFIDENCE && /[a-z0-9@]/i.test(w.text))
      .sort((a, b) => a.box.x - b.box.x);
    let run: OcrWord[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const text = run.map((w) => w.text).join(" ");
      if (text.replace(/[^a-z0-9]/gi, "").length >= 2) {
        const h = [...run.map((w) => w.box.h)].sort((a, b) => a - b)[Math.floor(run.length / 2)];
        pieces.push({ box: union(run.map((w) => w.box)), text, h, match: classifyText(text) });
      }
      run = [];
    };
    for (const w of good) {
      const prev = run[run.length - 1];
      if (prev && w.box.x - (prev.box.x + prev.box.w) > 1.5 * Math.max(w.box.h, prev.box.h)) flush();
      run.push(w);
    }
    flush();
  }

  // Grow each address into its label: lines just above/below that line up with it.
  const used = new Set<number>();
  const groups: TextGroup[] = [];
  const near = (a: Piece, g: Box, h: number) => {
    const gap = Math.max(g.y - (a.box.y + a.box.h), a.box.y - (g.y + g.h), 0);
    const overlap = Math.min(a.box.x + a.box.w, g.x + g.w) - Math.max(a.box.x, g.x);
    const aligned = Math.abs(a.box.x - g.x) < 1.5 * h || overlap > 0.3 * Math.min(a.box.w, g.w);
    // OCR boxes hug the letters, so even normal line spacing looks like a big
    // gap. Erring toward covering a nearby line is the safe mistake here.
    return gap < 2.4 * Math.max(h, a.h) && aligned;
  };

  pieces.forEach((p, i) => {
    if (used.has(i) || !(p.match?.kind === "address" || p.match?.kind === "postal")) return;
    const members = [i];
    used.add(i);
    let box = p.box;
    for (let grew = true; grew; ) {
      grew = false;
      pieces.forEach((q, j) => {
        if (used.has(j) || !near(q, box, p.h)) return;
        members.push(j);
        used.add(j);
        box = union([box, q.box]);
        grew = true;
      });
    }
    const ordered = members.map((m) => pieces[m]).sort((a, b) => a.box.y - b.box.y);
    groups.push({
      box,
      text: ordered.map((m) => m.text).join(" / "),
      match: { kind: "address", label: "Mailing label / address" },
      isLabel: true,
    });
  });

  pieces.forEach((p, i) => {
    if (!used.has(i)) groups.push({ box: p.box, text: p.text, match: p.match, isLabel: false });
  });
  return groups;
}
