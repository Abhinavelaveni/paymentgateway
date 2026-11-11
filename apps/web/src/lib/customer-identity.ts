import type { Customer } from "./checkout-types";

// Same keys and 7-day lifetime as the legacy checkout so a customer who signed in on the old
// page stays signed in on the new one.
const KEY_IDENTITY = "youpi.customer.identity";
const KEY_ACCOUNTS = "youpi.customer.accounts";
const KEY_ACTIVE = "youpi.customer.activeId";
const KEY_TOKEN = "ypg_customer_token";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PreservedIdentity {
  customer: Customer;
  token: string | null;
}

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function clearIdentity() {
  const s = ls();
  if (!s) return;
  try {
    s.removeItem(KEY_IDENTITY);
    s.removeItem(KEY_ACCOUNTS);
    s.removeItem(KEY_ACTIVE);
    s.removeItem(KEY_TOKEN);
  } catch {}
}

export function readIdentity(): PreservedIdentity | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY_IDENTITY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.customer) {
      clearIdentity();
      return null;
    }
    const expiry = data.expiresAt || (data.savedAt || Date.now()) + MAX_AGE_MS;
    if (Date.now() > expiry) {
      clearIdentity();
      return null;
    }
    return { customer: data.customer, token: data.token || s.getItem(KEY_TOKEN) };
  } catch {
    return null;
  }
}

export function saveIdentity(cust: Customer, token: string | null) {
  const s = ls();
  if (!s || !cust?.id) return;
  const clean: Customer = {
    id: cust.id,
    name: cust.name || cust.fullName || "Customer",
    email: cust.email || "",
    mobileNumber: cust.mobileNumber || cust.phoneNumber || "",
    status: cust.status || "ACTIVE",
  };
  const resolved = token || s.getItem(KEY_TOKEN);
  const now = Date.now();
  try {
    s.setItem(KEY_IDENTITY, JSON.stringify({ customer: clean, token: resolved, savedAt: now, expiresAt: now + MAX_AGE_MS }));
    s.setItem(KEY_ACCOUNTS, JSON.stringify([clean]));
    s.setItem(KEY_ACTIVE, cust.id);
    if (resolved) s.setItem(KEY_TOKEN, resolved);
  } catch {}
}

export function last10(phone?: string) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}
