/**
 * BlurText — word/character split for GSAP ScrollTrigger blur entrances.
 *
 * Inspired by React Bits BlurText (no React / Motion).
 *
 * Structure for characters:
 *   <span class="blur-text__word" aria-hidden="true">
 *     <span class="blur-text__char">C</span>...
 *   </span>
 *   [space text node]
 *
 * Parent keeps aria-label with the full original sentence.
 */

function clearSegmentStyles(node) {
  ['filter', 'opacity', 'transform', 'will-change', 'display'].forEach((property) => {
    node.style.removeProperty(property);
  });
}

function applyInitialState(node, { blur, translateY, scale }) {
  node.style.display = 'inline-block';
  node.style.filter = `blur(${blur}px)`;
  node.style.opacity = '0';
  node.style.transform = `translate3d(0, ${translateY}px, 0) scale(${scale})`;
  node.style.willChange = 'filter, opacity, transform';
}

/**
 * @param {HTMLElement} element
 * @param {object} [options]
 * @param {'words'|'chars'} [options.animateBy='words']
 * @param {'top'|'bottom'} [options.direction='top'] - 'top' = fall from above (negative Y)
 * @param {number} [options.blur=12]
 * @param {number} [options.y]
 * @param {number} [options.scale=0.98]
 * @returns {{ words: NodeListOf<Element>, chars: NodeListOf<Element>, targets: NodeListOf<Element>, element: HTMLElement, destroy: Function } | null}
 */
export function splitBlurText(element, options = {}) {
  if (!element || !(element instanceof HTMLElement)) return null;

  const animateBy = options.animateBy === 'chars' ? 'chars' : 'words';
  const direction = options.direction === 'bottom' ? 'bottom' : 'top';
  const blur = options.blur ?? 12;
  const scale = options.scale ?? 0.98;
  const translateY = options.y ?? (direction === 'top' ? -48 : 48);

  if (element.dataset.blurTextSplit === 'true') {
    const words = element.querySelectorAll('.blur-text__word');
    const chars = element.querySelectorAll('.blur-text__char');
    return {
      words,
      chars,
      targets: animateBy === 'chars' ? chars : words,
      element,
      destroy: () => _destroy(element),
    };
  }

  const text = element.textContent || '';
  if (!text.trim()) return null;

  element.setAttribute('aria-label', text.trim());

  const fragments = [];
  const words = text.trim().split(/\s+/);

  for (let i = 0; i < words.length; i += 1) {
    const wordSpan = document.createElement('span');
    wordSpan.className = 'blur-text__word';
    wordSpan.setAttribute('aria-hidden', 'true');
    wordSpan.style.display = 'inline-block';
    wordSpan.style.whiteSpace = 'nowrap';

    if (animateBy === 'chars') {
      const chars = Array.from(words[i]);
      chars.forEach((char) => {
        const charSpan = document.createElement('span');
        charSpan.className = 'blur-text__char';
        charSpan.textContent = char;
        charSpan.setAttribute('aria-hidden', 'true');
        applyInitialState(charSpan, { blur, translateY, scale });
        wordSpan.appendChild(charSpan);
      });
    } else {
      wordSpan.textContent = words[i];
      applyInitialState(wordSpan, { blur, translateY, scale });
    }

    fragments.push(wordSpan);

    if (i < words.length - 1) {
      fragments.push(document.createTextNode(' '));
    }
  }

  element.textContent = '';
  fragments.forEach((node) => element.appendChild(node));

  element.dataset.blurTextSplit = 'true';
  element.dataset.blurTextAnimateBy = animateBy;
  element.dataset.blurTextDirection = direction;
  element.dataset.blurTextInitialBlur = String(blur);
  element.dataset.blurTextInitialY = String(translateY);

  const wordElements = element.querySelectorAll('.blur-text__word');
  const charElements = element.querySelectorAll('.blur-text__char');

  return {
    words: wordElements,
    chars: charElements,
    targets: animateBy === 'chars' ? charElements : wordElements,
    element,
    destroy: () => _destroy(element),
  };
}

function _destroy(element) {
  if (!element || !element.dataset.blurTextSplit) return;
  const text = (element.getAttribute('aria-label') || element.textContent || '').trim();
  element.querySelectorAll('.blur-text__word, .blur-text__char').forEach(clearSegmentStyles);
  element.textContent = text;
  element.removeAttribute('aria-label');
  delete element.dataset.blurTextSplit;
  delete element.dataset.blurTextAnimateBy;
  delete element.dataset.blurTextDirection;
  delete element.dataset.blurTextInitialBlur;
  delete element.dataset.blurTextInitialY;
}

/** Force all generated segments into the final readable state. */
export function revealBlurTextSegments(root = document) {
  root.querySelectorAll('.blur-text__word, .blur-text__char').forEach((node) => {
    node.style.filter = 'blur(0px)';
    node.style.opacity = '1';
    node.style.transform = 'translate3d(0, 0, 0) scale(1)';
    node.style.willChange = 'auto';
  });
}
