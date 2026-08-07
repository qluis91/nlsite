# Tilopay Payment Integration — Architecture & Status

**Last updated:** 2026-08-06

## Integration Status: BLOCKED — Documentation Incomplete

The provider-neutral architecture is implemented and compiles cleanly, but REAL provider API calls cannot be completed until the Tilopay server-side documentation is confirmed.

## Documentation Access Status

| Source | Status |
|--------|--------|
| SDK V1 PDF (`https://app.tilopay.com/sdk/documentation.pdf`) | ✅ Audited (v1.2.0, 2023-08-30) |
| SDK V2 guides (`https://web.tilopay.com/documentacion/sdk`) | ❌ Behind merchant portal login — links produce Internal Server Error |
| Postman API collection (`https://documenter.getpostman.com/view/12758640/TVKA5KUT`) | ❌ Requires JavaScript rendering |
| Official API docs page (`https://web.tilopay.com/documentacion/api`) | ❌ Marketing content only |
| Developer registration (`https://web.tilopay.com/developers`) | ✅ Available (credential generation) |
| WooCommerce plugin source | ✅ Secondary evidence (credential model) |

## What IS Confirmed

| Item | Value | Source |
|------|-------|--------|
| Integration mode | SDK V1 (native payment form) | SDK V1 PDF |
| SDK script URL | `https://app.tilopay.com/sdk/v1/sdk.min.js` | SDK V1 PDF |
| jQuery dependency | Required by SDK V1 | SDK V1 PDF |
| Credential model | API Key + API User + API Password | WooCommerce plugin |
| Auth method | Basic Auth + X-Api-Key header | WooCommerce plugin |
| Client init | `Tilopay.Init({token, currency, amount, ...})` | SDK V1 PDF |
| Client pay | `Tilopay.startPayment()` | SDK V1 PDF |
| SDK token source | `GetTokenSdk` server-side API method | SDK V1 PDF |
| Currency format | ISO 4217 codes (e.g., CRC, USD) | SDK V1 PDF |
| Amount format | Decimal (e.g., 100.00) | SDK V1 PDF |
| Domains | `app.tilopay.com` (SDK/API) | SDK V1 PDF + WooCommerce |
| Merchant portal | `admin.tilopay.com` | Product page |

## What Is UNCONFIRMED (Blocking Real API Calls)

| Item | Status |
|------|--------|
| GetTokenSdk endpoint URL | Not documented publicly — best estimate: `POST /api/v1/token_sdk` |
| Transaction status endpoint URL | Not documented publicly — best estimate: `GET /api/v1/transactions/:id` |
| Webhook existence for SDK payments | Not confirmed |
| Webhook signature mechanism | Not confirmed (no HMAC, no header names, no algorithm) |
| Webhook payload format | Not confirmed |
| Webhook URL registration location | Presumably merchant portal (`admin.tilopay.com`) |
| SDK V2 API surface | Cannot access guides (behind login) |
| Token lifetime | Not documented |
| Server-side auth token model | Not confirmed (Basic Auth per-request vs token caching) |
| Sandbox test cards | Requires developer registration |
| 3DS flow behavior | Presumed SDK-handled (via `#result` div in V1) |

## Best-Known Endpoint Estimates

⚠️ These paths are derived from WooCommerce plugin source code and SDK V1 PDF conventions. They MUST be verified against the Tilopay merchant portal before production use.

```
GetTokenSdk:      POST https://app.tilopay.com/api/v1/token_sdk
Transaction Lookup: GET https://app.tilopay.com/api/v1/transactions/:id
```

## Architecture

### Integration Mode: SDK V1 (Native Payment Form)

