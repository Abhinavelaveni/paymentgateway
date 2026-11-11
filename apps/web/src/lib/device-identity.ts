// Device binding layer (parity with the legacy DeviceIdentity object): a per-browser ECDSA key
// registered with POST /api/v1/devices/register; id + token kept in localStorage and IndexedDB.
const DB_NAME = "youpi_device_keystore_v1";
const STORE = "keys";

export interface DeviceCreds {
  deviceId: string | null;
  deviceToken: string | null;
}

let current: DeviceCreds = { deviceId: null, deviceToken: null };
let inflight: Promise<DeviceCreds> | null = null;

export const getDevice = () => current;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function readRecord(): Promise<{ deviceId?: string; deviceToken?: string } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get("primary_device");
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeRecord(record: Record<string, unknown>) {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: "primary_device", ...record });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function signals() {
  let canvasSignature = "";
  try {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 30;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("YouPI-PG-Device-Binding-2026", 2, 2);
      canvasSignature = c.toDataURL().slice(-32);
    }
  } catch {}
  let webglRenderer = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && dbg) webglRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  } catch {}
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent || "",
    platform: nav.platform || "",
    language: nav.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screenSignature: `${screen.width}x${screen.height}x${screen.colorDepth || 24}`,
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: nav.deviceMemory || 0,
    webglRenderer,
    canvasSignature,
  };
}

async function register(): Promise<DeviceCreds> {
  if (current.deviceId) return current;
  const stored = await readRecord();
  if (stored?.deviceId) {
    current = { deviceId: stored.deviceId, deviceToken: stored.deviceToken || null };
    try {
      localStorage.setItem("ypg_device_id", stored.deviceId);
      if (stored.deviceToken) localStorage.setItem("ypg_device_token", stored.deviceToken);
    } catch {}
    return current;
  }
  try {
    const id = localStorage.getItem("ypg_device_id");
    if (id) {
      current = { deviceId: id, deviceToken: localStorage.getItem("ypg_device_token") };
      return current;
    }
  } catch {}

  let publicKey = "";
  try {
    if (crypto?.subtle) {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
      publicKey = btoa(String.fromCharCode(...spki));
    }
  } catch {}
  if (!publicKey) publicKey = btoa(`fallback-device-key-${Math.random()}-${Date.now()}`);

  try {
    const res = await fetch("/api/v1/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, signals: signals() }),
    });
    const data = await res.json();
    if (data?.deviceId) {
      current = { deviceId: data.deviceId, deviceToken: data.deviceToken || null };
      try {
        localStorage.setItem("ypg_device_id", data.deviceId);
        if (data.deviceToken) localStorage.setItem("ypg_device_token", data.deviceToken);
      } catch {}
      await writeRecord({ deviceId: data.deviceId, deviceToken: data.deviceToken, publicKeyBase64: publicKey, registeredAt: new Date().toISOString() });
    }
  } catch {}
  return current;
}

export function ensureDevice(): Promise<DeviceCreds> {
  if (current.deviceId) return Promise.resolve(current);
  inflight ||= register().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Forgets the stored device (localStorage + IndexedDB) so the next call registers a fresh one. */
export async function resetDevice() {
  current = { deviceId: null, deviceToken: null };
  try {
    localStorage.removeItem("ypg_device_id");
    localStorage.removeItem("ypg_device_token");
  } catch {}
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("primary_device");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
