import { NextRequest } from "next/server";
import { CONTROL_CENTER_URL, relay } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// /api/services/* -> Control Center supervisor (port 8090). The browser must present the admin
// bearer token; the Control Center verifies it, exactly as the legacy admin proxy required.
function handler(req: NextRequest) {
  if (!/^Bearer\s+\S+/i.test(req.headers.get("authorization") || "")) {
    return Response.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
  }
  return relay(req, CONTROL_CENTER_URL);
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
