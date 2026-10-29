/**
 * Shared PUBLIC/CONTENT raster image upload policy.
 *
 * Source size limits apply to the browser-uploaded bytes BEFORE Sharp.
 * Persisted public images are always re-encoded (typically WebP quality 80).
 *
 * Intentional exclusions (keep their own pipelines/limits):
 * - videos, GLB models, PDFs
 * - private payment-proof uploads
 */
'use strict';

const PUBLIC_IMAGE_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
const PUBLIC_IMAGE_WEBP_QUALITY = 80;
const PUBLIC_IMAGE_MAX_DIMENSION = 10000;
const PUBLIC_IMAGE_MAX_PIXELS = 100 * 1000 * 1000;
const PUBLIC_IMAGE_BATCH_MAX_BYTES = 75 * 1024 * 1024;
const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const FORM_FIELD_MAX_BYTES = 64 * 1024;

const PUBLIC_IMAGE_SOURCE_MAX_MB = Math.round(PUBLIC_IMAGE_SOURCE_MAX_BYTES / (1024 * 1024));
const AVATAR_SOURCE_MAX_MB = Math.round(AVATAR_SOURCE_MAX_BYTES / (1024 * 1024));
const PUBLIC_IMAGE_BATCH_MAX_MB = Math.round(PUBLIC_IMAGE_BATCH_MAX_BYTES / (1024 * 1024));

module.exports = {
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_WEBP_QUALITY,
  PUBLIC_IMAGE_MAX_DIMENSION,
  PUBLIC_IMAGE_MAX_PIXELS,
  PUBLIC_IMAGE_BATCH_MAX_BYTES,
  AVATAR_SOURCE_MAX_BYTES,
  FORM_FIELD_MAX_BYTES,
  PUBLIC_IMAGE_SOURCE_MAX_MB,
  AVATAR_SOURCE_MAX_MB,
  PUBLIC_IMAGE_BATCH_MAX_MB,
};
