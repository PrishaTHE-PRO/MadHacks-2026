// Safe meeting spots (implementation spec §4.2).
//
// 1. Geocode the area the user typed and the listing's location with
//    OpenStreetMap Nominatim. We never use the user's GPS: ask, don't track.
// 2. Meet halfway when both are known and close enough to drive.
// 3. Find public places around that point with the Overpass API: police
//    stations, libraries, grocery stores, bank lobbies, community centers.
// 4. Rank them in code (kind first, then distance) and return 3 of different
//    kinds. High-value or high-risk deals put a police station first.
// A small curated list for the demo city (Madison, WI) covers venue Wi-Fi or
// Overpass being down.

import type { MeetupSpot, MeetupSpotsInput, MeetupSpotsResponse, SpotKind } from "../../shared/types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// The public Overpass servers are often busy (502/504), so try a few mirrors.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Nominatim and Overpass ask clients to identify themselves. Keep it generic.
const USER_AGENT = "DealDig/0.1 (hackathon prototype)";

/** At or above this price, suggest a police station first. */
export const HIGH_VALUE_PRICE = 250;
/** Beyond this, halfway is too far to be practical; search near the user instead. */
const MAX_MIDPOINT_KM = 60;
const RADII_M = [3000, 10000];
const SPOT_COUNT = 3;

// ---------------------------------------------------------------------------
// Ranking (pure, tested)
// ---------------------------------------------------------------------------

const KIND_SCORE: Record<SpotKind, number> = {
  police: 100,
  library: 85,
  grocery: 75,
  community: 65,
  bank: 60,
  cafe: 55,
};
const PENALTY_PER_KM = 10;

export const KIND_WHY: Record<SpotKind, string> = {
  police: "Police station lobby: cameras and officers on site. Ask if they have a marked exchange spot.",
  library: "Public library: staffed, busy and covered by cameras at the entrance.",
  grocery: "Busy grocery store: meet just inside the entrance, where staff and cameras are.",
  community: "Community center: public and staffed during open hours.",
  bank: "Bank lobby: cameras everywhere, and you can take out cash on the spot. Open hours only.",
  cafe: "Busy café: public, and you can sit down and check the item before paying.",
};

export type SpotCandidate = Omit<MeetupSpot, "why" | "mapUrl" | "distanceKm">;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Midpoint on the sphere. Fine for the short distances we use it for. */
export function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const [φ1, λ1, φ2, λ2] = [a.lat * rad, a.lng * rad, b.lat * rad, b.lng * rad];
  const bx = Math.cos(φ2) * Math.cos(λ2 - λ1);
  const by = Math.cos(φ2) * Math.sin(λ2 - λ1);
  const φ = Math.atan2(Math.sin(φ1) + Math.sin(φ2), Math.sqrt((Math.cos(φ1) + bx) ** 2 + by ** 2));
  const λ = λ1 + Math.atan2(by, Math.cos(φ1) + bx);
  return { lat: φ / rad, lng: λ / rad };
}

