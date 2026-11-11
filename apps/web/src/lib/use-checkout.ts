"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckoutState, Customer, PaymentMethod } from "./checkout-types";
import { TERMINAL_STATUSES } from "./checkout-types";
import { clearIdentity, readIdentity, saveIdentity } from "./customer-identity";
import { ensureDevice, getDevice, resetDevice } from "./device-identity";
import { postToMerchant } from "./merchant-bridge";

const FALLBACK_POLL_MS = 2000;
const QUEUE_POLL_MS = 1200;

export interface AuthSession {
  customer: Customer | null;
  token: string | null;
}

/** Auth + device headers, identical to getApiHeaders() in the legacy checkout. */
export function apiHeaders(token: string | null, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  const dev = getDevice();
  if (dev.deviceId) headers["X-Device-Id"] = dev.deviceId;
  if (dev.deviceToken) headers["X-Device-Token"] = dev.deviceToken;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["x-customer-token"] = token;
  }
  return headers;
}

export function useCheckout(paymentId: string) {
  const [state, setState] = useState<CheckoutState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [duplicate, setDuplicate] = useState<Record<string, unknown> | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [auth, setAuth] = useState<AuthSession>({ customer: null, token: null });
  const [authReady, setAuthReady] = useState(false);
  const deviceRetried = useRef(false);
  const [guestName, setGuestNameState] = useState("");
  useEffect(() => {
    try {
      setGuestNameState(localStorage.getItem("youpi.guest.name") || "");
    } catch {}
  }, []);
  const setGuestName = useCallback((n: string) => {
    const clean = n.replace(/[^\p{L}\p{N} .-]/gu, "").trim().slice(0, 30);
    setGuestNameState(clean);
    try {
      localStorage.setItem("youpi.guest.name", clean);
    } catch {}
  }, []);

  const authRef = useRef(auth);
  authRef.current = auth;
  const stateRef = useRef<CheckoutState | null>(null);
  const binding = useRef(false);
  const hooked = useRef<Set<string>>(new Set());

  // Restore the 7-day identity once, on the client only.
  useEffect(() => {
    const preserved = readIdentity();
    if (preserved) setAuth({ customer: preserved.customer, token: preserved.token });
    setAuthReady(true);
  }, []);

  const emitHook = useCallback(
    (action: string, details: Record<string, unknown> = {}) => {
      postToMerchant({
        type: "YOUPI_PAYMENT_HOOK",
        action,
        paymentId,
        orderId: stateRef.current?.orderId,
        details,
      });
      const token = authRef.current.token;
      fetch(`/api/v1/checkout/${paymentId}/trigger-hook`, {
        method: "POST",
        headers: apiHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action, details, ...(token ? { token } : {}) }),
      }).catch(() => {});
    },
    [paymentId],
  );

  /** Fires a hook once per (action,status) so polling does not spam the backend. */
  const emitHookOnce = useCallback(
    (action: string, details: Record<string, unknown> = {}) => {
      const key = `${action}:${String(details.status ?? "")}`;
      if (hooked.current.has(key)) return;
      hooked.current.add(key);
      emitHook(action, details);
    },
    [emitHook],
  );

  const loadState = useCallback(async () => {
    try {
      await ensureDevice();
      const res = await fetch(`/api/v1/checkout/${paymentId}/state`, {
        headers: apiHeaders(authRef.current.token ?? readIdentity()?.token ?? null),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      // The backend reports an unregistered/revoked *requesting* device as
      // error=DUPLICATE_SESSION_DETECTED with code=DEVICE_REVOKED. Forget the stale stored device,
      // register a fresh one and retry once; only then fall through to the restart screen.
      const badDevice = ["DEVICE_REVOKED", "DEVICE_SIGNATURE_INVALID", "DEVICE_ID_REQUIRED"];
      if (badDevice.includes(data.code) || badDevice.includes(data.error)) {
        if (!deviceRetried.current) {
          deviceRetried.current = true;
          await resetDevice();
          return loadState();
        }
        setDuplicate(data);
        setLoaded(true);
        return;
      }
      if (res.status === 409 || data.error === "DUPLICATE_SESSION_DETECTED") {
        setDuplicate(data);
        setLoaded(true);
        return;
      }
      if (!res.ok) {
        setLoaded(true);
        return;
      }
      setDuplicate(null);
      stateRef.current = data;
      setState(data);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [paymentId]);

  // Initial load, then 2s fallback polling (stops on terminal/blocked states), like the old page.
  useEffect(() => {
    if (!authReady) return;
    loadState();
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s && ((TERMINAL_STATUSES as readonly string[]).includes(s.status) || s.status === "BLOCKED" || s.isBanned)) return;
      loadState();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [authReady, loadState]);

  // Fast poll while queued.
  useEffect(() => {
    if (state?.status !== "QUEUED") return;
    const id = setInterval(loadState, QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [state?.status, loadState]);

  // Realtime stream.
  useEffect(() => {
    if (!authReady) return;
    let closed = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      await ensureDevice();
      if (closed) return;
      const dev = getDevice();
      const params = new URLSearchParams();
      if (dev.deviceId) params.set("deviceId", dev.deviceId);
      if (dev.deviceToken) params.set("deviceToken", dev.deviceToken);
      const qs = params.toString();
      es = new EventSource(`/api/v1/checkout/${paymentId}/stream${qs ? `?${qs}` : ""}`);
      const onPayload = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data && (data.error === "DUPLICATE_SESSION_DETECTED" || data.type === "DUPLICATE_SESSION_DETECTED")) {
            setDuplicate(data);
          } else if (data?.type === "STATE_CHANGE" && data.payload) {
            stateRef.current = data.payload;
            setState(data.payload);
          } else {
            loadState();
          }
        } catch {
          loadState();
        }
      };
      es.onmessage = onPayload;
      for (const name of [
        "status_change",
        "state_change",
        "account_blocked",
        "fraud_detected",
        "counter_payment_confirmed",
        "counter_payment_declined",
        "payment_success",
        "queue_cleared",
        "session_expired",
      ]) {
        es.addEventListener(name, onPayload as EventListener);
      }
      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [authReady, paymentId, loadState]);

  // Bind the signed-in customer to this payment session (INITIATED or unbound).
  useEffect(() => {
    if (!state || !auth.customer || !auth.token) return;
    if (state.customer && state.status !== "INITIATED") return;
    if (binding.current) return;
    binding.current = true;
    (async () => {
      try {
        await ensureDevice();
        const res = await fetch(`/api/v1/checkout/${paymentId}/bind-customer`, {
          method: "POST",
          headers: apiHeaders(auth.token, { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` }),
          body: JSON.stringify({ token: auth.token, customerId: auth.customer!.id }),
        });
        if (res.ok) {
          const bound = await res.json().catch(() => null);
          if (bound?.status && bound.status !== "INITIATED") loadState();
        } else if (res.status === 401) {
          clearIdentity();
          setAuth({ customer: null, token: null });
        }
      } catch {
      } finally {
        binding.current = false;
      }
    })();
  }, [state, auth, paymentId, loadState]);

  // Guest checkout (backend YOUPI_GUEST_CHECKOUT=true): no WhatsApp sign-in; the session is
  // activated by guest-start below.
  const guest = state?.guestCheckout === true;
  const signedIn =
    (guest && guestName.length > 0) ||
    Boolean((state?.customer || auth.customer) && (state?.status !== "INITIATED" || Boolean(auth.token)));
  const guestStarting = useRef(false);
  const guestAttempts = useRef(0);
  useEffect(() => {
    if (!guest || !guestName || state?.status !== "INITIATED" || guestStarting.current || guestAttempts.current >= 5) return;
    guestStarting.current = true;
    guestAttempts.current += 1;
    (async () => {
      try {
        await ensureDevice();
        await fetch(`/api/v1/checkout/${paymentId}/guest-start`, {
          method: "POST",
          headers: apiHeaders(null, { "Content-Type": "application/json" }),
          body: JSON.stringify({ name: guestName }),
        });
        await loadState();
      } catch {
      } finally {
        guestStarting.current = false;
      }
    })();
  }, [guest, guestName, state?.status, paymentId, loadState]);

  const customer = (state?.customer as Customer | null | undefined) || auth.customer;

  const completeSignIn = useCallback(
    async (cust: Customer, token: string) => {
      saveIdentity(cust, token);
      setAuth({ customer: cust, token });
      authRef.current = { customer: cust, token };
      await ensureDevice();
      await fetch(`/api/v1/checkout/${paymentId}/bind-customer`, {
        method: "POST",
        headers: apiHeaders(token, { "Content-Type": "application/json", Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ token, customerId: cust.id }),
      }).catch(() => {});
      emitHook("AUTH_COMPLETED", { customerId: cust.id });
      loadState();
    },
    [paymentId, emitHook, loadState],
  );

  const signOut = useCallback(async () => {
    const token = authRef.current.token;
    if (token) {
      await fetch("/api/v1/customer/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    clearIdentity();
    setAuth({ customer: null, token: null });
  }, []);

  const post = useCallback(
    async (suffix: string, body?: unknown) => {
      await ensureDevice();
      return fetch(`/api/v1/checkout/${paymentId}/${suffix}`, {
        method: "POST",
        headers: apiHeaders(authRef.current.token, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    [paymentId],
  );

  const selectMethod = useCallback(
    async (m: PaymentMethod) => {
      setMethod(m);
      try {
        const dev = await ensureDevice();
        const res = await post("select-method", { method: m, deviceId: dev.deviceId });
        const data = await res.json();
        if (res.ok && data) {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  method: m,
                  ...(data.timeRemainingSeconds !== undefined ? { timeRemainingSeconds: data.timeRemainingSeconds } : {}),
                  ...(data.status ? { status: data.status } : {}),
                }
              : prev,
          );
          loadState();
        }
      } catch {}
    },
    [post, loadState],
  );

  return {
    state,
    loaded,
    duplicate,
    method,
    setMethod,
    auth,
    authReady,
    signedIn,
    guest,
    guestName,
    setGuestName,
    customer,
    loadState,
    emitHook,
    emitHookOnce,
    completeSignIn,
    signOut,
    post,
    selectMethod,
  };
}
