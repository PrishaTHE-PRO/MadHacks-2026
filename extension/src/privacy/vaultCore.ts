// AES-GCM sealing for data Second Look keeps on the device (check history).
// Pure WebCrypto with the key passed in, so Node tests can run it.

export interface Sealed {
  v: 1;
  iv: string; // base64, 12 bytes
  data: string; // base64 ciphertext + tag
}

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const isSealed = (x: unknown): x is Sealed =>
  !!x && typeof x === "object" && (x as Sealed).v === 1 && typeof (x as Sealed).iv === "string" && typeof (x as Sealed).data === "string";

/** A new key that can't be read out of the browser (extractable: false). */
export const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { v: 1, iv: toB64(iv), data: toB64(cipher) };
}

/** Throws if the key is wrong or the data was changed. */
export async function unseal<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, key, fromB64(sealed.data));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
