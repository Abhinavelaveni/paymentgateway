import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { orderReferenceCode, findSessionByReferenceCode, buildUpiUri } from '../index.js';

const A = { id: '7f3b2a00-0000-0000-0000-000000000000' };
const B = { id: 'c91d4e22-1111-2222-3333-444444444444' };

describe('Order reference code (optional UPI comment)', () => {
  test('is short, upper-case, derived from the session id and stable', () => {
    assert.equal(orderReferenceCode(A.id), 'YP-7F3B2A');
    assert.equal(orderReferenceCode(A.id), orderReferenceCode(A.id));
    assert.match(orderReferenceCode(B.id), /^YP-[0-9A-F]{6}$/);
  });

  test('returns an empty code for a missing or malformed id', () => {
    assert.equal(orderReferenceCode(''), '');
    assert.equal(orderReferenceCode(undefined), '');
    assert.equal(orderReferenceCode('zz'), '');
  });

  test('is carried as the note (tn) in the UPI link', () => {
    const uri = buildUpiUri({ payeeVpa: 'shop@bank', payeeName: 'Shop', amountPaise: 1000n, transactionRef: orderReferenceCode(A.id) });
    assert.equal(new URL(uri.replace('upi://', 'http://x/')).searchParams.get('tn'), 'YP-7F3B2A');
  });

  test('tie-break picks the one session whose code appears in the alert', () => {
    const text = 'Received Rs 10 from Someone, note YP-C91D4E, UPI Ref 123456789012';
    assert.equal(findSessionByReferenceCode([A, B], text), B);
    assert.equal(findSessionByReferenceCode([A, B], text.toLowerCase()), B);
  });

  test('tie-break never guesses: no code, or both codes, gives null', () => {
    assert.equal(findSessionByReferenceCode([A, B], 'Received Rs 10 from Someone'), null);
    assert.equal(findSessionByReferenceCode([A, B], 'YP-7F3B2A and YP-C91D4E'), null);
    assert.equal(findSessionByReferenceCode([A, B], ''), null);
    assert.equal(findSessionByReferenceCode([], 'YP-7F3B2A'), null);
  });
});
