import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

/**
 * Launches the Next.js frontend (apps/web). Forked by the process supervisor when
 * YOUPI_FRONTEND=next; can also be run by hand: `node scripts/start-web.js`.
 *
 * Production build by default (built on first start); YOUPI_WEB_DEV=true runs `next dev`.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(rootDir, 'apps', 'web');
const port = String(process.env.NEXT_WEB_PORT || process.env.PORT || 7100);
const host = process.env.YOUPI_BIND_HOST || '127.0.0.1';
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');

if (!fs.existsSync(nextBin)) {
  console.error('[web] Next.js is not installed. Run `npm install` in the repository root first.');
  process.exit(1);
}

const dev = String(process.env.YOUPI_WEB_DEV || '').toLowerCase() === 'true';
const env = { ...process.env, PORT: port, NEXT_TELEMETRY_DISABLED: '1' };

if (!dev && !fs.existsSync(path.join(webDir, '.next', 'BUILD_ID'))) {
  console.log('[web] No production build found; running `next build` (first start only)...');
  const build = spawnSync(process.execPath, [nextBin, 'build'], { cwd: webDir, env, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('[web] next build failed.');
    process.exit(build.status || 1);
  }
}

const child = spawn(process.execPath, [nextBin, dev ? 'dev' : 'start', '-p', port, '-H', host], { cwd: webDir, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch {}
  });
}
