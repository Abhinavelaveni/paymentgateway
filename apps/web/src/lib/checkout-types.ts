export type PaymentMethod = "UPI" | "COD" | "CASH_COUNTER" | "CARD_COUNTER";

export interface Branding {
  appName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  trustBadgeText?: string;
  hideTrustBadge?: boolean;
  subbannerText?: string;
  hideSubbanner?: boolean;
  hideTimeSavingBanner?: boolean;
  hidePoweredBy?: boolean;
  sidebarNotice?: string;
  footerGuarantee?: string;
  counterInstructions?: string;
  cardCounterInstructions?: string;
  supportEmails?: string[];
  supportEmail?: string;
  supportMobiles?: string[];
  supportMobile?: string;
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  sellingMode?: "ONLINE" | "OFFLINE";
  enabledPaymentMethods?: PaymentMethod[];
}

export interface Customer {
  id: string;
  name?: string;
  fullName?: string;
  email?: string;
  mobileNumber?: string;
  phoneNumber?: string;
  phone?: string;
  status?: string;
}

export interface UpiServerIndicator {
  status?: string;
  tier?: "GREEN" | "YELLOW" | "RED";
  label?: string;
  warning?: string;
  recommendedAlternative?: string;
}

export interface CheckoutState {
  id?: string;
  orderId?: string;
  status: string;
  method?: PaymentMethod;
  amount?: string;
  merchantName?: string;
  branding?: Branding;
  customer?: Customer | null;
  sellingMode?: "ONLINE" | "OFFLINE";
  enabledMethods?: PaymentMethod[];
  upiUri?: string;
  payeeVpa?: string;
  vpa?: string;
  referenceCode?: string;
  uniquePaise?: { baseAmount?: string; offsetPaise?: number } | null;
  timeRemainingSeconds?: number;
  expiresAt?: string;
  queuePosition?: number;
  returnUrl?: string | null;
  cancelUrl?: string | null;
  verificationTag?: string;
  isBanned?: boolean;
  fraudDetected?: boolean;
  blockedNotice?: { title?: string; subtitle?: string; message?: string; reason?: string };
  hasActiveSessionConflict?: boolean;
  conflictingSession?: { id: string; orderId?: string; amount?: string };
  upiServerIndicator?: UpiServerIndicator;
  [key: string]: unknown;
}

export const TERMINAL_STATUSES = [
  "SUCCESS",
  "OBSERVED_SUCCESS",
  "RECONCILED",
  "MANUAL_REVIEW",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
