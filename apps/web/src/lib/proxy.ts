import { NextRequest } from "next/server";

/**
 * Server-side relay used by the Next.js app. The browser only ever talks to this app's own
 * origin, so no CORS headers are needed anywhere (same model as the legacy checkout/admin
 * servers on :7000 / :6001).
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/** Headers a browser must never be able to spoof when talking to the payment core. */
const STRIPPED_REQUEST_HEADERS = new Set(["x-internal-render", "x-internal-token"]);

export const PAYMENT_API_URL =
  process.env.PAYMENT_API_URL || process.env.BASE_PAYMENT_API_URL || "http://localhost:6100";
export const CONTROL_CENTER_URL =
  process.env.CONTROL_CENTER_URL || `http://127.0.0.1:${process.env.CONTROL_CENTER_PORT || 8090}`;
const DEFAULT_MERCHANT_ID =
  process.env.YOUPI_DEFAULT_MERCHANT_ID || "00000000-0000-0000-0000-000000000001";

export async function relay(
  req: NextRequest,
  target: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const incoming = new URL(req.url);
  const url = new URL(incoming.pathname + incoming.search, target);

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || STRIPPED_REQUEST_HEADERS.has(lower)) return;
    headers.set(key, value);
  });
  headers.set("x-forwarded-host", req.headers.get("host") || "");
  headers.set("x-forwarded-proto", req.headers.get("x-forwarded-proto") || incoming.protocol.replace(":", ""));
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error duplex is required by undici for streamed request bodies
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: req.signal,
      cache: "no-store",
    });
    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // fetch() already decoded the body, so the encoding/length headers no longer apply.
      if (HOP_BY_HOP.has(lower) || lower === "content-encoding") return;
      respHeaders.set(key, value);
    });
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (err) {
    return Response.json(
      { error: "Gateway API unavailable", details: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export const merchantHeaders = { "x-merchant-id": DEFAULT_MERCHANT_ID };
