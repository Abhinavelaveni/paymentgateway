"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Admin API access. Same model as the legacy admin page: the admin token
 * (ADMIN_API_TOKEN or data/.secrets/admin_api_token) is entered once, kept in sessionStorage
 * for this tab only, and sent as `Authorization: Bearer` on /api/v1/admin/*, /api/services and
 * /api/admin/tickets. The token never goes in a URL (SSE uses fetch streaming for that reason).
 */

const TOKEN_KEY = "youpi_admin_token";

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function isProtectedPath(url: string) {
  return (
    (/\/api\/v1\/admin\//.test(url) || /\/api\/services/.test(url) || /\/api\/admin\/tickets/.test(url) || /\/api\/logs\/stream/.test(url) || /\/api\/v1\/orders\/.+\/cod/.test(url)) &&
    !/\/admin\/sms-gateway\/download-apk/.test(url)
  );
}

interface AdminCtx {
  token: string;
  needsToken: boolean;
  rejected: boolean;
  setToken: (t: string) => void;
  signOut: () => void;
  /** fetch with bearer; opens the token prompt on 401. */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** JSON convenience: resolves to parsed body (or {}), with ok/status. */
  json: <T = any>(path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; data: T }>;
  send: <T = any>(method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; data: T }>;
  /** Authenticated SSE over fetch. Returns a closer. */
  stream: (path: string, onEvent: (name: string, data: string) => void) => () => void;
}

const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside <AdminProvider>");
  return v;
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [rejected, setRejected] = useState(false);
  const tokenRef = useRef("");

  useEffect(() => {
    const t = readToken();
    tokenRef.current = t;
    setTokenState(t);
    if (!t) setNeedsToken(true);
  }, []);

  const setToken = useCallback((t: string) => {
    const clean = t.trim();
    try {
      sessionStorage.setItem(TOKEN_KEY, clean);
    } catch {}
    tokenRef.current = clean;
    setTokenState(clean);
    setRejected(false);
    setNeedsToken(false);
  }, []);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
    tokenRef.current = "";
    setTokenState("");
    setNeedsToken(true);
  }, []);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!isProtectedPath(path)) return fetch(path, init);
    const attempt = () => {
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${tokenRef.current}`);
      return fetch(path, { ...init, headers, cache: "no-store" });
    };
    if (!tokenRef.current) {
      setNeedsToken(true);
      return new Response(JSON.stringify({ error: "Admin token required" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const res = await attempt();
    if (res.status === 401) {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {}
      tokenRef.current = "";
      setTokenState("");
      setRejected(true);
      setNeedsToken(true);
    }
    return res;
  }, []);

  const json = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      try {
        const res = await api(path, init);
        const data = (await res.json().catch(() => ({}))) as T;
        return { ok: res.ok, status: res.status, data };
      } catch {
        return { ok: false, status: 0, data: {} as T };
      }
    },
    [api],
  );

  const send = useCallback(
    <T,>(method: string, path: string, body?: unknown) =>
      json<T>(path, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    [json],
  );

  const stream = useCallback(
    (path: string, onEvent: (name: string, data: string) => void) => {
      const controller = new AbortController();
      let closed = false;
      const run = async () => {
        while (!closed) {
          try {
            if (!tokenRef.current) {
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
            const res = await fetch(path, {
              headers: { Authorization: `Bearer ${tokenRef.current}`, Accept: "text/event-stream" },
              signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            while (!closed) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let sep: number;
              while ((sep = buf.indexOf("\n\n")) !== -1) {
                const raw = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                let name = "message";
                const data: string[] = [];
                for (const line of raw.split("\n")) {
                  if (line.startsWith("event:")) name = line.slice(6).trim();
                  else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
                }
                if (data.length || name !== "message") onEvent(name, data.join("\n"));
              }
            }
          } catch {
            if (closed) return;
          }
          if (!closed) await new Promise((r) => setTimeout(r, 3000));
        }
      };
      run();
      return () => {
        closed = true;
        controller.abort();
      };
    },
    [],
  );

  const value = useMemo<AdminCtx>(
    () => ({ token, needsToken, rejected, setToken, signOut, api, json, send, stream }),
    [token, needsToken, rejected, setToken, signOut, api, json, send, stream],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Polls `fn` immediately and every `ms` while `enabled`. */
export function usePolling(fn: () => void | Promise<void>, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    ref.current();
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

export const rupees = (paise: number | string | undefined | null) => `₹${(Number(paise || 0) / 100).toFixed(2)}`;
