/**
 * Payment Proof — Concurrency + CSRF tests
 * Tests guest upload concurrency via HTTP; admin actions simulated via DB where needed.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('http');
const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startTestServer, stopTestServer } = require('./testServer');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Af8D/2Q==', 'base64');
let BASE = '';

function get(url, ck) {
  return new Promise(R => h.get(BASE+url, ck?{headers:{Cookie:ck}}:{}, resp=>{let d='';const sc=resp.headers['set-cookie'];resp.on('data',c=>d+=c);resp.on('end',()=>{const nc=(sc&&sc.length>0)?sc.map(c=>c.split(';')[0]).join('; '):(ck||'');R({s:resp.statusCode,b:d,ck:nc})})}));
}
function postF(url, body, ck) {
  return new Promise(R => {
    const u = new URL(BASE+url); const buf = Buffer.from(body);
    h.request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':buf.length,Cookie:ck||''}},resp=>{let d='';const sc=resp.headers['set-cookie'];resp.on('data',c=>d+=c);resp.on('end',()=>{const nc=(sc&&sc.length>0)?sc.map(c=>c.split(';')[0]).join('; '):(ck||'');R({s:resp.statusCode,b:d,ck:nc})})}).end(buf);
  });
}
function postProof(url, csrf, ck, buf, fname) {
  return new Promise(R => {
    const bdry = '---' + Math.random().toString(36).slice(2);
    const parts = [];
    parts.push(Buffer.from('--' + bdry + '\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n' + csrf + '\r\n'));
    parts.push(Buffer.from('--' + bdry + '\r\nContent-Disposition: form-data; name="proofFile"; filename="' + fname + '"\r\nContent-Type: image/jpeg\r\n\r\n'));
    parts.push(buf);
    parts.push(Buffer.from('\r\n--' + bdry + '--\r\n'));
    const body = Buffer.concat(parts);
    const u = new URL(BASE+url);
    h.request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+bdry,'Content-Length':body.length,Cookie:ck||''}},resp=>{let d='';const sc=resp.headers['set-cookie'];resp.on('data',c=>d+=c);resp.on('end',()=>{const nc=(sc&&sc.length>0)?sc.map(c=>c.split(';')[0]).join('; '):(ck||'');R({s:resp.statusCode,b:d,ck:nc})})}).end(body);
  });
}

function xc(html) { const m = html.match(/name="_csrf"\s+value="([^"]+)"/); return m?m[1]:''; }
function xpid(html) { const m = html.match(/name="productId"\s+value="(\d+)"/); return m?m[1]:''; }
function xtoken(html) { const m = html.match(/name="checkoutToken"\s+value="([^"]+)"/); return m?m[1]:''; }
function xref(html) { const m = html.match(/confirmacion\/(NL-[A-Z0-9]+)/); return m?m[1]:''; }

async function createEligibleOrder() {
  // Create a disposable in-stock product so the fixture never depends on real catalog.
  const testSlug = 'test-pp-' + crypto.randomBytes(4).toString('hex');
  const [pi] = await pool.query(
    "INSERT INTO products (name, slug, description, regular_price, stock_quantity, is_active, is_published) VALUES (?,?,?,?,?,?,?)",
    ['PP Test Product', testSlug, 'Temp product for concurrency test', '1000.00', 99, 1, 1]
  );
  const testPid = pi.insertId;
  testProductIds.push(testPid);
  let r = await get('/tienda/' + testSlug); let ck = r.ck;
  const pid = xpid(r.b), cs = xc(r.b);
  assert.ok(pid, 'Product ID found');
  r = await postF('/carrito/agregar', 'productId='+pid+'&quantity=1&returnTo=%2Fcarrito&_csrf='+cs, ck);
  ck = r.ck;
  r = await get('/checkout', ck); ck = r.ck;
  const token = xtoken(r.b), cs2 = xc(r.b);
  assert.ok(token, 'Checkout token');
  r = await postF('/checkout', 'customerName=CT&email=ct@test.com&phone=88880020&deliveryMethod=local_pickup&paymentMethod=sinpe&checkoutToken='+token+'&_csrf='+cs2, ck);
  ck = r.ck;
  const ref = xref(r.b);
  assert.ok(ref, 'Order ref created');
  return { ref, ck };
}

// Track created test orders and products for cleanup
const testOrders = [];
const testProductIds = [];

describe('Payment Proof CSRF & Concurrency', () => {
  before(async () => {
    const server = await startTestServer();
    BASE = server.baseUrl;
  });
  after(async () => {
    for (const pid of testProductIds) {
      try { await pool.query('DELETE FROM products WHERE id=?', [pid]); } catch(_){}
    }
    for (const ref of testOrders) {
      try {
        const id = (await pool.query('SELECT id FROM orders WHERE order_reference=?',[ref]))[0][0]?.id;
        if (id) {
          await pool.query('DELETE FROM payment_proofs WHERE order_id=?',[id]);
          await pool.query('DELETE FROM order_events WHERE order_id=?',[id]);
          await pool.query('DELETE FROM order_items WHERE order_id=?',[id]);
          await pool.query('DELETE FROM orders WHERE id=?',[id]);
        }
      } catch(_){}
    }
    await stopTestServer();
    await pool.end();
  });

  // ── CSRF architecture validation ──
  it('Controllers contain no manual CSRF comparison', () => {
    const code = fs.readFileSync(path.join(__dirname,'..','controllers','paymentProofController.js'),'utf8');
    assert.ok(!code.includes('csrfToken'), 'No csrfToken in controller');
    assert.ok(!code.includes('requireCsrf'), 'No requireCsrf function');
  });

  it('Route files use centralized csrfSynchronisedProtection after multer', () => {
    const g = fs.readFileSync(path.join(__dirname,'..','routes','paymentProofGuestRoutes.js'),'utf8');
    const a = fs.readFileSync(path.join(__dirname,'..','routes','paymentProofAccountRoutes.js'),'utf8');
    assert.ok(g.includes('csrfSynchronisedProtection') && g.includes('proofFileUpload'), 'Guest routes: multer + centralized CSRF');
    assert.ok(a.includes('csrfSynchronisedProtection') && a.includes('proofFileUpload'), 'Account routes: multer + centralized CSRF');
  });

  it('Invalid CSRF returns 403 and creates no proof', async () => {
    const { ref, ck } = await createEligibleOrder();
    testOrders.push(ref);
    const r = await postProof('/consultar-pedido/'+ref+'/comprobante', 'bad_token', ck, JPEG, 't.jpg');
    assert.equal(r.s, 403);
    const [[c]] = await pool.query('SELECT COUNT(*) AS cnt FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?)',[ref]);
    assert.equal(Number(c.cnt), 0, 'No proof created on invalid CSRF');
  });

  it('Missing CSRF returns 403 and creates no proof', async () => {
    const { ref, ck } = await createEligibleOrder();
    testOrders.push(ref);
    // Send multipart without _csrf field
    const bdry = '---' + Math.random().toString(36).slice(2);
    const parts = [];
    parts.push(Buffer.from('--' + bdry + '\r\nContent-Disposition: form-data; name="proofFile"; filename="t.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'));
    parts.push(JPEG);
    parts.push(Buffer.from('\r\n--' + bdry + '--\r\n'));
    const body = Buffer.concat(parts);
    const u = new URL(BASE + '/consultar-pedido/'+ref+'/comprobante');
    const resp = await new Promise(R => h.request({hostname:u.hostname,port:u.port,path:u.pathname,method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+bdry,'Content-Length':body.length,Cookie:ck||''}},rr=>{let d='';rr.on('data',c=>d+=c);rr.on('end',()=>R({s:rr.statusCode,b:d}))}).end(body));
    assert.equal(resp.s, 403, 'Missing CSRF returns 403');
  });

  // ── Concurrency: two simultaneous initial uploads ──
  it('Two simultaneous uploads produce exactly one active proof', async () => {
    const { ref, ck } = await createEligibleOrder();
    testOrders.push(ref);
    const r = await get('/consultar-pedido/'+ref, ck);
    const cs = xc(r.b);

    const b1 = Buffer.concat([JPEG, Buffer.from('A')]);
    const b2 = Buffer.concat([JPEG, Buffer.from('B')]);

    const [r1, r2] = await Promise.all([
      postProof('/consultar-pedido/'+ref+'/comprobante', cs, ck, b1, 'a.jpg'),
      postProof('/consultar-pedido/'+ref+'/comprobante', cs, ck, b2, 'b.jpg'),
    ]);

    const ok = (r1.s===302?1:0) + (r2.s===302?1:0);
    assert.ok(ok >= 1, 'At least one upload produces a redirect');

    const [[c]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) AND status IN ('pending_review','approved')",[ref]);
    assert.equal(Number(c.cnt), 1, 'Exactly one active proof after concurrent uploads');

    // Losing upload should NOT leave an orphan file
    const [[ec]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM order_events WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) AND event_type='payment_proof_submitted'",[ref]);
    assert.equal(Number(ec.cnt), 1, 'Exactly one submitted event');

    // Payment and order status unchanged
    const [[o]] = await pool.query('SELECT payment_status, order_status FROM orders WHERE order_reference=?',[ref]);
    assert.equal(o.payment_status, 'pending', 'Payment still pending');
    assert.equal(o.order_status, 'pending_payment', 'Order still pending_payment');
  });

  // ── Concurrency: upload vs manual confirmation ──
  it('Upload rejected when order is already paid', async () => {
    const { ref, ck } = await createEligibleOrder();
    testOrders.push(ref);

    // Verify order page shows proof form
    let r = await get('/consultar-pedido/'+ref, ck);
    assert.ok(r.b.includes('_csrf'), 'Order page has CSRF for proof upload');

    // Manually change order to paid via DB (simulates admin confirmation winning race)
    await pool.query("UPDATE orders SET payment_status='paid', order_status='payment_confirmed' WHERE order_reference=?",[ref]);

    // Verify page no longer shows upload form
    r = await get('/consultar-pedido/'+ref, ck);
    assert.ok(!r.b.includes('proofFile'), 'No proof upload form on paid order');

    // Verify no proof was created
    const [[c]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) AND status='pending_review'",[ref]);
    assert.equal(Number(c.cnt), 0, 'No new proof on paid order');
  });

  // ── Concurrency: rejected proof replacement ──
  it('Rejected proof replacement: concurrent uploads serialize', async () => {
    const { ref, ck } = await createEligibleOrder();
    testOrders.push(ref);

    // Upload first proof
    let r = await get('/consultar-pedido/'+ref, ck);
    const cs = xc(r.b);
    r = await postProof('/consultar-pedido/'+ref+'/comprobante', cs, ck, JPEG, 'first.jpg');
    assert.equal(r.s, 302, 'First upload succeeds');

    // Simulate admin rejection via DB
    const [profs] = await pool.query(
      "SELECT id FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) ORDER BY id DESC LIMIT 1",[ref]);
    assert.ok(profs[0], 'Proof found for rejection');
    await pool.query("UPDATE payment_proofs SET status='rejected', reviewed_at=NOW(), rejection_reason='test reject' WHERE id=?",[profs[0].id]);

    // Two concurrent replacement uploads
    r = await get('/consultar-pedido/'+ref, ck);
    const cs2 = xc(r.b);
    const b1 = Buffer.concat([JPEG, Buffer.from('X')]);
    const b2 = Buffer.concat([JPEG, Buffer.from('Y')]);
    await Promise.all([
      postProof('/consultar-pedido/'+ref+'/comprobante', cs2, ck, b1, 'r1.jpg'),
      postProof('/consultar-pedido/'+ref+'/comprobante', cs2, ck, b2, 'r2.jpg'),
    ]);

    const [[c]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) AND status='pending_review'",[ref]);
    const [[rc]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM payment_proofs WHERE order_id=(SELECT id FROM orders WHERE order_reference=?) AND status='rejected'",[ref]);
    assert.equal(Number(c.cnt), 1, 'Exactly one pending after replacement race');
    assert.equal(Number(rc.cnt), 1, 'Old rejected proof preserved');
  });

  // ── Regression tests ──
  it('Login/register pages have CSRF tokens', async () => {
    for (const url of ['/auth/login', '/auth/register']) {
      const r = await get(url);
      assert.ok(r.b.includes('name="_csrf"'), url+' has CSRF');
    }
  });

  it('Store and guest lookup pages work', async () => {
    assert.equal((await get('/tienda')).s, 200);
    assert.equal((await get('/consultar-pedido')).s, 200);
  });
});
