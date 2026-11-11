import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePairingBaseUrl } from '../routes/pollers.routes.js';

const local = { isProduction: false, apiUrl: 'http://localhost:6100' };
const resolve = (headers, runtime = local, env = {}) => resolvePairingBaseUrl({ headers }, runtime, env);

test('pairing QR uses the public address the admin was opened on (proxy headers)', () => {
  assert.equal(resolve({ 'x-forwarded-host': 'svc.onrender.com', 'x-forwarded-proto': 'https' }), 'https://svc.onrender.com');
});

test('pairing QR uses the LAN host the admin was opened on', () => {
  assert.equal(resolve({ host: '192.168.1.45:6001' }), 'http://192.168.1.45:6001');
});

test('malformed host headers fall back to the runtime URL', () => {
  assert.equal(resolve({ host: 'bad host/x' }), 'http://localhost:6100');
  assert.equal(resolve({}), 'http://localhost:6100');
});

test('Cloudflare production mode keeps the derived API hostname', () => {
  assert.equal(resolve({ host: 'a.example.com' }, { isProduction: true, apiUrl: 'https://pay-api.example.com' }), 'https://pay-api.example.com');
});

test('PUBLIC_API_URL overrides everything when it is a plain http(s) origin', () => {
  assert.equal(resolve({ host: 'a.com' }, local, { PUBLIC_API_URL: 'https://fixed.example.com/' }), 'https://fixed.example.com');
  assert.equal(resolve({ host: 'a.com' }, local, { PUBLIC_API_URL: 'javascript:alert(1)' }), 'http://a.com');
});
