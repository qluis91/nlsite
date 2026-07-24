# Tilopay Client Setup Guide

This guide covers configuring a new independently deployed NLSite client site with Tilopay.

## Prerequisites

1. A running NLSite deployment with HTTPS in production
2. A Tilopay merchant account (create at https://web.tilopay.com/developers for sandbox, or via the production merchant process)

## Step 1: Obtain Tilopay Credentials

### Sandbox (Development)

1. Register as a developer at https://web.tilopay.com/developers
2. Complete the registration form (all fields required)
3. Receive sandbox credentials: API Key, API User, API Password
4. Obtain sandbox test card numbers from the portal

### Production

1. Complete Tilopay merchant affiliation
2. Access your merchant panel at https://admin.tilopay.com
3. Navigate to "Integración con plataformas"
4. Obtain: API Key (Llave API), API User (Usuario API), API Password (Contraseña API)

## Step 2: Configure Tilopay Merchant Portal

For the Tilopay callback/webhook to work, your site must be reachable via HTTPS.

1. Log in to https://admin.tilopay.com
2. Configure your callback/return URL pointing to your deployment:
   - Return URL: `https://YOUR-DOMAIN/pagos/tilopay/retorno`
   - Cancel URL: `https://YOUR-DOMAIN/pagos/tilopay/cancelado`
   - Webhook URL (if supported): `https://YOUR-DOMAIN/webhooks/tilopay`
3. Enable the desired payment methods (credit/debit cards, SINPE Móvil, etc.)

The exact configuration location depends on the current Tilopay portal version. Consult Tilopay support if the settings are not visible.

## Step 3: Configure Environment Variables

Add to your `.env` file:

```env
TILOPAY_ENABLED=true
TILOPAY_ENV=sandbox          # or production
TILOPAY_PUBLIC_BASE_URL=https://YOUR-DOMAIN
TILOPAY_API_KEY=your-api-key
TILOPAY_API_USER=your-api-user
TILOPAY_API_PASSWORD=your-api-password
TILOPAY_REQUEST_TIMEOUT_MS=15000
```

The return, cancel, and webhook URLs are derived automatically from `TILOPAY_PUBLIC_BASE_URL`.

## Step 4: Validate Configuration

Run the configuration validator:

```powershell
node scripts/validate-tilopay-config.js
```

Expected output:
```
Tilopay: ENABLED
  ✓ Environment: sandbox
  ✓ TILOPAY_API_KEY is set
  ✓ TILOPAY_API_USER is set
  ✓ TILOPAY_API_PASSWORD is set
  ✓ Public URL: https://YOUR-DOMAIN (https:)
  Derived URLs:
  ✓   Return: https://YOUR-DOMAIN/pagos/tilopay/retorno
  ✓   Cancel: https://YOUR-DOMAIN/pagos/tilopay/cancelado
  ✓   Webhook: https://YOUR-DOMAIN/webhooks/tilopay
  ✓ SDK script: https://app.tilopay.com/sdk/v1/sdk.min.js...
  ✓ API base: https://app.tilopay.com
  ✓ Request timeout: 15000ms
  ✓ Currency: CRC (Costa Rican colones)

Tilopay configuration valid for sandbox.
```

**The validator never prints credential values.**

## Step 5: Run Database Migration

```powershell
node scripts/migrate-tilopay.js
```

Run it twice to confirm idempotency (second run should be a no-op).

## Step 6: Restart Application

```powershell
npm start
```

On startup, the application validates Tilopay configuration. If variables are missing, it fails with a descriptive error.

## Step 7: Test in Sandbox

1. Create an order through the store checkout, selecting "Tarjeta con Tilopay" as payment method
2. Open the order detail and click "Pagar con Tilopay"
3. The Tilopay payment form should load (SDK V1 with jQuery)
4. Use sandbox test card numbers to complete a purchase
5. Verify the order transitions to "Pago confirmado"

If the payment form does not load, check:
- Browser console for JavaScript errors (CSP, SDK loading)
- Network tab for `sdk.min.js` and `jquery.min.js` loads
- Server logs for `[tilopay]` errors

## Step 8: Go to Production

After successful sandbox testing:

1. Change `TILOPAY_ENV=production`
2. Set `TILOPAY_PUBLIC_BASE_URL` to the production HTTPS domain
3. Use PRODUCTION credentials (never reuse sandbox credentials)
4. Re-run `node scripts/validate-tilopay-config.js`
5. Restart the application

## What Changes Per Client

| Item | Per-Client | Notes |
|------|-----------|-------|
| Codebase | Shared | Same application code for all deployments |
| `.env` credentials | Unique | Each client has their own Tilopay merchant account |
| `TILOPAY_PUBLIC_BASE_URL` | Unique | Each client's domain |
| Tilopay portal config | Unique | Callback URLs, payment methods, test cards |
| Enabled payment methods | May vary | Depends on Tilopay merchant account configuration |

## Known Limitations

- **Webhook verification**: The Tilopay webhook signature mechanism is not yet publicly documented. The webhook route currently uses server-to-server API lookup for verification.
- **SDK V2**: The SDK V2 guides require merchant portal login. The integration currently uses SDK V1 (`https://app.tilopay.com/sdk/v1/sdk.min.js`). When SDK V2 documentation becomes available, evaluate migration.
- **API endpoints**: GetTokenSdk and transaction status endpoint URLs are best-known estimates from WooCommerce plugin source. Verify against the Tilopay merchant portal.
- **Sandbox test**: A real sandbox transaction has not yet been completed against live Tilopay (pending credential generation).

## Troubleshooting

| Problem | Check |
|---------|-------|
| Tilopay not showing in checkout | Verify `TILOPAY_ENABLED=true` |
| Payment form won't load | Check `TILOPAY_PUBLIC_BASE_URL` is correct and HTTPS-accessible |
| SDK not loading | Check CSP allows `app.tilopay.com` for `script-src` and `connect-src` |
| jQuery not loading | Check CSP allows `ajax.googleapis.com` for `script-src` |
| Payment initiation fails | Check server logs for `[tilopay]` errors, verify credentials |
| Return page shows "verifying" | This is normal — the browser redirect has no payment status. The server reconciles separately. |
