import { mountInShadow } from "../ui/shadow";
import { App } from "./App";

// The sidebar fills the side panel window.
const SIDEBAR_CSS = `
  .dd-root { height: 100vh; }
  .dd-backdrop { height: 100%; }
`;

mountInShadow(document.getElementById("root")!, SIDEBAR_CSS).render(
  <div className="dd-backdrop">
    <div className="dd-fill">
      <App />
    </div>
  </div>,
);
