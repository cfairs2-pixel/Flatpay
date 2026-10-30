import { build } from 'esbuild';
import { mkdir, cp, rm, writeFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await build({ entryPoints: ['scripts/vendor-entry.mjs'], outfile: 'public/vendor/supabase.js', bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'eof' });
await cp('node_modules/@supabase/supabase-js/LICENSE', 'public/vendor/SUPABASE-LICENSE.txt');
await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
await writeFile('dist/.nojekyll', '');
console.log('Built dist/: static phone app + official Supabase browser client.');
