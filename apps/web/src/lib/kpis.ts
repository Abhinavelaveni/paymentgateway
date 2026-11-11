export interface AdminPayment {
  id: string;
  orderId: string;
  amountPaise: number | string;
  method: string;
  status: string;
  verificationLevel?: number;
  verificationTag?: string;
  verificationSources?: string[];
  createdAt: string;
  completedAt?: string | null;
  referenceCode?: string;
}


/** SQLite timestamps ("YYYY-MM-DD HH:MM:SS") are UTC without a zone. */
function parseTs(raw?: string | null) {
  if (!raw) return NaN;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  return new Date(s).getTime();
}

/**
 * KPIs. Today's Volume counts every payment received today: bank-confirmed (SUCCESS,
 * RECONCILED) AND observed from SMS/app notifications (OBSERVED_SUCCESS); observed money is
 * broken out separately because it is not yet reconciled to a statement.
 */
export function computeKpis(payments: AdminPayment[], queueLen: number, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let volume = 0;
  let observed = 0;
  let count = 0;
  let single = 0;
  let dual = 0;
  let pendingCounter = 0;
  for (const p of payments) {
    const t = parseTs(p.completedAt || p.createdAt);
    if (["RECONCILED", "SUCCESS", "OBSERVED_SUCCESS"].includes(p.status) && !Number.isNaN(t) && t >= start.getTime()) {
      count++;
      volume += Number(p.amountPaise);
      if (p.status === "OBSERVED_SUCCESS") observed += Number(p.amountPaise);
      if ((p.verificationLevel ?? 0) >= 2) dual++;
      else single++;
    }
    if (p.status === "ACTIVE" && (p.method === "CASH_COUNTER" || p.method === "CARD_COUNTER")) pendingCounter++;
  }
  return { volume, observed, count, single, dual, pendingCounter, queue: queueLen };
}
