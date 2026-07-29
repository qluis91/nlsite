const cmsContent = require('../services/cmsContentService');
const publishing = require('../services/cmsPublishingService');
const { DEFAULT_ABOUT_CONTENT } = require('../scripts/migrate-about-page-cms');

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

async function resolveContentMedia(content) {
  const heroMedia = await cmsContent.resolveMediaReference(content.hero?.media, null);
  const sections = await Promise.all((content.sections || [])
    .filter((section) => section?.visible !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map(async (section) => ({
      ...section,
      mediaResolved: await cmsContent.resolveMediaReference(section.media, null),
    })));
  const ogMedia = await cmsContent.resolveMediaReference(content.seo?.ogMedia, null);
  return { heroMedia, sections, ogMedia };
}

async function getNavbarCmsData() {
  const [navItems, rawSettings] = await Promise.all([
    publishing.getPublishedNavItems('home'),
    publishing.getPublishedSettings([
      'site.logo_primary', 'site.logo_light', 'site.logo_dark',
      'navbar.bg_color', 'navbar.text_color', 'navbar.accent_color',
    ]),
  ]);
  const settings = Object.fromEntries(
    Object.entries(rawSettings).map(([key, value]) => [
      key,
      value === null || value === undefined || value === 'null' ? '' : value,
    ])
  );
  const logos = {};
  for (const [name, key] of Object.entries({
    primary: 'site.logo_primary',
    light: 'site.logo_light',
    dark: 'site.logo_dark',
  })) {
    logos[name] = await cmsContent.resolveMediaReference(settings[key], null);
  }
  return { navItems, settings, logos };
}

async function showAbout(req, res, next) {
  try {
    const content = await cmsContent.getPublishedSectionContent(
      'nosotros',
      'about-content',
      DEFAULT_ABOUT_CONTENT
    );
    const resolved = await resolveContentMedia(content);
    const cmsData = await getNavbarCmsData();
    const ctaUrl = safePublicUrl(content.cta?.url);
    const canonical = safePublicUrl(content.seo?.canonical) || '/nosotros';

    return res.render('pages/nosotros', {
      title: content.hero?.title || 'Nosotros',
      layout: 'layouts/main',
      metaTitle: content.seo?.title || content.hero?.title || 'Nosotros',
      metaDescription: content.seo?.description || content.hero?.description || '',
      canonical,
      ogImage: resolved.ogMedia?.url || resolved.heroMedia?.url || '',
      robots: content.isVisible === false ? 'noindex,nofollow' : 'index,follow',
      content,
      heroMedia: resolved.heroMedia,
      sections: resolved.sections,
      ctaUrl,
      ctaRel: content.cta?.target === '_blank' ? 'noopener noreferrer' : '',
      cmsData,
      navbarOnHome: false,
      usesHeroNavbar: true,
      pageClass: 'page-about',
      pageStyles: ['/css/home.css', '/css/about.css'],
      pageModule: '/js/about.js',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { safePublicUrl, resolveContentMedia, showAbout };
