"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdmin, usePolling } from "@/lib/admin-api";

interface Banned {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  mobileNumber?: string;
  bannedAt?: string;
  banReason?: string;
  lastSessionId?: string;
  source?: string;
}

const REASONS = ["Administrative Override", "Verified legitimate customer", "False positive", "OTHER"];

export function Security() {
  const admin = useAdmin();
  const [banned, setBanned] = useState<Banned[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [unban, setUnban] = useState<Banned | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [custom, setCustom] = useState("");
  const [dossier, setDossier] = useState<any | null>(null);
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualReason, setManualReason] = useState("");

  const load = useCallback(async () => {
    if (!admin.token) return;
    const [b, e, h] = await Promise.all([
      admin.json<{ bannedUsers?: Banned[] }>("/api/v1/admin/security/banned-users"),
      admin.json<{ events?: any[] }>("/api/v1/admin/security/events"),
      admin.json<{ history?: any[] }>("/api/v1/admin/security/history"),
    ]);
    if (b.ok) setBanned(b.data.bannedUsers ?? []);
    if (e.ok) setEvents(e.data.events ?? []);
    if (h.ok) setHistory(h.data.history ?? []);
  }, [admin]);
  usePolling(load, 15000, Boolean(admin.token));

  const q = query.trim().toLowerCase();
  const shown = banned.filter((u) => !q || [u.name, u.email, u.phone, u.mobileNumber, u.id].some((v) => String(v ?? "").toLowerCase().includes(q)));

  async function doUnban() {
    if (!unban) return;
    const finalReason = reason === "OTHER" ? custom.trim() : reason;
    if (!finalReason) return toast.error("A reason is required to unban a customer.");
    const r = await admin.send<{ message?: string; error?: string }>("POST", "/api/v1/admin/security/unban", { customerId: unban.id, reason: finalReason });
    if (r.ok) {
      toast.success(r.data.message || "Customer unbanned");
      setUnban(null);
      setDossier(null);
      load();
    } else toast.error(r.data.error || "Failed to unban customer");
  }

  async function doManualBan() {
    if (!manualId.trim() || !manualReason.trim()) return toast.error("Customer and reason are required.");
    const r = await admin.send<{ message?: string; error?: string }>("POST", "/api/v1/admin/security/manual-ban", { customerId: manualId.trim(), reason: manualReason.trim(), notes: "" });
    if (r.ok) {
      toast.success(r.data.message || "Customer banned");
      setManual(false);
      setManualId("");
      setManualReason("");
      load();
    } else toast.error(r.data.error || "Failed to ban customer");
  }

  async function openDossier(id: string) {
    const r = await admin.json<any>(`/api/v1/admin/security/banned-users/${encodeURIComponent(id)}`);
    if (r.ok) setDossier({ ...r.data, _id: id });
    else toast.error("Failed to retrieve ban dossier");
  }

  return (
    <>
      <Tabs defaultValue="banned">
        <TabsList>
          <TabsTrigger value="banned">Banned users ({banned.length})</TabsTrigger>
          <TabsTrigger value="events">Security events</TabsTrigger>
          <TabsTrigger value="history">Ban history</TabsTrigger>
        </TabsList>

        <TabsContent value="banned">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Banned customers</CardTitle>
              <div className="flex gap-2">
                <Input className="w-56" placeholder="Search name, phone, email…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button variant="outline" onClick={() => setManual(true)}>
                  Ban a customer
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Banned</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No customers currently banned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    shown.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-medium">{u.name || "Anonymous"}</div>
                          <div className="font-mono text-xs text-muted-foreground">{u.id}</div>
                        </TableCell>
                        <TableCell>{u.email || "-"}</TableCell>
                        <TableCell className="font-mono">{u.phone || u.mobileNumber || "-"}</TableCell>
                        <TableCell className="text-xs">{u.bannedAt ? new Date(u.bannedAt).toLocaleString() : "-"}</TableCell>
                        <TableCell>
                          <Badge variant={u.banReason === "MANUAL_BAN" ? "secondary" : "destructive"}>{u.banReason || "FRAUDULENT_PAYMENT_INJECTION"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.source || "SMS"}</Badge>
                        </TableCell>
                        <TableCell className="space-x-2 whitespace-nowrap text-right">
                          <Button size="sm" variant="outline" onClick={() => openDossier(u.id)}>
                            Details
                          </Button>
                          <Button size="sm" onClick={() => setUnban(u)}>
                            Unban
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardContent className="overflow-x-auto p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Raw</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No security events recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((e, i) => (
                      <TableRow key={e.id || i}>
                        <TableCell className="text-xs">{e.createdAt ? new Date(e.createdAt).toLocaleString() : "-"}</TableCell>
                        <TableCell>
                          <Badge variant={e.eventType === "USER_UNBANNED" ? "default" : e.eventType === "MANUAL_BAN" ? "secondary" : "destructive"}>{e.eventType === "FRAUDULENT_PAYMENT_INJECTION" ? "FRAUD_INJECTION" : e.eventType}</Badge>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">{e.customerId || "-"}</code>
                        </TableCell>
                        <TableCell>{e.source || "SMS"}</TableCell>
                        <TableCell className="font-mono text-xs">{e.sender || "-"}</TableCell>
                        <TableCell className="text-xs">{e.fraudReason || "-"}</TableCell>
                        <TableCell>
                          <code className="text-xs">{e.rawMessage ? (e.rawMessage.length > 55 ? `${e.rawMessage.slice(0, 52)}...` : e.rawMessage) : "-"}</code>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="overflow-x-auto p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No historical ban actions logged.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((l, i) => (
                      <TableRow key={l.id || i}>
                        <TableCell className="text-xs">{l.createdAt ? new Date(l.createdAt).toLocaleString() : "-"}</TableCell>
                        <TableCell>
                          <Badge variant={l.action === "USER_UNBANNED" ? "default" : l.action === "CUSTOMER_MANUALLY_BANNED" ? "secondary" : "destructive"}>
                            {l.action === "CUSTOMER_AUTOMATICALLY_BANNED" ? "AUTO_BANNED" : l.action === "USER_UNBANNED" ? "UNBANNED" : l.action === "CUSTOMER_MANUALLY_BANNED" ? "MANUAL_BAN" : l.action}
                          </Badge>
                        </TableCell>
                        <TableCell>{l.actorId || l.actorType || "SYSTEM"}</TableCell>
                        <TableCell>
                          <code className="text-xs">{l.entityId || "-"}</code>
                        </TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs" title={JSON.stringify(l.details || {})}>
                          {JSON.stringify(l.details || {})}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!unban} onOpenChange={(o) => !o && setUnban(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unban {unban?.name || "customer"}?</DialogTitle>
            <DialogDescription>A reason is mandatory and is written to the audit log.</DialogDescription>
          </DialogHeader>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r === "OTHER" ? "Other…" : r}
              </option>
            ))}
          </select>
          {reason === "OTHER" && <Input placeholder="Reason" value={custom} onChange={(e) => setCustom(e.target.value)} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnban(null)}>
              Cancel
            </Button>
            <Button onClick={doUnban}>Confirm unban</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban a customer</DialogTitle>
            <DialogDescription>Enter the customer ID and a mandatory reason.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Customer ID" value={manualId} onChange={(e) => setManualId(e.target.value)} />
          <Input placeholder="Reason" value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setManual(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doManualBan}>
              Ban customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dossier} onOpenChange={(o) => !o && setDossier(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ban evidence dossier</DialogTitle>
            <DialogDescription>Verbatim evidence as captured by the observer.</DialogDescription>
          </DialogHeader>
          {dossier && (
            <div className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="mb-1 font-semibold">Customer</div>
                  <div>{dossier.customer?.name || "-"}</div>
                  <div className="font-mono">{dossier.customer?.phone || "-"}</div>
                  <div>{dossier.customer?.email || "-"}</div>
                  <div className="text-xs text-muted-foreground">
                    {dossier.customer?.totalOrders || 0} orders · ₹{dossier.customer?.totalSpentRupees || "0.00"}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-1 font-semibold">Enforcement</div>
                  <div>Type: {dossier.banDetails?.banType || "-"}</div>
                  <div>Trigger: {dossier.banDetails?.triggerEvent || "-"}</div>
                  <div>Order: #{dossier.banDetails?.orderId || "-"}</div>
                  <div>Amount: ₹{dossier.banDetails?.sessionAmountRupees || "-"}</div>
                </div>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/50 bg-muted p-3 font-mono text-xs">{String(dossier.rawEvidence || "NO_RAW_PAYLOAD_AVAILABLE")}</pre>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                const u = banned.find((b) => b.id === dossier?._id);
                if (u) setUnban(u);
              }}
            >
              Unban this customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
