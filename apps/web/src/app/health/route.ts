export const dynamic = "force-dynamic";

// Liveness for the public entry point (Render health check / uptime monitors).
export function GET() {
  return Response.json({ status: "UP", service: "youpi-web" });
}