- Card fields (`ccnumber`, `expdate`, `cvv`) render in a `.payFormTilopay` div in the merchant page
- The Tilopay JavaScript SDK (`sdk.min.js`) controls these fields — raw card data does NOT reach the Express server
- Server-side obtains an SDK token from Tilopay's `GetTokenSdk` API
- Client calls `Tilopay.Init({token, currency, amount, ...})` to initialize
- Client calls `Tilopay.startPayment()` to process payment
- 3DS challenges (if any) are handled in the `#result` div by the SDK
- On completion, Tilopay redirects to the configured `redirect` URL

### Payment Initiation (3-Stage Process)

```
Stage A (inside TX):
  - Lock order with SELECT ... FOR UPDATE
  - Validate eligibility (method, status, total, shipping)
  - Check for existing active attempt
  - Create tilopay_transactions row with status=creating
  - Insert audit event
  - Commit

Stage B (outside TX):
  - Call GetTokenSdk with server-authoritative amount/currency/order
  - If Mock Mode: return safe test token

Stage C (inside TX):
  - Persist provider session token
  - Set status=pending
  - Commit
```

### Webhook/Notification Architecture

Since webhook signature mechanism is not confirmed:

1. Accept JSON notification at `POST /webhooks/tilopay` (no session, no CSRF)
2. Extract provider/internal reference from body
3. Perform authenticated server-to-server lookup via `getTransactionStatus()`
4. Use the lookup result — NOT the notification body — as authoritative
5. Process via `confirmPayment()` (same path as reconciliation)

When Tilopay documents a signature mechanism:
- Add signature verification before the server-to-server lookup
- Server-to-server lookup remains as an additional verification check

### Payment Verification (Centralized)

One shared `verifyTilopayPayment(internalRef, { trigger, actorUserId })` operation is the single authoritative path used by ALL verification flows:

| Trigger | Route | Auth |
|---------|-------|------|
| `return` | `GET /pagos/tilopay/retorno?ref=` | None (public) |
| `customer_verify` | `POST /cuenta/pedidos/:ref/tilopay/verificar` | Session + CSRF + ownership |
| `guest_verify` | `POST /consultar-pedido/:ref/tilopay/verificar` | Guest grant + CSRF |
| `admin` | `POST /admin/orders/:ref/tilopay/reconcile` | Admin session + CSRF |
| `webhook` | `POST /webhooks/tilopay` | Provider notification |

The operation:
1. Loads local transaction + order
2. If already terminally resolved → returns cached result (idempotent)
3. Calls Tilopay `getTransactionStatus()` provider endpoint
4. Validates: provider transaction ID, amount (exact), currency, status
5. Only `approved` with matching amount/currency → `confirmPayment()` → marks order paid
6. Returns provider-neutral result object

**Result contract:**
```
{ verified, localStatus, orderPaid, terminal, retryAllowed, messageCode, customerMessage }
```

**Browser return safety:**
- Query parameters (`?success=true`, `?status=approved`, `?payment_status=paid`) NEVER mark an order paid
- Return page uses only the `?ref=` parameter to locate the local transaction, then performs server-to-server verification
- Provider HTTP 200 alone NEVER marks an order paid

```
Inside one transaction:
  1. Lock tilopay_transactions row
  2. Lock orders row
  3. Verify not already terminally processed
  4. Normalize provider status
  5. Verify amount (exact match required)
  6. Verify currency match
  7. Only 'approved' → payment_status=paid, order_status=payment_confirmed
  8. Insert exactly one approval event
  9. Commit
```

## Files

