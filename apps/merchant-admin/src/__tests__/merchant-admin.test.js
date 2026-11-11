import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { getAdminToken } from '@youpi/common';
import { startAdminServer } from '../index.js';

describe('Merchant Admin Integration Tests', () => {
  let serverInstance;
  let baseUrl;
  let testDb;
  let nextStub;

  before(async () => {
    // Stand-in for the Next.js app (apps/web) that serves the dashboard pages.
    nextStub = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'X-Stub-Path': req.url });
      res.end('NEXT-ADMIN-PAGE');
    });
    await new Promise(r => nextStub.listen(0, '127.0.0.1', r));
    process.env.NEXT_WEB_URL = `http://127.0.0.1:${nextStub.address().port}`;
    testDb = new Database({ inMemory: true });
    serverInstance = await startAdminServer(6101, { db: testDb });
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
    await new Promise(r => nextStub.close(r));
    delete process.env.NEXT_WEB_URL;
    testDb.close();
  });

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, { headers }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  test('GET /health returns UP', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.equal(json.status, 'UP');
    assert.equal(json.service, 'merchant-admin');
  });

  test('GET / and /admin and /_next assets are relayed to the Next.js app', async () => {
    for (const route of ['/', '/admin', '/_next/static/chunks/app.js']) {
      const res = await get(route);
      assert.equal(res.status, 200, route);
      assert.equal(res.text, 'NEXT-ADMIN-PAGE');
    }
    assert.equal((await get('/admin')).headers['x-stub-path'], '/admin');
  });

  test('unknown routes are 404 and are not relayed', async () => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
  });

  test('GET /api/admin/tickets requires the admin token', async () => {
    const anonymous = await get('/api/admin/tickets');
    assert.equal(anonymous.status, 401);

    const res = await get('/api/admin/tickets', { Authorization: `Bearer ${getAdminToken()}` });
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.ok(Array.isArray(json));
  });

  test('Control Center supervisor proxy routes (/api/services* and /api/logs/stream) require the admin token', async () => {
    const anonServices = await get('/api/services');
    assert.equal(anonServices.status, 401);

    const wrongToken = await get('/api/services', { Authorization: 'Bearer wrong-token' });
    assert.equal(wrongToken.status, 401);

    const anonLogs = await get('/api/logs/stream');
    assert.equal(anonLogs.status, 401);

    const wrongQueryLogs = await get('/api/logs/stream?token=wrong-token');
    assert.equal(wrongQueryLogs.status, 401);
  });
});
