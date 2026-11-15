// Private browsing settings, in chrome.storage.local under `privacy:settings`.
// Read by the background (to apply rules), the side panel (the Privacy card)
// and the content script (outbound link cleaning). Settings never leave the device.

export interface PrivacySettings {
  /** Block third-party trackers on marketplace pages (Phase 2). */
  shield: boolean;
  /** Also block first-party analytics endpoints (Phase 2, off by default). */
  strict: boolean;
  /** Registrable domains where the shield is paused. */
  pausedSites: string[];
  /** Strip tracking tags and referrers from links (Phase 3). */
  cleanLinks: boolean;
  /** Delete listing pages from Chrome history (Phase 3, needs the optional `history` permission). */
  scrubHistory: boolean;
  /** Send listing photos to Google to find copies on the web (Phase 1, opt-in). */
  webPhotos: boolean;
  /** Don't keep Second Look's own check history (Phase 1). */
  noHistory: boolean;
  /** Clear tracker cookies when the last marketplace tab closes (Phase 3, needs `browsingData`). */
  clearTrackerCookies: boolean;
}

export const DEFAULT_SETTINGS: PrivacySettings = {
  shield: true,
  strict: false,
  pausedSites: [],
  cleanLinks: true,
  scrubHistory: false,
  webPhotos: false,
  noHistory: false,
  clearTrackerCookies: false,
};

export const SETTINGS_KEY = "privacy:settings";

/** Settings that need an optional permission before they can be turned on. */
export const SETTING_PERMISSION: Partial<Record<keyof PrivacySettings, "history" | "browsingData">> = {
  scrubHistory: "history",
  clearTrackerCookies: "browsingData",
};

export const withDefaults = (stored: Partial<PrivacySettings> | undefined): PrivacySettings => ({ ...DEFAULT_SETTINGS, ...stored });

export async function loadSettings(): Promise<PrivacySettings> {
  try {
    return withDefaults((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<PrivacySettings> | undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
