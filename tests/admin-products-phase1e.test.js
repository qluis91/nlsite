const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const pool = require('../config/db');
const catalog = require('../services/adminCatalogService');
const {
  CATALOG_SCHEMA_REQUIREMENTS,
  inspectCatalogSchema,
  assertCatalogSchemaReady,
} = require('../services/catalogSchemaReadinessService');
const {
  logCatalogFailure,
  sanitizeLogText,
} = require('../utils/adminCatalogDiagnostics');
const { startTestServer, stopTestServer } = require('./testServer');

const marker = `phase1e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}_admin@example.invalid`;
const userEmail = `${marker}_user@example.invalid`;
const password = `Catalog-${crypto.randomBytes(8).toString('hex')}!`;
const adminJar = {};
const userJar = {};
let baseUrl;
let categoryId;
let productId;

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'expected a CSRF token');
  return match[1];
}

async function request(requestPath, { method = 'GET', body, jar = {} } = {}) {
  const headers = {};
  if (jar.cookie) headers.Cookie = jar.cookie;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    payload = new URLSearchParams(body);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    requestId: response.headers.get('x-request-id') || '',
    text: await response.text(),
  };
}

function productForm(token, overrides = {}) {
  const form = new FormData();
  const values = {
    _csrf: token,
    name: `${marker} product`,
    categoryIds: String(categoryId),
    regularPrice: '1250.50',
    promotionalPrice: '',
    webPrice: '1100',
    stockQuantity: '4',
    weight: '120',
    description: 'Production-like catalog fixture',
    tags: 'legacy, admin',
    seo_title: '',
    seo_description: '',
    og_image: '',
    isActive: '1',
    isPublished: '1',
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => form.append(key, value));
  return form;
}

async function login(email, jar, returnTo = '/') {
  const page = await request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { jar });
  const response = await request('/auth/login', {
    method: 'POST',
    jar,
    body: { email, password, _csrf: csrf(page.text), returnTo },
  });
  assert.equal(response.status, 302);
}

async function cleanup() {
  if (productId) {
    await pool.query('DELETE FROM products WHERE id = ?', [productId]).catch(() => {});
    productId = null;
  }
  await pool.query('DELETE FROM products WHERE slug LIKE ?', [`${marker}%`]).catch(() => {});
  if (categoryId) {
    await pool.query('DELETE FROM categories WHERE id = ?', [categoryId]).catch(() => {});
    categoryId = null;
  }
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]).catch(() => {});
  await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, userEmail]).catch(() => {});
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash(password, 8);
  await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,1,1),(?,?,?,2,1)',
    [`Admin ${marker}`, adminEmail, hash, `User ${marker}`, userEmail, hash]
  );
  const [category] = await pool.query(
    'INSERT INTO categories (name,slug) VALUES (?,?)',
    [`Category ${marker}`, `${marker}-category`]
  );
  categoryId = category.insertId;
  ({ baseUrl } = await startTestServer());
  await request('/__test_reset_auth_limiters');
  await login(adminEmail, adminJar, '/admin/catalogo/productos');
  await login(userEmail, userJar, '/');
});

after(async () => {
  await stopTestServer();
  await cleanup();
  await pool.end();
});

