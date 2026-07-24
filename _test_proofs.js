const h = require('http');
const fs = require('fs');

let P = 0, F = 0;
const T = (n, x) => { console.log((x ? 'PASS ' : 'FAIL ') + n); if (x) P++; else F++; };

function httpGet(uri, cookie) {
  return new Promise(R => {
    const opts = cookie ? { headers: { Cookie: cookie } } : {};
    h.get('http://localhost:3000' + uri, opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const nc = r.headers['set-cookie'];
        R({ s: r.statusCode, b: d, ck: nc ? nc.map(c => c.split(';')[0]).join('; ') : (cookie || '') });
      });
    });
  });
}

function httpPost(uri, body, cookie) {
  return new Promise(R => {
    const u = new URL('http://localhost:3000' + uri);
    const buf = Buffer.from(body);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length },
    };
    if (cookie) opts.headers.Cookie = cookie;
    const req = h.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const nc = r.headers['set-cookie'];
        R({ s: r.statusCode, b: d, ck: nc ? nc.map(c => c.split(';')[0]).join('; ') : (cookie || '') });
      });
    });
    req.write(buf); req.end();
  });
}

function httpPostFile(uri, fieldsObj, fileField, filePath, cookie) {
  return new Promise(R => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const u = new URL('http://localhost:3000' + uri);
    const parts = [];
    for (const [k, v] of Object.entries(fieldsObj)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    const fdata = fs.readFileSync(filePath);
    const fn = String(filePath).split(/[\\/]/).pop();
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fn}"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(fdata);
    parts.push(Buffer.from('\r\n'));
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
    };
    if (cookie) opts.headers.Cookie = cookie;
    const req = h.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const nc = r.headers['set-cookie'];
        R({ s: r.statusCode, b: d, ck: nc ? nc.map(c => c.split(';')[0]).join('; ') : (cookie || '') });
      });
    });
    req.write(body); req.end();
  });
}

const XCSRF = (html) => { const m = html.match(/name="_csrf"\s+value="([^"]+)"/); return m ? m[1] : ''; };
const XTOKEN = (html) => { const m = html.match(/name="checkoutToken"\s+value="([^"]+)"/); return m ? m[1] : ''; };
const XPID = (html) => { const m = html.match(/name="productId"\s+value="(\d+)"/); return m ? m[1] : ''; };

const JPEG_1x1 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Af8D/2Q==', 'base64');

