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
