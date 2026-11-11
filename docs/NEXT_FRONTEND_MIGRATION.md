# Next.js + shadcn/ui frontend

The customer checkout and the merchant admin are a Next.js App Router app in `apps/web`
(TypeScript, Tailwind v4, shadcn/ui). They replaced the hand-written HTML pages
(`checkout.html`, `admin.html`) that used to live under `apps/checkout-portal` and
`apps/merchant-admin`; those pages and their template renderers have been removed.

The backend (payment API on 6100, SQLite, Android observer) is unchanged: the UI only talks to it
over HTTP.

## How it is wired

```
browser ──► checkout portal :7000 ──/checkout/:id, /_next/*──► Next.js :7100
            (public entry)        ──/api/*, /youpi.js, icons──► served locally / payment API :6100
browser ──► merchant admin :6001 ──/ and /admin, /_next/*────► Next.js :7100
                                  ──/api/*, APK, /health─────► served locally / payment API :6100
```

- `npm start` (or `npm run dev`) starts everything. The supervisor runs the Next.js app as the
  `web` service (`scripts/start-web.js`: `next build` on first start, then `next start`).
- The portal and admin servers stay the public entry points, so the iframe contract
  (`<portal>/checkout/:id`), `/youpi.js` and existing Cloudflare tunnels are unchanged. The portal
  still sets the framing CSP (`CHECKOUT_FRAME_ANCESTORS`).
- Standalone for development: `npm run dev -w @youpi/web` serves `/checkout/:id`, `/admin` and
  `/youpi.js` on <http://localhost:7100> and proxies `/api/*` itself. No CORS setup is needed.
- Render: see [DEPLOYMENT.md](DEPLOYMENT.md#5-deploy-on-render). There the Next.js app is the single
  public port and the payment API is private in the same container.

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `NEXT_WEB_PORT` / `NEXT_WEB_URL` | `7100` / `http://127.0.0.1:7100` | listen port / relay target |
| `YOUPI_WEB_DEV` | `false` | run `next dev` instead of a production build |
| `YOUPI_DEFAULT_MERCHANT_ID` | `0000…0001` | `x-merchant-id` added by the Next `/api` proxy |
| `PAYMENT_API_URL`, `CONTROL_CENTER_URL` | `:6100`, `:8090` | upstreams of the Next proxy |
| `YOUPI_GUEST_CHECKOUT` | unset | `true`: name form instead of WhatsApp OTP; the name is the UPI note |

## Layout

```
apps/web/src
  app/checkout/[id]       iframe page (same URL contract as before)
  app/admin               merchant dashboard
  app/health              liveness check
  app/api/[...path]       server-side proxy to :6100 (strips x-internal-*, streams SSE)
  app/api/services|logs   proxy to the control center :8090 (bearer token required)
  app/youpi.js            serves apps/checkout-portal/src/sdk/youpi.js unchanged
  proxy.ts                framing CSP for /checkout/* from CHECKOUT_FRAME_ANCESTORS at runtime
  components/ui           shadcn/ui components
  components/checkout     auth/name gate and checkout flow
  components/admin        operations, store settings, developer hub, security
  lib                     checkout hook, device identity, merchant postMessage bridge, admin API client, KPI maths
```

Security properties: customer/admin tokens travel in headers only (admin SSE uses fetch streaming,
never a query token), `x-internal-*` headers are stripped, the checkout posts to the storefront only
for a known origin (referrer or `youpi.js`'s `youpiParentOrigin`) and accepts `youpi.request_cancel`
only from it, redirect targets must be http(s), and `upi://` links are validated before use.

## What is and is not ported from the old pages

Checkout: everything is ported (sign-in or guest name, UPI QR and app intent, timer, queue, success /
failed / expired / cancelled / manual-review, blocked, duplicate-session and conflict screens, COD,
counter modes, order summary, reference code, unique-paise note, `youpi.*` postMessage events), with
a new shadcn layout. Not carried over: splash screen, header gradient themes, the time-saving banner.

Admin: ported are KPIs (Today's Volume counts `OBSERVED_SUCCESS`), live slots and queue, counter desk,
COD orders, ledger, Android pairing and devices, UPI accounts, brand/selling-mode settings,
supervisor and logs, secrets rotation, tunnel, WhatsApp, and the security pages.

**Removed with the old admin page and not rebuilt:** Gmail OAuth setup, payment simulator and
developer test mode, multi-merchant selector, "send test SMS", support tickets list, and the live
phone mock-up in brand settings. The APIs behind them still exist.

## Tests

`npm test` runs `apps/web/src/lib/__tests__/web-lib.test.ts` (KPI maths, UPI link and note handling)
with Node's native TypeScript support, plus the portal/admin relay tests. Web app checks:
`npm run typecheck -w @youpi/web` and `npm run build -w @youpi/web`.
