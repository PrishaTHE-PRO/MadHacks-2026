// Meetup helper tests (spec §4.1): spot ranking, daylight and OSM parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFromOverpass, haversineKm, mapUrl, midpoint, rankSpots, sunTimes, type SpotCandidate } from "../src/meetup";

const CENTER = { lat: 43.0747, lng: -89.3841 }; // downtown Madison

const spot = (id: string, kind: SpotCandidate["kind"], kmEast: number, name = id): SpotCandidate => ({
  id,
  name,
  kind,
  lat: CENTER.lat,
  lng: CENTER.lng + kmEast / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180)),
  source: "osm",
});

test("rankSpots: three different kinds, best first", () => {
  const picked = rankSpots(
    [spot("cafe", "cafe", 0.1), spot("lib", "library", 0.5), spot("lib2", "library", 0.6), spot("grocery", "grocery", 0.4), spot("bank", "bank", 0.2)],
    CENTER,
    { policeFirst: false },
  );
  assert.deepEqual(picked.map((s) => s.id), ["lib", "grocery", "bank"]);
  assert.ok(picked.every((s) => s.mapUrl.startsWith("https://www.google.com/maps/search/")));
});

test("rankSpots: a far police station loses to a near library, unless policeFirst", () => {
  const all = [spot("police", "police", 4), spot("lib", "library", 0.3), spot("grocery", "grocery", 0.3), spot("cafe", "cafe", 0.2)];
  assert.notEqual(rankSpots(all, CENTER, { policeFirst: false })[0].id, "police");
  assert.equal(rankSpots(all, CENTER, { policeFirst: true })[0].id, "police");
});

test("rankSpots: fills with repeats when there are fewer than three kinds, and drops duplicates", () => {
  const picked = rankSpots(
    [spot("a", "library", 0.2, "Central Library"), spot("a2", "library", 0.25, "Central Library"), spot("b", "library", 1, "East Library")],
    CENTER,
    { policeFirst: true },
  );
  assert.deepEqual(picked.map((s) => s.id), ["a", "b"]);
});

test("midpoint and distance", () => {
  const a = { lat: 43.0747, lng: -89.3841 };
  const b = { lat: 43.0389, lng: -87.9065 }; // Milwaukee
  const m = midpoint(a, b);
  assert.ok(Math.abs(haversineKm(a, m) - haversineKm(b, m)) < 0.5);
  assert.ok(Math.abs(haversineKm(a, b) - 120) < 5);
});

test("sunTimes: Madison on Nov 14 is about 6:45 AM to 4:35 PM CST", () => {
  const t = sunTimes(new Date("2026-11-14T12:00:00Z"), 43.0747, -89.3841)!;
  const sunsetCst = new Date(t.sunset.getTime() - 6 * 3600_000).toISOString().slice(11, 16);
  const sunriseCst = new Date(t.sunrise.getTime() - 6 * 3600_000).toISOString().slice(11, 16);
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  assert.ok(Math.abs(minutes(sunsetCst) - minutes("16:35")) <= 10, `sunset ${sunsetCst}`);
  assert.ok(Math.abs(minutes(sunriseCst) - minutes("06:48")) <= 10, `sunrise ${sunriseCst}`);
});

test("sunTimes: polar night returns null", () => {
  assert.equal(sunTimes(new Date("2026-12-21T12:00:00Z"), 78.2, 15.6), null);
});

test("candidatesFromOverpass: kinds, centers, addresses, private places skipped", () => {
  const c = candidatesFromOverpass([
    { type: "node", id: 1, lat: 43.07, lon: -89.38, tags: { amenity: "police", name: "Central District", "addr:housenumber": "211", "addr:street": "S Carroll St", "addr:city": "Madison" } },
    { type: "way", id: 2, center: { lat: 43.08, lon: -89.39 }, tags: { amenity: "library" } },
    { type: "node", id: 3, lat: 43.07, lon: -89.38, tags: { shop: "supermarket", name: "Fresh Market", opening_hours: "07:00-22:00" } },
    { type: "node", id: 4, lat: 43.07, lon: -89.38, tags: { amenity: "community_centre", name: "Staff only", access: "private" } },
    { type: "node", id: 5, tags: { amenity: "cafe", name: "No coords" } },
  ]);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], {
    id: "osm:node/1",
    name: "Central District",
    kind: "police",
    address: "211 S Carroll St, Madison",
    lat: 43.07,
    lng: -89.38,
    openingHours: undefined,
    source: "osm",
  });
  assert.equal(c[1].name, "Public library");
  assert.equal(c[1].lat, 43.08);
  assert.equal(c[2].openingHours, "07:00-22:00");
});

test("mapUrl searches by name + address when there is one", () => {
  assert.match(mapUrl({ name: "Central Library", address: "201 W Mifflin St", lat: 1, lng: 2 }), /query=Central%20Library%2C%20201/);
  assert.match(mapUrl({ name: "Library", lat: 43.1, lng: -89.4 }), /query=43\.100000%2C-89\.400000/);
});
