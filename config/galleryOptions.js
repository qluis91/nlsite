const path = require('path');

const MEDIA_TYPES = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
});

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm']);
const VIDEO_EXTENSIONS = Object.freeze({
  'video/mp4': '.mp4',
  'video/webm': '.webm',
});

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_POSTER_SIZE = 10 * 1024 * 1024;
const TITLE_MAX_LENGTH = 160;
const DESCRIPTION_MAX_LENGTH = 5000;
const ALT_TEXT_MAX_LENGTH = 300;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1000;
const DEFAULT_PAGE_SIZE = 24;
const ADMIN_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;

const PUBLIC_PATHS = Object.freeze({
  images: '/uploads/gallery/images/',
  thumbnails: '/uploads/gallery/thumbnails/',
  videos: '/uploads/gallery/videos/',
  posters: '/uploads/gallery/posters/',
});

const galleryRoot = path.join(__dirname, '..', 'public', 'uploads', 'gallery');
const STORAGE_ROOTS = Object.freeze({
  gallery: galleryRoot,
  images: path.join(galleryRoot, 'images'),
  thumbnails: path.join(galleryRoot, 'thumbnails'),
  videos: path.join(galleryRoot, 'videos'),
  posters: path.join(galleryRoot, 'posters'),
});

const IMAGE_PROFILES = Object.freeze({
  display: Object.freeze({
    maxWidth: 2400,
    maxHeight: 2400,
    fit: 'inside',
    withoutEnlargement: true,
    quality: 86,
    format: 'webp',
  }),
  thumbnail: Object.freeze({
    maxWidth: 512,
    maxHeight: 512,
    fit: 'cover',
    position: 'attention',
    withoutEnlargement: false,
    quality: 82,
    format: 'webp',
  }),
  poster: Object.freeze({
    maxWidth: 2400,
    maxHeight: 2400,
    fit: 'inside',
    withoutEnlargement: true,
    quality: 86,
    format: 'webp',
  }),
});

module.exports = {
  MEDIA_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  VIDEO_EXTENSIONS,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_POSTER_SIZE,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  ALT_TEXT_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PUBLIC_PATHS,
  STORAGE_ROOTS,
  IMAGE_PROFILES,
};