| File | Purpose |
|------|---------|
| `config/tilopay.js` | Environment validation, PUBLIC_BASE_URL, derived URLs, MOCK_MODE gating |
| `config/tilopayStatusMap.js` | Status normalization, terminal/approval/retry helpers |
| `services/tilopayClient.js` | Provider HTTP adapter — GetTokenSdk, getTransactionStatus |
| `services/tilopayService.js` | Business logic — initiation (3-stage), confirmation, notification, reconciliation |
| `controllers/tilopayController.js` | Route handlers — pay, return, cancel, handleWebhook, adminReconcile |
| `routes/tilopayRoutes.js` | User-facing routes (initiation, return, cancel) |
| `routes/tilopayWebhookRoutes.js` | Notification route (bounded JSON, no session, no CSRF) |
| `scripts/migrate-tilopay.js` | Idempotent migration for `tilopay_transactions` |
| `scripts/validate-tilopay-config.js` | Configuration validator (safe output, no credentials exposed) |
| `views/pages/tilopay-pay.ejs` | Payment form with Tilopay SDK V1 + jQuery |
| `views/pages/tilopay-result.ejs` | Payment result page (return/cancel) |
| `tests/tilopay.test.js` | Automated tests (~30 tests) |
| `docs/TILOPAY_CLIENT_SETUP.md` | Client installation guide |

## Environment Variables

```bash
TILOPAY_ENABLED=false              # true to enable
TILOPAY_ENV=sandbox                # sandbox | production
TILOPAY_PUBLIC_BASE_URL=           # Public URL of THIS site (e.g. https://cliente.example)
TILOPAY_API_KEY=                   # Integration key from Tilopay portal
TILOPAY_API_USER=                  # API user from Tilopay portal
TILOPAY_API_PASSWORD=              # API password from Tilopay portal
TILOPAY_MOCK=false                 # Mock mode — DEVELOPMENT ONLY, blocked in production
TILOPAY_REQUEST_TIMEOUT_MS=15000   # Request timeout
```

Derived URLs (from `TILOPAY_PUBLIC_BASE_URL`):
- Return: `{PUBLIC_BASE_URL}/pagos/tilopay/retorno`
- Cancel: `{PUBLIC_BASE_URL}/pagos/tilopay/cancelado`
- Webhook: `{PUBLIC_BASE_URL}/webhooks/tilopay`

## PCI Boundary

| Card data | Reaches NLSite server? |
|-----------|----------------------|
| Card number | ❌ No — in merchant DOM but handled by Tilopay SDK |
| CVV | ❌ No — handled by Tilopay SDK |
| Expiration | ❌ No — handled by Tilopay SDK |
| Stored in DB | ❌ No card fields stored |
| Stored in logs | ❌ No card fields logged |

## Credential Security

**⚠️ Published test credentials MUST NOT be used:**
- `6609-5850-8330-8034-3464` (API Key — published on WooCommerce plugin page)
- `lSrT45` (API User — published on WooCommerce plugin page)
- `Zlb8H9` (API Password — published on WooCommerce plugin page)

Required before production:
1. Register at `https://web.tilopay.com/developers` for sandbox credentials
2. Generate NEW production credentials from Tilopay merchant panel
3. Place only in `.env` — never in source code, docs, or tests

## What's NOT Yet Complete

| Item | Status |
|------|--------|
| Real Tilopay API endpoint URLs confirmed | ❌ Pending merchant portal access |
| Webhook signature mechanism confirmed | ❌ Pending documentation |
| Sandbox transaction completed | ❌ Pending sandbox credentials |
| Webhook end-to-end validated | ❌ Pending callback URL + signatures |
| Real-browser visual validation | ❌ Pending sandbox credentials |
| Sandbox credentials obtained | ❌ Pending developer registration |
| SDK V2 evaluated | ❌ Guides behind login |
| Automated payment-success simulation (with DB) | ⚠ Provider-neutral logic tested; needs live DB + mock provider adapter for deterministic DB assertions |
| Automated payment-failure simulation (declined/pending/cancelled/failed) | ⚠ Same: logic tested, DB assertions need live DB setup |
| Concurrency test (webhook + reconciliation) | ⚠ Provider-neutral; needs mock provider delay simulation |
| Client installation guide | ✅ `docs/TILOPAY_CLIENT_SETUP.md` |
| Config validator | ✅ `scripts/validate-tilopay-config.js` |
| Mock mode gated from production | ✅ `TILOPAY_MOCK=true` blocked when `NODE_ENV=production` |
