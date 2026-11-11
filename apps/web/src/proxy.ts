import { NextResponse, type NextRequest } from "next/server";

/**
 * Runtime framing policy for the embeddable checkout page (mirrors checkoutFrameHeaders() in
 * apps/checkout-portal/src/server.js). Evaluated per request, not at build time, so
 * CHECKOUT_FRAME_ANCESTORS / YOUPI_MODE changes apply on restart without a rebuild.
 *
 * - explicit CHECKOUT_FRAME_ANCESTORS always wins ('self' + the listed http(s) origins)
 * - otherwise production => 'self'; development/localhost => * (the demo store on :5000 embeds
 *   the portal across origins)
 */
function frameAncestorOrigins(raw: string | undefined) {
  const origins: string[] = [];
  for (const entry of String(raw || "").split(/[\s,]+/)) {
    if (!entry) continue;
    try {
      const url = new URL(entry);
      if ((url.protocol === "https:" || url.protocol === "http:") && entry.replace(/\/$/, "") === url.origin) origins.push(url.origin);
    } catch {}
  }
  return origins;
}

function frameAncestorsDirective(env: NodeJS.ProcessEnv = process.env) {
  const configured = frameAncestorOrigins(env.CHECKOUT_FRAME_ANCESTORS);
  if (configured.length) return `frame-ancestors 'self' ${configured.join(" ")}`;
  const production = env.YOUPI_MODE === "production" || env.NODE_ENV === "production";
  const localhost = env.YOUPI_MODE === "localhost";
  return `frame-ancestors ${production && !localhost ? "'self'" : "*"}`;
}

export function proxy(_req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", frameAncestorsDirective());
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = { matcher: ["/checkout/:path*"] };
