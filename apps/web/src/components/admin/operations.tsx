"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rupees, useAdmin, usePolling } from "@/lib/admin-api";
import { computeKpis, type AdminPayment } from "@/lib/kpis";
import { ObserversPanel } from "./observers";

interface Slot {
  status: string;
  orderId: string;
  amountPaise: number | string;
  expiresAt?: string;
  processingExpiresAt?: string;
}
interface QueueRow {
  queuePosition: number;
  orderId: string;
  amountPaise: number | string;
  createdAt: string;
}

export function StatusBadge({ status }: { status: string }) {
  const label = status === "OBSERVED_SUCCESS" ? "Observed (not reconciled)" : status;
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "SUCCESS" || status === "RECONCILED" ? "default" : status === "OBSERVED_SUCCESS" || status === "ACTIVE" ? "secondary" : status === "QUEUED" || status === "PROCESSING" ? "outline" : "destructive";
  return <Badge variant={variant}>{label}</Badge>;
}

function Kpi({ title, value, sub, testId }: { title: string; value: React.ReactNode; sub?: string; testId?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold" data-testid={testId}>
          {value}
        </div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Operations({ sellingMode }: { sellingMode: string }) {
  const admin = useAdmin();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [cod, setCod] = useState<any[]>([]);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    if (!admin.token) return;
    const [q, p] = await Promise.all([admin.json<{ currentSlot?: Slot; queue?: QueueRow[] }>("/api/v1/admin/queue"), admin.json<{ payments?: AdminPayment[] }>("/api/v1/admin/payments")]);
    if (q.ok) {
      setSlot(q.data.currentSlot ?? null);
      setQueue(q.data.queue ?? []);
    }
    if (p.ok) setPayments(p.data.payments ?? []);
    if (sellingMode === "ONLINE") {
      const c = await admin.json<{ codOrders?: any[] }>("/api/v1/admin/cod-orders");
      if (c.ok) setCod(c.data.codOrders ?? []);
    }
  }, [admin, sellingMode]);

  usePolling(refresh, 4000, Boolean(admin.token));

  // 1s tick so slot countdowns move between polls.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime: counter prompts and status changes.
  useEffect(() => {
    if (!admin.token) return;
    return admin.stream("/api/v1/admin/stream", (name, data) => {
      if (name === "counter_payment_requested") {
        try {
          const p = JSON.parse(data);
          toast(`🔔 Customer requested ${p.method === "CASH_COUNTER" ? "cash at till" : "card at POS"} ${p.amountPaise ? rupees(p.amountPaise) : ""} ${p.orderId ? `(Order #${p.orderId})` : ""}`);
        } catch {
          toast("🔔 In-store customer selected Cash/Card payment");
        }
        refresh();
      } else if (name === "status_change") refresh();
    });
  }, [admin.token, admin.stream, refresh]);

  const kpi = computeKpis(payments, queue.length);
  const counterPending = payments.filter((p) => p.status === "ACTIVE" && (p.method === "CASH_COUNTER" || p.method === "CARD_COUNTER"));
  const remaining = (iso?: string) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0);
  void tick;

  async function clearQueue() {
    if (!window.confirm("Clear the entire UPI waiting queue? All queued sessions will be expired.")) return;
    const r = await admin.send<{ clearedCount?: number; error?: string }>("POST", "/api/v1/admin/queue/clear");
    if (r.ok) {
      toast.success(`Queue cleared. Expired ${r.data.clearedCount || 0} sessions.`);
      refresh();
    } else toast.error(r.data.error || "Failed to clear queue");
  }

  async function approve(p: AdminPayment) {
    const r = await admin.send<{ error?: string }>("POST", "/api/v1/admin/counter-confirm", { paymentId: p.id, operatorId: "Cashier Desk #1", method: p.method });
    if (r.ok) {
      toast.success("Payment approved");
      refresh();
    } else toast.error(r.data.error || "Failed to approve payment");
  }
  async function decline(p: AdminPayment) {
    const reason = window.prompt("Reason for declining this counter payment:", "Payment note rejected at till");
    if (reason === null) return;
    const r = await admin.send<{ error?: string }>("POST", "/api/v1/admin/counter-decline", { paymentId: p.id, operatorId: "Cashier Desk #1", reason });
    if (r.ok) {
      toast.success("Payment declined");
      refresh();
    } else toast.error(r.data.error || "Failed to decline payment");
  }

  const shown = payments.filter((p) => !filter.trim() || [p.orderId, p.id, p.status, p.method, p.referenceCode].some((v) => String(v ?? "").toLowerCase().includes(filter.trim().toLowerCase())));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" data-testid="kpis">
        <Kpi
          title="Today's Volume"
          testId="kpi-volume"
          value={rupees(kpi.volume)}
          sub={kpi.observed > 0 ? `${rupees(kpi.volume - kpi.observed)} confirmed · ${rupees(kpi.observed)} observed (not yet bank-reconciled)` : undefined}
        />
        <Kpi title="Successful Today" testId="kpi-success" value={kpi.count} />
        <Kpi title="Queue" testId="kpi-queue" value={kpi.queue} />
        <Kpi title="Pending Counter" testId="kpi-pending" value={kpi.pendingCounter} />
        <Kpi title="Single Verified" testId="kpi-single" value={kpi.single} />
        <Kpi title="Dual Verified" testId="kpi-dual" value={kpi.dual} />
      </div>

      <Tabs defaultValue="live">
        <TabsList className="flex-wrap">
          <TabsTrigger value="live">Live monitor & slots</TabsTrigger>
          <TabsTrigger value="counter">{sellingMode === "ONLINE" ? "COD orders" : "Counter desk"}</TabsTrigger>
          <TabsTrigger value="ledger">Transactions ledger</TabsTrigger>
          <TabsTrigger value="observers">Payment observers</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active checkout</CardTitle>
              </CardHeader>
              <CardContent data-testid="slot-active">
                {slot && slot.status === "ACTIVE" ? (
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{rupees(slot.amountPaise)}</div>
                    <div className="font-medium">Order #{slot.orderId}</div>
                    <Badge variant="secondary">
                      ACTIVE · {String(Math.floor(remaining(slot.expiresAt) / 60)).padStart(2, "0")}:{String(remaining(slot.expiresAt) % 60).padStart(2, "0")} remaining
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No customer actively checking out.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">In verification</CardTitle>
              </CardHeader>
              <CardContent data-testid="slot-processing">
                {slot && slot.status === "PROCESSING" ? (
                  <div className="space-y-1">
                    <div className="text-2xl font-bold">{rupees(slot.amountPaise)}</div>
                    <div className="font-medium">Order #{slot.orderId}</div>
                    <Badge variant="outline">VERIFYING · {remaining(slot.processingExpiresAt)}s remaining</Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No payment in verification.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">UPI waiting queue</CardTitle>
                <CardDescription>Customers waiting for the single UPI slot.</CardDescription>
              </div>
              <Button variant="destructive" size="sm" onClick={clearQueue} disabled={queue.length === 0}>
                Clear queue
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Waiting queue is empty.
                      </TableCell>
                    </TableRow>
                  ) : (
                    queue.map((q) => (
                      <TableRow key={`${q.orderId}-${q.queuePosition}`}>
                        <TableCell className="font-semibold">#{q.queuePosition}</TableCell>
                        <TableCell>Order #{q.orderId}</TableCell>
                        <TableCell>{rupees(q.amountPaise)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">QUEUED</Badge>
                        </TableCell>
                        <TableCell>{new Date(q.createdAt).toLocaleTimeString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="counter">
          {sellingMode === "ONLINE" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cash on Delivery orders</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Placed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cod.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No Cash on Delivery orders placed yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      cod.map((o) => (
                        <TableRow key={o.paymentId}>
                          <TableCell className="font-medium">Order #{o.orderId}</TableCell>
                          <TableCell>
                            <code className="text-xs">{String(o.paymentId).slice(0, 16)}…</code>
                          </TableCell>
                          <TableCell className="font-semibold">{rupees(o.amountPaise)}</TableCell>
                          <TableCell>{o.customerName || "Customer"}</TableCell>
                          <TableCell>{o.customerPhone || "-"}</TableCell>
                          <TableCell>{new Date(o.placedAt).toLocaleTimeString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Counter desk (POS cashier)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {counterPending.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No pending counter payments right now.
                        </TableCell>
                      </TableRow>
                    ) : (
                      counterPending.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">Order #{p.orderId}</TableCell>
                          <TableCell>
                            <code className="text-xs">{p.id.slice(0, 16)}…</code>
                          </TableCell>
                          <TableCell className="font-semibold">{rupees(p.amountPaise)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{p.method === "CASH_COUNTER" ? "Cash at till" : "Card at POS"}</Badge>
                          </TableCell>
                          <TableCell>{new Date(p.createdAt).toLocaleTimeString()}</TableCell>
                          <TableCell className="space-x-2">
                            <Button size="sm" onClick={() => approve(p)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => decline(p)}>
                              Decline
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">Transactions ledger</CardTitle>
              <Input className="max-w-56" placeholder="Filter order / status…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table data-testid="ledger">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        No payments.
                      </TableCell>
                    </TableRow>
                  ) : (
                    shown.map((p) => {
                      const verified = ["SUCCESS", "OBSERVED_SUCCESS", "RECONCILED", "MANUAL_REVIEW"].includes(p.status);
                      const tag = p.verificationTag || ((p.verificationLevel ?? 0) >= 2 ? "Dual Verification" : "Single Verification");
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">Order #{p.orderId}</TableCell>
                          <TableCell>
                            <code className="text-xs">{p.id}</code>
                          </TableCell>
                          <TableCell>{rupees(p.amountPaise)}</TableCell>
                          <TableCell>{p.method}</TableCell>
                          <TableCell>
                            <StatusBadge status={p.status} />
                          </TableCell>
                          <TableCell>{verified ? <Badge variant={(p.verificationLevel ?? 0) >= 2 ? "default" : "secondary"}>{(p.verificationLevel ?? 0) >= 2 ? "✓✓" : "✓"} {tag}</Badge> : "-"}</TableCell>
                          <TableCell className="space-x-1">
                            {(p.verificationSources || []).length
                              ? (p.verificationSources || []).map((s) => (
                                  <code key={s} className="rounded border px-1 text-xs">
                                    {s === "GOOGLE_MESSAGES" ? "SMS" : s}
                                  </code>
                                ))
                              : "-"}
                          </TableCell>
                          <TableCell>{new Date(p.createdAt).toLocaleTimeString()}</TableCell>
                          <TableCell>{p.completedAt ? new Date(p.completedAt).toLocaleTimeString() : "-"}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="observers">
          <ObserversPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
