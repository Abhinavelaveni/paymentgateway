import crypto from 'node:crypto';

/** Largest paise offset added to an order's amount to make it unique among live payments. */
export const UNIQUE_PAISE_MAX_OFFSET = 99;

/**
 * Unique-paise mode (opt-in, YOUPI_UNIQUE_PAISE=true): each live order on a receiving account
 * is shown a distinct amount (base + 1..99 paise), so an alert can be matched on amount alone
 * and many customers can pay at once. Off by default, which keeps the one-live-payment-per-UPI-ID
 * queue. Read at call time so tests and restarts pick up the setting.
 */
export function isUniquePaiseEnabled() {
  return String(process.env.YOUPI_UNIQUE_PAISE || '').trim().toLowerCase() === 'true';
}

/**
 * Picks a random offset (1..99) such that base + offset is not in `usedAmounts`.
 * @param {number} basePaise
 * @param {Set<number>|Iterable<number>} usedAmounts amounts (paise) already taken on the account
 * @param {(max: number) => number} [randomInt] returns an integer in [0, max); injectable for tests
 * @returns {number|null} the offset, or null when every offset is taken
 */
export function pickUniquePaiseOffset(basePaise, usedAmounts, randomInt = (max) => crypto.randomInt(max)) {
  const used = usedAmounts instanceof Set ? usedAmounts : new Set(usedAmounts);
  const free = [];
  for (let offset = 1; offset <= UNIQUE_PAISE_MAX_OFFSET; offset++) {
    if (!used.has(Number(basePaise) + offset)) free.push(offset);
  }
  if (free.length === 0) return null;
  return free[randomInt(free.length)];
}
