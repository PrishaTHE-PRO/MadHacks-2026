// Meetup helper (spec §4.1): suggest 3 safe public places between the user
// and the item, with map links and daylight times to meet.

import { useEffect, useState } from "react";
import { SERVER_URL } from "../config";
import type { Listing, MeetupSpotsResponse, RiskReport, SpotKind } from "../../../shared/types";

const AREA_KEY = "meetup:area";

const KIND_LABEL: Record<SpotKind, string> = {
  police: "Police station",
  library: "Library",
  grocery: "Grocery store",
  community: "Community center",
  bank: "Bank lobby",
  cafe: "Café",
};

const SLOT_HOURS = [10, 12, 14, 16, 18];

/** Daylight slots like "Today 2:00 PM": at least 1 h from now, 1 h after sunrise and 1 h before sunset. */
export function timeOptions(daylight: MeetupSpotsResponse["daylight"], now = new Date()): string[] {
  const out: string[] = [];
  daylight.forEach((d, i) => {
    const sunrise = new Date(d.sunrise).getTime();
    const sunset = new Date(d.sunset).getTime();
    for (const h of SLOT_HOURS) {
      const slot = new Date(now);
      slot.setDate(now.getDate() + i);
      slot.setHours(h, 0, 0, 0);
      const t = slot.getTime();
      if (t < now.getTime() + 3600_000 || t < sunrise + 3600_000 || t > sunset - 3600_000) continue;
      const time = slot.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      out.push(`${i === 0 ? "Today" : "Tomorrow"} ${time}`);
    }
  });
  return out.slice(0, 4);
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const errorText = (err: unknown) =>
  err instanceof TypeError ? "Can't reach the DealDig server. Is it running?" : err instanceof Error ? err.message : String(err);

export function MeetupHelper({ listing, report }: { listing: Listing; report: RiskReport }) {
  const [area, setArea] = useState("");
  const [found, setFound] = useState<MeetupSpotsResponse | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState("");

  // Remember what the user typed (on this device only) so they don't retype it per listing.
  useEffect(() => {
    void chrome.storage.local.get(AREA_KEY).then((r) => setArea((r[AREA_KEY] as string) ?? ""));
  }, []);

  // A new listing starts over.
  useEffect(() => {
    setFound(null);
    setError("");
  }, [listing.platform, listing.id]);

  const find = async () => {
    setFinding(true);
    setError("");
    void chrome.storage.local.set({ [AREA_KEY]: area.trim() });
    try {
      const res = await fetch(`${SERVER_URL}/meetup/spots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: area.trim(),
          listingLocation: listing.location,
          price: listing.price,
          riskLevel: report.level,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
      setFound(data as MeetupSpotsResponse);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFinding(false);
    }
  };

  const times = found ? timeOptions(found.daylight) : [];
  const sunsetToday = found?.daylight[0]?.sunset;

  return (
    <section className="card meetup">
      <h2>Meet safely</h2>

      <label className="field">
        <span>Where are you coming from?</span>
        <div className="row">
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && area.trim() && !finding && void find()}
            placeholder="Neighborhood, zip or cross streets"
          />
          <button disabled={finding || (!area.trim() && !listing.location)} onClick={find}>
            {finding ? "Finding…" : found ? "Update" : "Find spots"}
          </button>
        </div>
      </label>
      <p className="muted small">
        {listing.location ? `Item is in ${listing.location}. ` : ""}
        We search halfway between. Only what you type is used, never your GPS.
      </p>
      {error && <p className="error">{error}</p>}

      {found && (
        <>
          {found.notes.map((n) => (
            <p key={n} className={`note ${report.level === "high" ? "high" : ""}`}>
              {n}
            </p>
          ))}

          <ul className="spots">
            {found.spots.map((s) => (
              <li key={s.id}>
                <div className="spot">
                  <div className="grow">
                    <div className="title">{s.name}</div>
                    <div className="muted small">
                      {KIND_LABEL[s.kind]} · {s.distanceKm} km{s.address ? ` · ${s.address}` : ""}
                    </div>
                    <div className="small">{s.why}</div>
                    {s.openingHours && <div className="muted small">Hours: {s.openingHours}</div>}
                  </div>
                  <a href={s.mapUrl} target="_blank" rel="noreferrer" className="small">
                    Map
                  </a>
                </div>
              </li>
            ))}
          </ul>

          <div className="field">
            <span>Good times to meet</span>
            {times.length > 0 ? (
              <div className="chips">
                {times.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">It's getting dark. Meet tomorrow in daylight.</p>
            )}
            {sunsetToday && <p className="muted small">Sunset today is {clock(sunsetToday)}. Meet in daylight and bring a friend.</p>}
          </div>
        </>
      )}
    </section>
  );
}
