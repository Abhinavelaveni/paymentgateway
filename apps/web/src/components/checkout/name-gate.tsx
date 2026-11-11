"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Guest checkout: just ask for a name. It becomes the UPI payment note (comment). */
export function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const valid = name.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(name);
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Enter your name to pay</h2>
        <p className="text-sm text-muted-foreground">It will be added as the comment on your UPI payment.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="guest-name">Your name</Label>
        <Input id="guest-name" autoComplete="name" maxLength={30} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi Kumar" />
      </div>
      <Button type="submit" className="w-full" disabled={!valid} data-testid="btn-name-continue">
        Continue to payment
      </Button>
    </form>
  );
}
