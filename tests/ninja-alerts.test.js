const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const scriptSource = fs.readFileSync(path.join(root, 'public/js/ninja-alerts.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'public/css/ninja-alerts.css'), 'utf8');
const partialPath = path.join(root, 'views/partials/ninja-alerts.ejs');
const {
  normalizeFlashMessages,
  normalizeAlertType,
} = require('../utils/alertMessages');
const { setLocals } = require('../middlewares/authMiddleware');

class FakeClassList {
  constructor(node) {
    this.node = node;
  }

  values() {
    return this.node.className.split(/\s+/).filter(Boolean);
  }

  add(...names) {
    this.node.className = [...new Set([...this.values(), ...names])].join(' ');
  }

  remove(...names) {
    this.node.className = this.values().filter((name) => !names.includes(name)).join(' ');
  }

  contains(name) {
    return this.values().includes(name);
  }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.classList = new FakeClassList(this);
    this.animateCalls = [];
    this.type = '';
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node.tagName === 'BODY') return true;
      node = node.parentNode;
    }
    return false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item !== listener));
  }

  dispatch(type, extra = {}) {
    const event = { type, target: this, relatedTarget: null, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const dataMatch = selector.match(/^\[([^\]]+)\]$/);
    if (dataMatch) return this.attributes.has(dataMatch[1]);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  contains(other) {
    if (this === other) return true;
    return this.children.some((child) => child.contains(other));
  }

  getBoundingClientRect() {
    const index = this.parentNode ? this.parentNode.children.indexOf(this) : 0;
    return { top: index * 80 };
  }

  animate(frames, options) {
    this.animateCalls.push({ frames, options });
    return { finished: Promise.resolve() };
  }
}

function runtime({ reduceMotion = false } = {}) {
  const body = new FakeNode('body');
  const host = new FakeNode('section');
  host.setAttribute('data-ninja-alerts', '');
  body.appendChild(host);
  const documentListeners = new Map();
  const document = {
    body,
    readyState: 'complete',
    activeElement: null,
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_namespace, tag) => new FakeNode(tag),
    querySelector: (selector) => (
      host.matches(selector) ? host : body.querySelector(selector)
    ),
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };

  let now = 0;
  let timerSequence = 0;
  const timers = new Map();
  const FakeDate = class extends Date {
    static now() {
      return now;
    }
  };
  const window = {
    matchMedia: () => ({ matches: reduceMotion }),
    requestAnimationFrame: (callback) => callback(),
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const context = {
    window,
    document,
    Date: FakeDate,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
  };
  vm.runInNewContext(scriptSource, context, { filename: 'ninja-alerts.js' });
  return {
    window,
    host,
    timers,
    context,
    advance(ms) {
      now += ms;
    },
  };
}

test('flash normalization maps aliases, consumes all four keys, and preserves text', () => {
  const session = {
    info_msg: 'Pago en proceso.',
    success_msg: 'Guardado.',
    warning_msg: 'Revisa los datos.',
    error_msg: 'Falló la operación.',
  };
  const alerts = normalizeFlashMessages(session, { consume: true });
  assert.deepEqual(alerts.map((item) => item.type), ['info', 'success', 'warning', 'error']);
  assert.deepEqual(alerts.map((item) => item.title), [
    'Pago en proceso.',
    'Guardado.',
    'Revisa los datos.',
    'Falló la operación.',
  ]);
  assert.equal(normalizeAlertType('danger'), 'error');
  assert.deepEqual(session, {});
});

test('referenced-media errors become warnings without changing their message', () => {
  const text = 'No se puede archivar: el archivo está en uso en Galería.';
  const [alert] = normalizeFlashMessages({ error_msg: text });
  assert.equal(alert.type, 'warning');
  assert.equal(alert.title, text);
});

test('setLocals exposes normalized alerts and consumes redirect flashes once', () => {
  const req = {
    path: '/auth/login',
    session: { info_msg: 'Tu sesión expiró.', cart: { items: [] } },
  };
  const res = { locals: {} };
  let called = false;
  setLocals(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.locals.ninjaAlerts[0].type, 'info');
  assert.equal(res.locals.ninjaAlerts[0].title, 'Tu sesión expiró.');
  assert.equal(req.session.info_msg, undefined);
});