describe('Admin Products Phase 1E SQL and data resilience', () => {
  it('reproduces the former MariaDB ONLY_FULL_GROUP_BY failure and the fixed queries pass', async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query(
        "SET SESSION sql_mode = CONCAT_WS(',', @@sql_mode, 'ONLY_FULL_GROUP_BY')"
      );
      await assert.rejects(
        connection.query(
          `SELECT p.id, p.name, pi.file_path
             FROM products p
             LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
            GROUP BY p.id`
        ),
        (error) => error.code === 'ER_WRONG_FIELD_WITH_GROUP'
      );

      const result = await catalog.listProducts('', '', 1, 20, connection);
      const categories = await catalog.listCategories(connection);
      assert.ok(Array.isArray(result.products));
      assert.ok(Array.isArray(categories));
    } finally {
      connection.release();
    }
  });

  it('binds combined search and category filters in the same order with no placeholder mismatch', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('COUNT(*) AS total')) return [[{ total: 0 }]];
        if (sql.includes('SELECT p.id')) return [[]];
        throw new Error('unexpected query');
      },
    };
    const result = await catalog.listProducts('needle', '7', 'bad-page', 20, db);
    assert.equal(result.page, 1);
    assert.deepEqual(calls[0].params, ['%needle%', 7]);
    assert.deepEqual(calls[1].params, ['%needle%', 7, 20, 0]);
    assert.doesNotMatch(calls[1].sql, /\bGROUP BY\b/i);
  });

  it('normalizes malformed legacy values and invalid media paths without crashing', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('COUNT(*) AS total')) return [[{ total: 1 }]];
        if (sql.includes('SELECT p.id')) {
          return [[{
            id: 91,
            name: 'Legacy',
            stock_quantity: null,
            is_active: 'unexpected',
            is_published: null,
            primary_image: 'https://invalid.example/private.jpg',
          }]];
        }
        if (sql.includes('SELECT pc.product_id')) return [[{ product_id: 91, name: 'Known' }]];
        throw new Error('unexpected query');
      },
    };
    const result = await catalog.listProducts('', '', 1, 20, db);
    assert.equal(result.products[0].stock_quantity, 0);
    assert.equal(result.products[0].is_active, 0);
    assert.equal(result.products[0].is_published, 0);
    assert.equal(result.products[0].primary_image, null);
    assert.equal(result.warnings.length, 4);
  });

  it('sanitizes invalid pagination, category, and long search inputs', () => {
    const normalized = catalog.normalizeAdminProductQuery('x'.repeat(250), '-9', 'NaN', 9999);
    assert.equal(normalized.search.length, 100);
    assert.equal(normalized.categoryId, null);
    assert.equal(normalized.page, 1);
    assert.equal(normalized.limit, 100);
  });

  it('archives instead of deleting when historical foreign keys reference the product', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.startsWith('DELETE')) {
          const error = new Error('referenced');
          error.code = 'ER_ROW_IS_REFERENCED_2';
          throw error;
        }
        return [{ affectedRows: 1 }];
      },
    };
    const result = await catalog.deleteProduct(77, db);
    assert.deepEqual(result, { action: 'archived', reason: 'historical-references' });
    assert.match(calls[1].sql, /is_active = 0, is_published = 0/);
    assert.deepEqual(calls[1].params, [77]);
  });
});

describe('Catalog readiness and safe diagnostics', () => {
  it('accepts the current MariaDB catalog schema', async () => {
    const result = await inspectCatalogSchema(pool, { force: true });
    assert.equal(result.ready, true, JSON.stringify(result));
  });

  it('reports a missing required capability explicitly', async () => {
    const rows = [];
    for (const [table, columns] of Object.entries(CATALOG_SCHEMA_REQUIREMENTS)) {
      for (const column of Object.keys(columns)) {
        if (`${table}.${column}` === 'products.stock_quantity') continue;
        rows.push({ tableName: table, columnName: column, dataType: columns[column][0] });
      }
    }
    const db = { query: async () => [rows] };
    const result = await inspectCatalogSchema(db, { force: true });
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ['products.stock_quantity']);
    await assert.rejects(
      assertCatalogSchemaReady(db, { force: true }),
      (error) => error.code === 'CATALOG_SCHEMA_NOT_READY' && error.status === 503
    );
  });

  it('logs correlation, stage, database code, and status without secrets or raw SQL', () => {
    let line = '';
    const original = console.error;
    console.error = (value) => { line = value; };
    try {
      logCatalogFailure({
        requestId: 'request-1',
        route: '/admin/catalogo/productos',
        method: 'GET',
        adminId: 12,
        filters: { search: 'safe', categoryId: 2, page: 1, limit: 20 },
        stage: 'products.list',
      }, {
        code: 'ER_PARSE_ERROR',
        errno: 1064,
        message: 'safe failure',
        sql: 'SELECT password FROM users',
        password: 'never-log',
      }, 500);
    } finally {
      console.error = original;
    }
    assert.match(line, /admin_catalog_request_failed/);
    assert.match(line, /request-1/);
    assert.match(line, /products\.list/);
    assert.match(line, /ER_PARSE_ERROR/);
    assert.doesNotMatch(line, /never-log|SELECT password/);
    assert.equal(sanitizeLogText('one\n two').includes('\n'), false);
  });

  it('wires catalog readiness into deployment and /ready without adding a fake migration', () => {
    const deploy = fs.readFileSync(path.join(__dirname, '../scripts/migrate-deploy.js'), 'utf8');
    const readiness = fs.readFileSync(path.join(__dirname, '../config/databaseReadiness.js'), 'utf8');
    const tracker = require('../scripts/migrationTracker');
    assert.match(deploy, /assertCatalogSchemaReady/);
    assert.match(readiness, /inspectCatalogSchema/);
    assert.ok(tracker.MIGRATION_REGISTRY.some((entry) => entry.name === 'migrateCatalog'));
    assert.ok(tracker.MIGRATION_REGISTRY.some((entry) => entry.name === 'migrateCategoryHero'));
    assert.ok(tracker.MIGRATION_REGISTRY.some((entry) => entry.name === 'migrateCatalogSeo'));
    assert.equal(tracker.MIGRATION_REGISTRY.some((entry) => /phase1e/i.test(entry.name)), false);
  });
});

