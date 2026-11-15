// "Your history": everything this device has checked, with Forget seller and
// Clear all (spec §7.1). Main's history card, in the sidebar's style.

import { useEffect, useState } from "react";
import { PLATFORM_NAMES } from "../../../shared/types";
import { clearHistory, forgetSeller, HISTORY_DAYS, loadHistory, type HistoryEntry } from "../history";
import { ago } from "./listingFacts";

const PILL = { low: "Low", medium: "Careful", high: "High" } as const;

/** Live view of this device's history (it changes when the background saves a check). */
export function useHistory(): HistoryEntry[] {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void loadHistory().then(setHistory);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && "history" in changes) void loadHistory().then(setHistory);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return history;
}

export function HistoryCard({ history }: { history: HistoryEntry[] }) {
  const [confirmClear, setConfirmClear] = useState(false);
  if (!history.length) return null;
  return (
    <details className="dd-card dd-history">
      <summary>
        <h3>Your history ({history.length})</h3>
        <svg className="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </summary>
      <p className="dd-fine">On this device only, for {HISTORY_DAYS} days. Clearing keeps reports you sent.</p>
      <ul>
        {history.slice(0, 30).map((h) => (
          <li key={`${h.platform}:${h.listingId}`}>
            <span className={`dd-level-pill ${h.level}`}>{PILL[h.level]}</span>
            <div className="dd-history-text">
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              <div className="dd-fine">
                {h.score}/100 · {PLATFORM_NAMES[h.platform]} · {h.sellerName || "unknown seller"} · {ago(h.lastSeenAt)}
              </div>
            </div>
            <button className="dd-link dd-small" onClick={() => void forgetSeller(h.platform, h.sellerId, h.listingId)}>
              Forget seller
            </button>
          </li>
        ))}
      </ul>
      {confirmClear ? (
        <div className="dd-btn-row">
          <button
            className="dd-btn secondary"
            onClick={() => {
              void clearHistory();
              setConfirmClear(false);
            }}
          >
            Yes, clear all
          </button>
          <button className="dd-btn secondary" onClick={() => setConfirmClear(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <button className="dd-btn secondary" onClick={() => setConfirmClear(true)}>
          Clear all history
        </button>
      )}
    </details>
  );
}
