// What DealDig adds to a marketplace page (the badge, chat chips) lives in
// CLOSED shadow roots, on hosts with no id, class or data attribute. The
// page's own scripts (and other extensions) can't read the score or warnings
// through `host.shadowRoot`, and can't find DealDig with one selector.
// We keep our references here instead of marking the DOM.

const roots = new WeakMap<Element, ShadowRoot>();
const hosts = new WeakSet<Element>();

/** A new, unmarked host element with a closed shadow root. */
export function makeHost(): HTMLDivElement {
  const host = document.createElement("div");
  roots.set(host, host.attachShadow({ mode: "closed" }));
  hosts.add(host);
  return host;
}

/** The closed shadow root of a host made by makeHost. */
export function rootOf(host: Element): ShadowRoot {
  const root = roots.get(host);
  if (!root) throw new Error("Not a DealDig host");
  return root;
}

/** Is this node one of our hosts, or inside one? (Our own mutations shouldn't trigger rescans.) */
export function isOurs(node: Node | null): boolean {
  for (let el = node instanceof Element ? node : (node?.parentElement ?? null); el; el = el.parentElement) {
    if (hosts.has(el)) return true;
  }
  return false;
}
