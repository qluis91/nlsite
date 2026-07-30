const EMBED_FRAME_ORIGINS = Object.freeze([
  'https://www.youtube-nocookie.com',
  'https://www.tiktok.com',
  'https://www.instagram.com',
  'https://www.facebook.com',
]);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);

function parsePublicUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function youtubeEmbed(url) {
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  let id = '';
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    id = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v') || '';
  } else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    id = match?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return {
    platform: 'youtube',
    src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`,
    title: 'Video de YouTube',
  };
}

function tiktokEmbed(url) {
  if (!TIKTOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(/^\/@[^/]+\/video\/(\d{5,30})(?:\/|$)/);
  if (!match) return null;
  return {
    platform: 'tiktok',
    src: `https://www.tiktok.com/player/v1/${match[1]}?controls=1&progress_bar=1&play_button=1`,
    title: 'Publicación de TikTok',
  };
}

function instagramEmbed(url) {
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]{5,64})(?:\/|$)/);
  if (!match) return null;
  return {
    platform: 'instagram',
    src: `https://www.instagram.com/${match[1]}/${match[2]}/embed/`,
    title: 'Publicación de Instagram',
  };
}

function facebookEmbed(url) {
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const path = url.pathname;
  const supportedPath = (
    /^\/[^/]+\/posts\/[^/]+\/?$/.test(path)
    || /^\/[^/]+\/videos\/\d+\/?$/.test(path)
    || /^\/reel\/\d+\/?$/.test(path)
    || path === '/permalink.php'
    || path === '/photo.php'
    || path === '/watch'
    || path === '/watch/'
  );
  const hasRequiredQuery = (
    (path === '/permalink.php' && url.searchParams.has('story_fbid'))
    || (path === '/photo.php' && url.searchParams.has('fbid'))
    || ((path === '/watch/' || path === '/watch') && url.searchParams.has('v'))
  );
  if (!supportedPath || (
    ['/permalink.php', '/photo.php', '/watch/', '/watch'].includes(path)
    && !hasRequiredQuery
  )) return null;

  const params = new URLSearchParams({
    href: url.href,
    show_text: 'true',
    width: '560',
  });
  return {
    platform: 'facebook',
    src: `https://www.facebook.com/plugins/post.php?${params.toString()}`,
    title: 'Publicación de Facebook',
  };
}

function deriveSocialEmbed({ platform, postUrl, displayMode, embedEnabled } = {}) {
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const wantsEmbed = displayMode === 'embed' && embedEnabled === true;
  if (!wantsEmbed) {
    return {
      action: 'external',
      supported: false,
      reason: displayMode !== 'embed' ? 'external_mode' : 'embed_disabled',
    };
  }

  const url = parsePublicUrl(postUrl);
  if (!url) {
    return { action: 'fallback', supported: false, reason: 'unsafe_url' };
  }

  const builders = {
    youtube: youtubeEmbed,
    tiktok: tiktokEmbed,
    instagram: instagramEmbed,
    facebook: facebookEmbed,
  };
  const descriptor = builders[normalizedPlatform]?.(url) || null;
  if (!descriptor) {
    return { action: 'fallback', supported: false, reason: 'unsupported_url' };
  }
  return {
    action: 'embed',
    supported: true,
    ...descriptor,
  };
}

function describeAdminBehavior(post) {
  const descriptor = deriveSocialEmbed(post);
  if (descriptor.action === 'embed') {
    return {
      kind: 'embed',
      label: `Abrirá como embed de ${descriptor.platform}.`,
    };
  }
  if (post?.displayMode === 'embed' && post?.embedEnabled === true) {
    return {
      kind: 'fallback',
      label: 'El formato de URL no admite embed; abrirá el enlace original.',
    };
  }
  return {
    kind: 'external',
    label: 'Abrirá el enlace original en una pestaña nueva.',
  };
}

module.exports = {
  EMBED_FRAME_ORIGINS,
  parsePublicUrl,
  deriveSocialEmbed,
  describeAdminBehavior,
};
