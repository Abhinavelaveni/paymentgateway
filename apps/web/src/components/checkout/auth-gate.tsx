"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { Customer } from "@/lib/checkout-types";
import { last10, readIdentity } from "@/lib/customer-identity";

type Step = "mobile" | "signup" | "otp";

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * WhatsApp-OTP sign-in. Checkout hides every payment option until this completes.
 * Flow parity with the legacy page: check-user -> (signup) -> send-otp -> verify-otp.
 */
export function AuthGate({ onSignedIn }: { onSignedIn: (customer: Customer, token: string) => Promise<void> }) {
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [greeting, setGreeting] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const saved = useRef<Customer | null>(null);

  useEffect(() => {
    saved.current = readIdentity()?.customer ?? null;
    if (saved.current?.mobileNumber) setMobile(last10(saved.current.mobileNumber));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendOtp(payload: Record<string, unknown>, hello: string) {
    const { res, data } = await postJson("/api/v1/customer/send-otp", payload);
    if (data?.devOtp) setDevOtp(String(data.devOtp));
    if (!res.ok) {
      toast.error(data.error || "Failed to send WhatsApp OTP.");
      return false;
    }
    setGreeting(hello);
    setOtp("");
    setStep("otp");
    setCooldown(30);
    toast.success("OTP sent to your WhatsApp number!");
    return true;
  }

  async function submitMobile() {
    const clean = last10(mobile);
    if (clean.length !== 10) return toast.error("Please enter a valid 10-digit mobile number");
    setMobile(clean);
    setBusy(true);
    try {
      const { res, data } = await postJson("/api/v1/customer/check-user", { mobileNumber: clean });
      if (!res.ok) return toast.error(data.error || "Failed to check mobile number");
      const match = saved.current && last10(saved.current.mobileNumber) === clean ? saved.current : null;
      if (data.exists && data.customer) {
        setName(data.customer.name || "");
        setEmail(data.customer.email || "");
        await sendOtp({ mobileNumber: clean }, `Welcome back, ${data.customer.name}! Enter the 6-digit WhatsApp OTP:`);
      } else if (match) {
        setName(match.name || "Customer");
        setEmail(match.email || "");
        await sendOtp(
          { mobileNumber: clean, name: match.name || "Customer", email: match.email || "" },
          `Welcome back, ${match.name || "Customer"}! Enter the 6-digit WhatsApp OTP:`,
        );
      } else {
        setStep("signup");
      }
    } catch {
      toast.error("Network error checking mobile number.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSignup() {
    if (!name.trim()) return toast.error("Please enter your full name");
    if (!email.includes("@") || !email.includes(".")) return toast.error("Please enter a valid email address");
    setBusy(true);
    try {
      await sendOtp(
        { mobileNumber: mobile, name: name.trim(), email: email.trim(), isNewUser: true },
        `Hello ${name.trim()}! Enter the 6-digit WhatsApp OTP:`,
      );
    } catch {
      toast.error("Network error sending WhatsApp OTP.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setBusy(true);
    try {
      await sendOtp({ mobileNumber: mobile, name, email }, greeting);
    } catch {
      toast.error("Network error resending OTP.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (otp.length < 6) return toast.error("Please enter the 6-digit WhatsApp OTP");
    setBusy(true);
    try {
      const { res, data } = await postJson("/api/v1/customer/verify-otp", { mobileNumber: mobile, otp, name, email });
      if (res.ok && data.customer) {
        await onSignedIn(data.customer, data.token);
        toast.success(`Welcome, ${data.customer.name}! Verified via WhatsApp.`);
      } else {
        toast.error(data.error || "Invalid or expired OTP. Please try again.");
        setOtp("");
      }
    } catch {
      toast.error("Network error verifying OTP.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="auth-gate">
      <div>
        <h2 className="text-lg font-semibold">Sign in to continue</h2>
        <p className="text-sm text-muted-foreground">We verify every customer with a one-time code on WhatsApp.</p>
      </div>

      {step === "mobile" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitMobile();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile number</Label>
            <div className="flex gap-2">
              <span className="inline-flex items-center rounded-md border px-3 text-sm text-muted-foreground">+91</span>
              <Input
                id="mobile"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                autoFocus
              />
            </div>
          </div>
          {saved.current && last10(saved.current.mobileNumber) && (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={busy}
              onClick={() => {
                setMobile(last10(saved.current?.mobileNumber));
                setTimeout(submitMobile, 0);
              }}
            >
              Continue as {saved.current.name || "saved account"} (+91 {last10(saved.current.mobileNumber)})
            </Button>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Checking account…" : "Continue"}
          </Button>
        </form>
      )}

      {step === "signup" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitSignup();
          }}
        >
          <p className="text-sm text-muted-foreground">New here? Tell us who you are (+91 {mobile}).</p>
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("mobile")}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? "Sending WhatsApp OTP…" : "Send WhatsApp OTP"}
            </Button>
          </div>
        </form>
      )}

      {step === "otp" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <p className="text-sm">{greeting}</p>
          <p className="text-xs text-muted-foreground">Sent to +91 {mobile}</p>
          <InputOTP maxLength={6} value={otp} onChange={setOtp} autoFocus data-testid="otp-input">
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {devOtp && <p className="text-xs text-muted-foreground">Dev OTP: {devOtp}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("mobile")}>
              Change number
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || otp.length < 6}>
              {busy ? "Verifying…" : "Verify & continue"}
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={cooldown > 0 || busy} onClick={resend}>
            Resend OTP {cooldown > 0 ? `(${cooldown}s)` : ""}
          </Button>
        </form>
      )}
    </div>
  );
}