describe('Real Admin Products route and CRUD flow', () => {
  it('blocks anonymous and normal users while the administrator can list, create, edit stock, filter, and delete', async () => {
    const anonymous = await request('/admin/catalogo/productos');
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.location, /\/auth\/login/);

    const normalUser = await request('/admin/catalogo/productos', { jar: userJar });
    assert.equal(normalUser.status, 302);
    assert.equal(normalUser.location, '/');

    const list = await request('/admin/catalogo/productos?page=invalid&category=-5', { jar: adminJar });
    assert.equal(list.status, 200);
    assert.ok(list.requestId);
    assert.match(list.text, /Productos/);

    const createPage = await request('/admin/catalogo/productos/nuevo', { jar: adminJar });
    assert.equal(createPage.status, 200);
    const created = await request('/admin/catalogo/productos', {
      method: 'POST',
      jar: adminJar,
      body: productForm(csrf(createPage.text)),
    });
    assert.equal(created.status, 302);
    assert.equal(created.location, '/admin/catalogo/productos');

    const slug = catalog.normalizeAdminProductQuery(`${marker} product`).search
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const [[product]] = await pool.query('SELECT * FROM products WHERE slug = ?', [slug]);
    assert.ok(product);
    productId = product.id;

    const filtered = await request(
      `/admin/catalogo/productos?search=${encodeURIComponent(marker)}&category=${categoryId}&page=1`,
      { jar: adminJar }
    );
    assert.equal(filtered.status, 200);
    assert.match(filtered.text, new RegExp(marker));

    const editPage = await request(`/admin/catalogo/productos/${productId}/editar`, { jar: adminJar });
    assert.equal(editPage.status, 200);
    const updated = await request(`/admin/catalogo/productos/${productId}`, {
      method: 'POST',
      jar: adminJar,
      body: productForm(csrf(editPage.text), {
        name: `${marker} updated`,
        stockQuantity: '7',
      }),
    });
    assert.equal(updated.status, 302);

    const [[afterUpdate]] = await pool.query(
      'SELECT name,stock_quantity,is_active,is_published FROM products WHERE id = ?',
      [productId]
    );
    assert.equal(afterUpdate.name, `${marker} updated`);
    assert.equal(afterUpdate.stock_quantity, 7);
    assert.equal(afterUpdate.is_active, 1);
    assert.equal(afterUpdate.is_published, 1);

    await pool.query(
      `INSERT INTO product_images
        (product_id,file_path,file_name,mime_type,is_primary,position)
       VALUES (?,?,?,?,1,0)`,
      [productId, 'https://invalid.example/private.jpg', 'legacy.jpg', 'image/jpeg']
    );
    const legacyEditor = await request(`/admin/catalogo/productos/${productId}/editar`, { jar: adminJar });
    assert.equal(legacyEditor.status, 200);
    assert.doesNotMatch(legacyEditor.text, /https:\/\/invalid\.example\/private\.jpg/);
    assert.match(legacyEditor.text, /thumb-sm--placeholder/);
    await pool.query('DELETE FROM product_images WHERE product_id = ?', [productId]);

    const listForDelete = await request('/admin/catalogo/productos', { jar: adminJar });
    const deleted = await request(`/admin/catalogo/productos/${productId}/eliminar`, {
      method: 'POST',
      jar: adminJar,
      body: { _csrf: csrf(listForDelete.text) },
    });
    assert.equal(deleted.status, 302);
    const [[remaining]] = await pool.query('SELECT COUNT(*) total FROM products WHERE id = ?', [productId]);
    assert.equal(Number(remaining.total), 0);
    productId = null;
  });

  it('returns a visible NinjaAlert validation failure instead of accepting invalid stock', async () => {
    const createPage = await request('/admin/catalogo/productos/nuevo', { jar: adminJar });
    const invalid = await request('/admin/catalogo/productos', {
      method: 'POST',
      jar: adminJar,
      body: productForm(csrf(createPage.text), {
        name: `${marker} invalid`,
        stockQuantity: '-4',
      }),
    });
    assert.equal(invalid.status, 302);
    const redirected = await request(invalid.location, { jar: adminJar });
    assert.equal(redirected.status, 200);
    assert.match(redirected.text, /stock debe ser un número entero no negativo/i);
    const [[count]] = await pool.query('SELECT COUNT(*) total FROM products WHERE name = ?', [`${marker} invalid`]);
    assert.equal(Number(count.total), 0);
  });
});
