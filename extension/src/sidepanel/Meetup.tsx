// Meetup helper (spec §4.2, §4.3): suggest 3 safe public places between the
// user and the item, pick a daylight time, and draft a reply the user can
// copy into the chat. DealDig never sends messages on its own.

import { useEffect, useState } from "react";
import { SERVER_URL } from "../config";
import type {
  DealRole,
  DraftReplyInput,
  DraftReplyResponse,
  Listing,
  MeetupSpotsResponse,
  ReplyTone,
  RiskReport,
  SpotKind,
} from "../../../shared/types";

const AREA_KEY = "meetup:area";

const KIND_LABEL: Record<SpotKind, string> = {
  police: "Police station",
  library: "Library",
  grocery: "Grocery store",
  community: "Community center",
  bank: "Bank lobby",
  cafe: "Café",
};

interface TimeOption {
  label: string; // "Today 2:00 PM"
  text: string; // "Saturday at 2:00 PM", what goes into the reply
}

const SLOT_HOURS = [10, 12, 14, 16, 18];

/** Daylight slots: at least 1 h from now, 1 h after sunrise and 1 h before sunset. */
export function timeOptions(daylight: MeetupSpotsResponse["daylight"], now = new Date()): TimeOption[] {
  const out: TimeOption[] = [];
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
      const weekday = slot.toLocaleDateString(undefined, { weekday: "long" });
      out.push({ label: `${i === 0 ? "Today" : "Tomorrow"} ${time}`, text: `${weekday} at ${time}` });
    }
  });
  return out.slice(0, 4);
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
  return data as T;
}

const errorText = (err: unknown) =>
  err instanceof TypeError ? "Can't reach the DealDig server. Is it running?" : err instanceof Error ? err.message : String(err);

export function MeetupHelper({ listing, report }: { listing: Listing; report: RiskReport }) {
  const [area, setArea] = useState("");
  const [found, setFound] = useState<MeetupSpotsResponse | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState("");

  const [spotId, setSpotId] = useState("");
  const [time, setTime] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [role, setRole] = useState<DealRole>("buyer");
  const [tone, setTone] = useState<ReplyTone>("friendly");
  const [theirMessage, setTheirMessage] = useState("");

  const [reply, setReply] = useState("");
  const [replyAi, setReplyAi] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [status, setStatus] = useState("");

  // Remember what the user typed (on this device only) so they don't retype it per listing.
  useEffect(() => {
    void chrome.storage.local.get(AREA_KEY).then((r) => setArea((r[AREA_KEY] as string) ?? ""));
  }, []);

  // A new listing starts over.
  useEffect(() => {
    setFound(null);
    setReply("");
    setError("");
    setStatus("");
  }, [listing.platform, listing.id]);

  const find = async () => {
    setFinding(true);
    setError("");
    setReply("");
    void chrome.storage.local.set({ [AREA_KEY]: area.trim() });
    try {
      const res = await post<MeetupSpotsResponse>("/meetup/spots", {
        area: area.trim(),
        listingLocation: listing.location,
        price: listing.price,
        riskLevel: report.level,
      });
      setFound(res);
      setSpotId(res.spots[0]?.id ?? "");
      const first = timeOptions(res.daylight)[0];
      setTime(first?.text ?? "");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFinding(false);
    }
  };

  const spot = found?.spots.find((s) => s.id === spotId);
  const chosenTime = time === "custom" ? customTime.trim() : time;

  const draft = async () => {
    if (!spot || !chosenTime) return;
    setDrafting(true);
    setStatus("");
    try {
      const body: DraftReplyInput = {
        listing: { title: listing.title, price: listing.price, platform: listing.platform },
        role,
        tone,
        spot: { name: spot.name, address: spot.address },
        time: chosenTime,
        theirMessage: theirMessage.trim() || undefined,
        riskReasons: report.topReasons,
      };
      const res = await post<DraftReplyResponse>("/meetup/reply", body);
      setReply(res.reply);
      setReplyAi(res.aiUsed);
    } catch (err) {
      setStatus(errorText(err));
    } finally {
      setDrafting(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(reply);
    setStatus("Copied. Paste it into the chat and press Send yourself.");
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
              <li key={s.id} className={s.id === spotId ? "selected" : ""}>
                <label>
                  <input type="radio" name="spot" checked={s.id === spotId} onChange={() => setSpotId(s.id)} />
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
                </label>
              </li>
            ))}
          </ul>

          <div className="field">
            <span>When</span>
            <div className="chips">
              {times.map((t) => (
                <button key={t.text} className={`chip ${time === t.text ? "on" : ""}`} onClick={() => setTime(t.text)}>
                  {t.label}
                </button>
              ))}
              <button className={`chip ${time === "custom" ? "on" : ""}`} onClick={() => setTime("custom")}>
                Other…
              </button>
            </div>
            {time === "custom" && (
              <input value={customTime} onChange={(e) => setCustomTime(e.target.value)} placeholder="e.g. Sunday at 1:00 PM" />
            )}
            {sunsetToday && <p className="muted small">Sunset today is {clock(sunsetToday)}. Meet in daylight and bring a friend.</p>}
          </div>

          <div className="field">
            <span>Draft a reply</span>
            <div className="chips">
              <button className={`chip ${role === "buyer" ? "on" : ""}`} onClick={() => setRole("buyer")}>
                I'm buying
              </button>
              <button className={`chip ${role === "seller" ? "on" : ""}`} onClick={() => setRole("seller")}>
                I'm selling
              </button>
              <span className="sep" />
              <button className={`chip ${tone === "friendly" ? "on" : ""}`} onClick={() => setTone("friendly")}>
                Friendly
              </button>
              <button className={`chip ${tone === "firm" ? "on" : ""}`} onClick={() => setTone("firm")}>
                Firm
              </button>
            </div>
            <textarea
              value={theirMessage}
              onChange={(e) => setTheirMessage(e.target.value)}
              placeholder="Optional: paste their last message, so the reply can answer it"
              rows={2}
            />
            <button disabled={!spot || !chosenTime || drafting} onClick={draft}>
              {drafting ? "Drafting…" : reply ? "Redraft" : "Draft reply"}
            </button>
          </div>

          {reply && (
            <div className="field">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} />
              <div className="row">
                <button onClick={copy}>Copy</button>
              </div>
              <p className="muted small">
                {replyAi ? "Drafted by Claude." : "Template reply (no AI key on the server)."} DealDig never sends
                messages for you.
              </p>
            </div>
          )}
          {status && <p className="muted small">{status}</p>}
        </>
      )}
    </section>
  );
}
