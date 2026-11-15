// Loading, empty and error states inside the pop-up body.

import { PLATFORM_NAMES, PLATFORMS, type ListingStep } from "../../../shared/types";
import { Bubble } from "./Bubble";

const STEP_LABEL: Record<ListingStep | "read", string> = {
  read: "Reading the listing",
  seller: "Checking the seller's history",
  item: "Identifying the item with Claude",
  price: "Comparing prices",
  summary: "Writing the summary",
};

/**
 * Live progress from the server: `plan` is the steps this check runs, `step`
 * the one in progress (earlier ones are done). Reading the listing happens in
 * the extension first, so it's done once the server has answered at all.
 */
export function LoadingState({ plan, step }: { plan?: ListingStep[]; step?: ListingStep }) {
  const steps: (ListingStep | "read")[] = ["read", ...(plan ?? [])];
  const current = step ? steps.indexOf(step) : plan ? 1 : 0;
  return (
    <div className="dd-state" role="status" aria-live="polite">
      <Bubble size={56} />
      <h2>Checking this listing…</h2>
      <ol className="dd-steps" aria-label="Progress">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s} className={`dd-step ${state}`} aria-current={state === "active" ? "step" : undefined}>
              <span className="dd-step-icon" aria-hidden="true">
                {state === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path d="M2.5 6.2l2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span>
                {STEP_LABEL[s]}
                {state === "active" ? "…" : ""}
              </span>
              <span className="dd-sr">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
            </li>
          );
        })}
      </ol>
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
