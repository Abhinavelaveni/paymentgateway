"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { KeyRound, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminProvider, useAdmin } from "@/lib/admin-api";
import { DeveloperHub } from "./developer-hub";
import { Operations } from "./operations";
import { Security } from "./security";
import { StoreSettings, useMerchantSettings } from "./store-settings";

const THEME_KEY = "youpi-theme";

function TokenDialog() {
  const admin = useAdmin();
  const [value, setValue] = useState("");
  return (
    <Dialog open={admin.needsToken} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} data-testid="token-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Admin token required
          </DialogTitle>
          <DialogDescription>
            {admin.rejected
              ? "That token was rejected. Enter the admin API token again."
              : "Enter the admin API token (ADMIN_API_TOKEN, or the contents of data/.secrets/admin_api_token on the server). It is kept for this browser tab only."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) {
              admin.setToken(value);
              setValue("");
            }
          }}
        >
          <Input type="password" autoComplete="off" autoFocus placeholder="Admin token" value={value} onChange={(e) => setValue(e.target.value)} />
          <DialogFooter>
            <Button type="submit" className="w-full">
              Unlock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Dashboard() {
  const admin = useAdmin();
  const { merchant, reload } = useMerchantSettings();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      const isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDark(isDark);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const sellingMode = merchant?.sellingMode || merchant?.branding?.sellingMode || "ONLINE";
  const hashTab = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const initial = ["operations", "storeSettings", "developerHub", "security"].includes(hashTab) ? hashTab : "operations";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-right" richColors />
      <TokenDialog />
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 p-4">
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{merchant?.branding?.appName || "YOUPI PG"} · Merchant admin</h1>
            <p className="text-xs text-muted-foreground">{merchant?.businessName || "Default store"}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => {
            const next = !dark;
            setDark(next);
            try {
              localStorage.setItem(THEME_KEY, next ? "dark" : "light");
            } catch {}
          }}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          {admin.token && (
            <Button variant="outline" size="sm" onClick={admin.signOut}>
              Lock
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        {admin.token ? (
          <Tabs defaultValue={initial} onValueChange={(v) => { try { history.replaceState(null, "", `#${v}`); } catch {} }}>
            <TabsList className="mb-4 flex-wrap">
              <TabsTrigger value="operations">Operations</TabsTrigger>
              <TabsTrigger value="storeSettings">Store settings</TabsTrigger>
              <TabsTrigger value="developerHub">Developer hub</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
            </TabsList>
            <TabsContent value="operations">
              <Operations sellingMode={sellingMode} />
            </TabsContent>
            <TabsContent value="storeSettings">
              <StoreSettings merchant={merchant} reload={reload} />
            </TabsContent>
            <TabsContent value="developerHub">
              <DeveloperHub merchant={merchant} reload={reload} />
            </TabsContent>
            <TabsContent value="security">
              <Security />
            </TabsContent>
          </Tabs>
        ) : (
          <p className="py-20 text-center text-sm text-muted-foreground">Locked. Enter the admin token to continue.</p>
        )}
      </main>
    </div>
  );
}

export default function AdminShell() {
  return (
    <AdminProvider>
      <Dashboard />
    </AdminProvider>
  );
}
