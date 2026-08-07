const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tilopayConfig = require('../config/tilopay');
const { validateHostedCheckoutUrl } = require('../services/tilopayClient');

function assertAccepted(url, environment) {
  const parsed = validateHostedCheckoutUrl(url, { environment });
  assert.equal(parsed.href, url);
}

function assertRejected(url, environment) {
  assert.throws(
    () => validateHostedCheckoutUrl(url, { environment }),
    (error) => error?.code === 'TILOPAY_INVALID_URL'
  );
}

describe('Tilopay exact hosted-checkout URL validation', () => {
  it('uses the existing sandbox and production environment names', () => {
    assert.deepEqual(tilopayConfig.getHostedCheckoutHosts('sandbox'), [
      'secure.tilopay.com',
      'securepayment.tilopay.com',
    ]);
    assert.deepEqual(tilopayConfig.getHostedCheckoutHosts('production'), [
      'secure.tilopay.com',
    ]);
    assert.deepEqual(tilopayConfig.getHostedCheckoutHosts('unknown'), []);
  });

  it('accepts both exact sandbox hosts', () => {
    assertAccepted('https://securepayment.tilopay.com/checkout/session', 'sandbox');
    assertAccepted('https://secure.tilopay.com/checkout/session', 'sandbox');
  });

  it('accepts only the production host with production evidence', () => {
    assertAccepted('https://secure.tilopay.com/checkout/session', 'production');
    assertRejected('https://securepayment.tilopay.com/checkout/session', 'production');
  });

  for (const environment of ['sandbox', 'production']) {
    it(`rejects insecure, deceptive, credentialed, ported, and malformed URLs in ${environment}`, () => {
      for (const url of [
        'http://secure.tilopay.com/checkout/session',
        'http://securepayment.tilopay.com/checkout/session',
        'https://faketilopay.com/checkout/session',
        'https://secure.tilopay.com.evil.example/checkout/session',
        'https://securepayment.tilopay.com.evil.example/checkout/session',
        'https://evil.example/?next=https://secure.tilopay.com/',
        'https://user:pass@secure.tilopay.com/checkout/session',
        'https://user:pass@securepayment.tilopay.com/checkout/session',
        'https://secure.tilopay.com:8443/checkout/session',
        'https://securepayment.tilopay.com:8443/checkout/session',
        'not-a-url',
        '://malformed',
      ]) {
        assertRejected(url, environment);
      }
    });
  }
});
