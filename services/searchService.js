const MAX_RESULTS = 40;

const PUBLIC_SEARCH_CONTENT = Object.freeze([
  {
    type: 'page',
    title: 'NinjaLab',
    description: 'Fabricación digital, diseño e impresión 3D de precisión en Costa Rica.',
    url: '/#inicio',
    category: 'Página',
    keywords: ['inicio', 'nosotros', 'empresa', 'equipo', 'costa rica'],
  },
  {
    type: 'service',
    title: 'Impresión 3D',
    description: 'Producción precisa de piezas, figuras, prototipos y proyectos personalizados.',
    url: '/#inicio',
    category: 'Servicio',
    keywords: ['impresion', '3d', 'fabricacion', 'figura', 'figuras', 'piezas'],
  },
  {
    type: 'service',
    title: 'Diseño y modelado',
    description: 'Desarrollo de ideas digitales y modelos preparados para fabricación.',
    url: '/#proyectos',
    category: 'Servicio',
    keywords: ['diseño', 'modelado', 'modelo', '3d', 'personalizado'],
  },
  {
    type: 'service',
    title: 'Prototipado',
    description: 'Pruebas e iteraciones para convertir una idea en una solución funcional.',
    url: '/#proyectos',
    category: 'Servicio',
    keywords: ['prototipo', 'prototipos', 'pruebas', 'iteracion', 'funcional'],
  },
  {
    type: 'service',
    title: 'Personalización de piezas',
    description: 'Piezas y figuras personalizadas según las necesidades de cada proyecto.',
    url: '/#proyectos',
    category: 'Servicio',
    keywords: ['personalizado', 'personalizados', 'personalizada', 'figura', 'figuras'],
  },
  {
    type: 'service',
    title: 'Acabados profesionales',
    description: 'Pintura, detalle y acabado final para proyectos fabricados por NinjaLab.',
    url: '/#proyectos',
    category: 'Servicio',
    keywords: ['acabado', 'acabados', 'pintura', 'detalle'],
  },
  {
    type: 'gallery',
    title: 'Proyectos NinjaLab',
    description: 'Muestra de diseño, impresión 3D, personalización y prototipado.',
    url: '/#proyectos',
    category: 'Galería',
    keywords: ['galeria', 'proyectos', 'trabajos', 'muestra'],
  },
  {
    type: 'gallery',
    title: 'Diseño desde cero',
    description: 'El proceso que lleva una idea digital hasta una pieza lista para producir.',
    url: '/#showcase-title',
    category: 'Proyecto',
    keywords: ['diseño', 'modelado', 'produccion', 'pieza'],
  },
  {
    type: 'gallery',
    title: 'Piezas personalizadas',
    description: 'Proyectos de impresión, personalización y producción de NinjaLab.',
    url: '/#showcase-title',
    category: 'Proyecto',
    keywords: ['pieza', 'piezas', 'figura', 'figuras', 'personalizado', 'impresion 3d'],
  },
  {
    type: 'gallery',
    title: 'Prototipos funcionales',
    description: 'Pruebas, iteraciones y soluciones funcionales antes de la producción final.',
    url: '/#showcase-title',
    category: 'Proyecto',
    keywords: ['prototipo', 'prototipos', 'funcional', 'produccion'],
  },
]);

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreResult(result, query) {
  const title = normalizeSearchText(result.title);
  const category = normalizeSearchText(result.category);
  const keywords = normalizeSearchText(result.keywords.join(' '));
  const description = normalizeSearchText(result.description);

  if (title === query) return 500;
  if (title.startsWith(query)) return 400;
  if (title.includes(query)) return 300;
  if (category.includes(query) || keywords.includes(query)) return 200;
  if (description.includes(query)) return 100;
  return 0;
}

function searchPublicContent(value) {
  const query = normalizeSearchText(value);
  if (!query) return { results: [], total: 0 };

  const ranked = PUBLIC_SEARCH_CONTENT
    .map((result) => ({ result, score: scoreResult(result, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.result.title.localeCompare(right.result.title, 'es', { sensitivity: 'base' })
      || left.result.url.localeCompare(right.result.url)
    ));

  return {
    total: ranked.length,
    results: ranked.slice(0, MAX_RESULTS).map(({ result }) => ({
      type: result.type,
      title: result.title,
      description: result.description,
      url: result.url,
      category: result.category,
    })),
  };
}

module.exports = {
  MAX_RESULTS,
  normalizeSearchText,
  searchPublicContent,
};
