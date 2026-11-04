import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, cp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function contentBuildId(entries) {
  const hash = createHash('sha256');
  for (const [path, contents] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update('\0').update(contents).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function versionUrl(specifier, buildId) {
  const url = new URL(specifier, 'https://build.invalid/');
  url.searchParams.set('v', buildId);
  return specifier.split(/[?#]/, 1)[0] + url.search + url.hash;
}

export function stampModuleImports(source, buildId) {
  // Root application modules are authored with quoted relative imports. Reader
  // workers and binaries under ocr/ and statement-reader/ are copied untouched.
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.\/[^"'\r\n]+?\.(?:mjs|js)(?:[?#][^"'\r\n]*)?)\2/g,
    (_match, prefix, quote, specifier) => `${prefix}${quote}${versionUrl(specifier, buildId)}${quote}`,
  );
}

export function stampHtml(source, buildId) {
  const meta = /<meta\s+name=(["'])app-build\1\s+content=(["'])[^"']*\2\s*\/?>/;
  if (!meta.test(source)) throw new Error('The app HTML needs its app-build metadata.');
  return source.replace(meta, `<meta name="app-build" content="${buildId}" />`).replace(
    /(\b(?:src|href)\s*=\s*)(["'])(\.\/[^"'\r\n]+?\.(?:mjs|js|css)(?:[?#][^"'\r\n]*)?)\2/g,
    (_match, prefix, quote, specifier) => `${prefix}${quote}${versionUrl(specifier, buildId)}${quote}`,
  );
}

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await collectFiles(path));
    else if (entry.isFile()) result.push([path, await readFile(path)]);
  }
  return result;
}

export async function buildSite() {
  await mkdir('public/vendor', { recursive: true });
  await build({ entryPoints: ['scripts/vendor-entry.mjs'], outfile: 'public/vendor/supabase.js', bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'eof' });
  await cp('node_modules/@supabase/supabase-js/LICENSE', 'public/vendor/SUPABASE-LICENSE.txt');
  const entries = [
    ...await collectFiles('public'),
    ...await collectFiles('scripts'),
    ['package.json', await readFile('package.json')],
    ['package-lock.json', await readFile('package-lock.json')],
  ];
  const buildId = contentBuildId(entries);
  await rm('dist', { recursive: true, force: true });
  await cp('public', 'dist', { recursive: true });
  for (const entry of await readdir('dist', { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:mjs|js)$/.test(entry.name)) continue;
    const path = `dist/${entry.name}`;
    await writeFile(path, stampModuleImports(await readFile(path, 'utf8'), buildId));
  }
  await writeFile('dist/index.html', stampHtml(await readFile('dist/index.html', 'utf8'), buildId));
  await writeFile('dist/version.json', JSON.stringify({ buildId }) + '\n');
  await writeFile('dist/.nojekyll', '');
  console.log(`Built dist/: phone app ${buildId} with versioned modules.`);
  return buildId;
}

// Importing the pure helpers in a test must not replace a release build.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildSite();
