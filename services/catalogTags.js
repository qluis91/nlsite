/**
 * Normalize database-driver JSON results without assuming whether the engine
 * returns native JSON as a parsed value or text-backed JSON as a string.
 */
function normalizeCatalogTags(value) {
  let candidate = value;
  if (candidate === null || candidate === undefined || candidate === '') return [];

  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(candidate)) return [];
  return candidate.filter((tag) => typeof tag === 'string');
}

module.exports = { normalizeCatalogTags };
