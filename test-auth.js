/**
 * Integration test: authentication, email verification, and password recovery.
 *
 * Usage:
 *   Start the app:  node app.js
 *   In another terminal:
 *     $env:TEST_ADMIN_EMAIL='admin@example.com'
 *     $env:TEST_ADMIN_PASSWORD='adminpass'
 *     $env:TEST_USER_EMAIL='user@example.com'
 *     $env:TEST_USER_PASSWORD='userpass'
 *     $env:TEST_NEW_EMAIL='newtest@example.com'
 *     node test-auth.js
 *
 * Reads credentials from environment variables. No hardcoded credentials.
 * Tests that read private inbox contents remain manual.
 */
const http = require('http');

const BASE = 'http://localhost:3000';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const USER_EMAIL = process.env.TEST_USER_EMAIL;
const USER_PASS = process.env.TEST_USER_PASSWORD;
const NEW_EMAIL = process.env.TEST_NEW_EMAIL;

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(label, condition, detail) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}

function skip(label) {
  skipped++;
  console.log(`  ⏭️  ${label} (no credentials)`);
}

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data,
          setCookie: res.headers['set-cookie'],
          redirect: res.headers.location || '',
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(new URLSearchParams(body).toString());
    req.end();
  });
}

function hasText(html, text) {
  return html.indexOf(text) >= 0;
}

