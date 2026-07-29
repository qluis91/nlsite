const { startTestServer, stopTestServer, getTestServer } = require('./tests/testServer');
const { migrateStoreHeroCms } = require('./scripts/migrate-store-hero-cms');
const pool = require('./config/db');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const m = 'diag_' + Date.now();
    const info = await startTestServer();
    await migrateStoreHeroCms();
    
    const h = await bcrypt.hash('Test123!', 8);
    await pool.query('INSERT INTO users (name, email, password, role_id, is_active) VALUES (?,?,?,1,1)', [m,m+'@t.com',h]);

    const jar = {};
    const baseUrl = info.baseUrl;

    async function req(method, path, fields = null) {
      const headers = {};
      let body;
      if (fields) {
        body = new URLSearchParams(fields).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      if (jar.cookie) headers.Cookie = jar.cookie;
      const resp = await fetch(baseUrl + path, { method, headers, body, redirect: 'manual' });
      const setCookie = resp.headers.get('set-cookie');
      if (setCookie) {
        const mc = setCookie.match(/(connect\.sid=[^;]+)/);
        if (mc) jar.cookie = mc[1];
      }
      return { status: resp.status, location: resp.headers.get('location'), text: await resp.text() };
    }

    const loginPage = await req('GET', '/auth/login?returnTo=%2Fadmin');
    const csrfMatch = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/);
    await req('POST', '/auth/login', {
      email: m+'@t.com', password: 'Test123!', _csrf: csrfMatch[1], returnTo: '/admin',
    });

    const heroRes = await req('GET', '/admin/page/store-hero');
    console.log('Hero status:', heroRes.status);
    
    // Read server logs
    const server = getTestServer();
    console.log('=== SERVER LOGS ===');
    console.log(server?.logs || 'no logs');
    console.log('=== END LOGS ===');

    await pool.query('DELETE FROM users WHERE email=?', [m+'@t.com']);
    await pool.end();
    await stopTestServer();
    console.log('DONE');
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  }
})();
