# Tilopay Payment Integration — Architecture & Status

**Last updated:** 2026-08-07

## Integration Status: SANDBOX VALIDATED ✅

The hosted-payment integration is functionally validated end-to-end in sandbox: login, processPayment, hosted checkout, consult verification, atomic confirmation, and all negative scenarios. Production E2E remains pending.

## Official API Endpoints

| Operation | Method | URL |
|-----------|--------|-----|
| Login (get token) | `POST` | `https://app.tilopay.com/api/v1/login` |
| Process Payment | `POST` | `https://app.tilopay.com/api/v1/processPayment` |
| Consult Transaction | `POST` | `https://app.tilopay.com/api/v1/consult` |

Source: Tilopay Postman collection (`_local/tilopay-official.postman_collection.json`).

## Architecture: Hosted Payment Flow

```
1. POST /api/v1/login        → { access_token, token_type, expires_in }
2. POST /api/v1/processPayment → { type: "100", url: "https://secure.tilopay.com/..." }
3. Redirect customer to hosted URL (secure.tilopay.com)
4. Customer completes payment on Tilopay's secure page
5. Browser redirects back → /pagos/tilopay/retorno?ref=<internalRef>
6. Server calls POST /api/v1/consult → authoritative provider result
7. Atomic confirmation: only code "1" (approved) with matching amount/currency marks order paid
```

Card data never reaches NLSite. The customer enters card details on Tilopay's hosted page.

## Sandbox Checkout Hosts

- `securepayment.tilopay.com`
- `secure.tilopay.com`

## Production Host Allowlist

- `secure.tilopay.com` only

`securepayment.tilopay.com` is NOT yet assumed for production.

All URLs must be HTTPS. Embedded credentials, non-default ports, and subdomain/suffix spoofing are rejected.

## Real Sandbox Consult Codes (Observed)

| Code | Meaning | Internal Status | Customer Label |
|------|---------|-----------------|----------------|
| `1` | Approved | `approved` | Confirmado |
| `2` | Declined / Denied | `declined` | Rechazado |
| `7` | 3DS / authentication failed | `declined` | Rechazado |
| `8` | Cancelled | `cancelled` | Cancelado |
| `43` | Stolen / pick-up card | `declined` | Rechazado |
| `51` | Insufficient funds | `declined` | Rechazado |
| `82` | Invalid CVV | `declined` | Rechazado |
| `98` | Issuer unreachable | `declined` | Rechazado |

Unknown codes use a safe generic Spanish fallback. All customer-facing messages come from the centralized `config/tilopayStatusMap.js`. Raw provider English text (e.g. "Insufficient funds", "Pick up card stolen card") is NEVER exposed to customers.

## Security Guarantees

| Rule | Enforcement |
|------|-------------|
| Browser query params NOT authoritative | Server-to-server `/api/v1/consult` only |
| Only confirmed approved marks paid | Code `"1"` + matching amount + matching currency |
| Amount/currency/orderNumber validated | Exact match required before confirmation |
| Paid orders never regress | `NOT IN ('approved','paid')` guards |
| Confirmation atomic/idempotent | DB transaction + `FOR UPDATE` locks |
| Webhook non-authoritative | No unauthenticated payment transitions |
| CSP strict | `form-action 'self'`, nonce-based `script-src` |
| No card data in NLSite | Hosted flow — card fields on Tilopay's domain |

## Retry & Idempotency

- Only one active payment attempt per order at a time (`creating` or recent `pending`)
- Concurrent submissions reuse the existing attempt
- Terminal declined/cancelled/failed attempts allow retry
- A new `tilopay_transactions` row is created for each retry
- Prior attempts are preserved for history

## Stale Pending Handling

- `PENDING_STALE_THRESHOLD_MS`: 15 minutes (900,000ms)
- Recent pending attempts (< 15 min) show "Verificando" in the UI
- Stale pending attempts (> 15 min) with no provider transaction → terminal `failed`
- Stale attempts are marked `failed` when a new payment attempt is initiated
- Order remains `payment_status=pending` and `order_status=pending_payment`

## Return/Abandonment Flow

- If browser returns but consult finds no transaction within the stale window → neutral "Estamos verificando tu pago..." toast
- After stale threshold → attempt transitions to `failed`, "No completado" shown, retry available
- Abandonment (customer never returns) → stale handler eventually closes the attempt; no browser callback required

## OrderHash

The Tilopay `OrderHash` field is received but NOT treated as verified. The algorithm is not documented by Tilopay. Server-to-server consultation is authoritative.

## Files

| File | Purpose |
|------|---------|
| `config/tilopay.js` | Environment validation, API URLs, MOCK_MODE gating |
| `config/tilopayStatusMap.js` | Status normalization, stale threshold, safe Spanish messages |
| `services/tilopayClient.js` | Provider HTTP adapter — login, processPayment, consultTransaction |
| `services/tilopayService.js` | Business logic — initiation, verifyAndConfirmPayment, atomic confirmation |
| `controllers/tilopayController.js` | Route handlers — initiate, return, verify |
| `views/pages/tilopay-pay.ejs` | Hosted-payment checkout form (no card fields, no SDK) |
| `views/pages/store/order-detail.ejs` | Order detail with Tilopay transaction history, retry buttons |
| `services/customerOrderService.js` | resolveNextAction — age-aware payment status summary |
| `scripts/migrate-tilopay.js` | Idempotent migration for `tilopay_transactions` |
| `tests/tilopay.test.js` | Automated tests (144 tests, 100% passing) |

## Environment Variables

```bash
TILOPAY_ENABLED=false              # true to enable
TILOPAY_ENV=sandbox                # sandbox | production
TILOPAY_API_BASE_URL=              # API base URL (default: https://app.tilopay.com)
TILOPAY_PUBLIC_BASE_URL=           # Public URL of THIS site
TILOPAY_API_KEY=                   # Integration key from Tilopay portal
TILOPAY_API_USER=                  # API user from Tilopay portal
TILOPAY_API_PASSWORD=              # API password from Tilopay portal
TILOPAY_MOCK=false                 # Mock mode — DEVELOPMENT ONLY, blocked in production
TILOPAY_REQUEST_TIMEOUT_MS=15000   # Request timeout
```

## What's NOT Yet Complete

| Item | Status |
|------|--------|
| Production E2E | Pending |
| `TILOPAY_ENABLED=true` in production | Pending |
| Admin reconciliation panel | Pending |
| Scheduled reconciliation (cron/interval) | Pending |
| Railway production deployment with correct `TILOPAY_PUBLIC_BASE_URL` | Pending |
| Webhook signature verification | Pending official documentation |
| SDK V1 legacy code removal | Pending Phase 2 cleanup |
