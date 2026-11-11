"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast, Toaster } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  HelpCircle,
  Loader2,
  LogOut,
  ShieldCheck,
  Smartphone,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CheckoutState, PaymentMethod } from "@/lib/checkout-types";
import { last10 } from "@/lib/customer-identity";
import { ensureDevice } from "@/lib/device-identity";
import {
  announceClose,
  buildUpiIntent,
  getFailedRedirectUrl,
  getStoreReturnUrl,
  isEmbedded,
  postToMerchant,
  resolveMerchantOrigin,
  sanitizeRedirectUrl,
} from "@/lib/merchant-bridge";
import { useCheckout } from "@/lib/use-checkout";
import { AuthGate } from "./auth-gate";
import { NameGate } from "./name-gate";

const UPI_APPS = [
  { name: "GPay", icon: "gpay.png" },
  { name: "PhonePe", icon: "phonepe.png" },
  { name: "Paytm", icon: "paytm.png" },
  { name: "CRED", icon: "cred.png" },
  { name: "BHIM", icon: "bhim.png" },
  { name: "Amazon Pay", icon: "amazonpay.png" },
];

function formatTime(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Counts down to `expiresAt` (or `fallbackSec` from now); re-anchors whenever the target changes. */
function useCountdown(expiresAt: string | undefined, fallbackSec: number | undefined, active: boolean, onExpire?: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const target = useRef<number | null>(null);
  const fired = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!active) {
      setRemaining(null);
      return;
    }
    let t: number | null = null;
    if (expiresAt) {
      const parsed = new Date(expiresAt).getTime();
      if (!Number.isNaN(parsed)) t = parsed;
    }
    if (t === null && fallbackSec !== undefined && fallbackSec !== null) t = Date.now() + Number(fallbackSec) * 1000;
    target.current = t;
    fired.current = false;
    const tick = () => {
      if (target.current === null) return setRemaining(null);
      const sec = Math.max(0, Math.ceil((target.current - Date.now()) / 1000));
      setRemaining(sec);
      if (sec <= 0 && !fired.current) {
        fired.current = true;
        expireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt, fallbackSec, active]);

  return remaining;
}

function applyBrandColor(color?: string) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color)
    ? ({ "--primary": color, "--primary-foreground": "#ffffff", "--ring": color } as React.CSSProperties)
    : undefined;
}