export function mapUrl(s: { name: string; address?: string; lat: number; lng: number }): string {
  // With an address, search by name + address so the pin lands on the right building.
  const query = s.address ? `${s.name}, ${s.address}` : `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pick the best `count` spots around `center`: different kinds first, then the
 * best remaining. With `policeFirst`, the nearest police station leads.
 */
export function rankSpots(
  candidates: SpotCandidate[],
  center: { lat: number; lng: number },
  opts: { policeFirst: boolean; count?: number },
): MeetupSpot[] {
  const count = opts.count ?? SPOT_COUNT;
  const scored = candidates
    .map((c) => {
      const distanceKm = haversineKm(center, c);
      return { c, distanceKm, score: KIND_SCORE[c.kind] - PENALTY_PER_KM * distanceKm };
    })
    .sort((a, b) => b.score - a.score);

  // Drop duplicates: same name within 300 m (OSM often has a node and a building).
  const unique: typeof scored = [];
  for (const s of scored) {
    const dupe = unique.some((u) => normName(u.c.name) === normName(s.c.name) && haversineKm(u.c, s.c) < 0.3);
    if (!dupe) unique.push(s);
  }

  const picked: typeof scored = [];
  if (opts.policeFirst) {
    const police = unique
      .filter((s) => s.c.kind === "police")
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (police) picked.push(police);
  }
  for (const s of unique) {
    if (picked.length >= count) break;
    if (!picked.includes(s) && !picked.some((p) => p.c.kind === s.c.kind)) picked.push(s);
  }
  for (const s of unique) {
    if (picked.length >= count) break;
    if (!picked.includes(s)) picked.push(s);
  }

  return picked.map(({ c, distanceKm }) => ({
    ...c,
    distanceKm: Math.round(distanceKm * 10) / 10,
    why: KIND_WHY[c.kind],
    mapUrl: mapUrl(c),
  }));
}

// ---------------------------------------------------------------------------
// Daylight (pure, tested): the sunrise equation, accurate to a few minutes.
// ---------------------------------------------------------------------------

export function sunTimes(day: Date, lat: number, lng: number): { sunrise: Date; sunset: Date } | null {
  const rad = Math.PI / 180;
  const noonUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12);
  const jd = noonUtc / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1 || cosW > 1) return null; // midnight sun or polar night
  const w = Math.acos(cosW) / rad;
  const toDate = (j: number) => new Date((j - 2440587.5) * 86400000);
  return { sunrise: toDate(jTransit - w / 360), sunset: toDate(jTransit + w / 360) };
}

/** Today and tomorrow at the place, using its solar date (so late-evening UTC doesn't skip a day). */
export function daylightFor(lat: number, lng: number, now = new Date()) {
  const localSolar = new Date(now.getTime() + (lng / 15) * 3600_000);
  const out: { sunrise: string; sunset: string }[] = [];
  for (const offset of [0, 1]) {
    const day = new Date(localSolar.getTime() + offset * 86400_000);
    const t = sunTimes(day, lat, lng);
    if (t) out.push({ sunrise: t.sunrise.toISOString(), sunset: t.sunset.toISOString() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Curated demo spots (Madison, WI). Coordinates are approximate and only used
// for distance; map links search by name + address.
// ---------------------------------------------------------------------------

const MADISON = { lat: 43.0747, lng: -89.3841 };
const CURATED_RADIUS_KM = 25;

const CURATED: SpotCandidate[] = [
  {
    id: "curated:mpd-central",
    name: "Madison Police Department, Central District",
    kind: "police",
    address: "211 S Carroll St, Madison, WI",
    lat: 43.0727,
    lng: -89.3858,
    source: "curated",
  },
  {
    id: "curated:uwpd",
    name: "UW–Madison Police Department",
    kind: "police",
    address: "1429 Monroe St, Madison, WI",
    lat: 43.0681,
    lng: -89.4108,
    source: "curated",
  },
  {
    id: "curated:mpl-central",
    name: "Madison Public Library, Central Library",
    kind: "library",
    address: "201 W Mifflin St, Madison, WI",
    lat: 43.076,
    lng: -89.3875,
    source: "curated",
  },
  {
    id: "curated:memorial-library",
    name: "Memorial Library (UW–Madison)",
    kind: "library",
    address: "728 State St, Madison, WI",
    lat: 43.0753,
    lng: -89.3981,
    source: "curated",
  },
  {
    id: "curated:union-south",
    name: "Union South",
    kind: "community",
    address: "1308 W Dayton St, Madison, WI",
    lat: 43.0718,
    lng: -89.4078,
    source: "curated",
  },
];

const nearMadison = (p: { lat: number; lng: number }) => haversineKm(p, MADISON) <= CURATED_RADIUS_KM;

// ---------------------------------------------------------------------------
// OpenStreetMap lookups
// ---------------------------------------------------------------------------

interface Place {
  lat: number;
  lng: number;
  label: string;
}

const geocodeCache = new Map<string, Place | null>();
let lastNominatim = 0;

/** Nominatim allows 1 request per second; space ours out. Never throws. */
export async function geocode(text: string): Promise<Place | null> {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();

  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const place = hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: shortLabel(hit.display_name) } : null;
    geocodeCache.set(key, place);
    return place;
  } catch (err) {
    console.warn("[meetup] geocode failed:", err instanceof Error ? err.message : err);
    return null; // don't cache failures: the network may come back
  }
}

/** "Madison, Dane County, Wisconsin, United States" → "Madison, Dane County, Wisconsin" */
const shortLabel = (displayName: string) => displayName.split(", ").slice(0, 3).join(", ");

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const QUERIES: { kind: SpotKind; filter: string }[] = [
  { kind: "police", filter: '["amenity"="police"]' },
  { kind: "library", filter: '["amenity"="library"]' },
  { kind: "grocery", filter: '["shop"="supermarket"]["name"]' },
  { kind: "community", filter: '["amenity"="community_centre"]["name"]' },
  { kind: "bank", filter: '["amenity"="bank"]["name"]' },
  { kind: "cafe", filter: '["amenity"="cafe"]["name"]' },
];

export function kindOf(tags: Record<string, string>): SpotKind | null {
  if (tags.amenity === "police") return "police";
  if (tags.amenity === "library") return "library";
  if (tags.shop === "supermarket") return "grocery";
  if (tags.amenity === "community_centre") return "community";
  if (tags.amenity === "bank") return "bank";
  if (tags.amenity === "cafe") return "cafe";
  return null;
}

const DEFAULT_NAME: Record<SpotKind, string> = {
  police: "Police station",
  library: "Public library",
  grocery: "Grocery store",
  community: "Community center",
  bank: "Bank",
  cafe: "Café",
};

/** Turn Overpass elements into candidates. Pure, tested. */
export function candidatesFromOverpass(elements: OverpassElement[]): SpotCandidate[] {
  const out: SpotCandidate[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = kindOf(tags);
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!kind || lat === undefined || lng === undefined) continue;
    if (tags.access === "private" || tags.access === "no") continue;
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const address = [street, tags["addr:city"]].filter(Boolean).join(", ") || undefined;
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: tags.name || DEFAULT_NAME[kind],
      kind,
      address,
      lat,
      lng,
      openingHours: tags.opening_hours,
      source: "osm",
    });
  }
  return out;
}

const overpassCache = new Map<string, { at: number; spots: SpotCandidate[] }>();
const OVERPASS_CACHE_MS = 60 * 60 * 1000;
/** After every mirror fails, skip Overpass for a while so the panel stays fast. */
const OVERPASS_COOLDOWN_MS = 2 * 60 * 1000;
let overpassDownUntil = 0;

async function overpassSpots(center: { lat: number; lng: number }, radiusM: number): Promise<SpotCandidate[]> {
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)},${radiusM}`;
  const hit = overpassCache.get(key);
  if (hit && Date.now() - hit.at < OVERPASS_CACHE_MS) return hit.spots;

  if (Date.now() < overpassDownUntil) throw new Error("skipped: Overpass failed recently");

  const around = `(around:${radiusM},${center.lat},${center.lng})`;
  // One output per kind, so cafés can't crowd out the police station.
  const query =
    "[out:json][timeout:15];\n" + QUERIES.map((q) => `nwr${around}${q.filter};out center tags 15;`).join("\n");
  let data: { elements?: OverpassElement[] } | null = null;
  const errors: string[] = [];
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      data = (await res.json()) as { elements?: OverpassElement[] };
      break;
    } catch (err) {
      errors.push(`${new URL(url).host}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!data) {
    overpassDownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
    throw new Error(`all Overpass servers failed (${errors.join("; ")})`);
  }
  const spots = candidatesFromOverpass(data.elements ?? []);
  overpassCache.set(key, { at: Date.now(), spots });
  return spots;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export class MeetupError extends Error {}

export async function findSpots(input: MeetupSpotsInput): Promise<MeetupSpotsResponse> {
  const notes: string[] = [];
  const [mine, theirs] = await Promise.all([geocode(input.area), geocode(input.listingLocation ?? "")]);

  let center: Place | null = null;
  if (mine && theirs) {
    const km = haversineKm(mine, theirs);
    if (km < 2) {
      center = { ...midpoint(mine, theirs), label: `near ${mine.label}` };
    } else if (km <= MAX_MIDPOINT_KM) {
      center = { ...midpoint(mine, theirs), label: `halfway between ${mine.label} and ${theirs.label}` };
    } else {
      center = mine;
      notes.push(`The item is about ${Math.round(km)} km from you, so these spots are near you. Agree on a place with the seller.`);
    }
  } else {
    center = mine ?? theirs;
  }

  // Offline fallback for the demo city.
  const text = `${input.area} ${input.listingLocation ?? ""}`.toLowerCase();
  if (!center && text.includes("madison")) center = { ...MADISON, label: "Madison, WI" };
  if (!center) throw new MeetupError("Couldn't find that area. Try a zip code or \"City, State\".");

  let candidates: SpotCandidate[] = [];
  for (const radius of RADII_M) {
    try {
      candidates = await overpassSpots(center, radius);
    } catch (err) {
      console.warn("[meetup] Overpass failed:", err instanceof Error ? err.message : err);
      break;
    }
    if (new Set(candidates.map((c) => c.kind)).size >= SPOT_COUNT) break;
  }
  if (nearMadison(center)) candidates = [...candidates, ...CURATED];

  const highRisk = input.riskLevel === "high";
  const highValue = (input.price ?? 0) >= HIGH_VALUE_PRICE;
  const spots = rankSpots(candidates, center, { policeFirst: highRisk || highValue });
  if (!spots.length) throw new MeetupError("Couldn't find public places near there right now. Try a nearby town or zip code.");

  if (highRisk) {
    notes.unshift("This listing scored high risk. Think about walking away. If you go, meet at a police station and don't pay before you see the item.");
  } else if (highValue && spots[0]?.kind === "police") {
    notes.unshift(`Over $${HIGH_VALUE_PRICE}: a police station lobby is the safest place to hand over cash.`);
  }

  return { spots, center, daylight: daylightFor(center.lat, center.lng), notes };
}
