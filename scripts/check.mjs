import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for (const file of ['public/cloud-client.js','public/cloud-api.mjs','public/workspace.js','public/service-worker.js']) {
 const check=spawnSync(process.execPath,['--check',file],{stdio:'inherit'}); assert.equal(check.status,0,file);
}
const m=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(m.display,'standalone'); assert.equal(m.scope,'./');
for(const icon of m.icons) assert(existsSync('public/'+icon.src.replace(/^\.\//,'')));
const app=readFileSync('public/workspace.js','utf8');
assert(!app.includes('localStorage')); assert(app.includes('X-Record-Revision')); assert(app.includes('flatpay:refresh'));
const page=readFileSync('public/index.html','utf8'); assert(page.includes('./cloud-client.js')); assert(!page.includes('href="/'));
assert(existsSync('supabase/migrations/202610300001_flatpay.sql'));
console.log('Syntax, PWA paths, workspace API and Supabase migration checks passed.');
