/* Only generic, public assets are cached. Workspace and authentication responses
 * must always reach the server. Bump VERSION when changing cached public assets. */
const VERSION = 'v3';
const APP_BASE = new URL(self.registration.scope);
const appURL = path => new URL(path, APP_BASE).href;
const PREFIX = `myflatpay-pwa-${encodeURIComponent(APP_BASE.pathname)}-`;
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const READER_CACHE = `${PREFIX}readers-${VERSION}`;
const OFFLINE_URL = appURL('offline.html');
const PUBLIC_ASSETS = [
  OFFLINE_URL,
  appURL('mobile.css'),
  appURL('icons/app-icon-192.png'),
  appURL('icons/app-icon-512.png'),
  appURL('icons/apple-touch-icon.png'),
];
const MAX_READER_ENTRIES = 48;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PUBLIC_ASSETS);
    } catch {
      // Optional offline assets must not prevent an online app update.
    }
  })());
  // An update waits until the user closes the old app or explicitly accepts it.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, READER_CACHE]);
    try {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !keep.has(name)) {
          try { await caches.delete(name); } catch { /* Storage cleanup is optional. */ }
        }
      }
    } catch {
      // A denied Cache Storage API must not prevent this worker taking control.
    }
    await self.clients.claim();
  })());
});

function isReaderAsset(path) {
  return /^(?:ocr|statement-reader)\/[A-Za-z0-9_./-]+\.(?:js|mjs|wasm|gz|bcmap|ttf|otf|pfb|json)$/.test(path)
    && !path.includes('..');
}

async function matchPublicAsset(request) {
  try { return await caches.match(request); } catch { return undefined; }
}

async function cacheReader(request) {
  let cache;
  try {
    cache = await caches.open(READER_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Storage can be unavailable or full on a phone. Reading still works online.
  }
  const response = await fetch(request);
  if (cache && response.ok && response.type === 'basic') {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_READER_ENTRIES))) await cache.delete(key);
    } catch {
      // Caching is optional: never discard a valid reader asset after fetching it.
    }
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(APP_BASE.pathname)) return;
  const relativePath = url.pathname.slice(APP_BASE.pathname.length);
  // Never intercept API or authentication requests, including sign-in redirects.
  if (relativePath.startsWith('api/') || /(?:^|\/)auth(?:\/|$)|(?:^|\/)sign(?:in|out)|(?:^|\/)callback/.test(relativePath)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache: 'no-store' });
      } catch {
        return (await matchPublicAsset(OFFLINE_URL)) || new Response(
          '<!doctype html><meta name="viewport" content="width=device-width"><title>myflatpay is offline</title><h1>Reconnect to open your workspace</h1><p>Your saved records remain in your online account.</p><button onclick="location.reload()">Try again</button>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
        );
      }
    })());
    return;
  }
  if (PUBLIC_ASSETS.includes(url.href) && !url.search) {
    event.respondWith((async () => (await matchPublicAsset(request)) || fetch(request))());
    return;
  }
  if (isReaderAsset(relativePath) && !url.search) event.respondWith(cacheReader(request));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX)) await caches.delete(name);
      event.ports?.[0]?.postMessage({ ok: true });
    })());
  }
});
