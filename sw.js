// オンラインでは常に最新版を読み込み、その内容を端末に保存してオフライン起動に使う
const SHELL_CACHE = 'booster-catch-shell-v1';
const FONT_CACHE = 'booster-catch-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const SCOPE = self.registration.scope;
const SHELL_URL = SCOPE;
const STATIC_FILES = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];

/** HTML とそこから参照するビルド成果物を保存し、古い成果物を消す */
async function saveShell(response) {
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((match) => new URL(match[1], SCOPE).href);
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    assets.map(async (url) => {
      if (!(await cache.match(url, { ignoreVary: true }))) await cache.add(url);
    }),
  );
  await cache.put(SHELL_URL, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

  const assetRoot = new URL('assets/', SCOPE).href;
  for (const request of await cache.keys()) {
    if (request.url.startsWith(assetRoot) && !assets.includes(request.url)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL_URL, { cache: 'no-store' });
      await saveShell(response);
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(STATIC_FILES.map((path) => new URL(path, SCOPE).href));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, FONT_CACHE];
      for (const key of await caches.keys()) {
        if (key.startsWith('booster-catch-') && !keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function handleNavigation(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(saveShell(response.clone()));
    return response;
  } catch {
    const cached = await caches.match(SHELL_URL, { ignoreVary: true });
    if (cached) return cached;
    throw new Error('offline and no cached app');
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
  } else if (url.href.startsWith(new URL('assets/', SCOPE).href)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else if (url.href.startsWith(SCOPE)) {
    event.respondWith(networkFirst(request));
  }
});
