'use strict';

const CACHE_NAME = 'mark6-shake-offline-v1';
const CACHE_PREFIX = 'mark6-shake-';
const SCOPE_URL = self.registration.scope;
const ROOT_URL = new URL('./', SCOPE_URL).href;
const INDEX_URL = new URL('index.html', SCOPE_URL).href;
const OPTIONAL_URLS = [
  'manifest.webmanifest',
  'icon-192.png',
  'share-icon-512.png',
  'assets/completion-crystal-chime.wav',
  'assets/lottery-balls-dry-clatter.mp3'
].map(path => new URL(path, SCOPE_URL).href);

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const freshRequest = new Request(request, { cache: 'no-cache' });
  return fetch(freshRequest, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function fetchAndCache(cache, url, timeoutMs = 3000) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok || response.type === 'opaque') throw new Error('Could not cache ' + url);
  await cache.put(url, response.clone());
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shellResults = await Promise.allSettled([
      fetchAndCache(cache, ROOT_URL, 4000),
      fetchAndCache(cache, INDEX_URL, 4000)
    ]);
    if (!shellResults.some(result => result.status === 'fulfilled')) {
      throw new Error('The app shell is not available to cache yet.');
    }
    await Promise.allSettled(OPTIONAL_URLS.map(url => fetchAndCache(cache, url, 3000)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function refreshNavigation(request, cache) {
  const response = await fetchWithTimeout(request, 2500);
  if (!response.ok || response.type === 'opaque') return response;
  await cache.put(ROOT_URL, response.clone());
  await cache.put(INDEX_URL, response.clone());
  return response;
}

async function handleNavigation(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request) || await cache.match(ROOT_URL) || await cache.match(INDEX_URL);
  if (cached) {
    event.waitUntil(refreshNavigation(request, cache).catch(() => {}));
    return cached;
  }
  try {
    return await refreshNavigation(request, cache);
  } catch (_) {
    return new Response('搖搖樂暫時未能載入。請先連線開啟一次，之後即可離線使用。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function handleSameOriginResource(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    event.waitUntil(fetchAndCache(cache, request, 2500).catch(() => {}));
    return cached;
  }
  try {
    return await fetchAndCache(cache, request, 3000);
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(SCOPE_URL)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, event));
    return;
  }
  event.respondWith(handleSameOriginResource(request, event));
});
