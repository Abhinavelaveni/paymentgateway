import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startCheckoutServer } from '../index.js';
import { checkoutFrameHeaders, frameAncestorOrigins, isProductionLike } from '../server.js';

describe('Checkout portal (public entry in front of the Next.js app)', () => {
  let portal;
  let nextStub;
  let baseUrl;

  before(async () => {
    // Stand-in for apps/web: echoes the path and sets its own (wrong) CSP so we can prove the
    // portal stays authoritative for the framing policy.
    nextStub = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': 'frame-ancestors none', 'X-Stub-Path': req.url });
      res.end('NEXT-CHECKOUT-PAGE');
    });
    await new Promise(r => nextStub.listen(0, '127.0.0.1', r));
    process.env.NEXT_WEB_URL = `http://127.0.0.1:${nextStub.address().port}`;
    portal = await startCheckoutServer(7110);
    baseUrl = `http://localhost:${portal.port}`;
  });

  after(async () => {
    await portal.close();
    await new Promise(r => nextStub.close(r));
    delete process.env.NEXT_WEB_URL;
  });

  const get = (path) => new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }).on('error', reject);
  });

  test('GET /health is served locally', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).service, 'checkout-portal');
  });

  test('GET /checkout/:id is relayed to Next.js and keeps the portal framing CSP', async () => {
    const res = await get('/checkout/abc-123');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'NEXT-CHECKOUT-PAGE');
    assert.equal(res.headers['x-stub-path'], '/checkout/abc-123');
    assert.match(res.headers['content-security-policy'], /frame-ancestors/);
    assert.doesNotMatch(res.headers['content-security-policy'], /frame-ancestors none/);
  });

  test('/_next assets are relayed', async () => {
    const res = await get('/_next/static/chunks/x.js');
    assert.equal(res.text, 'NEXT-CHECKOUT-PAGE');
  });

  test('GET /youpi.js serves the SDK with no-store caching', async () => {
    const res = await get('/youpi.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.match(res.text, /YOUPI PG V2/);
  });

  test('icons are served and path traversal is not', async () => {
    assert.equal((await get('/icons/upi.svg')).status, 200);
    assert.equal((await get('/icons/..%2f..%2fpackage.json')).status, 404);
  });

  test('QR endpoint returns an SVG', async () => {
    const res = await get('/checkout/some-id/qr.svg');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /image\/svg\+xml/);
  });

  test('unknown routes are 404', async () => {
    assert.equal((await get('/nope')).status, 404);
  });
});

describe('framing policy', () => {
  test('only plain http(s) origins are accepted in CHECKOUT_FRAME_ANCESTORS', () => {
    assert.deepEqual(frameAncestorOrigins('https://a.example.com http://b.test, javascript:alert(1) https://c.com/path'), ['https://a.example.com', 'http://b.test']);
  });

  test('production defaults to self; development stays framable; explicit list wins', () => {
    assert.match(checkoutFrameHeaders({ YOUPI_MODE: 'production' })['Content-Security-Policy'], /frame-ancestors 'self';/);
    assert.match(checkoutFrameHeaders({ NODE_ENV: 'development' })['Content-Security-Policy'], /frame-ancestors \*;/);
    assert.match(checkoutFrameHeaders({ YOUPI_MODE: 'production', CHECKOUT_FRAME_ANCESTORS: 'https://shop.example.com' })['Content-Security-Policy'], /frame-ancestors 'self' https:\/\/shop\.example\.com;/);
    assert.equal(isProductionLike({ NODE_ENV: 'production' }), true);
  });
});
