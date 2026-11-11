import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@youpi/db';
import { startServer as startPaymentApi } from '../../../apps/payment-api/src/index.js';
import { AndroidObserverDriver } from '../driver.js';
import { PaymentStatus, resolveSecret } from '@youpi/common';

const MERCHANT = '00000000-0000-0000-0000-000000000001';
const ACCOUNT = '00000000-0000-0000-0000-000000000002';

async function boot(port, uniquePaise) {
  process.env.YOUPI_UNIQUE_PAISE = uniquePaise ? 'true' : 'false';
  const db = new Database({ inMemory: true });
  const api = await startPaymentApi(port, db);
  const driver = new AndroidObserverDriver({ apiBaseUrl: `http://localhost:${api.port}`, deviceName: 'Paise Tester', deviceModel: 'Pixel' });
  await driver.pair(resolveSecret('android_enrollment_secret', 'ANDROID_ENROLLMENT_SECRET'));
  return { db, api, driver };
}

function newSession(ctx, orderId, amountPaise) {
  const s = ctx.sessionRepo.create({ merchantId: MERCHANT, receivingAccountId: ACCOUNT, orderId, amountPaise });
  const r = ctx.queueEngine.enqueueOrActivate(s.id, ACCOUNT, 300000);
  return { id: s.id, result: r };
}

const paytm = (driver, amountPaise) => driver.submitObservation({
  amount: (amountPaise / 100).toFixed(2),
  receivingAccountId: ACCOUNT,
  notificationTitle: `Received ₹${(amountPaise / 100).toFixed(2)} from Test Payer`,
  notificationText: 'Deposited in your State Bank Of India - 2508 on 28 October at 7:53 PM',
  package: 'net.one97.paytm'
});

describe('Unique-paise mode ON: many customers pay the same base amount at once', () => {
  let env;
  before(async () => { env = await boot(6218, true); });
  after(async () => {
    env.driver.stopHeartbeat();
    await env.api.close();
    env.db.close();
    delete process.env.YOUPI_UNIQUE_PAISE;
  });

  test('two ₹100 orders on one UPI ID are both ACTIVE with different amounts', () => {
    const ctx = env.api.app.context;
    const a = newSession(ctx, 'PAISE-A', 10000n);
    const b = newSession(ctx, 'PAISE-B', 10000n);
    assert.equal(a.result.status, PaymentStatus.ACTIVE);
    assert.equal(b.result.status, PaymentStatus.ACTIVE);

    const sa = ctx.sessionRepo.findById(a.id);
    const sb = ctx.sessionRepo.findById(b.id);
    assert.notEqual(sa.amountPaise, sb.amountPaise);
    for (const s of [sa, sb]) {
      assert.ok(s.amountPaise >= 10001n && s.amountPaise <= 10099n, `amount ${s.amountPaise} in 100.01..100.99`);
      assert.equal(s.metadata.uniquePaise.baseAmountPaise, 10000);
    }
    env.a = sa;
    env.b = sb;
  });

  test('each credit settles only the order with that exact amount', async () => {
    const ctx = env.api.app.context;

    const rb = await paytm(env.driver, Number(env.b.amountPaise));
    assert.equal(rb.status, 200, JSON.stringify(rb.body).slice(0, 300));
    assert.equal(rb.body.attribution.attributed, true);
    assert.equal(rb.body.attribution.paymentSessionId, env.b.id);
    assert.equal(ctx.sessionRepo.findById(env.b.id).status, PaymentStatus.OBSERVED_SUCCESS);
    assert.equal(ctx.sessionRepo.findById(env.a.id).status, PaymentStatus.ACTIVE, 'the other order is untouched');

    const ra = await paytm(env.driver, Number(env.a.amountPaise));
    assert.equal(ra.status, 200, JSON.stringify(ra.body).slice(0, 300));
    assert.equal(ra.body.attribution.paymentSessionId, env.a.id);
    assert.equal(ctx.sessionRepo.findById(env.a.id).status, PaymentStatus.OBSERVED_SUCCESS);
  });

  test('a credit with a base amount that no live order owns settles nothing', async () => {
    const ctx = env.api.app.context;
    const c = newSession(ctx, 'PAISE-C', 20000n);
    const wrong = await paytm(env.driver, 20000); // customer paid the bare base amount
    assert.notEqual(wrong.body?.attribution?.attributed, true);
    assert.equal(ctx.sessionRepo.findById(c.id).status, PaymentStatus.ACTIVE);
  });

  test('one customer can have several different orders live at once, but not two of the same order', async () => {
    const ctx = env.api.app.context;
    const customer = ctx.customerRepo.create({ name: 'Multi Order', mobileNumber: '9876500011' });
    const mk = (orderId) => {
      const s = ctx.sessionRepo.create({ merchantId: MERCHANT, receivingAccountId: ACCOUNT, orderId, amountPaise: 1200n, customerId: customer.id });
      return s.id;
    };
    const a = mk('MULTI-1');
    ctx.queueEngine.enqueueOrActivate(a, ACCOUNT, 300000);
    const b = mk('MULTI-2');

    // The second order is independent of the first: no conflict is reported for it.
    const stateB = await fetch(`http://localhost:${env.api.port}/api/v1/checkout/${b}/state`).then(r => r.json());
    assert.equal(stateB.hasActiveSessionConflict, false);
    assert.equal(ctx.sessionRepo.findActiveForCustomer(customer.id, b, 'MULTI-2'), null);

    // A retry of the same order (suffix -R1) is still a duplicate of the live one; other orders are not.
    assert.equal(ctx.sessionRepo.findActiveForCustomer(customer.id, null, 'MULTI-1-R1')?.orderId, 'MULTI-1');
    assert.equal(ctx.sessionRepo.findActiveForCustomer(customer.id, null, 'MULTI-3'), null);
    // Without the paise-mode filter (mode off) the old rule still sees any live order of the customer.
    assert.equal(ctx.sessionRepo.findActiveForCustomer(customer.id, b)?.orderId, 'MULTI-1');
  });

  test('re-posting the same order with its original amount is idempotent, not a mismatch', async () => {
    const res = await fetch(`http://localhost:${env.api.port}/api/v1/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'PAISE-C', amount: '200.00' })
    });
    assert.notEqual(res.status, 409);
  });
});

describe('Unique-paise mode OFF (default): the one-slot queue is unchanged', () => {
  let env;
  before(async () => { env = await boot(6219, false); });
  after(async () => {
    env.driver.stopHeartbeat();
    await env.api.close();
    env.db.close();
    delete process.env.YOUPI_UNIQUE_PAISE;
  });

  test('a second ₹100 order on the same UPI ID is QUEUED at its original amount', () => {
    const ctx = env.api.app.context;
    const a = newSession(ctx, 'QUEUE-A', 10000n);
    const b = newSession(ctx, 'QUEUE-B', 10000n);
    assert.equal(a.result.status, PaymentStatus.ACTIVE);
    assert.equal(b.result.status, PaymentStatus.QUEUED);
    assert.equal(ctx.sessionRepo.findById(a.id).amountPaise, 10000n);
    assert.equal(ctx.sessionRepo.findById(b.id).amountPaise, 10000n);
  });
});
