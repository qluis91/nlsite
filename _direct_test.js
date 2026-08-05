const http = require('http');
require('./config/testBootstrap');
process.env.PORT = '0';

const app = require('./app');
const server = http.createServer(app);
server.listen(0, async () => {
  const port = server.address().port;
  console.log('Direct server on:', port);
  
  const { migrateStoreHeroCms } = require('./scripts/migrate-store-hero-cms');
  await migrateStoreHeroCms();
  
  const pool = require('./config/db');
  const bcrypt = require('bcryptjs');
  const m = 'direct_' + Date.now();
  const h = await bcrypt.hash('Test123!', 8);
  await pool.query('INSERT INTO users (name, email, password, role_id, is_active) VALUES (?,?,?,1,1)', [m,m+'@t.com',h]);

  const jar = {};
  const baseUrl = `http://127.0.0.1:${port}`;

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
  if (heroRes.status === 200) {
    console.log('OK! Contains "Hero de Tienda":', heroRes.text.includes('Hero de Tienda'));
  } else {
    console.log('First 500 chars:', heroRes.text.slice(0, 500));
    console.log('Last 500 chars:', heroRes.text.slice(-500));
  }

  await pool.query('DELETE FROM users WHERE email=?', [m+'@t.com']);
  await pool.end();
  server.close();
  process.exit(0);
});
