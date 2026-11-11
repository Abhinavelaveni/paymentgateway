"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdmin, usePolling } from "@/lib/admin-api";

interface Device {
  deviceId?: string;
  id?: string;
  deviceName?: string;
  device_name?: string;
  deviceModel?: string;
  pairedAt?: string;
  createdAt?: string;
  created_at?: string;
}

/** Android SMS/notification observer: pairing QR, enrolment token, paired devices. */
export function ObserversPanel() {
  const admin = useAdmin();
  const [devices, setDevices] = useState<Device[]>([]);
  const [qrSvg, setQrSvg] = useState("");
  const [enrollToken, setEnrollToken] = useState("");
  const [qrError, setQrError] = useState(false);

  const load = useCallback(async () => {
    if (!admin.token) return;
    const [d, q] = await Promise.all([
      admin.json<{ devices?: Device[] }>("/api/v1/admin/sms-gateway/devices"),
      admin.json<{ pairingQrSvg?: string; qrSvg?: string; enrollmentToken?: string }>("/api/v1/admin/sms-gateway/pair-qr"),
    ]);
    if (d.ok) setDevices(d.data.devices ?? []);
    if (q.ok) {
      setQrSvg(q.data.pairingQrSvg || q.data.qrSvg || "");
      setEnrollToken(q.data.enrollmentToken || "");
      setQrError(false);
    } else setQrError(true);
  }, [admin]);

  usePolling(load, 10000, Boolean(admin.token));

  async function unpair(id: string) {
    if (!window.confirm(`Unpair device "${id}"?`)) return;
    const r = await admin.send("DELETE", `/api/v1/admin/sms-gateway/devices/${encodeURIComponent(id)}`);
    if (r.ok) {
      toast.success("Device unpaired");
      load();
    } else toast.error("Failed to unpair device");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Pair an Android device
            <Badge variant={devices.length ? "default" : "secondary"} data-testid="sms-badge">
              {devices.length ? `${devices.length} PAIRED` : "STANDBY"}
            </Badge>
          </CardTitle>
          <CardDescription>Install the observer app, then scan this QR (or paste the token) to pair it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="mx-auto aspect-square w-56 rounded-lg border bg-white p-2" data-testid="pair-qr">
            {qrSvg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Pairing QR" className="size-full" src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`} />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">{qrError ? "Failed to load QR" : "Loading…"}</div>
            )}
          </div>
          {enrollToken && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Enrolment token</div>
              <code className="block break-all rounded border bg-muted p-2 text-xs" data-testid="enroll-token">
                {enrollToken}
              </code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(enrollToken).then(() => toast.success("Token copied"))}>
                Copy token
              </Button>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={() => (window.location.href = "/api/v1/admin/sms-gateway/download-apk")}>
            Download Android APK
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paired devices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Paired</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No devices paired yet. Scan the QR to pair.
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((d) => {
                  const id = d.deviceId || d.id || "-";
                  const raw = d.pairedAt || d.createdAt || d.created_at;
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{d.deviceName || d.device_name || d.deviceModel || "Android Observer"}</TableCell>
                      <TableCell>
                        <code className="text-xs">{id}</code>
                      </TableCell>
                      <TableCell>{raw ? new Date(raw).toLocaleTimeString() : "Active"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="destructive" onClick={() => unpair(id)}>
                          Unpair
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
