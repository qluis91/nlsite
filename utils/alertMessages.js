const crypto = require('crypto');

const ALERT_TYPES = Object.freeze(['info', 'success', 'warning', 'error']);
const FLASH_KEYS = Object.freeze({
  info_msg: 'info',
  success_msg: 'success',
  warning_msg: 'warning',
  error_msg: 'error',
});

function normalizeAlertType(value, fallback = 'info') {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = {
    danger: 'error',
    failure: 'error',
    fail: 'error',
    warn: 'warning',
    notice: 'info',
    message: 'info',
    ok: 'success',
  };
  const type = aliases[normalized] || normalized;
  return ALERT_TYPES.includes(type) ? type : fallback;
}

function messageVariant(type, text) {
  if (
    type === 'error'
    && /(?:est[aá]\s+en\s+uso|referenciad[oa]|no\s+se\s+puede\s+(?:archivar|eliminar))/i.test(text)
  ) {
    return 'warning';
  }
  return type;
}

function boundedText(value, maxLength = 2000) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim().slice(0, maxLength);
}

function stableId(type, title, description) {
  const digest = crypto
    .createHash('sha256')
    .update(`${type}\0${title}\0${description}`)
    .digest('hex')
    .slice(0, 16);
  return `flash-${type}-${digest}`;
}

function normalizeAlert(value, fallbackType = 'info') {
  if (value === null || typeof value === 'undefined' || value === false) return null;

  const input = typeof value === 'object' && !Array.isArray(value)
    ? value
    : { title: value };
  const title = boundedText(input.title || input.message || input.text);
  const description = boundedText(input.description, 4000);
  if (!title && !description) return null;

  const requestedType = normalizeAlertType(input.type, fallbackType);
  const type = messageVariant(requestedType, `${title} ${description}`);
  const resolvedTitle = title || description;
  const resolvedDescription = title ? description : '';
  const duration = Number.isFinite(Number(input.duration))
    ? Math.max(0, Math.min(120000, Number(input.duration)))
    : undefined;

  return {
    id: boundedText(input.id, 200) || stableId(type, resolvedTitle, resolvedDescription),
    type,
    title: resolvedTitle,
    description: resolvedDescription,
    persistent: Boolean(input.persistent),
    ...(typeof duration === 'number' ? { duration } : {}),
  };
}

function appendNormalized(target, value, fallbackType) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const alert = normalizeAlert(item, fallbackType);
    if (alert) target.push(alert);
  }
}

function normalizeFlashMessages(session = {}, { consume = false } = {}) {
  const alerts = [];

  for (const [key, type] of Object.entries(FLASH_KEYS)) {
    appendNormalized(alerts, session[key], type);
    if (consume) delete session[key];
  }

  if (session.flash) {
    if (typeof session.flash === 'object' && !Array.isArray(session.flash)) {
      const knownTypeKeys = Object.keys(session.flash).filter((key) => (
        ALERT_TYPES.includes(normalizeAlertType(key, ''))
      ));
      if (knownTypeKeys.length) {
        for (const key of knownTypeKeys) {
          appendNormalized(alerts, session.flash[key], normalizeAlertType(key));
        }
      } else {
        appendNormalized(alerts, session.flash, 'info');
      }
    } else {
      appendNormalized(alerts, session.flash, 'info');
    }
    if (consume) delete session.flash;
  }

  const unique = [];
  const seen = new Set();
  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    unique.push(alert);
  }
  return unique;
}

module.exports = {
  ALERT_TYPES,
  FLASH_KEYS,
  normalizeAlertType,
  normalizeAlert,
  normalizeFlashMessages,
};
