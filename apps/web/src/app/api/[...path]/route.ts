import { NextRequest } from "next/server";
import { PAYMENT_API_URL, merchantHeaders, relay } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// Transparent proxy: /api/* -> Payment Core REST API (port 6100). Mirrors the /api proxy of
// the legacy checkout portal and merchant admin, including SSE streams.
const handler = (req: NextRequest) => relay(req, PAYMENT_API_URL, merchantHeaders);

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
