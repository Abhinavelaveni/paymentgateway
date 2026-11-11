import { toRupeesString } from './money.js';

/**
 * Validates whether a given string is a syntactically valid UPI Virtual Payment Address (VPA).
 * Format: username@bank
 * @param {string} vpa
 * @returns {boolean}
 */
export function isValidVpa(vpa) {
  if (!vpa || typeof vpa !== 'string') return false;
  const clean = vpa.trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/.test(clean);
}

/**
 * Short, human-typeable reference for a payment session (e.g. "YP-7F3K2A"), derived from the
 * session id so it needs no storage. It goes in the UPI note (tn) and on the checkout page, and
 * is only ever a tie-breaker: a credit alert that carries it can settle a tie, but alerts
 * without it are matched exactly as before.
 * @param {string} sessionId
 * @returns {string}
 */
export function orderReferenceCode(sessionId) {
  const hex = String(sessionId || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
  return hex.length === 6 ? `YP-${hex}` : '';
}

/**
 * Finds the single session whose reference code appears in an alert's text.
 * Returns null unless exactly one candidate's code is present, so it can never guess.
 * @param {Array<{ id: string }>} sessions
 * @param {string} alertText
 */
export function findSessionByReferenceCode(sessions, alertText) {
  const text = String(alertText || '').toUpperCase();
  if (!text) return null;
  const hits = (sessions || []).filter(s => {
    const code = orderReferenceCode(s?.id);
    return code && text.includes(code);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Builds a canonical upi://pay URI dynamically from server-validated parameters.
 * Amount is derived exclusively from server-side integer paise.
 * @param {{
 *   payeeVpa: string,
 *   payeeName: string,
 *   amountPaise: bigint,
 *   transactionRef: string,
 *   transactionNote?: string,
 *   currency?: string
 * }} options
 * @returns {string}
 */
export function buildUpiUri(options) {
  if (!isValidVpa(options.payeeVpa)) {
    throw new Error(`Invalid payee VPA: ${options.payeeVpa}`);
  }

  const amountStr = toRupeesString(options.amountPaise);

  const params = new URLSearchParams();
  params.set('pa', options.payeeVpa.trim());
  params.set('pn', options.payeeName.trim());
  params.set('am', amountStr);
  const txnId = (options.transactionRef || options.transactionNote || '').trim();
  if (txnId) {
    params.set('tn', txnId);
  }

  return `upi://pay?${params.toString()}`;
}

/**
 * Builds an Android intent URI for launching a specific UPI application.
 * Format: intent://pay?<UPI_PARAMS>#Intent;scheme=upi;package=<PACKAGE>;end
 * @param {{
 *   payeeVpa: string,
 *   payeeName: string,
 *   amountPaise: bigint,
 *   transactionRef?: string,
 *   transactionNote?: string,
 *   currency?: string,
 *   packageName: string
 * }} options
 * @returns {string}
 */
export function buildUpiIntentUri(options) {
  if (!options.packageName || !options.packageName.trim()) {
    throw new Error('Package name is required for Android UPI intent URI');
  }
  const upiUri = buildUpiUri(options);
  const query = upiUri.split('?')[1] || '';
  const cleanPackage = options.packageName.trim();
  return `intent://pay?${query}#Intent;scheme=upi;package=${cleanPackage};end`;
}
