import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawn } from 'node:child_process';
import { runMigrations } from '../packages/db/src/migrate.js';

/**
 * Render (single public port) launcher.
 *
 * Render exposes ONE port per web service ($PORT). The Next.js app (apps/web) is that public
 * entry point: it serves /checkout/:id, /admin and /youpi.js and proxies /api/* to the payment
 * core, which listens privately on 127.0.0.1:6100 in the same container.
 *
 *   internet -> Next.js ($PORT) --/api--> payment-api (127.0.0.1:6100) --> SQLite (/app/data)
 *
 * Android observers and merchant servers use the same public URL (https://<service>.onrender.com)
 * as their API base. Gmail/legacy observers are not started here.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicPort = String(process.env.PORT || 10000);
const apiPort = String(process.env.PAYMENT_API_PORT || 6100);

// Render injects RENDER_EXTERNAL_URL (https://<service>.onrender.com).
const publicUrl = (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
// One self-hosted deployment on a platform URL, not the Cloudflare multi-hostname layout.
process.env.YOUPI_MODE = process.env.YOUPI_MODE || 'localhost';
process.env.YOUPI_ALLOW_LOCALHOST_MODE = process.env.YOUPI_ALLOW_LOCALHOST_MODE || 'true';
process.env.SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(rootDir, 'data', 'youpi_pg.sqlite');
fs.mkdirSync(path.dirname(process.env.SQLITE_DB_PATH), { recursive: true });

console.log('[render] Running database migrations...');
runMigrations();

const children = [];
function run(name, child) {
  children.push(child);
  child.on('exit', (code, signal) => {
    console.error(`[render] ${name} exited (code ${code}, signal ${signal}); stopping container so Render restarts it.`);
    shutdown(code || 1);
  });
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// 1. Payment core, private on loopback. PORT must be overridden: Render's PORT is the public one.
run('payment-api', fork(path.join(rootDir, 'apps/payment-api/src/index.js'), [], {
  env: {
    ...process.env,
    PORT: apiPort,
    PAYMENT_API_PORT: apiPort,
    YOUPI_BIND_HOST: '127.0.0.1',
    ...(publicUrl ? { CHECKOUT_PUBLIC_URL: publicUrl, PUBLIC_APP_URL: publicUrl } : {})
  },
  stdio: 'inherit'
}));

// 2. Next.js public entry point.
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
run('web', spawn(process.execPath, [nextBin, 'start', '-p', publicPort, '-H', '0.0.0.0'], {
  cwd: path.join(rootDir, 'apps', 'web'),
  env: {
    ...process.env,
    PORT: publicPort,
    PAYMENT_API_URL: `http://127.0.0.1:${apiPort}`,
    NEXT_TELEMETRY_DISABLED: '1'
  },
  stdio: 'inherit'
}));

console.log(`[render] YOUPI PG up: public port ${publicPort}${publicUrl ? ` (${publicUrl})` : ''}, payment-api on 127.0.0.1:${apiPort}`);
