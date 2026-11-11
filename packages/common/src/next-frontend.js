import http from 'node:http';
import https from 'node:https';

/**
 * Hand-off from the checkout portal (:7000) and merchant admin (:6001) to the Next.js frontend
 * (apps/web, :7100). Those servers stay the public entry points, so the iframe contract
 * (`<host>/checkout/:id`, `/youpi.js`) and existing tunnels/bookmarks keep working.
 */

export function nextFrontendUrl(env = process.env) {
  return env.NEXT_WEB_URL || `http://127.0.0.1:${env.NEXT_WEB_PORT || 7100}`;
}

const DROP_REQUEST = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'x-internal-render', 'x-internal-token']);

/**
 * Streams `req` to the Next.js server and pipes the answer back. Resolves once the response
 * has been started (or a 502 written), never throws.
 */
export function relayToNextFrontend(req, res, target = nextFrontendUrl(), overrideHeaders = {}) {
  const targetUrl = new URL(req.url, target);
  const client = targetUrl.protocol === 'https:' ? https : http;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = targetUrl.host;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';

  const proxyReq = client.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port || undefined,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method: req.method,
    headers
  }, (proxyRes) => {
    const outHeaders = { ...proxyRes.headers };
    for (const [name, value] of Object.entries(overrideHeaders)) {
      for (const existing of Object.keys(outHeaders)) {
        if (existing.toLowerCase() === name.toLowerCase()) delete outHeaders[existing];
      }
      outHeaders[name] = value;
    }
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Next.js frontend unavailable', details: err.message }));
    }
  });
  req.pipe(proxyReq);
}
