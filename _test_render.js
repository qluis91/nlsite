const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

const viewsDir = path.resolve(__dirname, 'views');
const templatePath = path.join(viewsDir, 'pages/admin/page/store-hero.ejs');

// Minimal variables matching the controller's render call
const vars = {
  title: 'Hero de Tienda',
  layout: 'layouts/admin',
  pageStyles: ['/css/admin-page.css'],
  pageModule: '/js/admin/media-library.js',
  csrfToken: 'test-csrf',
  section: {},
  content: { eyebrow: '', title: '', description: '', isVisible: true, imagePosition: 'center', backgroundMedia: '', imageAlt: '', primaryLabel: '', primaryUrl: '', buttonTarget: '_self', ariaLabel: '' },
  style: {},
  bgMedia: null,
  modelList: { items: [] },
  storeHeroPath: '/admin/page/store-hero',
  editorState: null,
  fieldErrors: [],
  submittedContent: null,
  pageAlerts: [],
};

// EJS needs views set correctly for includes
const opts = {
  views: [viewsDir],
};

ejs.renderFile(templatePath, vars, opts, (err, str) => {
  if (err) {
    console.error('ERROR:', err.message);
    console.error('Stack:', err.stack?.slice(0, 500));
  } else {
    console.log('OK, length:', str.length);
    console.log('Contains "Hero de Tienda":', str.includes('Hero de Tienda'));
  }
});
