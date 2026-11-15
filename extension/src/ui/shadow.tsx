// Mount React UI inside a shadow root with the DealDig styles, so the host
// page's CSS can't reach in (and ours can't leak out).

import { createRoot, type Root } from "react-dom/client";
import tokens from "./tokens.css";
import motion from "./motion.css";
import panel from "./panel.css";
import backdrop from "./backdrop.css";
import legacy from "./legacy.css";
import photo from "./photo.css";

export const UI_CSS = [tokens, motion, panel, backdrop, legacy, photo].join("\n");

/** Attach a shadow root to `host`, add the styles (plus any extra CSS), and return a React root inside it. */
export function mountInShadow(host: HTMLElement, extraCss = ""): Root {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = UI_CSS + extraCss;
  const container = document.createElement("div");
  container.className = "dd-root";
  shadow.replaceChildren(style, container);
  return createRoot(container);
}
