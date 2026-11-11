"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdmin, usePolling } from "@/lib/admin-api";
import { ObserversPanel } from "./observers";

interface Service {
  id: string;
  name: string;
  port: number;
  pid: number | null;
  status: string;
  uptimeSeconds: number;
}

function uptime(s: number) {
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Supervisor() {
  const admin = useAdmin();
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    if (!admin.token) return;
    const r = await admin.json<Service[]>("/api/services");
    if (r.ok && Array.isArray(r.data)) {
      setServices(r.data);
      setError(false);
    } else setError(true);
  }, [admin]);
  usePolling(load, 5000, Boolean(admin.token));

  useEffect(() => {
    if (!admin.token) return;
    return admin.stream("/api/logs/stream", (name, data) => {
      if (name !== "log") return;
      try {
        const l = JSON.parse(data);
        setLogs((prev) => [...prev.slice(-299), `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.serviceId}: ${l.line}`]);
      } catch {}
    });
  }, [admin.token, admin.stream]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function act(path: string, label: string) {
    const r = await admin.send<{ error?: string }>("POST", path);
    if (r.ok) toast.success(label);
    else toast.error(r.data.error || `${label} failed`);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">System supervisor</CardTitle>
            <CardDescription>Managed services (control center, port 8090).</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => act("/api/services/start-all", "Start all requested")}>
              Start all
            </Button>
            <Button size="sm" variant="destructive" onClick={() => window.confirm("Stop ALL services (including the payment API)?") && act("/api/services/stop-all", "Stop all requested")}>
              Stop all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>PID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-destructive">
                    Supervisor API unavailable (port 8090). Ensure services are running.
                  </TableCell>
                </TableRow>
              ) : (
                services.map((s) => {
                  const running = s.status === "RUNNING";
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{s.id}</div>
                      </TableCell>
                      <TableCell>
                        <code>{s.port}</code>
                      </TableCell>
                      <TableCell>{s.pid || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={running ? "default" : s.status === "STARTING" ? "secondary" : "destructive"}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>{running ? uptime(s.uptimeSeconds || 0) : "-"}</TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap">
                        {running ? (
                          <>
                            <Button size="sm" variant="destructive" onClick={() => act(`/api/services/${s.id}/stop`, `${s.name} stopping`)}>
                              Stop
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act(`/api/services/${s.id}/restart`, `${s.name} restarting`)}>
                              Restart
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" onClick={() => act(`/api/services/${s.id}/start`, `${s.name} starting`)}>
                            Start
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live service logs</CardTitle>
        </CardHeader>
        <CardContent>
          <pre ref={logRef} className="h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs" data-testid="service-logs">
            {logs.length ? logs.join("\n") : "Waiting for log output…"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Secret({ label, value }: { label: string; value?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly type={show ? "text" : "password"} value={value || ""} className="font-mono" />
        <Button variant="outline" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </Button>
        <Button variant="outline" onClick={() => value && navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`))}>
          Copy
        </Button>
      </div>
    </div>
  );
}

function Webhooks({ merchant, reload }: { merchant: Record<string, any> | null; reload: () => void }) {
  const admin = useAdmin();
  const [rotated, setRotated] = useState<{ key?: string; secret?: string }>({});

  async function rotate(kind: "merchant-key" | "webhook-secret") {
    const msg = kind === "merchant-key" ? "Generate a new secret Merchant API key (X-Merchant-Key)? Backend scripts using the old key must be updated." : "Rotate the webhook HMAC signing secret? Update YOUPI_WEBHOOK_SECRET on your backend.";
    if (!window.confirm(msg)) return;
    const r = await admin.send<{ merchantKey?: string; webhookSecret?: string; error?: string }>("POST", `/api/v1/admin/${kind}/rotate`, { merchantId: merchant?.merchantId });
    if (r.ok) {
      setRotated((p) => ({ ...p, ...(r.data.merchantKey ? { key: r.data.merchantKey } : {}), ...(r.data.webhookSecret ? { secret: r.data.webhookSecret } : {}) }));
      toast.success(kind === "merchant-key" ? "New Merchant API key generated" : "New webhook secret generated");
      reload();
    } else toast.error(r.data.error || "Rotation failed");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Webhooks & secrets</CardTitle>
        <CardDescription>Fulfil orders only from the signed server-to-server webhook (X-Gateway-Signature, HMAC-SHA256 over the raw body).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Secret label="Publishable key (data-youpi-key)" value={merchant?.publishableKey || merchant?.merchantId} />
        <Secret label="Secret merchant API key (X-Merchant-Key)" value={rotated.key || merchant?.merchantKey} />
        <Button variant="outline" onClick={() => rotate("merchant-key")}>
          Rotate merchant API key
        </Button>
        <Secret label="Webhook signing secret" value={rotated.secret || merchant?.webhookSecret} />
        <Button variant="outline" onClick={() => rotate("webhook-secret")}>
          Rotate webhook secret
        </Button>
        <div className="space-y-1.5">
          <Label>Webhook URL</Label>
          <Input readOnly value={merchant?.webhookUrl || ""} placeholder="Set in Store settings" />
        </div>
      </CardContent>
    </Card>
  );
}

function Tunnel() {
  const admin = useAdmin();
  const [status, setStatus] = useState<{ running?: boolean; isRunning?: boolean; pid?: number | null; uptimeMs?: number; logs?: string[]; recentLogs?: string[] }>({});
  const [cmd, setCmd] = useState("");
  const load = useCallback(async () => {
    if (!admin.token) return;
    const r = await admin.json<typeof status>("/api/v1/admin/tunnel/status");
    if (r.ok) setStatus({ ...r.data, running: Boolean(r.data.isRunning ?? r.data.running), logs: r.data.recentLogs ?? r.data.logs });
  }, [admin]);
  usePolling(load, 5000, Boolean(admin.token));

  async function start() {
    if (!cmd.trim()) return toast.error("Paste your Cloudflare tunnel command.");
    await admin.send("POST", "/api/v1/admin/merchant-settings", { cloudflareTunnelCommand: cmd.trim(), branding: { cloudflareTunnelCommand: cmd.trim() } });
    const r = await admin.send<{ error?: string }>("POST", "/api/v1/admin/tunnel/start", { command: cmd.trim() });
    if (r.ok) toast.success("Tunnel command executed");
    else toast.error(r.data.error || "Failed to start tunnel");
    load();
  }
  async function stop() {
    const r = await admin.send<{ message?: string }>("POST", "/api/v1/admin/tunnel/stop", {});
    toast(r.data.message || "Tunnel stopped");
    load();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Cloudflare tunnel</CardTitle>
          <CardDescription>{status.running ? `PID ${status.pid} · up ${Math.floor((status.uptimeMs || 0) / 1000)}s` : "No tunnel running."}</CardDescription>
        </div>
        <Badge variant={status.running ? "default" : "secondary"}>{status.running ? "RUNNING" : "STOPPED"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="tunnel-cmd">Tunnel command</Label>
        <Input id="tunnel-cmd" placeholder="cloudflared tunnel run --token …" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        <div className="flex gap-2">
          {!status.running ? <Button onClick={start}>Start tunnel</Button> : <Button variant="destructive" onClick={stop}>Stop tunnel</Button>}
        </div>
        {status.logs?.length ? <pre className="h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{status.logs.join("\n")}</pre> : null}
      </CardContent>
    </Card>
  );
}

function Protocols() {
  const admin = useAdmin();
  const [wa, setWa] = useState<{ status?: string; phoneNumber?: string; qrCode?: string }>({});
  const load = useCallback(async () => {
    if (!admin.token) return;
    const r = await admin.json<typeof wa>("/api/v1/admin/whatsapp/status");
    if (r.ok) setWa(r.data);
  }, [admin]);
  usePolling(load, 4000, Boolean(admin.token));

  async function act(kind: "reconnect" | "disconnect") {
    const r = await admin.send<{ error?: string }>("POST", `/api/v1/admin/whatsapp/${kind}`);
    if (r.ok) toast.success(kind === "reconnect" ? "Reconnecting WhatsApp…" : "WhatsApp disconnected");
    else toast.error(r.data.error || "Action failed");
    load();
  }
  let qrSrc = wa.qrCode || "";
  if (qrSrc.startsWith("<svg")) qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(qrSrc)}`;
  const qrOk = qrSrc.startsWith("data:image/") || qrSrc.startsWith("https://") || qrSrc.startsWith("http://");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">WhatsApp (customer OTP)</CardTitle>
          <CardDescription>{wa.status === "CONNECTED" ? `Linked phone: ${wa.phoneNumber || "linked device"}` : wa.status === "QR_READY" ? "Scan the QR with the merchant WhatsApp." : "Not connected."}</CardDescription>
        </div>
        <Badge variant={wa.status === "CONNECTED" ? "default" : "secondary"}>{wa.status || "UNKNOWN"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {wa.status === "QR_READY" && qrOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrSrc} alt="WhatsApp pairing QR" className="size-56 rounded-lg border bg-white p-2" />
        )}
        <div className="flex gap-2">
          <Button onClick={() => act("reconnect")}>{wa.status === "CONNECTED" ? "Re-pair device" : "Connect / refresh QR"}</Button>
          {wa.status === "CONNECTED" && (
            <Button variant="destructive" onClick={() => act("disconnect")}>
              Disconnect
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Gmail OAuth observer configuration is not yet ported to this UI — use the legacy admin page.</p>
      </CardContent>
    </Card>
  );
}

export function DeveloperHub({ merchant, reload }: { merchant: Record<string, any> | null; reload: () => void }) {
  return (
    <Tabs defaultValue="supervisor">
      <TabsList className="flex-wrap">
        <TabsTrigger value="supervisor">System supervisor</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks & secrets</TabsTrigger>
        <TabsTrigger value="android">Android SMS hub</TabsTrigger>
        <TabsTrigger value="tunnel">Cloudflare tunnel</TabsTrigger>
        <TabsTrigger value="protocols">WhatsApp</TabsTrigger>
      </TabsList>
      <TabsContent value="supervisor">
        <Supervisor />
      </TabsContent>
      <TabsContent value="webhooks">
        <Webhooks merchant={merchant} reload={reload} />
      </TabsContent>
      <TabsContent value="android">
        <ObserversPanel />
      </TabsContent>
      <TabsContent value="tunnel">
        <Tunnel />
      </TabsContent>
      <TabsContent value="protocols">
        <Protocols />
      </TabsContent>
    </Tabs>
  );
}
