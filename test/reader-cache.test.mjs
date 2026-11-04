import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const origin = 'https://app.example';
const readerPath = 'ocr/worker.min.js';

function assetResponse(text = 'reader asset') {
  const response = new Response(text, { headers: { 'Content-Type': 'text/javascript' } });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

function loadWorker({ scope = '/Flatpay/', cacheOverrides = {}, openFailure, networkFailure, cacheNames = [],
  publicMatchFailure, publicResponse, enumerationFailure, deletionFailure } = {}) {
  const handlers = new Map();
  const fetches = [];
  const opened = [];
  const removed = [];
  let claimed = false;
  const cache = {
    addAll: async () => {},
    match: async () => undefined,
    put: async () => {},
    keys: async () => [],
    delete: async () => true,
    ...cacheOverrides,
  };
  const context = vm.createContext({
    URL, Response,
    self: {
      registration: { scope: `${origin}${scope}` },
      location: { origin },
      clients: { claim: async () => { claimed = true; } },
      skipWaiting: () => {},
      addEventListener: (type, listener) => handlers.set(type, listener),
    },
    caches: {
      open: async name => {
        opened.push(name);
        if (openFailure) throw openFailure;
        return cache;
      },
      match: async () => {
        if (publicMatchFailure) throw publicMatchFailure;
        return publicResponse;
      },
      keys: async () => {
        if (enumerationFailure) throw enumerationFailure;
        return cacheNames;
      },
      delete: async name => {
        removed.push(name);
        if (deletionFailure) throw deletionFailure;
        return true;
      },
    },
    fetch: async request => {
      fetches.push(request);
      if (networkFailure) throw networkFailure;
      return assetResponse();
    },
  });
  vm.runInContext(workerSource, context);
  const appURL = path => new URL(path, `${origin}${scope}`).href;
  return {
    fetches, opened, removed, appURL,
    get claimed() { return claimed; },
    async lifecycle(type) {
      let work;
      handlers.get(type)({ waitUntil: promise => { work = promise; } });
      await work;
    },
    request(path = readerPath, { method = 'GET', external = false, navigate = false } = {}) {
      let response;
      const url = external ? path : appURL(path);
      handlers.get('fetch')({
        request: navigate ? { url, method, mode: 'navigate' } : new Request(url, { method }),
        respondWith: promise => { response = promise; },
      });
      return response;
    },
    async clearCaches() {
      let work;
      let acknowledged = false;
      handlers.get('message')({
        data: { type: 'CLEAR_CACHES' },
        ports: [{ postMessage: message => { acknowledged = message.ok === true; } }],
        waitUntil: promise => { work = promise; },
      });
      await work;
      return acknowledged;
    },
  };
}

for (const [name, options] of [
  ['cache open failure', { openFailure: new Error('Storage denied') }],
  ['cache read failure', { cacheOverrides: { match: async () => { throw new Error('Cache read failed'); } } }],
  ['cache write failure', { cacheOverrides: { put: async () => { throw new Error('Cache write failed'); } } }],
  ['cache quota exhaustion', { cacheOverrides: { put: async () => { throw new DOMException('Full', 'QuotaExceededError'); } } }],
  ['cache key enumeration failure', { cacheOverrides: { keys: async () => { throw new Error('Cache unavailable'); } } }],
  ['cache eviction failure', { cacheOverrides: {
    keys: async () => Array.from({ length: 49 }, (_, index) => new Request(`${origin}/Flatpay/ocr/asset-${index}.js`)),
    delete: async () => { throw new Error('Cache deletion failed'); },
  } }],
]) {
  test(`reader asset still loads after ${name}`, async () => {
    const worker = loadWorker(options);
    const response = await worker.request();
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'reader asset');
    assert.equal(worker.fetches.length, 1);
  });
}

test('a cached reader asset remains available when the network is unavailable', async () => {
  const worker = loadWorker({
    networkFailure: new TypeError('Offline'),
    cacheOverrides: { match: async () => assetResponse('cached reader asset') },
  });
  assert.equal(await (await worker.request()).text(), 'cached reader asset');
  assert.equal(worker.fetches.length, 0);
});

