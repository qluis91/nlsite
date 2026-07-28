/**
 * YouTube URL normalization and validation.
 * Accepts: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/
 * Returns canonical video ID (11 characters: [a-zA-Z0-9_-]{11}) and derived URLs.
 * No YouTube Data API or API keys required.
 */

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_PLACEHOLDER_URL = '/images/gallery-video-placeholder.svg';
const LOCAL_GALLERY_THUMBNAIL_RE = /^\/uploads\/gallery\/thumbnails\/[a-zA-Z0-9._-]+$/;

function cleanVideoId(value) {
  const candidate = String(value || '').trim();
  return YT_ID_RE.test(candidate) ? candidate : null;
}

function extractVideoId(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  const plainId = cleanVideoId(input);
  if (plainId) return plainId;

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'youtu.be') {
    const [candidate, extra] = parsed.pathname.split('/').filter(Boolean);
    return extra ? null : cleanVideoId(candidate);
  }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)) return null;

  if (parsed.pathname === '/watch') return cleanVideoId(parsed.searchParams.get('v'));
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 2 && ['shorts', 'embed'].includes(segments[0])) {
    return cleanVideoId(segments[1]);
  }
  return null;
}

function youtubeThumbnailUrls(videoId) {
  const validatedId = cleanVideoId(videoId);
  if (!validatedId) return [];
  return [
    `https://img.youtube.com/vi/${validatedId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${validatedId}/mqdefault.jpg`,
  ];
}

function resolveYoutubeThumbnailCandidates({ customCoverPath, youtubeUrl, videoId } = {}) {
  const validatedId = cleanVideoId(videoId) || extractVideoId(youtubeUrl);
  const candidates = [];
  if (LOCAL_GALLERY_THUMBNAIL_RE.test(String(customCoverPath || ''))) {
    candidates.push(customCoverPath);
  }
  candidates.push(...youtubeThumbnailUrls(validatedId), YOUTUBE_PLACEHOLDER_URL);
  return candidates;
}

function validateAndNormalize(raw) {
  const videoId = extractVideoId(raw);
  if (!videoId) {
    return {
      valid: false,
      error: 'URL de YouTube no válida. Formatos aceptados: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/',
      videoId: null,
      canonicalUrl: null,
      embedUrl: null,
      thumbnailUrl: null,
      thumbnailFallbackUrls: [YOUTUBE_PLACEHOLDER_URL],
    };
  }
  const [thumbnailUrl, ...thumbnailFallbackUrls] = youtubeThumbnailUrls(videoId);
  return {
    valid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    thumbnailUrl,
    thumbnailFallbackUrls: [...thumbnailFallbackUrls, YOUTUBE_PLACEHOLDER_URL],
  };
}

module.exports = {
  extractVideoId,
  validateAndNormalize,
  youtubeThumbnailUrls,
  resolveYoutubeThumbnailCandidates,
  YT_ID_RE,
  YOUTUBE_PLACEHOLDER_URL,
  LOCAL_GALLERY_THUMBNAIL_RE,
};
