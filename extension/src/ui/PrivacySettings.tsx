// Privacy settings group (design doc "Settings" table). Always available under
// the Listing tab, like history. Settings that need an optional permission
// (history, browsingData) ask Chrome for it when switched on, so the warning
// appears in context instead of at install.

import { useState } from "react";
import type { PrivacySettings } from "../privacy/settings";

interface Row {
  key: keyof PrivacySettings;
  name: string;
  about: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "On marketplace pages",
    rows: [
      { key: "shield", name: "Block trackers", about: "Stops ad and analytics companies from seeing which listings you open." },
      { key: "strict", name: "Strict mode", about: "Also blocks the marketplace's own analytics. Can break some pages." },
      { key: "cleanLinks", name: "Remove tracking tags and referrers", about: "Links you open don't tell the next site which listing you came from." },
    ],
  },
  {
    title: "In your browser",
    rows: [
      { key: "scrubHistory", name: "Don't keep listings in browser history", about: "Deletes listing pages from Chrome history and sync. Chrome will ask for permission." },
      { key: "clearTrackerCookies", name: "Clear tracker cookies when I'm done", about: "When the last marketplace tab closes. You stay signed in to the marketplace. Chrome will ask for permission." },
    ],
  },
  {
    title: "Second Look itself",
    rows: [
      { key: "webPhotos", name: "Check photos with outside services", about: "Sends listing photos to Google and Sightengine to find copies on the web and AI fakes." },
      { key: "noHistory", name: "Don't keep Second Look history", about: "Checks aren't saved on this device. Earlier visits won't be shown." },
    ],
  },
];

export interface PrivacySettingsProps {
  settings: PrivacySettings;
  /** Resolves false when Chrome's permission was refused (the switch stays off). */
  onChange(key: keyof PrivacySettings, on: boolean): Promise<boolean>;
  onWipe(): Promise<void>;
}

export function PrivacySettingsCard({ settings, onChange, onWipe }: PrivacySettingsProps) {
  const [refused, setRefused] = useState<keyof PrivacySettings | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiped, setWiped] = useState(false);
  return (
    <details className="dd-card dd-settings">
      <summary>
        <h3>Privacy settings</h3>
        <svg className="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </summary>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="dd-settings-group">{g.title}</p>
          {g.rows.map((r) => {
            const disabled = r.key === "strict" && !settings.shield;
            return (
              <label key={r.key} className={`dd-setting${disabled ? " disabled" : ""}`} style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings[r.key]) && !disabled}
                  disabled={disabled}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setRefused(null);
                    void onChange(r.key, on).then((ok) => !ok && setRefused(r.key));
                  }}
                />
                <span className="dd-setting-text">
                  <span className="dd-setting-name">{r.name}</span>
                  <span className="dd-fine">{refused === r.key ? "Chrome didn't give permission, so this stays off." : r.about}</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
      <div>
        <p className="dd-settings-group">Wipe</p>
        {wiped ? (
          <p className="dd-fine" style={{ marginTop: 8 }}>Done. Second Look's history, reports list and saved results are gone from this device.</p>
        ) : confirmWipe ? (
          <div className="dd-btn-row" style={{ marginTop: 8 }}>
            <button
              className="dd-btn secondary dd-danger-btn"
              onClick={() => void onWipe().then(() => (setWiped(true), setConfirmWipe(false)))}
            >
              Yes, wipe everything
            </button>
            <button className="dd-btn secondary" onClick={() => setConfirmWipe(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <p className="dd-fine" style={{ marginTop: 8 }}>
              Deletes your Second Look history, the sellers you reported, your anonymous reporter ID and saved results. Reports already sent stay sent.
            </p>
            <button className="dd-link dd-small dd-danger-btn" style={{ marginTop: 6 }} onClick={() => setConfirmWipe(true)}>
              Wipe everything
            </button>
          </>
        )}
      </div>
    </details>
  );
}