test('an unavailable cache does not hide a real network failure', async () => {
  const networkFailure = new TypeError('Offline');
  const worker = loadWorker({ openFailure: new Error('Storage denied'), networkFailure });
  await assert.rejects(worker.request(), error => error === networkFailure);
});

test('API, authentication, uploads and external requests bypass the reader cache', () => {
  const worker = loadWorker();
  for (const path of ['api/deals', 'api/export', 'auth/login', 'signin-with-chatgpt', 'callback', 'uploads/customer.pdf']) {
    assert.equal(worker.request(path), undefined, path);
  }
  assert.equal(worker.request('https://database.example/auth/v1/token', { external: true }), undefined);
  assert.equal(worker.request(readerPath, { method: 'POST' }), undefined);
  assert.equal(worker.opened.length, 0);
  assert.equal(worker.fetches.length, 0);
});

test('reader cache buckets remain scoped to the hosted project path', async () => {
  const project = loadWorker();
  const root = loadWorker({ scope: '/' });
  assert.equal(await (await project.request('statement-reader/pdf.worker.min.mjs')).text(), 'reader asset');
  assert.equal(await (await root.request('statement-reader/pdf.worker.min.mjs')).text(), 'reader asset');
  assert.notEqual(project.opened[0], root.opened[0]);
  assert.match(project.opened[0], /%2FFlatpay%2F/);
});

test('logout clears this project’s old and current cache buckets and acknowledges completion', async () => {
  const worker = loadWorker({ cacheNames: [
    'myflatpay-pwa-%2FFlatpay%2F-readers-v2',
    'myflatpay-pwa-%2FFlatpay%2F-shell-v3',
    'myflatpay-pwa-%2FOther%2F-readers-v2',
    'unrelated-cache',
  ] });
  assert.equal(await worker.clearCaches(), true);
  assert.deepEqual(worker.removed, [
    'myflatpay-pwa-%2FFlatpay%2F-readers-v2',
    'myflatpay-pwa-%2FFlatpay%2F-shell-v3',
  ]);
});

test('worker installation succeeds when Cache Storage cannot be opened', async () => {
  const worker = loadWorker({ openFailure: new Error('Storage denied') });
  await worker.lifecycle('install');
  assert.equal(await (await worker.request()).text(), 'reader asset');
});

test('worker installation succeeds when generic precaching runs out of space', async () => {
  const worker = loadWorker({ cacheOverrides: {
    addAll: async () => { throw new DOMException('Full', 'QuotaExceededError'); },
  } });
  await worker.lifecycle('install');
  assert.equal(await (await worker.request()).text(), 'reader asset');
});

test('activation claims clients even when cache enumeration is unavailable', async () => {
  const worker = loadWorker({ enumerationFailure: new Error('Storage denied') });
  await worker.lifecycle('activate');
  assert.equal(worker.claimed, true);
});

test('activation claims clients even when old-cache deletion fails', async () => {
  const worker = loadWorker({
    cacheNames: ['myflatpay-pwa-%2FFlatpay%2F-readers-v2'],
    deletionFailure: new Error('Storage denied'),
  });
  await worker.lifecycle('activate');
  assert.equal(worker.claimed, true);
  assert.equal(worker.removed.length, 1);
});

test('public assets still load online when cache matching is unavailable', async () => {
  const worker = loadWorker({ publicMatchFailure: new Error('Storage denied') });
  assert.equal(await (await worker.request('mobile.css')).text(), 'reader asset');
  assert.equal(worker.fetches.length, 1);
});

test('public-asset network errors stay visible when no cached response is available', async () => {
  const networkFailure = new TypeError('Offline');
  const worker = loadWorker({ publicMatchFailure: new Error('Storage denied'), networkFailure });
  await assert.rejects(worker.request('mobile.css'), error => error === networkFailure);
});

test('navigation uses the built-in offline screen if both network and cache are unavailable', async () => {
  const worker = loadWorker({ publicMatchFailure: new Error('Storage denied'), networkFailure: new TypeError('Offline') });
  const response = await worker.request('', { navigate: true });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Reconnect to open your workspace/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('navigation can still use a generic cached offline page', async () => {
  const worker = loadWorker({ publicResponse: new Response('generic offline page'), networkFailure: new TypeError('Offline') });
  assert.equal(await (await worker.request('', { navigate: true })).text(), 'generic offline page');
});
