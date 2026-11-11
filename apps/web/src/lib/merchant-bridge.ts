import type { CheckoutState } from "./checkout-types";

/**
 * postMessage bridge to the storefront that embeds the checkout iframe (youpi.js). Event names
 * and payload shapes are the existing public contract: do not rename them.
 */

export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  return window.parent !== window || window.location.search.includes("embedded=1");
}

/** Only http(s) URLs may be used as redirect targets (rejects javascript:, data:, vbscript:). */
export function sanitizeRedirectUrl(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Origin of the embedding storefront: referrer first, then the origin youpi.js declares. */
export function resolveMerchantOrigin(): string | null {
  try {
    if (document.referrer) {
      const p = new URL(document.referrer);
      if (p.protocol === "http:" || p.protocol === "https:") return p.origin;
    }
  } catch {}
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["youpiParentOrigin", "origin", "merchantOrigin"]) {
      const declared = params.get(key);
      if (!declared) continue;
      const p = new URL(declared, window.location.origin);
      if (p.protocol === "http:" || p.protocol === "https:") return p.origin;
    }
  } catch {}
  return null;
}

/** Messages carry payment data, so they are dropped unless the merchant origin is known. */
export function postToMerchant(message: Record<string, unknown>) {
  const target = resolveMerchantOrigin();
  if (!target) return;
  try {
    window.parent.postMessage(message, target);
  } catch {}
}

export function getStoreReturnUrl(state: CheckoutState | null): string {
  if (state) {
    const cancel = sanitizeRedirectUrl(state.cancelUrl);
    if (cancel) return cancel;
    const ret = sanitizeRedirectUrl(state.returnUrl);
    if (ret) {
      try {
        return `${new URL(ret).origin}/`;
      } catch {}
    }
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const cancel = sanitizeRedirectUrl(params.get("cancelUrl") || params.get("cancel_url"));
    if (cancel) return cancel;
    const q = sanitizeRedirectUrl(params.get("returnUrl") || params.get("storeUrl") || params.get("redirectUrl"));
    if (q) return `${new URL(q).origin}/`;
  } catch {}
  if (document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.host !== window.location.host) return `${ref.origin}/`;
    } catch {}
  }
  const { hostname, port } = window.location;
  if (port === "7000" || port === "7100" || hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:5000/";
  }
  return "/";
}

export function getFailedRedirectUrl(state: CheckoutState | null, paymentId: string): string {
  const orderId = state?.orderId || "";
  const reason = state?.status || "FAILED";
  let baseOrigin = "";
  const safeReturn = sanitizeRedirectUrl(state?.returnUrl);
  if (safeReturn) baseOrigin = new URL(safeReturn).origin;
  if (!baseOrigin && document.referrer) {
    try {
      baseOrigin = new URL(document.referrer).origin;
    } catch {}
  }
  const query = `orderId=${encodeURIComponent(orderId)}&reason=${encodeURIComponent(reason)}&paymentId=${encodeURIComponent(paymentId)}`;
  return baseOrigin ? `${baseOrigin}/order-failed?${query}` : `/order-failed?${query}`;
}

/** Tells an embedding storefront the customer left, using every event name the SDK listens for. */
export function announceClose(storeUrl: string) {
  postToMerchant({ event: "youpi.modal_close", redirectUrl: storeUrl });
  postToMerchant({ event: "youpi.close", redirectUrl: storeUrl });
  postToMerchant({ event: "youpi.cancel", redirectUrl: storeUrl });
  postToMerchant({ event: "youpi.payment_cancelled", redirectUrl: storeUrl });
}

export function sanitizeUpiUri(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.toLowerCase().startsWith("upi://pay?")) return null;
  if (!/^upi:\/\/pay\?[a-zA-Z0-9_\-.=&%+:@/]*$/i.test(t)) return null;
  return t;
}

/** Replaces the UPI note (tn) with the customer-supplied comment, e.g. their name. */
function withComment(uri: string, comment?: string): string {
  if (!comment) return uri;
  const replaced = uri.replace(/([?&])tn=[^&]*/i, `$1tn=${encodeURIComponent(comment)}`);
  return replaced === uri && !/[?&]tn=/i.test(uri) ? `${uri}&tn=${encodeURIComponent(comment)}` : replaced;
}

export function buildUpiIntent(state: CheckoutState | null, paymentId: string, comment?: string): string | null {
  const fromState = sanitizeUpiUri(state?.upiUri);
  if (fromState) return sanitizeUpiUri(withComment(fromState, comment));
  const vpa = encodeURIComponent(String(state?.payeeVpa || state?.vpa || "merchant@upi").trim());
  const name = encodeURIComponent(String(state?.merchantName || "Store").trim());
  const amt = encodeURIComponent(String(state?.amount || "10.00").trim());
  return sanitizeUpiUri(`upi://pay?pa=${vpa}&pn=${name}&am=${amt}&tn=${encodeURIComponent(comment || paymentId)}`);
}
