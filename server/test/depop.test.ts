// Depop parser tests, against a saved depop.com/products/... page
// (fixtures/depop-listing.html). The page is turned into PageData the way
// content/collect.ts does it in Chrome, with linkedom standing in for the DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { DEPOP_SECTIONS, isDepopListingUrl, parseDepopPage } from "../../extension/src/adapters/depop";
import type { PageData, PageLink } from "../../extension/src/adapters/page";
import { runRules } from "../src/rules";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const URL_ = "https://www.depop.com/products/stugbug_v-grey-and-white-striped-long-0d53/";
const HTML = readFileSync(new URL("./fixtures/depop-listing.html", import.meta.url), "utf8");

/** innerText stand-in: block elements end with a newline, like Chrome's innerText. */
function innerText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const b of clone.querySelectorAll("p, div, li, h1, h2, h3, button")) b.append("\n");
  return (clone.textContent ?? "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n+/g, "\n").trim();
}

const links = (root: ParentNode): PageLink[] =>
  [...root.querySelectorAll("a[href]")].map((a) => ({
    href: new URL(a.getAttribute("href")!, URL_).href,
    text: innerText(a).replace(/\s+/g, " "),
    label: a.getAttribute("aria-label") ?? undefined,
  }));

/** What content/collect.ts produces for this page with DEPOP_SECTIONS. */
function collect(html: string, url = URL_): PageData {
  const { document } = parseHTML(html);
  const sections: PageData["sections"] = {};
  for (const [name, selector] of Object.entries(DEPOP_SECTIONS)) {
    const el = document.querySelector(selector);
    sections[name] = el
      ? {
          text: innerText(el),
          links: links(el),
          labels: [el, ...el.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter(Boolean) as string[],
        }
      : undefined;
  }
  const photosEl = document.querySelector(DEPOP_SECTIONS.photos);
  return {
    url,
    documentTitle: document.title,
    meta: Object.fromEntries(
      [...document.querySelectorAll("meta[content]")]
        .map((m) => [m.getAttribute("property") ?? m.getAttribute("name"), m.getAttribute("content")])
        .filter(([k]) => k),
    ),
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!)),
    text: "",
    headings: [],
    // linkedom files the page's links outside <body> (the saved page has a browser
    // extension's <template shadowrootmode> in it); in Chrome, collect.ts reads them from <body>.
    links: links(document),
    images: photosEl
      ? [...photosEl.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src") ?? "", alt: i.getAttribute("alt") ?? "", width: 600, height: 600 }))
      : [],
    sections,
  };
}

test("recognizes Depop listing URLs", () => {
  const cases: [string, boolean][] = [
    ["https://www.depop.com/products/janedoe-vintage-levis-501-jeans/", true],
    ["https://www.depop.com/products/janedoe-vintage-levis-501-jeans", true],
    ["https://depop.com/products/janedoe-coach-tabby-26/?ref=search", true],
    // the sell flow, profiles, search and lookalikes are not listings
    ["https://www.depop.com/products/create/", false],
    ["https://www.depop.com/products/edit/janedoe-tee/", false],
    ["https://www.depop.com/janedoe/", false],
    ["https://www.depop.com/search/?q=coach", false],
    ["https://www.depop.com.evil.example/products/janedoe-tee/", false],
    ["http://www.depop.com/products/janedoe-tee/", false],
    ["https://evil-depop.com/products/x/", false],
    ["not a url", false],
  ];
  for (const [url, ok] of cases) assert.equal(isDepopListingUrl(url), ok, url);
  // The page's own og:url
  const og = collect(HTML).meta["og:url"];
  assert.equal(og, URL_);
  assert.ok(isDepopListingUrl(og));
});

test("reads a saved Depop listing", () => {
  const l = parseDepopPage(collect(HTML), NOW);
  assert.ok(l);
  assert.equal(l.platform, "depop");
  assert.equal(l.id, "979850109");
  assert.equal(l.url, URL_);
  assert.equal(l.title, "Women's Grey Shirt");
  assert.equal(l.description, "grey and white striped long sleeve top with v neck and tie back Size s #fall #vneck #striped #feminine");
  assert.equal(l.price, 8);
  assert.equal(l.currency, "USD");
  assert.equal(l.size, "S");
  assert.equal(l.condition, "Like new condition");
  assert.equal(l.brand, undefined); // Depop's "Other" means no brand
  assert.equal(l.category, "Women > Tops > Shirts");
  assert.equal(l.likes, 14);
  assert.equal(l.status, "available");
  assert.deepEqual(l.photos, [
    "https://media-photos.depop.com/r1/52009648/5097972247_184b9b4516f44e4bbd39a69888328f99/P0.jpg",
    "https://media-photos.depop.com/r1/52009648/5097972064_7c1d7153526c423f9bc61804dbb4d6f8/P0.jpg",
  ]);

  const s = l.seller;
  assert.equal(s.platform, "depop");
  assert.equal(s.id, "52009648");
  assert.equal(s.username, "slugbug_v");
  assert.equal(s.profileUrl, "https://www.depop.com/slugbug_v/");
  assert.equal(s.rating, 5);
  assert.equal(s.reviewsCount, 49);
  assert.equal(s.itemsSold, 194);
  assert.equal(s.lastActiveAt, new Date(NOW).toISOString()); // "Active today"
  assert.notEqual(s.username, "stugbug_v"); // the URL slug's prefix is off by a character
});

test("nothing leaks in from the other product in the page's embedded Next.js data", () => {
  const json = JSON.stringify(parseDepopPage(collect(HTML), NOW));
  assert.ok(!/No Boundaries/i.test(json));
  assert.ok(!/ashkabash/i.test(json));
  assert.ok(!/test_buyer|buyer@example\.com/.test(json)); // the signed-in buyer
});

test("the username falls back to og:description, never the URL slug", () => {
  const page = collect(HTML);
  page.sections.seller = undefined;
  assert.equal(parseDepopPage(page, NOW)?.seller.username, "slugbug_v");
  // og tags left over from another item aren't trusted
  page.meta["og:url"] = "https://www.depop.com/products/someone-else-tee-1234/";
  assert.equal(parseDepopPage(page, NOW)?.seller.username, "");
});

test("a stale JSON-LD block from the previous item is ignored", () => {
  // Client-side navigation: the page now shows another item, JSON-LD still describes the old one.
  const page = collect(HTML, "https://www.depop.com/products/slugbug_v-pink-lace-cami-30ad/");
  const l = parseDepopPage(page, NOW);
  assert.ok(l);
  assert.equal(l.description, ""); // not the striped top's description
  assert.equal(l.price, 8); // from the price on screen
  assert.ok(l.photos.every((p) => p.includes("media-photos.depop.com")));
});

test("the saved listing scores as an established seller", () => {
  const l = parseDepopPage(collect(HTML), NOW)!;
  const r = runRules(l, { now: NOW }); // runs without throwing
  assert.ok(!r.signals.some((x) => x.id === "no-track-record"));
  assert.ok(!r.signals.some((x) => x.id === "poor-feedback"));
  assert.ok(!r.signals.some((x) => x.id === "inactive"));
});
