"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAdmin } from "@/lib/admin-api";

interface UpiAccount {
  id: string;
  upiId: string;
  payeeName: string;
  isActive: boolean;
  isSlotBusy?: boolean;
  createdAt: string;
}

type Branding = Record<string, any>;
interface Merchant {
  merchantId?: string;
  publishableKey?: string;
  merchantKey?: string;
  businessName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  sellingMode?: string;
  codEnabled?: boolean;
  cashEnabled?: boolean;
  cardEnabled?: boolean;
  supportEmails?: string[];
  supportMobiles?: string[];
  privacyPolicyUrl?: string;
  envMode?: string;
  domainPrefix?: string;
  domainTld?: string;
  customDomain?: string;
  branding?: Branding;
  [k: string]: any;
}

export function useMerchantSettings() {
  const admin = useAdmin();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const reload = useCallback(async () => {
    if (!admin.token) return;
    const r = await admin.json<Merchant>("/api/v1/admin/merchant-settings");
    if (r.ok) setMerchant(r.data);
  }, [admin]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { merchant, reload };
}

const csv = (v?: string[] | string) => (Array.isArray(v) ? v.join(", ") : v || "");
const splitList = (v: string) => v.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);

export function StoreSettings({ merchant, reload }: { merchant: Merchant | null; reload: () => void }) {
  const admin = useAdmin();
  const [accounts, setAccounts] = useState<UpiAccount[]>([]);
  const [active, setActive] = useState<{ upiId?: string; payeeName?: string; isActive?: boolean } | null>(null);
  const [newVpa, setNewVpa] = useState("");
  const [newPayee, setNewPayee] = useState("");
  const [activateNow, setActivateNow] = useState(true);

  const [form, setForm] = useState({
    businessName: "",
    appName: "",
    logoUrl: "",
    primaryColor: "#0b63e5",
    trustBadgeText: "",
    hideTrustBadge: false,
    subbannerText: "",
    hideSubbanner: false,
    hideTimeSavingBanner: false,
    hidePoweredBy: false,
    sidebarNotice: "",
    footerGuarantee: "",
    counterInstructions: "",
    cardCounterInstructions: "",
    supportEmails: "",
    supportMobiles: "",
    privacyPolicyUrl: "",
    termsUrl: "",
    webhookUrl: "",
    sellingMode: "ONLINE",
    cod: false,
    cash: true,
    card: true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!merchant) return;
    const b = merchant.branding || {};
    setForm({
      businessName: merchant.businessName || "",
      appName: b.appName || "",
      logoUrl: b.logoUrl || "",
      primaryColor: b.primaryColor || "#0b63e5",
      trustBadgeText: b.trustBadgeText || "",
      hideTrustBadge: Boolean(b.hideTrustBadge),
      subbannerText: b.subbannerText || "",
      hideSubbanner: Boolean(b.hideSubbanner),
      hideTimeSavingBanner: Boolean(b.hideTimeSavingBanner),
      hidePoweredBy: Boolean(b.hidePoweredBy),
      sidebarNotice: b.sidebarNotice || "",
      footerGuarantee: b.footerGuarantee || "",
      counterInstructions: b.counterInstructions || "",
      cardCounterInstructions: b.cardCounterInstructions || "",
      supportEmails: csv(merchant.supportEmails || b.supportEmails),
      supportMobiles: csv(merchant.supportMobiles || b.supportMobiles),
      privacyPolicyUrl: merchant.privacyPolicyUrl || b.privacyPolicyUrl || "",
      termsUrl: b.termsUrl || "",
      webhookUrl: merchant.webhookUrl || "",
      sellingMode: merchant.sellingMode || b.sellingMode || "ONLINE",
      cod: merchant.codEnabled ?? b.codEnabled ?? Boolean(b.enabledPaymentMethods?.includes("COD")),
      cash: merchant.cashEnabled ?? b.cashEnabled ?? true,
      card: merchant.cardEnabled ?? b.cardEnabled ?? true,
    });
  }, [merchant]);

  const loadUpi = useCallback(async () => {
    if (!admin.token) return;
    const r = await admin.json<{ accounts?: UpiAccount[]; upiId?: string; payeeName?: string; isActive?: boolean }>("/api/v1/admin/upi-settings");
    if (r.ok) {
      setAccounts(r.data.accounts ?? []);
      setActive(r.data);
    }
  }, [admin]);
  useEffect(() => {
    loadUpi();
  }, [loadUpi]);

  async function save() {
    const enabled = ["UPI"];
    if (form.sellingMode === "ONLINE") {
      if (form.cod) enabled.push("COD");
    } else {
      if (form.cash) enabled.push("CASH_COUNTER");
      if (form.card) enabled.push("CARD_COUNTER");
    }
    const supportEmails = splitList(form.supportEmails);
    const supportMobiles = splitList(form.supportMobiles);
    const nz = (s: string) => s.trim() || null;
    // Environment / domain fields are preserved from the server copy: they are edited in the
    // Cloudflare tunnel panel, not here.
    const env = {
      envMode: merchant?.envMode,
      domainPrefix: merchant?.domainPrefix,
      domainTld: merchant?.domainTld,
      customDomain: merchant?.customDomain,
    };
    const r = await admin.send<{ error?: string }>("POST", "/api/v1/admin/merchant-settings", {
      merchantId: merchant?.merchantId,
      businessName: form.businessName.trim(),
      webhookUrl: form.webhookUrl.trim(),
      supportEmails,
      supportMobiles,
      privacyPolicyUrl: nz(form.privacyPolicyUrl),
      termsUrl: nz(form.termsUrl),
      sellingMode: form.sellingMode,
      enabledPaymentMethods: enabled,
      codEnabled: form.cod,
      cashEnabled: form.cash,
      cardEnabled: form.card,
      ...env,
      branding: {
        ...(merchant?.branding || {}),
        appName: form.appName.trim() || "YOUPI PG",
        logoUrl: nz(form.logoUrl),
        primaryColor: form.primaryColor,
        trustBadgeText: nz(form.trustBadgeText),
        hideTrustBadge: form.hideTrustBadge,
        subbannerText: nz(form.subbannerText),
        hideSubbanner: form.hideSubbanner,
        hideTimeSavingBanner: form.hideTimeSavingBanner,
        hidePoweredBy: form.hidePoweredBy,
        sidebarNotice: nz(form.sidebarNotice),
        footerGuarantee: nz(form.footerGuarantee),
        counterInstructions: nz(form.counterInstructions),
        cardCounterInstructions: nz(form.cardCounterInstructions),
        termsUrl: nz(form.termsUrl),
        sellingMode: form.sellingMode,
        enabledPaymentMethods: enabled,
        codEnabled: form.cod,
        cashEnabled: form.cash,
        cardEnabled: form.card,
        supportEmails,
        supportMobiles,
        privacyPolicyUrl: nz(form.privacyPolicyUrl),
      },
    });
    if (r.ok) {
      toast.success("Store settings saved. Live on checkout.");
      reload();
    } else toast.error(r.data.error || "Failed to save merchant settings");
  }

  async function addVpa() {
    if (!newVpa.trim()) return toast.error("Enter a valid UPI VPA");
    const r = await admin.send<{ error?: string; account?: UpiAccount }>("POST", "/api/v1/admin/upi-accounts", {
      upiId: newVpa.trim(),
      payeeName: newPayee.trim() || form.businessName,
      isActive: activateNow,
    });
    if (r.ok) {
      toast.success(`UPI account "${r.data.account?.upiId}" added`);
      setNewVpa("");
      setNewPayee("");
      loadUpi();
    } else toast.error(r.data.error || "Failed to add UPI account");
  }
  async function vpaAction(kind: "activate" | "toggle", id: string) {
    const r = await admin.send<{ error?: string }>("POST", `/api/v1/admin/upi-accounts/${id}/${kind}`);
    if (r.ok) loadUpi();
    else toast.error(r.data.error || "Action failed");
  }
  async function deleteVpa(a: UpiAccount) {
    if (!window.confirm(`Delete VPA "${a.upiId}"?`)) return;
    const r = await admin.send("DELETE", `/api/v1/admin/upi-accounts/${a.id}`);
    if (r.ok) {
      toast.success(`VPA "${a.upiId}" deleted`);
      loadUpi();
    }
  }

  const field = (id: keyof typeof form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${id}`}>{label}</Label>
      <Input id={`f-${id}`} value={String(form[id])} onChange={(e) => set(id, e.target.value as never)} {...props} />
    </div>
  );
  const toggle = (id: "hideTrustBadge" | "hideSubbanner" | "hideTimeSavingBanner" | "hidePoweredBy" | "cod" | "cash" | "card", label: string) => (
    <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
      {label}
      <Switch checked={form[id]} onCheckedChange={(v) => set(id, v as never)} />
    </label>
  );

  return (
    <Tabs defaultValue="brand">
      <TabsList className="flex-wrap">
        <TabsTrigger value="brand">Brand identity</TabsTrigger>
        <TabsTrigger value="vpa">Receiving accounts (VPAs)</TabsTrigger>
        <TabsTrigger value="modes">Selling modes</TabsTrigger>
      </TabsList>

      <TabsContent value="brand" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brand identity</CardTitle>
            <CardDescription>Shown to customers on the checkout page.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {field("businessName", "Business name")}
            {field("appName", "App / brand name")}
            {field("logoUrl", "Logo URL")}
            <div className="space-y-1.5">
              <Label htmlFor="f-primaryColor">Primary colour</Label>
              <div className="flex gap-2">
                <input aria-label="Colour picker" type="color" className="h-9 w-12 rounded border" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
                <Input id="f-primaryColor" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
              </div>
            </div>
            {field("trustBadgeText", "Trust badge text")}
            {field("subbannerText", "Sub-banner text")}
            {field("sidebarNotice", "Sidebar notice")}
            {field("footerGuarantee", "Footer guarantee")}
            {field("privacyPolicyUrl", "Privacy policy URL")}
            {field("termsUrl", "Terms URL")}
            {field("supportEmails", "Support emails (comma separated)")}
            {field("supportMobiles", "Support mobiles (comma separated)")}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="f-counter">Cash counter instructions</Label>
              <Textarea id="f-counter" value={form.counterInstructions} onChange={(e) => set("counterInstructions", e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="f-cardcounter">Card counter instructions</Label>
              <Textarea id="f-cardcounter" value={form.cardCounterInstructions} onChange={(e) => set("cardCounterInstructions", e.target.value)} />
            </div>
            <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
              {toggle("hideTrustBadge", "Hide trust badge")}
              {toggle("hideSubbanner", "Hide sub-banner")}
              {toggle("hideTimeSavingBanner", "Hide time-saving banner")}
              {toggle("hidePoweredBy", "Hide “powered by”")}
            </div>
          </CardContent>
        </Card>
        <Button onClick={save} data-testid="save-settings">
          Save brand & settings
        </Button>
      </TabsContent>

      <TabsContent value="vpa" className="space-y-4">
        <Card>
          <CardContent className="p-4" data-testid="active-vpa">
            <div className="text-xs text-muted-foreground">Active gateway VPA</div>
            <div className="text-lg font-semibold">{active?.isActive && active.upiId ? active.upiId : "No VPA currently active"}</div>
            <div className="text-sm text-muted-foreground">{active?.isActive ? `Payee: ${active.payeeName || "Store"}` : "Add or activate a VPA below to accept payments"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a UPI account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-vpa">UPI ID</Label>
              <Input id="new-vpa" placeholder="name@bank" value={newVpa} onChange={(e) => setNewVpa(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-payee">Payee name</Label>
              <Input id="new-payee" value={newPayee} onChange={(e) => setNewPayee(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={activateNow} onCheckedChange={setActivateNow} /> Activate now
            </label>
            <Button onClick={addVpa}>Add VPA</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>UPI ID</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No UPI accounts saved yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.upiId}</TableCell>
                      <TableCell>{a.payeeName}</TableCell>
                      <TableCell>{a.isActive ? <Badge>● ACTIVE</Badge> : <Badge variant="outline">Disabled</Badge>}</TableCell>
                      <TableCell>{a.isSlotBusy ? <Badge variant="secondary">Slot busy</Badge> : <span className="text-xs text-muted-foreground">Available</span>}</TableCell>
                      <TableCell className="text-xs">{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap">
                        {a.isActive ? (
                          <Button size="sm" variant="outline" onClick={() => vpaAction("toggle", a.id)}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => vpaAction("activate", a.id)}>
                            Activate
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => deleteVpa(a)}>
                          Delete
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

      <TabsContent value="modes" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Selling mode</CardTitle>
            <CardDescription>Online stores can offer Cash on Delivery; in-store (offline) mode offers cash and card at the counter.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button variant={form.sellingMode === "ONLINE" ? "default" : "outline"} onClick={() => set("sellingMode", "ONLINE")}>
                Online store
              </Button>
              <Button variant={form.sellingMode === "OFFLINE" ? "default" : "outline"} onClick={() => set("sellingMode", "OFFLINE")}>
                Offline / in-store
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {form.sellingMode === "ONLINE" ? (
                toggle("cod", "Enable Cash on Delivery")
              ) : (
                <>
                  {toggle("cash", "Enable cash at till")}
                  {toggle("card", "Enable card at POS")}
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <Button onClick={save}>Save selling modes</Button>
      </TabsContent>
    </Tabs>
  );
}
