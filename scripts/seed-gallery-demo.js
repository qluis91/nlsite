require('dotenv').config();
const fs = require('fs');
const sharp = require('sharp');
sharp.cache(false);

const DEMO_PREFIX = 'demo-gallery-';
const DEMO_CATEGORIES = Object.freeze([
  { key: 'figuras', name: 'Demo · Figuras 3D', order: 101 },
  { key: 'productos', name: 'Demo · Productos personalizados', order: 102 },
  { key: 'procesos', name: 'Demo · Procesos', order: 103 },
  { key: 'prototipos', name: 'Demo · Prototipos', order: 104 },
  { key: 'decoracion', name: 'Demo · Decoración', order: 105 },
]);
const DEMO_ITEMS = Object.freeze([
  { slug: 'figura-geometrica', title: 'Figura geométrica', category: 'figuras', theme: 0 },
  { slug: 'pieza-articulada', title: 'Pieza articulada', category: 'figuras', theme: 1 },
  { slug: 'miniatura-abstracta', title: 'Miniatura abstracta', category: 'figuras', theme: 2 },
  { slug: 'soporte-personalizado', title: 'Soporte personalizado', category: 'productos', theme: 3 },
  { slug: 'organizador-escritorio', title: 'Organizador de escritorio', category: 'productos', theme: 4 },
  { slug: 'trofeo-personalizado', title: 'Trofeo personalizado', category: 'productos', theme: 5 },
  { slug: 'proceso-impresion', title: 'Proceso de impresión', category: 'procesos', theme: 6 },
  { slug: 'capas-fabricacion', title: 'Capas de fabricación', category: 'procesos', theme: 7 },
  { slug: 'acabado-superficie', title: 'Acabado de superficie', category: 'procesos', theme: 8 },
  { slug: 'prototipo-mecanico', title: 'Prototipo mecánico', category: 'prototipos', theme: 9 },
  { slug: 'accesorio-tecnologico', title: 'Accesorio tecnológico', category: 'prototipos', theme: 10 },
  { slug: 'ensamble-modular', title: 'Ensamble modular', category: 'prototipos', theme: 11 },
  { slug: 'lampara-decorativa', title: 'Lámpara decorativa', category: 'decoracion', theme: 12 },
  { slug: 'maceta-moderna', title: 'Maceta moderna', category: 'decoracion', theme: 13 },
  { slug: 'letrero-decorativo', title: 'Letrero decorativo', category: 'decoracion', theme: 14 },
]);

let loadedDependencies = null;

function loadDependencies() {
  if (!loadedDependencies) {
    loadedDependencies = {
      pool: require('../config/db'),
      media: require('../services/galleryMediaService'),
    };
  }
  return loadedDependencies;
}

function assertDemoEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || '').toLowerCase() === 'production'
    && environment.ALLOW_PRODUCTION_DEMO_SEED !== 'true'
  ) {
    throw new Error(
      'Demo gallery seeding is blocked in production. '
      + 'Do not enable ALLOW_PRODUCTION_DEMO_SEED on Railway production.'
    );
  }
}

function validatePrefix(prefix) {
  if (
    typeof prefix !== 'string'
    || prefix.length < 8
    || prefix.length > 80
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*-$/.test(prefix)
  ) {
    throw new Error('Demo prefix is invalid.');
  }
  return prefix;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function artworkDimensions(theme) {
  if (theme % 3 === 1) return { width: 960, height: 1200 };
  if (theme % 3 === 2) return { width: 1400, height: 900 };
  return { width: 1200, height: 900 };
}

async function generateDemoWebpBuffer(item) {
  const { width, height } = artworkDimensions(item.theme);
  const palettes = [
    ['#0a0d0b', '#244517', '#7cf03d'],
    ['#101316', '#123b47', '#4de3ff'],
    ['#130d16', '#4a1d55', '#e670ff'],
    ['#15120c', '#5b4213', '#ffd45c'],
    ['#0d1119', '#1a3370', '#7299ff'],
  ];
  const [background, secondary, accent] = palettes[item.theme % palettes.length];
  const title = escapeXml(item.title);
  const number = String(item.theme + 1).padStart(2, '0');
  const shapeOffset = 120 + (item.theme % 5) * 42;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${background}"/>
          <stop offset="1" stop-color="${secondary}"/>
        </linearGradient>
        <radialGradient id="glow">
          <stop offset="0" stop-color="${accent}" stop-opacity=".72"/>
          <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${width * 0.7}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.34}" fill="url(#glow)"/>
      <g fill="none" stroke="${accent}" stroke-width="${Math.max(8, width / 110)}" opacity=".86">
        <path d="M ${shapeOffset} ${height * 0.68} L ${width * 0.38} ${height * 0.22} L ${width * 0.65} ${height * 0.68} Z"/>
        <circle cx="${width * 0.63}" cy="${height * 0.48}" r="${Math.min(width, height) * 0.16}"/>
        <path d="M ${width * 0.2} ${height * 0.82} H ${width * 0.82}"/>
      </g>
      <g fill="${accent}" opacity=".22">
        <rect x="${width * 0.12}" y="${height * 0.15}" width="${width * 0.25}" height="${height * 0.12}" rx="22"/>
        <rect x="${width * 0.55}" y="${height * 0.7}" width="${width * 0.3}" height="${height * 0.1}" rx="22"/>
      </g>
      <text x="${width * 0.08}" y="${height * 0.1}" fill="${accent}" font-family="Arial, sans-serif" font-size="${Math.max(24, width / 32)}" font-weight="700" letter-spacing="6">NINJALAB DEMO ${number}</text>
      <text x="${width * 0.08}" y="${height * 0.91}" fill="#ffffff" font-family="Arial, sans-serif" font-size="${Math.max(34, width / 20)}" font-weight="700">${title}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg))
    .webp({ quality: 90 })
    .toBuffer();
}

