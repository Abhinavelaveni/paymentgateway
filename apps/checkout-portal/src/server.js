import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateQrSvg } from '@youpi/core';
import { getInternalServiceToken, relayToNextFrontend } from '@youpi/common';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Security headers applied to the QR response. */
const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
});

/**
 * Origins allowed to embed the checkout page, from CHECKOUT_FRAME_ANCESTORS
 * (comma or space separated, e.g. "https://shop.example.com"). youpi.js opens the
 * checkout in an iframe on the merchant's own site, which `frame-ancestors 'self'`
 * blocks whenever the store and the portal are on different origins. Anything that
 * is not a plain http(s) origin is ignored, so the CSP cannot be widened by accident.
 */
export function frameAncestorOrigins(raw = process.env.CHECKOUT_FRAME_ANCESTORS) {
  const origins = [];
  for (const entry of String(raw || '').split(/[\s,]+/)) {
    if (!entry) continue;
    try {
      const url = new URL(entry);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && entry.replace(/\/$/, '') === url.origin) {
        origins.push(url.origin);
      }
    } catch {}
  }
  return origins;
}

/**
 * True for production launches. scripts/start.js sets YOUPI_MODE/NODE_ENV to
 * 'production'; the dev script and the test runner leave them on development/test.
 */
export function isProductionLike(env = process.env) {
  return env.YOUPI_MODE === 'production' || env.NODE_ENV === 'production';
}

/**
 * Headers for the embeddable checkout page.
 *
 * The checkout page is embedded cross-origin by merchant storefronts. An explicit
 * CHECKOUT_FRAME_ANCESTORS always wins. Without one, production defaults to
 * frame-ancestors 'self' so unknown sites cannot frame the page, while development
 * stays permissive because storefronts on other ports embed the portal across origins.
 * X-Frame-Options is not sent because it cannot express an allowlist.
 */
export function checkoutFrameHeaders(env = process.env) {
  const configured = frameAncestorOrigins(env.CHECKOUT_FRAME_ANCESTORS);
  const frameAncestors = configured.length
    ? `'self' ${configured.join(' ')}`
    : (isProductionLike(env) ? "'self'" : '*');
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': `default-src 'self' data: blob:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'self'; object-src 'none'`
  };
}

/**
 * Strips hop-by-hop and spoofable internal headers before proxying to the payment core.
 * Returns a shallow copy so the caller's request object is never mutated.
 */
function sanitizedForwardHeaders(req, targetHost) {
  const headers = { ...req.headers, host: targetHost };
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    // Never let a browser claim to be an internal renderer or replay a credential we issue.
    if (lower === 'x-internal-render' || lower === 'x-internal-token') {
      delete headers[name];
    }
  }
  return headers;
}

// In production, reliably ensure environment variables from .env are loaded if not already provided
if (!process.env.BASE_PAYMENT_API_URL && typeof process.loadEnvFile === 'function') {
  try {
    const rootEnv = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(rootEnv)) {
      process.loadEnvFile(rootEnv);
    }
  } catch {}
}

/**
 * Public entry point of the checkout (port 7000). The checkout UI itself is the Next.js app
 * (apps/web); this server keeps the stable public contract in front of it: the /api proxy,
 * the embeddable SDK (/youpi.js), icons, the QR endpoint and health checks.
 */
export class CheckoutServer {
  /**
   * @param {{ apiBaseUrl?: string }} options
   */
  constructor(options = {}) {
    this.apiBaseUrl = options.apiBaseUrl || process.env.PAYMENT_API_URL || process.env.BASE_PAYMENT_API_URL || 'http://localhost:6100';
    this.sdkScriptPath = path.join(__dirname, 'sdk', 'youpi.js');
  }

  async fetchPaymentState(paymentId) {
    try {
      const stateUrl = new URL(`/api/v1/checkout/${encodeURIComponent(paymentId)}/state`, this.apiBaseUrl);
      const res = await fetch(stateUrl, {
        headers: { 'X-Internal-Render': 'true', 'X-Internal-Token': getInternalServiceToken() }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP', service: 'checkout-portal' }));
        return;
      }

      // Keep-alive ping for cron / uptime monitors
      if (pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('ok');
        return;
      }

      // Transparent API Proxy: /api/* -> Payment Core REST API
      if (pathname.startsWith('/api/')) {
        const targetUrl = new URL(req.url, this.apiBaseUrl);
        const requestClient = targetUrl.protocol === 'https:' ? https : http;
        const proxyReq = requestClient.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || undefined,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: req.method,
          headers: {
            ...sanitizedForwardHeaders(req, targetUrl.host),
            'x-forwarded-host': req.headers.host || '',
            'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https'
          }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gateway API unavailable', details: err.message }));
          }
        });

        req.pipe(proxyReq);
        return;
      }

      // Official SDK script: GET /youpi.js or /sdk/youpi-checkout.js
      if (pathname === '/youpi.js' || pathname === '/sdk/youpi.js' || pathname === '/sdk/youpi-checkout.js') {
        try {
          const sdkContent = fs.readFileSync(this.sdkScriptPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(sdkContent);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading SDK: ' + err.message);
        }
        return;
      }

      // Static icons: GET /icons/:filename with path traversal protection
      if (pathname.startsWith('/icons/')) {
        const iconName = path.basename(pathname);
        const iconDir = path.resolve(__dirname, '..', 'public', 'icons');
        const iconPath = path.resolve(iconDir, iconName);
        const relative = path.relative(iconDir, iconPath);
        const isSecure = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        if (isSecure && fs.existsSync(iconPath)) {
          const ext = path.extname(iconName).toLowerCase();
          const contentType = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          });
          fs.createReadStream(iconPath).pipe(res);
          return;
        }
      }

      // QR SVG: GET /checkout/:id/qr.svg (Direct from merchant receiving account)
      const qrMatch = pathname.match(/^\/checkout\/([^/]+)\/qr\.svg$/);
      if (qrMatch) {
        const paymentId = qrMatch[1];
        const state = await this.fetchPaymentState(paymentId);
        const upiUri = state?.upiUri || `upi://pay?pa=${encodeURIComponent(state?.payeeVpa || 'merchant@upi')}&pn=${encodeURIComponent(state?.merchantName || 'Store')}&am=${encodeURIComponent(state?.amount || '100.00')}&tn=${encodeURIComponent(paymentId)}`;

        const svg = generateQrSvg(upiUri, 220);
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*',
          ...BASE_SECURITY_HEADERS
        });
        res.end(svg);
        return;
      }

      // Checkout page and Next.js static assets are served by apps/web. This server stays
      // authoritative for the page's framing policy, so the iframe contract is unchanged.
      if (pathname.startsWith('/_next/') || /^\/checkout\/[^/]+$/.test(pathname)) {
        relayToNextFrontend(req, res, undefined, pathname.startsWith('/checkout/') ? checkoutFrameHeaders() : {});
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Checkout Page Not Found');
    });
  }
}
