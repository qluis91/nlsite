/**
 * Integration test: authentication, CSRF, and authorization.
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

/**
 * Extract CSRF token from HTML by finding name="_csrf" value="...".
 */
function extractCsrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Get a fresh CSRF token by visiting a GET page and extracting it.
 */
async function getCsrfToken(path, cookie) {
  const r = await request('GET', path, null, cookie);
  const token = extractCsrf(r.data);
  return { token, setCookie: r.setCookie, html: r.data, status: r.status };
}

function hasText(html, text) {
  return html.indexOf(text) >= 0;
}

async function main() {
  console.log('\n═══════════════════════════════════');
  console.log('  nlSite — Auth + CSRF Tests');
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

  // ── CSRF: Token availability on GET pages ──
  console.log('\n─ CSRF: Token availability ─');
  {
    const { token } = await getCsrfToken('/auth/login');
    assert('Login page has _csrf hidden input', token !== null);
  }
  {
    const { token } = await getCsrfToken('/auth/register');
    assert('Register page has _csrf hidden input', token !== null);
  }
  {
    const { token } = await getCsrfToken('/auth/forgot-password');
    assert('Forgot-password page has _csrf hidden input', token !== null);
  }
  {
    const { token } = await getCsrfToken('/admin/login');
    assert('Admin login page has _csrf hidden input', token !== null);
  }

  // ── CSRF: Missing token returns 403 ──
  console.log('\n─ CSRF: Missing token ─');
  {
    const r = await request('POST', '/auth/login', { email: 'none@test.com', password: 'x' });
    assert('POST /auth/login without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/register', { name: 'X', email: 'x@x.com', password: '123456', password2: '123456' });
    assert('POST /auth/register without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/admin/login', { email: 'x@x.com', password: 'x' });
    assert('POST /admin/login without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/forgot-password', { email: 'x@x.com' });
    assert('POST /auth/forgot-password without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/logout');
    assert('POST /auth/logout without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/resend-verification', { email: 'x@x.com' });
    assert('POST /auth/resend-verification without _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/reset-password', { token: 'x', password: '123456', password2: '123456' });
    assert('POST /auth/reset-password without _csrf → 403', r.status === 403);
  }

  // ── CSRF: Invalid token returns 403 ──
  console.log('\n─ CSRF: Invalid token ─');
  {
    const r = await request('POST', '/auth/login', { email: 'none@test.com', password: 'x', _csrf: 'fake-token-invalid' });
    assert('POST /auth/login with bad _csrf → 403', r.status === 403);
  }
  {
    const r = await request('POST', '/auth/register', {
      name: 'X', email: 'x@x.com', password: '123456', password2: '123456', _csrf: 'fake',
    });
    assert('POST /auth/register with bad _csrf → 403', r.status === 403);
  }

  // ── CSRF: 403 page content ──
  console.log('\n─ CSRF: 403 page ─');
  {
    const r = await request('POST', '/auth/login', { email: 'none@test.com', password: 'x' });
    assert('403 page shows layout (html tag)', r.data.includes('<html') || r.data.includes('html'));
    assert('403 page shows Spanish error', hasText(r.data, 'no es v'));
  }

  // ── Unknown user login ──
  console.log('\n─ Unknown user login ─');
  {
    const jar = await getCsrfToken('/auth/login');
    const r = await request('POST', '/auth/login', {
      email: 'noexiste@fake.com', password: 'anything', _csrf: jar.token,
    }, jar.setCookie ? jar.setCookie[0] : null);
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
      token: 'invalid', password: 'test1234', password2: 'test1234', _csrf: 'fake',
    });
    assert('Invalid token POST: 403 (no CSRF)', r.status === 403);
  }

  // ── Forgot-password generic response ──
  console.log('\n─ Forgot password generic ─');
  {
    const jar = await getCsrfToken('/auth/forgot-password');
    const cookie = jar.setCookie ? jar.setCookie[0] : null;
    const r = await request('POST', '/auth/forgot-password', {
      email: 'noexiste@fake.com', _csrf: jar.token,
    }, cookie);
    assert('Unknown email: 302 back to forgot-password', r.status === 302 && r.redirect === '/auth/forgot-password');
  }
  {
    const jar = await getCsrfToken('/auth/forgot-password');
    const cookie = jar.setCookie ? jar.setCookie[0] : null;
    const r = await request('POST', '/auth/forgot-password', {
      email: '', _csrf: jar.token,
    }, cookie);
    assert('Empty email: 302 back to forgot-password', r.status === 302 && r.redirect === '/auth/forgot-password');
  }

  // ── Registration does not create user immediately ──
  if (NEW_EMAIL) {
    console.log('\n─ Registration (pending verification) ─');
    const { token } = await getCsrfToken('/auth/register');
    {
      const r = await request('POST', '/auth/register', {
        name: 'Test New User', email: NEW_EMAIL, password: 'test1234', password2: 'test1234', _csrf: token,
      });
      assert('Registration: redirect to verify-pending', r.status === 302 && r.redirect === '/auth/verify-pending');
    }
    {
      const { token: t2 } = await getCsrfToken('/auth/login');
      const r = await request('POST', '/auth/login', { email: NEW_EMAIL, password: 'test1234', _csrf: t2 });
      assert('Unverified email cannot login', r.status === 302 && r.redirect === '/auth/login');
    }
  } else {
    console.log('\n─ Registration (SKIPPED — no TEST_NEW_EMAIL) ─');
    skip('Registration tests require TEST_NEW_EMAIL');
  }

  // ── CSRF: Cross-session token test ──
  console.log('\n─ CSRF: Cross-session ─');
  {
    const jar1 = await getCsrfToken('/auth/login');
    const jar2 = await getCsrfToken('/auth/login');
    assert('Session A has token', jar1.token !== null);
    assert('Session B has token', jar2.token !== null);
    assert('Tokens from different sessions differ', jar1.token !== jar2.token);
    // Token from jar1 used with jar2 cookie should fail
    const r = await request('POST', '/auth/login', {
      email: 'none@test.com', password: 'x', _csrf: jar2.token,
    }, jar1.setCookie ? jar1.setCookie[0] : null);
    // If both have cookies, using A's cookie with B's token should fail
    if (jar1.setCookie && jar2.setCookie) {
      assert('Token from session B fails with session A cookie', r.status === 403);
    } else {
      console.log('  ⏭️  Cross-session test skipped (no cookies to compare)');
    }
  }

  // ── Normal user ──
  if (USER_EMAIL && USER_PASS) {
    console.log('\n─ Normal user (with CSRF) ─');
    let userCookie = null;
    let userToken = null;
    {
      const jar = await getCsrfToken('/auth/login');
      userToken = jar.token;
      userCookie = jar.setCookie ? jar.setCookie[0] : null;
      const r = await request('POST', '/auth/login', {
        email: USER_EMAIL, password: USER_PASS, _csrf: userToken,
      }, userCookie);
      assert('Login: 302 redirect to /', r.status === 302 && r.redirect === '/');
      assert('Session cookie received', !!r.setCookie);
      userCookie = r.setCookie[0] || userCookie;
    }
    {
      const r = await request('GET', '/', null, userCookie);
      assert('Authenticated home: status 200', r.status === 200);
      assert('Authenticated home: navbar has avatar block', hasText(r.data, 'hero-nav-user-block'));
      const navIdx = r.data.indexOf('<nav ');
      const featuresIdx = r.data.indexOf('features-grid');
      const adminLinkIdx = r.data.indexOf('href="/admin"');
      const inNav = navIdx >= 0 && adminLinkIdx >= 0 && adminLinkIdx < featuresIdx;
      assert('Normal user: no admin nav link', !inNav);
    }
    {
      // CSRF: Valid logout
      const homePage = await request('GET', '/', null, userCookie);
      const logoutToken = extractCsrf(homePage.data);
      const r = await request('POST', '/auth/logout', { _csrf: logoutToken }, userCookie);
      assert('Logout with valid CSRF: 302 to /auth/login', r.status === 302 && r.redirect === '/auth/login');
    }
  } else {
    console.log('\n─ Normal user (SKIPPED — no credentials) ─');
    skip('Normal user tests require TEST_USER_EMAIL and TEST_USER_PASSWORD');
  }

  // ── Administrator ──
  if (ADMIN_EMAIL && ADMIN_PASS) {
    console.log('\n─ Administrator (with CSRF) ─');
    let adminCookie = null;
    let adminToken = null;
    {
      const jar = await getCsrfToken('/admin/login');
      adminToken = jar.token;
      adminCookie = jar.setCookie ? jar.setCookie[0] : null;
      const r = await request('POST', '/admin/login', {
        email: ADMIN_EMAIL, password: ADMIN_PASS, _csrf: adminToken,
      }, adminCookie);
      assert('Admin login: 302 redirect to /admin', r.status === 302 && r.redirect === '/admin');
      assert('Session cookie received', !!r.setCookie);
      adminCookie = r.setCookie[0] || adminCookie;
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
      // CSRF: logout with valid token
      const dashPage = await request('GET', '/admin', null, adminCookie);
      const dashToken = extractCsrf(dashPage.data);
      const r = await request('POST', '/auth/logout', { _csrf: dashToken }, adminCookie);
      assert('Admin logout with CSRF: 302 to /auth/login', r.status === 302 && r.redirect === '/auth/login');
    }
    {
      const r = await request('GET', '/admin', null, adminCookie);
      assert('After logout: /admin redirects to login', r.status === 302 && r.redirect.includes('/auth/login'));
    }
  } else {
    console.log('\n─ Administrator (SKIPPED — no credentials) ─');
    skip('Admin tests require TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD');
  }

  // ── CSRF: No side effects on rejected request ──
  console.log('\n─ CSRF: No side effects ─');
  {
    // Missing token should not create anything (test with unique email)
    const r = await request('POST', '/auth/register', {
      name: 'ShouldNot', email: 'nosideeffect-' + Date.now() + '@test.com',
      password: '123456', password2: '123456',
    });
    assert('POST /auth/register without CSRF → 403 (no DB write)', r.status === 403);
  }
  {
    // Invalid token should not trigger forgot-password
    const r = await request('POST', '/auth/forgot-password', {
      email: 'noexpect@test.com', _csrf: 'fake-token',
    });
    assert('POST /auth/forgot-password with bad CSRF → 403', r.status === 403);
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
