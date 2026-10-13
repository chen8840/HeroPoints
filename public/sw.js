/* eslint-env serviceworker */
// 构建时由 scripts/build.mjs 注入构建版本号与预缓存清单（不要手工改动下方两个常量名）。
const BUILD_VERSION = '__BUILD_VERSION__';
const PRECACHE_URLS = __PRECACHE_MANIFEST__;
const CACHE_NAME = `heroxp-${BUILD_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只处理同源静态资源；JSONBin 等跨域 API 请求不经过缓存。
  if (url.origin !== self.location.origin) return;

  // Keep the entry page paired with this worker's precached module/CSS version.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match('./index.html');
        if (cached) return cached;
        return fetch(request);
      })
    );
    return;
  }

  // Read only this build's cache; a waiting worker may already have cached a newer build.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