async function createImagePair(media, item) {
  const buffer = await generateDemoWebpBuffer(item);
  return media.processImagePair({
    buffer,
    size: buffer.length,
    mimetype: 'image/webp',
    originalname: `${item.slug}.webp`,
  });
}

function demoSlug(prefix, value) {
  return `${prefix}${value}`;
}

async function deleteDemoPaths(media, publicPaths) {
  const uniquePaths = [...new Set((publicPaths || []).filter(Boolean))];
  for (const publicPath of uniquePaths) {
    const absolutePath = media.resolveSafeGalleryPath(publicPath);
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        await fs.promises.unlink(absolutePath);
        break;
      } catch (error) {
        if (error.code === 'ENOENT') break;
        if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 15) throw error;
        await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
      }
    }
  }
}

async function seedGalleryDemo({
  prefix = DEMO_PREFIX,
  catalog = DEMO_ITEMS,
  categories = DEMO_CATEGORIES,
  environment = process.env,
  beforeCommit,
} = {}) {
  assertDemoEnvironment(environment);
  validatePrefix(prefix);
  const { pool, media } = loadDependencies();
  const [existingRows] = await pool.query(
    'SELECT * FROM gallery_items WHERE slug LIKE ? ORDER BY id',
    [`${prefix}%`]
  );
  const existingBySlug = new Map(existingRows.map((row) => [row.slug, row]));
  const prepared = new Map();
  const reusable = new Set();
  const replacedPaths = [];

  try {
    for (const item of catalog) {
      const slug = demoSlug(prefix, item.slug);
      const existing = existingBySlug.get(slug);
      const filesValid = existing
        && await media.galleryPathExists(existing.media_path, 'images')
        && await media.galleryPathExists(existing.thumbnail_path, 'thumbnails');
      if (filesValid) {
        reusable.add(slug);
      } else {
        prepared.set(slug, await createImagePair(media, item));
        if (existing) replacedPaths.push(existing.media_path, existing.thumbnail_path);
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const categoryIds = new Map();
      for (const category of categories) {
        const slug = demoSlug(prefix, category.key);
        await connection.query(
          `INSERT INTO gallery_categories (name, slug, description, sort_order, is_active)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE slug = VALUES(slug)`,
          [category.name, slug, 'Contenido genérico generado localmente para desarrollo.', category.order]
        );
        const [rows] = await connection.query(
          'SELECT id FROM gallery_categories WHERE slug = ? LIMIT 1',
          [slug]
        );
        if (!rows[0]) throw new Error('Demo category could not be resolved.');
        categoryIds.set(category.key, rows[0].id);
      }

      let created = 0;
      let repaired = 0;
      for (const [index, item] of catalog.entries()) {
        const slug = demoSlug(prefix, item.slug);
        if (reusable.has(slug)) continue;
        const pair = prepared.get(slug);
        const existing = existingBySlug.get(slug);
        const values = [
          categoryIds.get(item.category),
          item.title,
          'Arte genérico de demostración generado localmente para probar la galería.',
          pair.mediaPath,
          pair.thumbnailPath,
          `Composición abstracta de demostración: ${item.title}`,
          index + 1,
          index % 4 === 0 ? 1 : 0,
        ];
        if (existing) {
          await connection.query(
            `UPDATE gallery_items
                SET category_id = ?, title = ?, description = ?, media_type = 'image',
                    media_path = ?, thumbnail_path = ?, poster_path = NULL,
                    alt_text = ?, sort_order = ?, is_featured = ?
              WHERE id = ? AND slug = ?`,
            [...values, existing.id, slug]
          );
          repaired += 1;
        } else {
          await connection.query(
            `INSERT INTO gallery_items
              (category_id, title, slug, description, media_type, media_path,
               thumbnail_path, poster_path, alt_text, sort_order, is_featured,
               is_published, published_at)
             VALUES (?, ?, ?, ?, 'image', ?, ?, NULL, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
            [
              categoryIds.get(item.category),
              item.title,
              slug,
              'Arte genérico de demostración generado localmente para probar la galería.',
              pair.mediaPath,
              pair.thumbnailPath,
              `Composición abstracta de demostración: ${item.title}`,
              index + 1,
              index % 4 === 0 ? 1 : 0,
            ]
          );
          created += 1;
        }
      }
      if (typeof beforeCommit === 'function') {
        await beforeCommit([...prepared.values()]);
      }
      await connection.commit();
      await deleteDemoPaths(media, replacedPaths);
      return {
        categories: categories.length,
        imagesGenerated: prepared.size,
        itemsCreated: created,
        itemsRepaired: repaired,
        itemsReused: reusable.size,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    const createdPaths = [...prepared.values()].flatMap((pair) => pair.createdPaths || []);
    await media.deleteAbsolutePaths(createdPaths);
    throw error;
  }
}

async function cleanGalleryDemo({
  prefix = DEMO_PREFIX,
  environment = process.env,
} = {}) {
  assertDemoEnvironment(environment);
  validatePrefix(prefix);
  const { pool, media } = loadDependencies();
  const [items] = await pool.query(
    `SELECT id, media_path, thumbnail_path, poster_path
       FROM gallery_items
      WHERE slug LIKE ?`,
    [`${prefix}%`]
  );
  const connection = await pool.getConnection();
  let categoriesRemoved = 0;
  try {
    await connection.beginTransaction();
    const [deletedItems] = await connection.query(
      'DELETE FROM gallery_items WHERE slug LIKE ?',
      [`${prefix}%`]
    );
    const [deletedCategories] = await connection.query(
      `DELETE c
         FROM gallery_categories c
         LEFT JOIN gallery_items i ON i.category_id = c.id
        WHERE c.slug LIKE ? AND i.id IS NULL`,
      [`${prefix}%`]
    );
    categoriesRemoved = deletedCategories.affectedRows;
    await connection.commit();
    const paths = items.flatMap((item) => [
      item.media_path,
      item.thumbnail_path,
      item.poster_path,
    ]).filter(Boolean);
    await deleteDemoPaths(media, paths);
    return {
      itemsRemoved: deletedItems.affectedRows,
      categoriesRemoved,
      filesRemoved: new Set(paths).size,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function printSeedReport(report) {
  console.log(`Categories created/reused: ${report.categories}`);
  console.log(`Images generated: ${report.imagesGenerated}`);
  console.log(`Items created: ${report.itemsCreated}`);
  console.log(`Items repaired: ${report.itemsRepaired}`);
  console.log(`Items reused: ${report.itemsReused}`);
  console.log('Public URLs to test:');
  console.log('  /galeria');
  console.log('  /galeria?view=circular');
  console.log('  /galeria?view=ring');
}

async function closeDemoPool() {
  if (loadedDependencies?.pool) await loadedDependencies.pool.end();
}

async function runCli(argumentsList = process.argv.slice(2)) {
  assertDemoEnvironment(process.env);
  const command = argumentsList[0] || 'seed';
  if (!['seed', '--clean', '--reset'].includes(command) || argumentsList.length > 1) {
    throw new Error('Usage: node scripts/seed-gallery-demo.js [--clean|--reset]');
  }
  if (command === '--clean' || command === '--reset') {
    const cleaned = await cleanGalleryDemo();
    console.log(`Demo items removed: ${cleaned.itemsRemoved}`);
    console.log(`Demo categories removed: ${cleaned.categoriesRemoved}`);
    console.log(`Demo files cleaned: ${cleaned.filesRemoved}`);
    if (command === '--clean') return;
  }
  printSeedReport(await seedGalleryDemo());
}

if (require.main === module) {
  runCli()
    .catch((error) => {
      console.error(`Gallery demo script failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(closeDemoPool);
}

module.exports = {
  DEMO_PREFIX,
  DEMO_CATEGORIES,
  DEMO_ITEMS,
  assertDemoEnvironment,
  validatePrefix,
  generateDemoWebpBuffer,
  seedGalleryDemo,
  cleanGalleryDemo,
  closeDemoPool,
  runCli,
};
