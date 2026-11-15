// Loading, empty and error states inside the pop-up body.

import { PLATFORM_NAMES, PLATFORMS } from "../../../shared/types";
import { Bubble } from "./Bubble";

export function LoadingState() {
  return (
    <div className="dd-state" role="status" aria-live="polite">
      <Bubble size={56} />
      <h2>Checking this listing…</h2>
      <p>Seller, price and photos. Usually 2–4 seconds.</p>
      <div className="dd-skeleton" aria-hidden="true">
        <span className="dd-sheen" />
        <span className="dd-sheen" />
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="dd-state">
      <Bubble size={56} />
      <h2>Open a listing or a chat</h2>
      <p>DealDig checks it for scam signs automatically.</p>
      <div className="dd-chips" style={{ justifyContent: "center", marginTop: 6 }}>
        {PLATFORMS.map((p) => (
          <span key={p} className="dd-chip">
            {PLATFORM_NAMES[p]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CantConnectState({ onRetry }: { onRetry(): void }) {
  return (
    <div className="dd-state" role="alert">
      <Bubble size={56} icon="dash" />
      <h2>Can't reach the DealDig server</h2>
      <p>Chat warnings still work. Listing checks need the server running in your project folder:</p>
      <code className="dd-code">npm run server</code>
      <button className="dd-btn primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** Any other failure, e.g. the page couldn't be read. */
export function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="dd-state" role="alert">
      <Bubble size={56} icon="dash" />
      <h2>Can't check this page</h2>
      <p>{message}</p>
      <button className="dd-btn primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
