import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// Keeps the embeddable SDK contract (<script src=".../youpi.js">) working when the Next.js
// app is the checkout host. The single source of truth stays apps/checkout-portal/src/sdk.
export function GET() {
  const candidates = [
    path.resolve(process.cwd(), "../checkout-portal/src/sdk/youpi.js"),
    path.resolve(process.cwd(), "apps/checkout-portal/src/sdk/youpi.js"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return new Response("SDK not found", { status: 500 });
  return new Response(fs.readFileSync(file, "utf8"), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
