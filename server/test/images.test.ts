import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { loadPhotos } from "../src/images";

test("refuses non-marketplace hosts, local addresses, credentials, ports and lookalike hosts without fetching", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  try {
    const result = await loadPhotos([
      "https://example.com/a.jpg", "http://127.0.0.1/a.jpg", "https://127.0.0.1/a.jpg",
      "https://i.ebayimg.com.evil.example/a.jpg", "https://i.ebayimg.com:444/a.jpg",
      "https://user:pass@i.ebayimg.com/a.jpg", "https://[::1]/a.jpg", "https://fbcdn.net.evil.example/a.jpg",
    ], 8);
    assert.equal(result.photos.length, 0);
    assert.equal(result.failed, 8);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});

test("skips failed images, preserves original indices, sends bytes, and refuses redirects", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (url.endsWith("bad.jpg")) throw new Error("blocked");
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "content-type": "image/jpeg" } });
  });
  try {
    const result = await loadPhotos(["https://i.ebayimg.com/bad.jpg", "https://scontent.xx.fbcdn.net/good.jpg"]);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.photos, [{ index: 1, media_type: "image/jpeg", data: "/9j/2Q==" }]);
  } finally { fetchMock.mock.restore(); }
});

test("browser JPEG avoids fetching an expired URL; invalid data falls back to fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response("not an image", { headers: { "content-type": "text/html" } }));
  try {
    const result = await loadPhotos(["https://i.ebayimg.com/expired.jpg"], 4, ["data:image/jpeg;base64,/9j/2Q=="]);
    assert.equal(result.photos.length, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
    const invalid = await loadPhotos(["https://i.ebayimg.com/expired.jpg"], 4, ["data:image/jpeg;base64,aGVsbG8="]);
    assert.equal(invalid.photos.length, 0);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally { fetchMock.mock.restore(); }
});

test("rejects unsupported types and oversized bodies with or without content-length", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("svg")) return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
    return new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: {
      "content-type": "image/png", ...(url.endsWith("length") ? { "content-length": "5242881" } : {}),
    } });
  });
  try {
    const result = await loadPhotos(["https://i.ebayimg.com/svg", "https://i.ebayimg.com/length", "https://i.ebayimg.com/stream"]);
    assert.equal(result.failed, 3);
    assert.equal(result.photos.length, 0);
  } finally { fetchMock.mock.restore(); }
});
