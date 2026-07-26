/**
 * "Administrar página" overview — Phase 11A.
 * Only the media library is active; later modules are labelled, never linked.
 */
const mediaService = require('../services/mediaService');
const pool = require('../config/db');

const CMS_MODULES = Object.freeze([
  {
    key: 'global-settings',
    title: 'Configuración global y SEO',
    description: 'Nombre del sitio, metadatos SEO, favicon, Open Graph, URL canónica y modo de indexación.',
    href: '/admin/page/global-settings',
    status: 'active',
  },
  {
    key: 'media',
    title: 'Biblioteca multimedia',
    description: 'Carga, edita, reemplaza y archiva imágenes, logos, iconos y modelos 3D.',
    href: '/admin/page/media',
    status: 'active',
  },
  {
    key: 'navbar',
    title: 'Navbar',
    description: 'Enlaces, logotipo y ajustes globales de navegación.',
    href: '/admin/page/navbar',
    status: 'active',
  },
  {
    key: 'panel1',
    title: 'Panel 1',
    description: 'Hero de la portada, textos y modelo 3D.',
    href: '/admin/page/home/panel-1',
    status: 'active',
  },
  {
    key: 'panel2',
    title: 'Panel 2',
    description: 'Showcase de proyectos, logo loop y carrusel.',
    href: '/admin/page/home/panel-2',
    status: 'active',
  },
  {
    key: 'panel3',
    title: 'Panel 3',
    description: 'Servicios y contenido de cierre.',
    href: '/admin/page/home/panel-3',
    status: 'active',
  },
  {
    key: 'publishing',
    title: 'Publicación e historial',
    description: 'Borradores, publicación centralizada y reversión de cambios.',
    href: '/admin/page/publishing',
    status: 'active',
  },
]);

async function overview(req, res, next) {
  try {
    const [summary, recent, sectionCounts] = await Promise.all([
      mediaService.overviewSummary(),
      mediaService.recentAssets(6),
      Promise.all([
        pool.query('SELECT COUNT(*) total FROM logo_loop_items WHERE deleted_at IS NULL'),
        pool.query('SELECT COUNT(*) total FROM home_carousel_items WHERE deleted_at IS NULL'),
        pool.query('SELECT COUNT(*) total FROM home_feature_items WHERE deleted_at IS NULL'),
      ]).then(([ll, ca, ft]) => ({
        logoLoop: Number(ll[0][0].total),
        carousel: Number(ca[0][0].total),
        features: Number(ft[0][0].total),
      })),
    ]);
    res.render('pages/admin/page/overview', {
      title: 'Administrar página',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      modules: CMS_MODULES,
      summary,
      recent,
      sectionCounts,
      formatFileSize: mediaService.formatFileSize,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { CMS_MODULES, overview };
