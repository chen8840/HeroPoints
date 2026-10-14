import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function worker(version, cacheData, network = () => { throw new Error('offline'); }) {
  const listeners = {};
  const caches = { open: async (name) => ({ match: async (key) => cacheData[name]?.[typeof key === 'string' ? key : key.url], put: async () => { throw new Error('must not overwrite build cache'); } }), match: async () => { throw new Error('must not search other versions'); } };
  return readFile(new URL('../public/sw.js', import.meta.url), 'utf8').then((source) => {
    vm.runInNewContext(source.replaceAll('__BUILD_VERSION__', version).replaceAll('__PRECACHE_MANIFEST__', '[]'), { self: { location: { origin: 'https://example.com' }, addEventListener: (type, fn) => { listeners[type] = fn; } }, caches, URL, fetch: network });
    return async (request) => {
      let promise;
      listeners.fetch({ request, respondWith: (p) => { promise = p; }, waitUntil() {} });
      return promise;
    };
  });
}

test('old worker keeps old shell and modules even when new network and waiting cache exist', async () => {
  const data = {
    'heroxp-old': { './index.html': 'old HTML', 'https://example.com/HeroPoints/src/app.js': 'old JS' },
    'heroxp-new': { './index.html': 'new HTML', 'https://example.com/HeroPoints/src/app.js': 'new JS' }
  };
  let fetched = 0;
  const old = await worker('old', data, async () => { fetched++; return 'new HTML'; });
  assert.equal(await old({ method: 'GET', mode: 'navigate', url: 'https://example.com/HeroPoints/' }), 'old HTML');
  assert.equal(await old({ method: 'GET', mode: 'cors', url: 'https://example.com/HeroPoints/src/app.js' }), 'old JS');
  assert.equal(fetched, 0);
  const latest = await worker('new', data);
  assert.equal(await latest({ method: 'GET', mode: 'navigate', url: 'https://example.com/HeroPoints/' }), 'new HTML');
  assert.equal(await latest({ method: 'GET', mode: 'cors', url: 'https://example.com/HeroPoints/src/app.js' }), 'new JS');
});

test('Android back cancels actual conflict promise and allows next conflict dialog', async () => {
  const listeners = {};
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} }, addEventListener(type, fn) { this[type] = fn; }, querySelector: () => ({ value: 'local' }) });
    return elements.get(id);
  };
  const previous = { window: globalThis.window, history: globalThis.history, location: globalThis.location, document: globalThis.document };
  Object.assign(globalThis, {
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    document: { getElementById: element }, location: { href: 'https://example.com/HeroPoints/' },
    history: { pushState() {}, back() { listeners.popstate(); } }
  });
  try {
    const { initConflicts } = await import('../src/ui/conflicts.js');
    const ui = initConflicts();
    const conflict = { entity: 'score', label: 'Score', local: { checked: true }, remote: { checked: false } };
    const pending = ui.show([conflict]);
    listeners.popstate();
    assert.equal(await pending, null);
    const next = ui.show([conflict]);
    element('conflictConfirmBtn').click();
    assert.deepEqual(await next, ['local']);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('已有待激活的新版本时，打开应用依然提示更新（而非永远静默）', async () => {
  const listeners = {};
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        classList: {
          removed: [],
          add() {},
          remove(className) {
            this.removed.push(className);
          },
          contains: () => false
        },
        addEventListener() {}
      });
    }
    return elements.get(id);
  };

  let updateCalls = 0;
  const registration = {
    waiting: { postMessage() {} },
    addEventListener() {},
    update: async () => {
      updateCalls += 1;
    }
  };

  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        controller: {},
        register: async () => registration,
        addEventListener() {}
      }
    }
  });
  Object.assign(globalThis, {
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    document: { getElementById: element, addEventListener() {}, visibilityState: 'visible' }
  });

  try {
    const { initServiceWorker } = await import('../src/ui/install.js');
    initServiceWorker();
    listeners.load();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const banner = elements.get('updateBanner');
    assert.ok(banner, '应访问更新横幅元素');
    assert.ok(banner.classList.removed.includes('hidden'), '存在待激活版本时，打开应用应直接显示更新横幅');
    assert.ok(updateCalls >= 1, '打开应用时应主动检查一次新版本');
  } finally {
    Object.defineProperty(globalThis, 'navigator', previousNavigator);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('启动时尝试锁定竖屏；不支持的环境静默降级', async () => {
  const previousWindow = globalThis.window;
  const previousScreen = Object.getOwnPropertyDescriptor(globalThis, 'screen');
  if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
  try {
    const { initOrientationLock } = await import('../src/ui/install.js');

    let requested = null;
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: { lock: async (value) => { requested = value; } } }
    });
    assert.equal(initOrientationLock(), true, '支持锁定时应发起请求');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requested, 'portrait');

    Object.defineProperty(globalThis, 'screen', { configurable: true, value: { orientation: {} } });
    assert.equal(initOrientationLock(), false, '不支持 lock 的环境不报错');

    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: { lock: () => { throw new Error('denied'); } } }
    });
    assert.equal(initOrientationLock(), false, '锁定被拒绝时静默降级');
  } finally {
    if (previousScreen === undefined) delete globalThis.screen;
    else Object.defineProperty(globalThis, 'screen', previousScreen);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