test('partial renders all variants with escaped content and accessible controls', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const html = await ejs.renderFile(partialPath, {
    ninjaAlerts: ['info', 'success', 'warning', 'error'].map((type) => ({
      id: type,
      type,
      title: type === 'error' ? malicious : `Título ${type}`,
      description: `Descripción ${type}`,
    })),
  });
  for (const type of ['info', 'success', 'warning', 'error']) {
    assert.match(html, new RegExp(`ninja-alert--${type}`));
  }
  assert.match(html, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(html, /role="alert"[\s\S]*aria-live="assertive"/);
  assert.match(html, /aria-label="Cerrar alerta:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('global API renders variants, deduplicates IDs, actions work, and lifecycle removes safely', async () => {
  const env = runtime();
  let actionCalls = 0;
  const api = env.window.NinjaAlerts;
  api.info('Info', 'Descripción', { id: 'same', persistent: true });
  api.info('Duplicado', '', { id: 'same', persistent: true });
  api.success('Éxito', '', {
    id: 'success',
    persistent: true,
    actionLabel: 'Ver',
    actionCallback: () => { actionCalls += 1; },
  });
  api.warning('Atención', '', { id: 'warning', persistent: true });
  api.error('Error', '', { id: 'error', persistent: true });

  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 4);
  assert.equal(env.host.querySelector('.ninja-alert--info').getAttribute('role'), 'status');
  assert.equal(env.host.querySelector('.ninja-alert--error').getAttribute('role'), 'alert');
  env.host.querySelector('.ninja-alert__action').dispatch('click');
  assert.equal(actionCalls, 1);

  assert.equal(api.dismiss('warning'), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 3);
  api.clear();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 0);
});

test('hover and keyboard focus pause timers and resume with remaining time', () => {
  const env = runtime();
  env.window.NinjaAlerts.info('Temporizada', '', { id: 'timer', duration: 1000 });
  const node = env.host.querySelector('[data-ninja-alert]');
  assert.equal([...env.timers.values()][0].delay, 1000);

  env.advance(400);
  node.dispatch('mouseenter');
  assert.equal(env.timers.size, 0);
  node.dispatch('mouseleave');
  assert.equal([...env.timers.values()][0].delay, 600);

  env.advance(100);
  node.dispatch('focusin');
  assert.equal(env.timers.size, 0);
  node.dispatch('focusout', { relatedTarget: null });
  assert.equal([...env.timers.values()][0].delay, 500);
});

test('reduced motion bypasses entry and exit animation', async () => {
  const env = runtime({ reduceMotion: true });
  env.window.NinjaAlerts.success('Sin movimiento', '', { id: 'reduced', persistent: true });
  const node = env.host.querySelector('[data-ninja-alert]');
  assert.equal(node.animateCalls.length, 0);
  env.window.NinjaAlerts.dismiss('reduced');
  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 0);
});

test('visible limit queues excess alerts and reveals one after dismissal', async () => {
  const env = runtime({ reduceMotion: true });
  for (let index = 1; index <= 6; index += 1) {
    env.window.NinjaAlerts.info(`Alerta ${index}`, '', {
      id: `queued-${index}`,
      persistent: true,
    });
  }
  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 5);
  env.window.NinjaAlerts.dismiss('queued-1');
  await Promise.resolve();
  assert.equal(env.host.querySelectorAll('[data-ninja-alert]').length, 5);
  assert.equal(
    env.host.querySelectorAll('[data-ninja-alert]')
      .some((node) => node.getAttribute('data-alert-id') === 'queued-6'),
    true
  );
});

test('bootstrap guard prevents duplicate initialization, timers, and listeners', () => {
  const env = runtime();
  env.window.NinjaAlerts.info('Única', '', { id: 'unique', duration: 1000 });
  const api = env.window.NinjaAlerts;
  const node = env.host.querySelector('[data-ninja-alert]');
  const listenerCount = [...node.listeners.values()].reduce((sum, list) => sum + list.length, 0);
  const timerCount = env.timers.size;
  vm.runInNewContext(scriptSource, env.context, { filename: 'ninja-alerts-second-load.js' });
  assert.equal(env.window.NinjaAlerts, api);
  assert.equal(env.timers.size, timerCount);
  assert.equal(
    [...node.listeners.values()].reduce((sum, list) => sum + list.length, 0),
    listenerCount
  );
});

test('CSS supplies desktop/mobile positioning, safe stacking, and reduced-motion rules', () => {
  assert.match(cssSource, /\.ninja-alerts\s*\{[\s\S]*position:\s*fixed/);
  assert.match(cssSource, /z-index:\s*12000/);
  assert.match(cssSource, /top:\s*max\(1rem,\s*env\(safe-area-inset-top\)\)/);
  assert.match(cssSource, /@media \(max-width:\s*640px\)[\s\S]*left:\s*max\(0\.75rem/);
  assert.match(cssSource, /overflow-wrap:\s*anywhere/);
  assert.match(cssSource, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test('all shared layouts load the same partial and external CSP-safe assets', () => {
  for (const name of ['main', 'admin', 'store', 'account']) {
    const layout = fs.readFileSync(path.join(root, `views/layouts/${name}.ejs`), 'utf8');
    assert.match(layout, /include\('\.\.\/partials\/ninja-alerts'\)/, `${name} partial`);
    assert.match(layout, /\/css\/ninja-alerts\.css/, `${name} stylesheet`);
    assert.match(layout, /<script src="\/js\/ninja-alerts\.js"><\/script>/, `${name} script`);
  }
  assert.doesNotMatch(scriptSource, /\.innerHTML\s*=/);
  assert.match(scriptSource, /\.textContent\s*=/);
});
