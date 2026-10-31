const cmsContent = require('../services/cmsContentService');
const publicNavbar = require('../services/publicNavbarService');
const { getMaterialIconSvg } = require('../services/materialsIconService');
const { DEFAULT_MATERIALS_CONTENT } = require('../scripts/migrate-materials-page-cms');

function safePublicUrl(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function visibleMaterials(content) {
  const items = Array.isArray(content?.items) ? content.items : [];
  return items
    .filter((item) => item && item.visible !== false)
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((item) => ({
      ...item,
      iconSvg: getMaterialIconSvg(item.icon),
      pros: Array.isArray(item.pros) ? item.pros : [],
      cons: Array.isArray(item.cons) ? item.cons : [],
    }));
}

async function showMaterials(req, res, next) {
  try {
    const content = await cmsContent.getPublishedSectionContent(
      'materiales',
      'materials-content',
      DEFAULT_MATERIALS_CONTENT
    );
    const ogMedia = await cmsContent.resolveMediaReference(content.seo?.ogMedia, null);
    const cmsData = await publicNavbar.getNavbarCmsData();
    const materials = content.isVisible === false ? [] : visibleMaterials(content);
    const canonical = safePublicUrl(content.seo?.canonical) || '/materiales';

    return res.render('pages/materiales', {
      title: content.hero?.title || 'Materiales',
      layout: 'layouts/main',
      metaTitle: content.seo?.title || content.hero?.title || 'Materiales',
      metaDescription: content.seo?.description || content.hero?.description || '',
      canonical,
      ogImage: ogMedia?.url || '',
      robots: content.isVisible === false ? 'noindex,nofollow' : 'index,follow',
      content,
      materials,
      cmsData,
      usesHeroNavbar: true,
      currentPath: req.path || '/materiales',
      pageClass: 'page-materials',
      pageStyles: ['/css/public-navbar.css', '/css/home.css', '/css/materials.css'],
      pageModule: '/js/materials.js',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  safePublicUrl,
  visibleMaterials,
  showMaterials,
};
