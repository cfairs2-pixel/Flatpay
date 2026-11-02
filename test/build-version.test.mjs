import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { contentBuildId, stampModuleImports, stampHtml } from '../scripts/build.mjs';

test('build identity includes parser modules and lockfile content, independent of enumeration order', () => {
  const source = [
    ['public/workspace.js', 'workspace'],
    ['public/statement-layout.mjs', 'first parser'],
    ['package-lock.json', 'locked dependencies'],
  ];
  const original = contentBuildId(source);
  assert.equal(contentBuildId([...source].reverse()), original);
  assert.notEqual(contentBuildId(source.map(([path, data]) => [path, path.includes('layout') ? 'new parser' : data])), original);
  assert.notEqual(contentBuildId(source.map(([path, data]) => [path, path.includes('lock') ? 'new dependencies' : data])), original);
});

test('a new build loads changed parsers through a versioned static and dynamic module graph', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flatpay-version-test-'));
  const sources = new Map([
    ['entry.mjs', "import { sdk } from './vendor/sdk.js'; export async function read() { const { parse } = await import('./workspace.mjs'); return sdk + ':' + parse(); }"],
    ['workspace.mjs', "import { parse as readLayout } from './statement-layout.mjs'; export const parse = () => readLayout();"],
    ['statement-layout.mjs', "export const parse = () => 'first';"],
  ]);
  try {
    await mkdir(join(directory, 'vendor'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'vendor/sdk.js'), "export const sdk = 'sdk';");
    async function release() {
      const buildId = contentBuildId([...sources]);
      for (const [path, source] of sources) await writeFile(join(directory, path), stampModuleImports(source, buildId));
      return import(`${pathToFileURL(join(directory, 'entry.mjs')).href}?v=${buildId}`);
    }
    assert.equal(await (await release()).read(), 'sdk:first');
    sources.set('statement-layout.mjs', "export const parse = () => 'second';");
    assert.equal(await (await release()).read(), 'sdk:second');
    // The release transformation leaves authored import specifiers untouched.
    assert(sources.get('entry.mjs').includes("import('./workspace.mjs')"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTML build identity and entry assets resolve consistently under a project path', () => {
  const id = '0123456789abcdef';
  const source = '<meta name="app-build" content="development" /><script type="module" src="./cloud-client.js"></script><link rel="stylesheet" href="./cloud.css"><link rel="manifest" href="./manifest.webmanifest">';
  const result = stampHtml(source, id);
  assert(result.includes(`name="app-build" content="${id}"`));
  for (const [, specifier] of result.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(specifier, 'https://example.test/Flatpay/');
    assert(url.pathname.startsWith('/Flatpay/'));
    assert.equal(url.searchParams.get('v'), url.pathname.endsWith('webmanifest') ? null : id);
  }
  assert(source.includes('content="development"'));
});

test('versioning retains existing URL parameters and never rewrites worker URL constructors', () => {
  const source = "import { parse } from './statement-summary.mjs?mode=review#parser'; const worker = new URL('./service-worker.js', import.meta.url);";
  const result = stampModuleImports(source, '0123456789abcdef');
  assert(result.includes('./statement-summary.mjs?mode=review&v=0123456789abcdef#parser'));
  assert(result.includes("new URL('./service-worker.js', import.meta.url)"));
});

const client = await readFile(new URL('../public/cloud-client.js', import.meta.url), 'utf8');
const versionFunctions = client.slice(client.indexOf('function element('), client.indexOf('async function api('));

function versionClient({ appBuild = '0123456789abcdef', latest = 'fedcba9876543210', fail = false } = {}) {
  let now = 100000;
  let reloads = 0;
  const requests = [];
  function node(tag) {
    return {
      tag, children: [], attributes: {}, listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    };
  }
  const body = node('body');
  const all = () => {
    const nodes = [];
    function walk(item) { nodes.push(item); for (const child of item.children) walk(child); }
    walk(body);
    return nodes;
  };
  const context = vm.createContext({
    appBuild, baseUrl: 'https://example.test/Flatpay/',
    lastVersionCheck: 0, versionCheckPending: false,
    URL, AbortController, setTimeout, clearTimeout,
    Date: { now: () => now },
    navigator: { onLine: true },
    location: { reload: () => { reloads++; } },
    document: {
      hidden: false, body, createElement: node,
      getElementById: id => all().find(item => item.attributes.id === id),
    },
    nativeFetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (fail) throw new TypeError('Offline');
      return { ok: true, json: async () => ({ buildId: latest }) };
    },
  });
  vm.runInContext(versionFunctions, context);
  return {
    body, requests, all,
    check: () => context.checkAppVersion(),
    advance: milliseconds => { now += milliseconds; },
    get reloads() { return reloads; },
  };
}

test('new release probe uses native no-store fetch and waits for an explicit reload click', async () => {
  const client = versionClient();
  await client.check();
  assert.equal(client.requests[0].url, 'https://example.test/Flatpay/version.json');
  assert.equal(client.requests[0].options.cache, 'no-store');
  assert.equal(client.reloads, 0);
  assert(client.all().some(item => /Save changes, then reload/.test(item.textContent || '')));
  const reload = client.all().find(item => item.tag === 'button');
  reload.listeners.click();
  assert.equal(client.reloads, 1);
});

test('version probes are throttled and source previews do not request release metadata', async () => {
  const client = versionClient();
  await client.check();
  await client.check();
  assert.equal(client.requests.length, 1);
  client.advance(60001);
  await client.check();
  assert.equal(client.requests.length, 2);
  const sourcePreview = versionClient({ appBuild: 'development' });
  await sourcePreview.check();
  assert.equal(sourcePreview.requests.length, 0);
});

test('offline version checks cannot trigger reloads or prevent the rest of the app continuing', async () => {
  const client = versionClient({ fail: true });
  await client.check();
  assert.equal(client.reloads, 0);
  assert.equal(client.body.children.length, 0);
});
