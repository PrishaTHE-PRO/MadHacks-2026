// The sidebar on sell pages (the user creating their own listing). Same shell
// as Panel, without the Listing · Chat · Report tabs: just the photo check.

import type { ReactNode } from "react";
import { Bubble } from "./Bubble";

export function SellerPanel({ site, onClose, children }: { site?: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="dd-pop" role="region" aria-label="Second Look">
      <header className="dd-head">
        <Bubble size={36} />
        <div className="dd-head-text">
          <div className="dd-name">Second Look</div>
          <div className="dd-site">{site ? `Listing on ${site}: check your photos first` : "Check your photos first"}</div>
        </div>
        <button className="dd-close" aria-label="Close Second Look" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="dd-body">
        {/* PhotoPrivacy uses the old class names; legacy.css + photo.css style them. */}
        <div className="dd-legacy">{children}</div>
      </div>
    </div>
  );
}