export default function CheckoutClient({ paymentId }: { paymentId: string }) {
  const c = useCheckout(paymentId);
  const { state, loaded, duplicate, signedIn, customer } = c;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const embedded = useMemo(() => (typeof window === "undefined" ? false : isEmbedded()), []);

  const status = state?.status ?? "";
  const branding = state?.branding ?? {};
  const appName = branding.appName || "YouPI PG";
  const sellingMode = state?.sellingMode || branding.sellingMode || "ONLINE";
  const enabled = (state?.enabledMethods || branding.enabledPaymentMethods || ["UPI"]) as PaymentMethod[];
  const methodOptions = useMemo(() => {
    const opts: { id: PaymentMethod; label: string }[] = [{ id: "UPI", label: "UPI QR" }];
    if (sellingMode === "ONLINE" && enabled.includes("COD")) opts.push({ id: "COD", label: "Cash on Delivery" });
    if (sellingMode === "OFFLINE" && enabled.includes("CASH_COUNTER")) opts.push({ id: "CASH_COUNTER", label: "Cash" });
    if (sellingMode === "OFFLINE" && enabled.includes("CARD_COUNTER")) opts.push({ id: "CARD_COUNTER", label: "Card" });
    return opts;
  }, [sellingMode, enabled]);

  useEffect(() => {
    if (state) document.title = `${state.merchantName || "Merchant Checkout"} · ${appName} Checkout`;
  }, [state, appName]);

  // Tell the storefront the iframe is ready.
  useEffect(() => {
    if (isEmbedded()) postToMerchant({ event: "youpi.modal_ready", paymentId });
  }, [paymentId]);

  // The storefront's close (X) button asks us to confirm cancellation first.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data.event !== "youpi.request_cancel") return;
      const origin = resolveMerchantOrigin();
      if (origin && e.origin !== origin) return;
      setCancelOpen(true);
      c.emitHook("CANCEL_CLICKED");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expire = useCallback(() => {
    c.post("expire").catch(() => {});
    setTimeout(c.loadState, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.post, c.loadState]);

  const isActiveLike = status === "ACTIVE"; // never run the expiry clock for INITIATED (no slot yet)
  const upiTimerRemaining = useCountdown(state?.expiresAt, state?.timeRemainingSeconds, isActiveLike && c.method === "UPI" && signedIn, () => {
    setProcessing(false);
    expire();
  });
  const codTimerRemaining = useCountdown(state?.expiresAt, state?.timeRemainingSeconds, isActiveLike && c.method === "COD" && signedIn, expire);
  const queueRemaining = useCountdown(state?.expiresAt, state?.timeRemainingSeconds, status === "QUEUED" && signedIn, c.loadState);
  const procRemaining = useCountdown(state?.expiresAt, state?.timeRemainingSeconds, status === "PROCESSING" && signedIn, c.loadState);

  // Hooks + merchant events on terminal transitions (once per status).
  useEffect(() => {
    if (!state) return;
    const s = state.status;
    if (s === "CANCELLED") c.emitHookOnce("CANCEL_CONFIRMED", { status: s });
    if (s === "FAILED" || s === "EXPIRED") c.emitHookOnce("PAYMENT_FAILED", { status: s });
    if (s === "MANUAL_REVIEW") postToMerchant({ event: "youpi.payment_manual_review", data: state });
    if (s === "SUCCESS" || s === "OBSERVED_SUCCESS" || s === "RECONCILED") {
      const isCod = state.method === "COD" || state.verificationTag === "COD_ORDER_PLACED";
      c.emitHookOnce("PAYMENT_COMPLETED", { amount: state.amount, method: state.method, isCod, status: s });
      const event = s === "OBSERVED_SUCCESS" ? "youpi.payment_observed" : s === "RECONCILED" ? "youpi.payment_reconciled" : "youpi.payment_success";
      postToMerchant({ event, data: state });
    }
    if (s === "BLOCKED" || state.isBanned || state.fraudDetected) {
      c.emitHookOnce("PAYMENT_BLOCKED", { status: "BLOCKED", reason: state.blockedNotice?.reason || "FRAUDULENT_PAYMENT_INJECTION", orderId: state.orderId });
      postToMerchant({ event: "youpi.payment_blocked", data: { status: "BLOCKED", isBanned: true, orderId: state.orderId, paymentId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.status]);

  useEffect(() => {
    if (status === "SUCCESS" || status === "OBSERVED_SUCCESS" || status === "RECONCILED") setProcessing(false);
    if (status === "FAILED" || status === "EXPIRED" || status === "CANCELLED") setProcessing(false);
  }, [status]);

  // Auto-redirect to the merchant store when the page is standalone (not embedded).
  const successReturn = sanitizeRedirectUrl(state?.returnUrl);
  useEffect(() => {
    if (!successReturn || embedded) return;
    if (!["SUCCESS", "OBSERVED_SUCCESS", "RECONCILED"].includes(status)) return;
    const t = setTimeout(() => {
      window.location.href = successReturn;
    }, 2000);
    return () => clearTimeout(t);
  }, [successReturn, embedded, status]);

  async function confirmCancel() {
    c.emitHook("CANCEL_CONFIRMED");
    setCancelling(true);
    try {
      await c.post("cancel");
    } catch {}
    setTimeout(() => {
      setCancelling(false);
      setCancelOpen(false);
      setProcessing(false);
      if (embedded) announceClose(getStoreReturnUrl(state));
      c.loadState();
    }, 500);
  }

  async function paymentDone() {
    setProcessing(true);
    c.emitHook("PAYMENT_DONE_CLICKED");
    try {
      const res = await c.post("payment-done");
      if (res.ok) c.loadState();
    } catch {}
  }

  async function confirmCod() {
    if (!window.confirm(`Confirm and place this Cash on Delivery order for ₹${state?.amount}? You will pay in cash upon delivery.`)) return;
    setBusy(true);
    try {
      const res = await c.post("confirm-cod");
      const data = await res.json().catch(() => ({}));
      if (res.ok) c.loadState();
      else toast.error(data.error || "Failed to place COD order");
    } catch {
      toast.error("Network error confirming COD order.");
    } finally {
      setBusy(false);
    }
  }

  function retryNewPayment() {
    if (embedded) {
      const redirectUrl = getFailedRedirectUrl(state, paymentId);
      const reason = state?.status || "FAILED";
      postToMerchant({
        event: "youpi.payment_failed",
        data: { orderId: state?.orderId, reason, paymentId, status: reason, redirectUrl },
        orderId: state?.orderId,
        reason,
        paymentId,
        status: reason,
        redirectUrl,
      });
      postToMerchant({ event: "youpi.modal_close", action: "payment_failed", redirectUrl });
    } else {
      window.location.href = getFailedRedirectUrl(state, paymentId);
    }
  }

  async function endAndRestart() {
    setBusy(true);
    try {
      const dev = await ensureDevice();
      const res = await c.post("end-and-restart-payment", {
        deviceId: dev.deviceId,
        deviceToken: dev.deviceToken,
        conflictingSessionId: (duplicate?.conflicting_session_id as string) || state?.conflictingSession?.id || null,
      });
      const data = await res.json();
      if (data.success && (data.checkoutUrl || data.newSessionId)) {
        window.location.href = data.checkoutUrl || `/checkout/${data.newSessionId}`;
      } else {
        toast.error(data.error || "Failed to start new payment session. Please try again.");
      }
    } catch {
      toast.error("Network error while starting new payment session.");
    } finally {
      setBusy(false);
    }
  }

  async function retrySameSession() {
    setBusy(true);
    try {
      const res = await c.post("retry-new-payment");
      if (res.ok) await c.loadState();
      else toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to retry payment");
    } catch {
      toast.error("Network error while retrying payment");
    } finally {
      setBusy(false);
    }
  }

  function openUpiIntent() {
    const uri = buildUpiIntent(state, paymentId, c.guest ? c.guestName : undefined);
    if (uri) window.location.assign(uri);
  }

  function onUpiAppClick(name: string) {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 767;
    if (mobile) return openUpiIntent();
    toast(`Scan the QR with ${name} on your phone to pay ₹${state?.amount ?? ""}`);
  }

  // ---------- render ----------
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-muted/40" style={applyBrandColor(branding.primaryColor)}>
      <Toaster position="top-center" richColors />
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-3 sm:p-6">{children}</div>
    </div>
  );

  if (!loaded && !duplicate) {
    return shell(
      <Card>
        <CardContent className="space-y-3 p-6" data-testid="checkout-loading">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>,
    );
  }

  if (duplicate) {
    return shell(
      <Card data-testid="view-duplicate">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> Device Security Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {String(duplicate.message || "This payment session cannot be continued from this device. For security, start a new payment.")}
          </p>
          <Button onClick={endAndRestart} disabled={busy} className="w-full">
            {busy ? "Creating new payment…" : "End session & start new payment"}
          </Button>
        </CardContent>
      </Card>,
    );
  }

  if (!state) {
    return shell(
      <Alert variant="destructive" data-testid="checkout-not-found">
        <AlertTriangle className="size-4" />
        <AlertTitle>Payment not found</AlertTitle>
        <AlertDescription>This checkout link is invalid or the payment session no longer exists.</AlertDescription>
      </Alert>,
    );
  }

  const tier = state.upiServerIndicator?.tier || (state.upiServerIndicator?.status === "WORKING" ? "GREEN" : state.upiServerIndicator?.status === "BUSY" ? "YELLOW" : state.upiServerIndicator ? "RED" : "GREEN");
  const healthLabel = state.upiServerIndicator?.label || (tier === "GREEN" ? "Server is working" : tier === "YELLOW" ? "UPI server busy" : "Server facing issues");
  const healthColor = tier === "GREEN" ? "bg-emerald-500" : tier === "YELLOW" ? "bg-amber-500" : "bg-red-500";
  const isTerminal = ["SUCCESS", "OBSERVED_SUCCESS", "RECONCILED", "MANUAL_REVIEW", "CANCELLED", "EXPIRED", "FAILED"].includes(status);
  const blocked = status === "BLOCKED" || state.isBanned || state.fraudDetected;
  const up = state.uniquePaise;
  const refCode = typeof state.referenceCode === "string" ? state.referenceCode : "";
  const cashAltAvailable = state.upiServerIndicator?.recommendedAlternative === "CASH";

  const header = (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logoUrl} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
            {(state.merchantName || "M").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold" data-testid="merchant-name">
            {state.merchantName || "Merchant Checkout"}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {!branding.hideTrustBadge && (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5" /> {branding.trustBadgeText || `${appName} Verified Business`}
              </span>
            )}
            {!branding.hideSubbanner && <span>{branding.subbannerText || branding.sidebarNotice || `Verified & protected by ${appName}`}</span>}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs" data-testid="server-health">
          <span className={`size-2 rounded-full ${healthColor}`} /> {healthLabel}
        </span>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Amount</div>
          <div className="text-xl font-bold" data-testid="amount">
            ₹{state.amount}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const orderSummary = (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Order summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Row label="Order" value={`#${state.orderId ?? state.id}`} />
        <Row label="Total" value={`₹${state.amount}`} bold />
        {refCode && !c.guest && (
          <div className="pt-1 text-xs text-muted-foreground" data-testid="reference-code">
            Order code: <b className="select-all text-foreground">{refCode}</b>
            <div>Add this as the payment note/comment in your UPI app so we can match your payment.</div>
          </div>
        )}
        {up && Number(up.offsetPaise) > 0 && (
          <div className="pt-1 text-xs text-muted-foreground" data-testid="unique-paise-note">
            Pay exactly ₹{state.amount} (₹{up.baseAmount} + {up.offsetPaise} paise to identify your payment).
          </div>
        )}
      </CardContent>
    </Card>
  );

  const accountBar = signedIn && customer && (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <User className="size-3.5" />
        Using as {customer.fullName || customer.name || "Customer"}
        {last10(customer.mobileNumber || customer.phoneNumber || customer.phone) ? ` (+91 ${last10(customer.mobileNumber || customer.phoneNumber || customer.phone)})` : ""}
      </span>
      <span className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)}>
          <HelpCircle className="size-3.5" /> Help
        </Button>
        <Button size="sm" variant="ghost" onClick={c.signOut}>
          <LogOut className="size-3.5" /> Sign out
        </Button>
      </span>
    </div>
  );

  let body: React.ReactNode = null;

  if (state.hasActiveSessionConflict) {
    body = (
      <Card data-testid="view-conflict">
        <CardHeader>
          <CardTitle>Active payment session found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You already have an active payment session
            {state.conflictingSession ? ` (#${state.conflictingSession.orderId || state.conflictingSession.id.slice(0, 8)}) for ₹${state.conflictingSession.amount}` : ""}. For
            security, only one active payment session is allowed per customer.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {state.conflictingSession?.id && (
              <Button variant="outline" onClick={() => (window.location.href = `/checkout/${state.conflictingSession!.id}`)}>
                Continue existing payment
              </Button>
            )}
            <Button onClick={retrySameSession} disabled={busy}>
              End session & start new payment
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else if (isTerminal) {
    body = <TerminalView state={state} appName={appName} hidePoweredBy={branding.hidePoweredBy} embedded={embedded} onRetry={retryNewPayment} paymentId={paymentId} />;
  } else if (!signedIn && c.guest) {
    body = (
      <Card data-testid="name-gate">
        <CardContent className="p-5">
          <NameGate onSubmit={c.setGuestName} />
        </CardContent>
      </Card>
    );
  } else if (!signedIn) {
    body = (
      <Card>
        <CardContent className="p-5">
          <AuthGate onSignedIn={c.completeSignIn} />
        </CardContent>
      </Card>
    );
  } else if (blocked) {
    body = (
      <Card className="border-destructive" data-testid="view-blocked">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" /> {state.blockedNotice?.title || "Security Incident Investigation"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{state.blockedNotice?.subtitle || "This payment session has been blocked."}</p>
          <p className="text-muted-foreground">
            {state.blockedNotice?.message || "Our security systems flagged this session. Please contact the merchant for assistance."}
          </p>
          <div className="rounded-md border p-3 text-xs">
            <Row label="Order" value={`#${state.orderId ?? "N/A"}`} />
            <Row label="Session" value={String(state.id || paymentId)} />
            <Row label="Time" value={new Date().toLocaleTimeString()} />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (window.parent !== window) postToMerchant({ event: "youpi.payment_blocked_exit", data: { status: "BLOCKED", isBanned: true, orderId: state.orderId } });
              window.location.href = getFailedRedirectUrl(state, paymentId);
            }}
          >
            Exit
          </Button>
        </CardContent>
      </Card>
    );
  } else if (status === "QUEUED") {
    body = (
      <Card data-testid="view-queued">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Clock className="size-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Another customer is paying right now. You are in the queue.</div>
          <div className="text-4xl font-bold" data-testid="queue-position">
            #{state.queuePosition || 1}
          </div>
          <div className="text-sm">Estimated wait {queueRemaining !== null ? formatTime(queueRemaining) : "…"}</div>
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            Leave queue
          </Button>
        </CardContent>
      </Card>
    );
  } else if (status === "PROCESSING") {
    body = (
      <Card data-testid="view-processing">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="size-8 animate-spin" />
          <div className="font-semibold">Verifying your payment</div>
          <div className="text-sm text-muted-foreground">This will only take a few seconds. {procRemaining !== null ? `${procRemaining}s` : ""}</div>
        </CardContent>
      </Card>
    );
  } else {
    // ACTIVE / INITIATED: choose method.
    body = (
      <div className="space-y-4" data-testid="view-methods">
        {tier !== "GREEN" && (
          <Alert variant={tier === "RED" ? "destructive" : "default"} data-testid="downtime-alert">
            <AlertTriangle className="size-4" />
            <AlertTitle>{tier === "YELLOW" ? "UPI server busy" : "UPI server facing issues"}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {state.upiServerIndicator?.warning ||
                  (tier === "YELLOW"
                    ? "Your payment may take a few extra seconds."
                    : "It is not recommended to pay by UPI right now as the server is facing downtime. We recommend paying by cash instead.")}
              </p>
              {cashAltAvailable && methodOptions.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => c.selectMethod(methodOptions.find((m) => m.id !== "UPI")!.id)}>
                  {sellingMode === "ONLINE" ? "Pay via Cash on Delivery instead" : "Pay by cash at till instead"}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {methodOptions.length > 1 && (
          <Tabs value={c.method} onValueChange={(v) => c.selectMethod(v as PaymentMethod)}>
            <TabsList className="w-full">
              {methodOptions.map((m) => (
                <TabsTrigger key={m.id} value={m.id} data-testid={`tab-${m.id}`}>
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {c.method === "UPI" && (
          <Card data-testid="view-upi">
            <CardContent className="flex flex-col items-center gap-4 p-6">
              <div className="rounded-xl border bg-white p-3" data-testid="upi-qr">
                <QRCodeSVG value={buildUpiIntent(state, paymentId, c.guest ? c.guestName : undefined) || "upi://pay"} size={220} marginSize={1} />
              </div>
              <div className="text-sm text-muted-foreground">Scan with any UPI app</div>
              <div className="flex items-center gap-2 text-lg font-semibold" data-testid="upi-timer">
                <Clock className="size-4" /> {upiTimerRemaining !== null ? (upiTimerRemaining <= 0 ? "Expired" : formatTime(upiTimerRemaining)) : "--:--"}
              </div>
              <Button size="lg" className="w-full" onClick={openUpiIntent} data-testid="btn-open-upi-app">
                <Smartphone className="size-4" /> Pay with any UPI app (opens GPay, PhonePe, Paytm…)
              </Button>
              <div className="flex flex-wrap justify-center gap-3">
                {UPI_APPS.map((a) => (
                  <button key={a.name} type="button" className="flex flex-col items-center gap-1 text-xs" onClick={() => onUpiAppClick(a.name)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/icons/${a.icon}`} alt={a.name} className="size-9 rounded-md object-contain" />
                    {a.name}
                  </button>
                ))}
              </div>
              {upiTimerRemaining !== null && upiTimerRemaining <= 240 && upiTimerRemaining > 0 && (
                <Button className="w-full" onClick={paymentDone} disabled={processing} data-testid="btn-payment-done">
                  {processing ? "Checking…" : "I have paid — check my payment"}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel payment
              </Button>
            </CardContent>
          </Card>
        )}

        {c.method === "COD" && (
          <Card data-testid="view-cod">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 font-semibold">
                <Truck className="size-5" /> Cash on Delivery
              </div>
              <p className="text-sm text-muted-foreground">Place your order now and pay ₹{state.amount} in cash when it is delivered.</p>
              <div className="text-sm">
                Time left to confirm: <b>{codTimerRemaining !== null ? (codTimerRemaining <= 0 ? "Expired" : formatTime(codTimerRemaining)) : "--:--"}</b>
              </div>
              <Button className="w-full" onClick={confirmCod} disabled={busy} data-testid="btn-confirm-cod">
                {busy ? "Placing order…" : `Confirm & place COD order (₹${state.amount})`}
              </Button>
            </CardContent>
          </Card>
        )}

        {(c.method === "CASH_COUNTER" || c.method === "CARD_COUNTER") && (
          <Card data-testid="view-counter">
            <CardContent className="space-y-4 p-6 text-center">
              {c.method === "CASH_COUNTER" ? <Banknote className="mx-auto size-8" /> : <CreditCard className="mx-auto size-8" />}
              <div className="font-semibold">{c.method === "CASH_COUNTER" ? "Pay cash at the counter" : "Pay by card at the counter"}</div>
              <p className="text-sm text-muted-foreground">
                {c.method === "CASH_COUNTER"
                  ? branding.counterInstructions || "Please visit the billing counter and present this screen to the cashier."
                  : branding.cardCounterInstructions || branding.counterInstructions || "Please visit the billing counter and present this screen to the cashier."}
              </p>
              <div className="text-2xl font-bold">#{state.orderId}</div>
              <div className="text-sm text-muted-foreground">Waiting for the cashier to confirm your payment…</div>
              <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return shell(
    <>
      {header}
      {accountBar}
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div>{body}</div>
        <div className="space-y-4">{orderSummary}</div>
      </div>
      <p className="pt-2 text-center text-xs text-muted-foreground">
        {branding.footerGuarantee || (branding.hidePoweredBy ? "Secured by 256-bit bank encryption" : `Secured by ${appName} & 256-bit bank encryption`)}
        {branding.privacyPolicyUrl && sanitizeRedirectUrl(branding.privacyPolicyUrl) ? (
          <>
            {" · "}
            <a className="underline" href={sanitizeRedirectUrl(branding.privacyPolicyUrl)!} target="_blank" rel="noreferrer">
              Privacy
            </a>
          </>
        ) : null}
        {branding.termsUrl && sanitizeRedirectUrl(branding.termsUrl) ? (
          <>
            {" · "}
            <a className="underline" href={sanitizeRedirectUrl(branding.termsUrl)!} target="_blank" rel="noreferrer">
              Terms
            </a>
          </>
        ) : null}
      </p>

      <Dialog open={cancelOpen} onOpenChange={(o) => !cancelling && setCancelOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel payment?</DialogTitle>
            <DialogDescription>
              Your order with {state.merchantName || "the merchant"} will not be completed if you cancel now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep paying
            </Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelling} data-testid="btn-confirm-cancel">
              {cancelling ? "Cancelling…" : "Yes, cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{appName} Help & Support</DialogTitle>
            <DialogDescription>Quote these details if you contact the merchant.</DialogDescription>
          </DialogHeader>
          <HelpBody state={state} paymentId={paymentId} />
        </DialogContent>
      </Dialog>
    </>,
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

function HelpBody({ state, paymentId }: { state: CheckoutState; paymentId: string }) {
  const b = state.branding || {};
  const emails = b.supportEmails || (b.supportEmail ? [b.supportEmail] : []);
  const phones = b.supportMobiles || (b.supportMobile ? [b.supportMobile] : []);
  const caseInfo = `PAYMENT_ID: ${paymentId}\nORDER_ID: ${state.orderId || "N/A"}\nAMOUNT: ₹${state.amount || "N/A"}\nSTATUS: ${state.status || "N/A"}`;
  return (
    <div className="space-y-3 text-sm">
      {emails.length > 0 && (
        <div>
          <b>Email:</b> {emails.join(", ")}
        </div>
      )}
      {phones.length > 0 && (
        <div>
          <b>Phone:</b> {phones.join(", ")}
        </div>
      )}
      <Separator />
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{caseInfo}</pre>
      <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(caseInfo).then(() => toast.success("Copied"))}>
        Copy case info
      </Button>
    </div>
  );
}

function TerminalView({
  state,
  appName,
  hidePoweredBy,
  embedded,
  onRetry,
  paymentId,
}: {
  state: CheckoutState;
  appName: string;
  hidePoweredBy?: boolean;
  embedded: boolean;
  onRetry: () => void;
  paymentId: string;
}) {
  const s = state.status;
  const success = s === "SUCCESS" || s === "OBSERVED_SUCCESS" || s === "RECONCILED";

  if (success) {
    const isCod = state.method === "COD" || state.verificationTag === "COD_ORDER_PLACED";
    const title = isCod
      ? "Order placed (Cash on Delivery)!"
      : s === "OBSERVED_SUCCESS"
        ? "Payment observed"
        : s === "RECONCILED"
          ? "Payment reconciled"
          : "Payment successful!";
    const desc = isCod
      ? `Your order #${state.orderId} was confirmed. Please keep ₹${state.amount} in cash ready for the courier on arrival.`
      : s === "OBSERVED_SUCCESS"
        ? "A bank alert matched this payment. It is not confirmed against a bank statement yet."
        : s === "RECONCILED"
          ? "This payment was matched to a bank statement."
          : hidePoweredBy
            ? "Your payment was automatically verified by banking observers."
            : `Your payment was automatically verified by ${appName} banking observers.`;
    const ret = sanitizeRedirectUrl(state.returnUrl);
    return (
      <Card data-testid="view-success">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="size-12 text-emerald-500" />
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-3xl font-bold">₹{state.amount}</div>
          <p className="text-sm text-muted-foreground">
            {desc}
            {ret && !embedded ? " Redirecting to the merchant store…" : ""}
          </p>
          {ret && (
            <Button onClick={() => (window.location.href = ret)}>
              Return to store
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const cfg =
    s === "CANCELLED"
      ? { title: "Payment cancelled", desc: "You cancelled this payment session. Click below to return to the store.", action: "Back to store" }
      : s === "EXPIRED"
        ? { title: "Payment session expired", desc: "The 5-minute active payment window elapsed before verification was completed. Please return to the store and start a new order.", action: "Start new payment" }
        : s === "MANUAL_REVIEW"
          ? { title: "Payment held for review", desc: "This alert matched more than one payment, or it was flagged. It is not confirmed and no order should be fulfilled yet.", action: "" }
          : { title: "Payment not confirmed", desc: "No matching UPI bank confirmation was detected during the verification window.", action: "Try again" };

  const onAction = () => {
    if (s === "CANCELLED") {
      const store = getStoreReturnUrl(state);
      if (embedded) announceClose(store);
      else if (sanitizeRedirectUrl(store)) window.location.href = sanitizeRedirectUrl(store)!;
      else window.history.back();
      return;
    }
    onRetry();
  };

  return (
    <Card data-testid="view-failed">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        {s === "MANUAL_REVIEW" ? <AlertTriangle className="size-12 text-amber-500" /> : <XCircle className="size-12 text-destructive" />}
        <div className="text-xl font-semibold">{cfg.title}</div>
        <p className="text-sm text-muted-foreground">{cfg.desc}</p>
        <Badge variant="outline">{s}</Badge>
        <span className="sr-only">{paymentId}</span>
        {cfg.action && <Button onClick={onAction}>{cfg.action}</Button>}
      </CardContent>
    </Card>
  );
}