async function main() {
  console.log('\n═══════════════════════════════════');
  console.log('  nlSite — Auth Integration Tests');
  console.log('═══════════════════════════════════\n');

  // ── Anonymous ──
  console.log('─ Anonymous visitor ─');
  {
    const r = await request('GET', '/admin');
    assert('/admin redirects to /auth/login', r.status === 302 && r.redirect.includes('/auth/login'));
  }
  {
    const r = await request('GET', '/admin/users');
    assert('/admin/users redirects to /auth/login', r.status === 302 && r.redirect.includes('/auth/login'));
  }
  {
    const r = await request('GET', '/auth/login');
    assert('/auth/login returns 200', r.status === 200);
  }
  {
    const r = await request('GET', '/');
    assert('/ returns 200', r.status === 200);
  }
  {
    const r = await request('GET', '/auth/forgot-password');
    assert('/auth/forgot-password returns 200', r.status === 200);
  }
  {
    const r = await request('GET', '/auth/verify-pending');
    assert('/auth/verify-pending returns 200', r.status === 200);
  }
  {
    const r = await request('GET', '/auth/resend-verification');
    assert('/auth/resend-verification returns 200', r.status === 200);
  }

  // ── Unknown user ──
  console.log('\n─ Unknown user login ─');
  {
    const r = await request('POST', '/auth/login', { email: 'noexiste@fake.com', password: 'anything' });
    assert('Rejected: 302 redirect to /auth/login', r.status === 302 && r.redirect === '/auth/login');
  }
  {
    const r = await request('GET', '/auth/login');
    assert('Page shows unauthenticated state', r.status === 200 && !hasText(r.data, 'Cerrar Sesión'));
  }

  // ── Email verification: unknown token rejected ──
  console.log('\n─ Email verification ─');
  {
    const r = await request('GET', '/auth/verify-email?token=invalid');
    assert('Unknown token: 302 to login', r.status === 302 && r.redirect.includes('/auth/login'));
  }
  {
    const r = await request('GET', '/auth/verify-email');
    assert('Empty token: 302 to login', r.status === 302 && r.redirect.includes('/auth/login'));
  }

  // ── Password reset: unknown token rejected ──
  console.log('\n─ Password reset ─');
  {
    const r = await request('GET', '/auth/reset-password?token=invalid');
    assert('Unknown reset token: 302 to login', r.status === 302 && r.redirect.includes('/auth/login'));
  }
  {
    const r = await request('GET', '/auth/reset-password');
    assert('Empty reset token: 302 to login', r.status === 302 && r.redirect.includes('/auth/login'));
  }
  {
    const r = await request('POST', '/auth/reset-password', {
      token: 'invalid',
      password: 'test1234',
      password2: 'test1234'
    });
    assert('Invalid token POST: 302 to login', r.status === 302 && r.redirect.includes('/auth/login'));
  }

  // ── Forgot-password generic response ──
  console.log('\n─ Forgot password generic ─');
  {
    const r = await request('POST', '/auth/forgot-password', { email: 'noexiste@fake.com' });
    assert('Unknown email: 302 back to forgot-password', r.status === 302 && r.redirect === '/auth/forgot-password');
  }
  {
    const r = await request('POST', '/auth/forgot-password', { email: '' });
    assert('Empty email: 302 back to forgot-password', r.status === 302 && r.redirect === '/auth/forgot-password');
  }

  // ── Registration does not create user immediately ──
  if (NEW_EMAIL) {
    console.log('\n─ Registration (pending verification) ─');
    {
      const r = await request('POST', '/auth/register', {
        name: 'Test New User',
        email: NEW_EMAIL,
        password: 'test1234',
        password2: 'test1234'
      });
      assert('Registration: redirect to verify-pending', r.status === 302 && r.redirect === '/auth/verify-pending');
    }
    {
      const r = await request('POST', '/auth/login', { email: NEW_EMAIL, password: 'test1234' });
      assert('Unverified email cannot login', r.status === 302 && r.redirect === '/auth/login');
    }
    {
      // Clean up temporary test registration
      const r2 = await request('GET', '/auth/verify-pending');
      assert('Verify-pending page loads', r2.status === 200);
    }
  } else {
    console.log('\n─ Registration (SKIPPED — no TEST_NEW_EMAIL) ─');
    skip('Registration tests require TEST_NEW_EMAIL');
  }

  // ── Normal user ──
  if (USER_EMAIL && USER_PASS) {
    console.log('\n─ Normal user ─');
    let userCookie = null;
    {
      const r = await request('POST', '/auth/login', { email: USER_EMAIL, password: USER_PASS });
      assert('Login: 302 redirect to /', r.status === 302 && r.redirect === '/');
      assert('Session cookie received', !!r.setCookie);
      userCookie = r.setCookie[0];
    }
    {
      const r = await request('GET', '/', null, userCookie);
      assert('Authenticated home: status 200', r.status === 200);
      assert('Authenticated home: navbar has logout form', hasText(r.data, '/auth/logout'));
      const navIdx = r.data.indexOf('<nav ');
      const featuresIdx = r.data.indexOf('features-grid');
      const adminLinkIdx = r.data.indexOf('href="/admin"');
      const inNav = navIdx >= 0 && adminLinkIdx >= 0 && adminLinkIdx < featuresIdx;
      assert('Normal user: no admin nav link', !inNav);
    }
    {
      const r = await request('GET', '/admin', null, userCookie);
      assert('Normal user /admin: redirect to /', r.status === 302 && r.redirect === '/');
    }
    {
      const r = await request('GET', '/admin/users', null, userCookie);
      assert('Normal user /admin/users: redirect to /', r.status === 302 && r.redirect === '/');
    }
    {
      const r = await request('POST', '/auth/logout', null, userCookie);
      assert('Logout: 302 redirect to /auth/login', r.status === 302 && r.redirect === '/auth/login');
    }
  } else {
    console.log('\n─ Normal user (SKIPPED — no credentials) ─');
    skip('Normal user tests require TEST_USER_EMAIL and TEST_USER_PASSWORD');
  }

  // ── Administrator ──
  if (ADMIN_EMAIL && ADMIN_PASS) {
    console.log('\n─ Administrator ─');
    let adminCookie = null;
    {
      const r = await request('POST', '/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
      assert('Admin login: 302 redirect to /admin', r.status === 302 && r.redirect === '/admin');
      assert('Session cookie received', !!r.setCookie);
      adminCookie = r.setCookie[0];
    }
    {
      const r = await request('GET', '/admin', null, adminCookie);
      assert('Admin dashboard: status 200', r.status === 200);
      assert('Admin dashboard: has logout form in navbar', hasText(r.data, '/auth/logout'));
      assert('Admin dashboard: shows Panel de Control', hasText(r.data, 'Panel de Control'));
    }
    {
      const r = await request('GET', '/admin/users', null, adminCookie);
      assert('Admin users list: status 200', r.status === 200);
    }
    {
      const r = await request('POST', '/admin/login', { email: 'noexiste@fake.com', password: 'anything' });
      assert('Admin login rejects unknown: 302 to /admin/login', r.status === 302 && r.redirect === '/admin/login');
    }
    {
      const r = await request('POST', '/auth/logout', null, adminCookie);
      assert('Admin logout: 302 to /auth/login', r.status === 302 && r.redirect === '/auth/login');
    }
    {
      const r = await request('GET', '/admin', null, adminCookie);
      assert('After logout: /admin redirects to login', r.status === 302 && r.redirect.includes('/auth/login'));
    }
  } else {
    console.log('\n─ Administrator (SKIPPED — no credentials) ─');
    skip('Admin tests require TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD');
  }

  // ── Summary ──
  console.log(`\n═══════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`═══════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err.message);
  process.exit(1);
});
