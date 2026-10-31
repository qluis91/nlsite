/**
 * Allowlisted SVG icons for Cotización Materiales cards.
 * Unknown keys fall back to cube. Markup is trusted (local only).
 */

const ALLOWED_ICONS = Object.freeze([
  'atom',
  'temperature',
  'shield',
  'droplet',
  'cube',
  'flex',
  'layers',
  'flame',
]);

const SVG_ATTR =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const ICON_PATHS = Object.freeze({
  atom:
    '<circle cx="12" cy="12" r="1" />' +
    '<path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />' +
    '<path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.04-2.03-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.04 2.03 7.36.02 11.9-4.5Z" />',
  temperature: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />',
  droplet:
    '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.13 3 12.25c0 2.22 1.8 4.05 4 4.05z" />' +
    '<path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />',
  cube:
    '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" /><path d="m3 7 9 5 9-5" /><path d="M12 22V12" />',
  flex:
    '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />' +
    '<line x1="16" y1="8" x2="2" y2="22" /><line x1="17.5" y1="15" x2="9" y2="15" />',
  layers:
    '<polygon points="12 2 2 7 12 12 22 7 12 2" />' +
    '<polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />',
});

function normalizeIconKey(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return ALLOWED_ICONS.includes(key) ? key : 'cube';
}

function getMaterialIconSvg(value) {
  const key = normalizeIconKey(value);
  return `<svg ${SVG_ATTR}>${ICON_PATHS[key] || ICON_PATHS.cube}</svg>`;
}

module.exports = {
  ALLOWED_ICONS,
  normalizeIconKey,
  getMaterialIconSvg,
};
