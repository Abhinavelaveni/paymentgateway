// Runs under the repo's node:test runner via native TypeScript type-stripping (Node >= 24).
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeKpis, type AdminPayment } from "../kpis.ts";
import { sanitizeUpiUri } from "../merchant-bridge.ts";

const NOW = new Date("2026-11-11T15:00:00");
const iso = (h: number) => new Date(`2026-11-11T${String(h).padStart(2, "0")}:00:00`).toISOString();

function pay(over: Partial<AdminPayment>): AdminPayment {
  return { id: "p", orderId: "o", amountPaise: 10000, method: "UPI", status: "SUCCESS", createdAt: iso(10), completedAt: iso(10), ...over };
}

test("Today's Volume counts SUCCESS, RECONCILED and OBSERVED_SUCCESS", () => {
  const k = computeKpis(
    [pay({ status: "SUCCESS", amountPaise: 10000 }), pay({ status: "RECONCILED", amountPaise: 20000 }), pay({ status: "OBSERVED_SUCCESS", amountPaise: 30000 })],
    0,
    NOW,
  );
  assert.equal(k.volume, 60000);
  assert.equal(k.observed, 30000);
  assert.equal(k.count, 3);
});

test("Today's Volume ignores non-received statuses and earlier days", () => {
  const k = computeKpis(
    [
      pay({ status: "FAILED" }),
      pay({ status: "EXPIRED" }),
      pay({ status: "ACTIVE" }),
      pay({ status: "SUCCESS", createdAt: "2026-11-10T10:00:00", completedAt: "2026-11-10T10:00:00" }),
    ],
    0,
    NOW,
  );
  assert.equal(k.volume, 0);
  assert.equal(k.count, 0);
});

test("verification level splits single/dual and pending counter payments are counted", () => {
  const k = computeKpis(
    [
      pay({ verificationLevel: 1 }),
      pay({ verificationLevel: 2 }),
      pay({ status: "ACTIVE", method: "CASH_COUNTER" }),
      pay({ status: "ACTIVE", method: "CARD_COUNTER" }),
      pay({ status: "ACTIVE", method: "UPI" }),
    ],
    4,
    NOW,
  );
  assert.equal(k.single, 1);
  assert.equal(k.dual, 1);
  assert.equal(k.pendingCounter, 2);
  assert.equal(k.queue, 4);
});

test("sanitizeUpiUri accepts UPI pay links and rejects injection attempts", () => {
  const ok = "upi://pay?pa=shop%40bank&pn=Shop&am=499.00&tn=YP-ABC123";
  assert.equal(sanitizeUpiUri(ok), ok);
  assert.equal(sanitizeUpiUri("javascript:alert(1)"), null);
  assert.equal(sanitizeUpiUri("upi://pay?pa=a<script>"), null);
  assert.equal(sanitizeUpiUri("https://evil.example/pay"), null);
  assert.equal(sanitizeUpiUri(undefined), null);
});

import { buildUpiIntent } from "../merchant-bridge.ts";

test("guest name replaces the UPI note (tn) and stays a valid upi link", () => {
  const state = { status: "ACTIVE", upiUri: "upi://pay?pa=shop%40bank&pn=Shop&am=1.48&tn=YP-ABC123" };
  const uri = buildUpiIntent(state, "pid", "Ravi Kumar");
  assert.equal(uri, "upi://pay?pa=shop%40bank&pn=Shop&am=1.48&tn=Ravi%20Kumar");
  assert.equal(buildUpiIntent(state, "pid"), state.upiUri);
});

import { sanitizeRedirectUrl, resolveMerchantOrigin } from "../merchant-bridge.ts";

function stubBrowser(referrer: string, search = "") {
  (globalThis as any).window = { location: { origin: "https://pay.example.com", search, host: "pay.example.com" } };
  (globalThis as any).document = { referrer };
}

test("sanitizeRedirectUrl only accepts http(s), whatever the casing or padding", () => {
  stubBrowser("");
  assert.equal(sanitizeRedirectUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeRedirectUrl("  JaVaScRiPt:alert(1)"), null);
  assert.equal(sanitizeRedirectUrl("data:text/html,<script>"), null);
  assert.equal(sanitizeRedirectUrl("vbscript:x"), null);
  assert.equal(sanitizeRedirectUrl(undefined), null);
  assert.equal(sanitizeRedirectUrl("  https://shop.example.com/ok "), "https://shop.example.com/ok");
});

test("merchant origin comes from the referrer, then youpiParentOrigin, and never from a non-http(s) value", () => {
  stubBrowser("https://shop.example.com/cart?x=1");
  assert.equal(resolveMerchantOrigin(), "https://shop.example.com");
  stubBrowser("", "?youpiParentOrigin=https%3A%2F%2Fstore.test");
  assert.equal(resolveMerchantOrigin(), "https://store.test");
  stubBrowser("", "?youpiParentOrigin=javascript%3Aalert(1)");
  assert.equal(resolveMerchantOrigin(), null);
  stubBrowser("");
  assert.equal(resolveMerchantOrigin(), null);
});
