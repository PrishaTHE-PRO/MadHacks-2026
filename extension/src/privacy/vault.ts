// The history key lives in the extension's IndexedDB as a non-extractable
// CryptoKey: the browser can use it, but nothing (including us) can read the
// raw key bytes out. This stops someone reading Second Look's history from the
// profile folder on disk. It does not stop malware running as the user.

import { newKey } from "./vaultCore";

const DB_NAME = "dealdig-vault";
const STORE = "keys";
const KEY_ID = "history";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => (db.close(), resolve(req.result as T));
        tx.onerror = tx.onabort = () => (db.close(), reject(tx.error ?? req.error));
      }),
  );
}

/** The history key. With `create`, makes one if there isn't one yet (first writer wins). */
export async function vaultKey(create: boolean): Promise<CryptoKey | null> {
  const found = await run<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
  if (found || !create) return found ?? null;
  // Generate before the transaction (it would auto-commit across an await).
  const key = await newKey();
  // `add` fails if another page made the key first; then use theirs.
  await run("readwrite", (s) => s.add(key, KEY_ID)).catch(() => {});
  return (await run<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID))) ?? null;
}

export async function deleteVaultKey() {
  await run("readwrite", (s) => s.delete(KEY_ID)).catch(() => {});
}
