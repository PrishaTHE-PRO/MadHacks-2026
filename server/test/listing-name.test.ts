// The product name on the listing card: Claude's short name, or the site's
// title shortened at a word, never ending in "..." or "…".
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../../extension/src/ui/listingFacts";
import type { Listing } from "../../shared/types";

const listing = (title: string) => ({ title }) as Listing;

test("uses Claude's short name when there is one", () => {
  assert.equal(
    displayName(listing("Diane Von Furstenberg Vintage Pink and Brown Wrap ..."), "DVF silk jersey wrap dress"),
    "DVF silk jersey wrap dress",
  );
});

test("drops trailing dots and keeps short titles as they are", () => {
  assert.equal(displayName(listing("Nike Dunk Low Panda")), "Nike Dunk Low Panda");
  assert.equal(displayName(listing("Coach Tabby 26 bag...")), "Coach Tabby 26 bag");
  assert.equal(displayName(listing("Coach Tabby 26 bag …")), "Coach Tabby 26 bag");
});

test("cuts long titles at a word, without dots or a dangling word", () => {
  // Depop's JSON-LD name, already cut off by the site
  const depop = displayName(listing("grey and white striped long sleeve top with v neck..."));
  assert.equal(depop, "grey and white striped long sleeve top");
  const long = displayName(listing("Diane Von Furstenberg Vintage Pink and Brown Wrap Dress Size 6 Silk Jersey Tie Dye"));
  assert.ok(long.length <= 48, long);
  assert.ok(!/(\.\.\.|…)$/.test(long), long);
  assert.equal(long, "Diane Von Furstenberg Vintage Pink and Brown");
});

test("an empty AI name falls back to the title", () => {
  assert.equal(displayName(listing("Trek FX 2 Hybrid Bike"), "  "), "Trek FX 2 Hybrid Bike");
});
