// Outbound guard for URL detonation. The server opens links that scammers
// chose, so a link must never reach this machine or its network instead:
// http://127.0.0.1:8787/, http://192.168.1.1/ (the router), http://169.254.169.254/
// (cloud metadata, which hands out credentials), or a public name whose DNS
// points at any of those.
//
// The check runs inside the connection's own DNS lookup, so the address that
// was checked is the address we connect to. A name that answers "public" the
// first time and "127.0.0.1" the second (DNS rebinding) is still caught.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";
import type { LookupFunction } from "node:net";

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b:1::", 48], // local NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (private)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net, bits, "ipv6");

/** The IPv4 address hidden inside an IPv6 one (::ffff:a.b.c.d, NAT64, 6to4), if any. */
function embeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  const parts = hex ?? sixToFour;
  if (!parts) return null;
  const a = parseInt(parts[1], 16);
  const b = parseInt(parts[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

/** Is this IP address one the server must never connect to for a user's link? */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true; // not an IP at all: refuse
}

/** Ports a public website might use. Others (22, 6379, 5432...) are internal services. */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

export class BlockedUrlError extends Error {}

/** Reject a URL before any network work: scheme, port, and names that are always local. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("That isn't a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Only http and https links can be opened.");
  if (u.username || u.password) throw new BlockedUrlError("Links with a login in them (user@host) are a phishing trick; not opening it.");
  if (!ALLOWED_PORTS.has(u.port)) throw new BlockedUrlError(`Port ${u.port} isn't a normal website port.`);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host) || !host.includes("."))
    if (!isIP(host)) throw new BlockedUrlError("That address points inside a private network.");
  if (isIP(host) && isBlockedIp(host)) throw new BlockedUrlError("That address points inside a private network.");
  return u;
}

/** dns.lookup that refuses private answers. Used as the socket's lookup, so the checked IP is the one dialed. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const bad = addresses.find((a) => isBlockedIp(a.address));
    if (bad || addresses.length === 0) {
      const e = Object.assign(new BlockedUrlError(`${hostname} points inside a private network.`), { code: "EBLOCKED" });
      return callback(e as NodeJS.ErrnoException, "", 4);
    }
    if (options.all) (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

export interface GuardedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** True when the body was cut off at maxBytes. */
  truncated: boolean;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "upgrade", "proxy-authenticate", "trailer"]);

/**
 * One HTTP request, no redirects followed (the browser follows them, and each
 * hop comes back through here to be checked). Decompresses the body, caps its size.
 */
export function guardedFetch(
  raw: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | null; maxBytes: number; timeoutMs: number },
): Promise<GuardedResponse> {
  const u = assertPublicUrl(raw);
  const mod = u.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) if (!k.startsWith(":")) headers[k.toLowerCase()] = v;
  headers["accept-encoding"] = "gzip, deflate, br";
  delete headers["host"];

  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      { method: init.method ?? "GET", headers, lookup: guardedLookup, timeout: init.timeoutMs, agent: false },
      (res) => {
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          enc === "gzip" || enc === "x-gzip"
            ? res.pipe(zlib.createGunzip())
            : enc === "deflate"
              ? res.pipe(zlib.createInflate())
              : enc === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined || HOP_BY_HOP.has(k)) continue;
          out[k] = Array.isArray(v) ? v.join(k === "set-cookie" ? "\n" : ", ") : v;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () => resolve({ status: res.statusCode ?? 502, headers: out, body: Buffer.concat(chunks), truncated });
        stream.on("data", (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > init.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - init.maxBytes)));
            res.destroy();
            done();
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => !truncated && done());
        stream.on("error", (e) => (truncated ? undefined : chunks.length ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (init.body?.length) req.write(init.body);
    req.end();
  });
}
