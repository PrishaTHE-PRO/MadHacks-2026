// Copies what adapters need out of the live DOM into a plain `PageData` object.
// This is the only place that touches the DOM for DOM-based adapters.

import type { PageData, PageImage, PageLink, PageSection } from "../adapters/page";

const MAX_LINKS = 400;
const MAX_IMAGES = 80;

function readLinks(root: ParentNode): PageLink[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].slice(0, MAX_LINKS).map((a) => ({
    href: a.href,
    text: a.innerText.replace(/\s+/g, " ").trim(),
    label: a.getAttribute("aria-label") ?? undefined,
  }));
}

const usable = (u: string | null | undefined): u is string => Boolean(u && /^https?:/i.test(u));

/** Largest candidate in a srcset ("a.jpg 140w, b.jpg 1600w"). */
function largestInSrcset(srcset: string | null): string | undefined {
  if (!srcset) return undefined;
  const parts = srcset.split(",").map((c) => {
    const [url, size = "0"] = c.trim().split(/\s+/);
    return { url, size: parseFloat(size) || 0 };
  });
  return parts.filter((p) => usable(p.url)).sort((a, b) => b.size - a.size)[0]?.url;
}

/**
 * The image's real URL. Carousels lazy-load: photos you haven't swiped to yet
 * often have an empty or placeholder `src` and the real URL in a data attribute
 * or srcset, so look there too.
 */
function imageUrl(img: HTMLImageElement): string | undefined {
  const candidates = [
    img.getAttribute("data-zoom-src"),
    img.currentSrc,
    img.src,
    img.getAttribute("data-src"),
    img.getAttribute("data-lazy-src"),
    largestInSrcset(img.getAttribute("srcset") ?? img.getAttribute("data-srcset")),
  ];
  return candidates.find(usable);
}

function readLabels(el: Element): string[] {
  return [el, ...el.querySelectorAll("[aria-label]")].flatMap((e) => {
    const label = e.getAttribute("aria-label")?.trim();
    return label ? [label] : [];
  });
}

function readImages(root: ParentNode): PageImage[] {
  return [...root.querySelectorAll<HTMLImageElement>("img")].slice(0, MAX_IMAGES).flatMap((img) => {
    const src = imageUrl(img);
    if (!src) return [];
    const r = img.getBoundingClientRect();
    return [
      {
        src,
        alt: img.alt ?? "",
        width: Math.round(r.width),
        height: Math.round(r.height),
        linkHref: img.closest("a")?.href,
      },
    ];
  });
}

function readJsonLd(doc: Document): unknown[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
    try {
      return [JSON.parse(s.textContent ?? "")];
    } catch {
      return [];
    }
  });
}

function readMeta(doc: Document): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const m of doc.querySelectorAll<HTMLMetaElement>("meta[content]")) {
    const key = m.getAttribute("property") ?? m.getAttribute("name") ?? m.getAttribute("itemprop");
    if (key && !(key in meta)) meta[key] = m.content;
  }
  return meta;
}

export interface CollectOptions {
  root?: Element | null; // the listing's container; defaults to <body>
  sections?: Record<string, string>; // name → CSS selector, searched inside the document
}

export function collectPageData(opts: CollectOptions = {}): PageData {
  const root = opts.root ?? document.body;
  const sections: Record<string, PageSection | undefined> = {};
  for (const [name, selector] of Object.entries(opts.sections ?? {})) {
    const el = document.querySelector<HTMLElement>(selector);
    sections[name] = el ? { text: el.innerText, links: readLinks(el), labels: readLabels(el) } : undefined;
  }
  // Images from a named "photos" section (e.g. eBay's carousel) beat the whole root,
  // which also has thumbnails of other listings.
  const photosEl = opts.sections?.photos ? document.querySelector(opts.sections.photos) : null;

  return {
    url: location.href,
    documentTitle: document.title,
    meta: readMeta(document),
    jsonLd: readJsonLd(document),
    text: (root as HTMLElement).innerText ?? "",
    headings: [...root.querySelectorAll<HTMLElement>("h1, h2")]
      .map((h) => h.innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean),
    links: readLinks(root),
    // If the adapter named a photos section but it isn't on the page, return no
    // images rather than every thumbnail on it.
    images: opts.sections?.photos ? (photosEl ? readImages(photosEl) : []) : readImages(root),
    sections,
  };
}