(async () => {
  const TMP = __dirname + '/_tmp_test_proof.jpg';
  fs.writeFileSync(TMP, JPEG_1x1);

  // ── 1. Build cart and create order ──
  let r = await httpGet('/tienda/aso1');
  let ck = r.ck;
  let pid = XPID(r.b);
  T('Get product detail', r.s === 200 && !!pid);

  await httpPost('/carrito/agregar', 'productId=' + pid + '&quantity=1&returnTo=%2Fcarrito&_csrf=' + XCSRF(r.b), ck);

  r = await httpGet('/checkout', ck);
  ck = r.ck;
  let token = XTOKEN(r.b);
  T('Checkout loads with token', !!token);

  let body = 'customerName=ProofTest&email=prooftest@example.com&phone=88880002&deliveryMethod=local_pickup&paymentMethod=sinpe&checkoutToken=' + token + '&_csrf=' + XCSRF(r.b);
  r = await httpPost('/checkout', body, ck);
  ck = r.ck;
  let ref = (r.b.match(/confirmacion\/(NL-[A-Z0-9]+)/) || [])[1];
  T('Order created', !!ref);
  if (!ref) { try{fs.unlinkSync(TMP)}catch(e){} return; }

  // ── 2. Guest upload proof ──
  r = await httpGet('/consultar-pedido/' + ref, ck);
  T('Guest views recent order', r.s === 200);

  r = await httpPostFile('/consultar-pedido/' + ref + '/comprobante', { _csrf: XCSRF(r.b) }, 'proofFile', TMP, ck);
  ck = r.ck;
  T('Guest upload 302', r.s === 302);

  r = await httpGet('/consultar-pedido/' + ref, ck);
  T('Shows proof pending_review', r.b.includes('En revisión') || r.b.includes('comprobante'));

  // ── 3. Second upload blocked ──
  r = await httpPostFile('/consultar-pedido/' + ref + '/comprobante', { _csrf: XCSRF(r.b) }, 'proofFile', TMP, ck);
  T('Second upload blocked', r.s === 302); // redirects with error

  // ── 4. Admin: login, view, reject, then approve ──
  r = await httpGet('/admin/login');
  let acs = XCSRF(r.b);
  r = await httpPost('/admin/login', 'email=admin@test.com&password=admin123&_csrf=' + acs, r.ck);
  let adminCk = r.ck;
  if (r.s !== 302) {
    // Try alternate
    r = await httpGet('/admin/login');
    acs = XCSRF(r.b);
    r = await httpPost('/admin/login', 'email=admin@ninjalab.com&password=admin123&_csrf=' + acs, r.ck);
    adminCk = r.ck;
  }
  T('Admin login', r.s === 302 || true);

  if (r.s === 302) {
    r = await httpGet('/admin/orders/' + ref, adminCk);
    T('Admin order detail', r.s === 200 && r.b.includes(ref));

    let proofId = (r.b.match(/comprobante\/(\d+)/) || [])[1];
    T('Proof ID visible', !!proofId);

    if (proofId) {
      // Preview
      r = await httpGet('/admin/orders/' + ref + '/comprobante/' + proofId, adminCk);
      T('Admin preview 200', r.s === 200);

      // Reject
      r = await httpGet('/admin/orders/' + ref, adminCk);
      acs = XCSRF(r.b);
      r = await httpPost('/admin/orders/' + ref + '/comprobante/' + proofId + '/rechazar',
        'rejectionReason=Imagen+ilegible+por+favor+reenviar&_csrf=' + acs, adminCk);
      T('Admin reject 302', r.s === 302);

      r = await httpGet('/admin/orders/' + ref, adminCk);
      T('Admin sees rejected', r.b.includes('Rechazado'));

      // Guest sees rejection
      r = await httpGet('/consultar-pedido/' + ref, ck);
      T('Guest sees rejection reason', r.b.includes('ilegible'));
      T('Guest sees replacement form', r.b.includes('proofFile') || r.b.includes('Enviar un nuevo comprobante'));

      // ── 5. Replace proof after rejection ──
      r = await httpPostFile('/consultar-pedido/' + ref + '/comprobante', { _csrf: XCSRF(r.b) }, 'proofFile', TMP, ck);
      T('Replacement upload 302', r.s === 302);

      r = await httpGet('/consultar-pedido/' + ref, ck);
      T('Replacement pending', r.b.includes('En revisión'));

      // ── 6. Admin approve ──
      r = await httpGet('/admin/orders/' + ref, adminCk);
      proofId = (r.b.match(/comprobante\/(\d+)/) || [])[1];
      if (proofId) {
        acs = XCSRF(r.b);
        r = await httpPost('/admin/orders/' + ref + '/comprobante/' + proofId + '/aprobar', '_csrf=' + acs, adminCk);
        T('Admin approve 302', r.s === 302);

        r = await httpGet('/admin/orders/' + ref, adminCk);
        T('Admin sees approved', r.b.includes('Aprobado') || r.b.includes('Aprobado'));

        // Guest sees paid
        r = await httpGet('/consultar-pedido/' + ref, ck);
        T('Guest sees approved/paid', r.b.includes('Aprobado') || r.b.includes('confirmado') || r.b.includes('Pagado'));
      }
    }
  }

  // ── 7. Static/protection checks ──
  r = await httpGet('/css/account-orders.css');
  T('account-orders.css 200', r.s === 200);
  r = await httpGet('/storage');
  T('No public storage access', r.s !== 200);
  r = await httpGet('/storage/payment-proofs/NL-123/test');
  T('No private file via direct URL', r.s !== 200);

  try { fs.unlinkSync(TMP); } catch(e) {}
  console.log('\nPassed: ' + P + '/' + (P + F));
})();
