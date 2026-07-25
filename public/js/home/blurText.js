/**
 * Blur Text — word-level blur entrance animation.
 *
 * Splits an element's text into <span> words, sets initial blur/opacity/translateY
 * state in CSS, then exposes selectors for GSAP/ScrollTrigger to animate.
 *
 * Inspired by React Bits Blur Text behaviour without React or Motion.
 *
 * Usage:
 *   const split = splitBlurText(document.querySelector('.showcase-heading'), {
 *     direction: 'down',   // 'up' or 'down' — initial Y offset direction
 *     blur: 10,            // initial blur in px
 *   });
 *   // Then animate: gsap.to(split.words, { filter: 'blur(0px)', opacity: 1, y: 0, stagger: 0.06 });
 *   // Or destroy: split.destroy();
 */

/**
 * Splits text content into word-level <span> elements.
 *
 * @param {HTMLElement} element - The text element to split
 * @param {object} [options]
 * @param {'up'|'down'} [options.direction='down'] - Direction words appear from
 * @param {number} [options.blur=10] - Initial blur amount in px
 * @param {boolean} [options.preserveWhitespace=true] - Keep space nodes between words
 * @returns {{ words: HTMLCollection, element: HTMLElement, destroy: Function } | null}
 */
export function splitBlurText(element, options = {}) {
  if (!element || !(element instanceof HTMLElement)) return null;

  const direction = options.direction || 'down';
  const blur = options.blur ?? 10;
  const translateY = direction === 'down' ? 40 : -40;

  // Already split? Return existing
  if (element.dataset.blurTextSplit === 'true') {
    return {
      words: element.querySelectorAll('.blur-text__word'),
      element,
      destroy: () => _destroy(element),
    };
  }

  const text = element.textContent || '';
  if (!text.trim()) return null;

  // Save original text for screen readers
  element.setAttribute('aria-label', text.trim());

  // Build word spans
  const fragments = [];
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);

  for (let i = 0; i < words.length; i += 1) {
    const span = document.createElement('span');
    span.className = 'blur-text__word';
    span.textContent = words[i];
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'inline-block';
    span.style.filter = `blur(${blur}px)`;
    span.style.opacity = '0';
    span.style.transform = `translate3d(0, ${translateY}px, 0)`;
    span.style.willChange = 'filter, opacity, transform';
    fragments.push(span);

    // Add space between words (preserves wrapping)
    if (i < words.length - 1) {
      const space = document.createTextNode(' ');
      fragments.push(space);
    }
  }

  // Replace content
  element.textContent = '';
  fragments.forEach((node) => element.appendChild(node));

  element.dataset.blurTextSplit = 'true';
  element.dataset.blurTextInitialBlur = String(blur);
  element.dataset.blurTextDirection = direction;

  const wordElements = element.querySelectorAll('.blur-text__word');

  return {
    words: wordElements,
    element,
    destroy: () => _destroy(element),
  };
}

function _destroy(element) {
  if (!element || !element.dataset.blurTextSplit) return;
  const text = (element.getAttribute('aria-label') || element.textContent || '').trim();
  const words = element.querySelectorAll('.blur-text__word');
  words.forEach((w) => {
    w.style.filter = '';
    w.style.opacity = '';
    w.style.transform = '';
    w.style.willChange = '';
  });
  element.textContent = text;
  element.removeAttribute('aria-label');
  delete element.dataset.blurTextSplit;
  delete element.dataset.blurTextInitialBlur;
  delete element.dataset.blurTextDirection;
}
