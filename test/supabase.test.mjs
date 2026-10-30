import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Runs the actual migration against PostgreSQL in WASM. Auth JWT verification is
// Supabase's responsibility; this local stub models its authenticated user claim.
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610300001_flatpay.sql', import.meta.url), 'utf8'));
});
after(async () => { await db?.close(); });

async function account() {
  const id = randomUUID();
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
  return id;
}
async function asUser(id, role = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`SET ROLE ${role}`);
}
async function rpc(user, operation, input = {}, role = 'authenticated') {
  await asUser(user, role);
  const { rows } = await db.query('SELECT public.flatpay_workspace($1, $2::jsonb) AS result', [operation, JSON.stringify(input)]);
  return rows[0].result;
}

const emptyAssistant = () => ({ version: 1, messages: [], preferences: [], targets: { sales: null, commission: null }, _revision: 0 });
const expectError = (action, prefix) => assert.rejects(action, (error) => {
  assert.match(error.message, new RegExp(`^${prefix}:`));
  return true;
});

test('RPC requires authenticated identity; helpers and direct writes cannot bypass it', async () => {
  const alice = await account();
  await assert.rejects(() => rpc(null, 'deals.list', {}, 'anon'), /permission denied for function flatpay_workspace/);
  await expectError(() => rpc(null, 'deals.list'), '401');
  await asUser(alice);
  await assert.rejects(() => db.query('SELECT public._flatpay_export($1::uuid)', [alice]), /permission denied for function _flatpay_export/);
  await assert.rejects(() => db.query('INSERT INTO public.flatpay_deals(owner_id,id,payload,revision) VALUES($1,$2,$3::jsonb,1)', [alice, 'bypass', '{}']), /permission denied for table flatpay_deals/);
  await assert.rejects(() => db.query('UPDATE public.flatpay_accounts SET revision_counter=0 WHERE owner_id=$1', [alice]), /permission denied for table flatpay_accounts/);
});

test('account identity scopes RPC and RLS reads even when client supplies another owner', async () => {
  const alice = await account(), bob = await account();
  const saved = await rpc(alice, 'deals.save', { deal: { businessName: 'Alice shop', owner_id: bob, userId: bob } });
  assert.equal(saved.businessName, 'Alice shop');
  assert.equal(saved.owner_id, undefined);
  assert.equal(saved.userId, undefined);
  assert.ok(saved._revision > 0);
  assert.equal((await rpc(alice, 'deals.list')).length, 1);
  assert.deepEqual(await rpc(bob, 'deals.list', { owner_id: alice }), []);
  await expectError(() => rpc(bob, 'deals.save', { id: saved.id, deal: { ...saved, businessName: 'Stolen' } }), '404');
  await expectError(() => rpc(bob, 'deals.delete', { id: saved.id, revision: saved._revision }), '404');
  await asUser(bob);
  assert.deepEqual((await db.query('SELECT * FROM public.flatpay_deals WHERE owner_id=$1', [alice])).rows, []);
  const point = await rpc(alice, 'backups.create');
  assert.ok(point.id);
  await expectError(() => rpc(bob, 'backups.get', { id: point.id }), '404');
  assert.deepEqual((await rpc(bob, 'backups.list')).backups, []);
  assert.deepEqual((await rpc(bob, 'export')).deals, []);
});

test('stale customer edits/deletes fail without overwriting newer data and delete keeps recovery copy', async () => {
  const alice = await account();
  const first = await rpc(alice, 'deals.save', { deal: { businessName: 'Original' } });
  const newer = await rpc(alice, 'deals.save', { id: first.id, deal: { ...first, businessName: 'Latest' } });
  assert.ok(newer._revision > first._revision);
  await expectError(() => rpc(alice, 'deals.save', { id: first.id, deal: { ...first, businessName: 'Outdated' } }), '409');
  await expectError(() => rpc(alice, 'deals.delete', { id: first.id, revision: first._revision }), '409');
  await expectError(() => rpc(alice, 'deals.save', { id: first.id, deal: { businessName: 'Missing revision' } }), '409');
  assert.equal((await rpc(alice, 'deals.list'))[0].businessName, 'Latest');
  const deleted = await rpc(alice, 'deals.delete', { id: newer.id, revision: newer._revision });
  assert.equal(deleted.ok, true);
  assert.deepEqual(await rpc(alice, 'deals.list'), []);
  const points = (await rpc(alice, 'backups.list')).backups;
  assert.ok(points.some(point => point.reason === 'daily'));
  const recovery = points.find(point => point.reason === 'before-delete');
  assert.equal((await rpc(alice, 'backups.get', { id: recovery.id })).deals[0].businessName, 'Latest');
});

test('assistant state is account-owned and rejects concurrent stale updates', async () => {
  const alice = await account(), bob = await account();
  const initial = await rpc(alice, 'assistant.get');
  assert.equal(initial._revision, 0);
  const updated = await rpc(alice, 'assistant.set', { state: { ...initial, preferences: [{ id: 'preference-1', text: 'Use concise drafts.' }], targets: { sales: 10, commission: 1000 } } });
  assert.ok(updated._revision > 0);
  await expectError(() => rpc(alice, 'assistant.set', { state: initial }), '409');
  assert.equal((await rpc(alice, 'assistant.get')).preferences[0].text, 'Use concise drafts.');
  assert.deepEqual((await rpc(bob, 'assistant.get')).preferences, []);
  const exported = await rpc(alice, 'export');
  assert.equal(exported.assistant.targets.sales, 10);
  assert.equal(exported.assistant._revision, undefined);
});

test('malformed restore fails atomically, valid restore retains recovery and assigns fresh revisions', async () => {
  const alice = await account(), bob = await account();
  const original = await rpc(alice, 'deals.save', { deal: { businessName: 'Original' } });
  const foreign = await rpc(bob, 'deals.save', { deal: { businessName: 'Bob only' } });
  const beforePoints = (await rpc(alice, 'backups.list')).backups.length;
  const malformed = { version: 1, deals: [{ id: 'valid', businessName: 'Valid' }, { id: 'bad', businessName: '' }] };
  await expectError(() => rpc(alice, 'backups.preview', { backup: malformed }), '400');
  await expectError(() => rpc(alice, 'backups.restore', { backup: malformed, confirm: 'REPLACE MY WORKSPACE' }), '400');
  assert.equal((await rpc(alice, 'deals.list'))[0].businessName, 'Original');
  assert.equal((await rpc(alice, 'backups.list')).backups.length, beforePoints);
  await expectError(() => rpc(alice, 'backups.preview', { backup: { version: 1, deals: [{ id: 'same', businessName: 'One' }, { id: 'same', businessName: 'Two' }] } }), '400');
  const backup = { version: 1, deals: [{ id: foreign.id, businessName: 'Restored for Alice', owner_id: bob, _revision: 1000000 }] };
  const preview = await rpc(alice, 'backups.preview', { backup });
  assert.equal(preview.dealCount, 1);
  assert.equal(preview.assistantIncluded, false);
  await expectError(() => rpc(alice, 'backups.restore', { backup, confirm: 'yes' }), '400');
  const restored = await rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' });
  assert.equal(restored.restored, 1);
  assert.equal((await rpc(alice, 'backups.get', { id: restored.recoveryBackup })).deals[0].businessName, 'Original');
  const after = (await rpc(alice, 'deals.list'))[0];
  assert.equal(after.businessName, 'Restored for Alice');
  assert.equal(after.owner_id, undefined);
  assert.notEqual(after._revision, 1000000);
  assert.equal((await rpc(bob, 'deals.list'))[0].businessName, 'Bob only');
  const full = await rpc(alice, 'export');
  await rpc(alice, 'backups.restore', { backup: full, confirm: 'REPLACE MY WORKSPACE' });
  await expectError(() => rpc(alice, 'deals.save', { id: after.id, deal: after }), '409');
  await expectError(() => rpc(alice, 'deals.delete', { id: after.id, revision: after._revision }), '409');
  // Importing a legacy customers-only backup preserves account assistant settings.
  const state = await rpc(alice, 'assistant.get');
  await rpc(alice, 'assistant.set', { state: { ...state, preferences: [{ id: 'keep', text: 'Keep this setting.' }] } });
  await rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' });
  assert.equal((await rpc(alice, 'assistant.get')).preferences[0].text, 'Keep this setting.');
  assert.ok(original.id);
});

test('restored assistant actions cannot crash the client and failed validation leaves records intact', async () => {
  const alice = await account();
  await rpc(alice, 'deals.save', { deal: { businessName: 'Keep me' } });
  for (const metadata of [{ actions: [null] }, { actions: [{ type: 'followUp', text: { invalid: true } }] }, { actions: [{ type: 'followUp', text: 'A draft' }], applied: {} }]) {
    const assistant = { ...emptyAssistant(), messages: [{ id: 'message-1', role: 'assistant', content: 'Draft', ...metadata }] };
    const backup = { version: 1, deals: [], assistant };
    await expectError(() => rpc(alice, 'backups.preview', { backup }), '400');
    await expectError(() => rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' }), '400');
    assert.equal((await rpc(alice, 'deals.list'))[0].businessName, 'Keep me');
  }
});

test('legacy meeting notes with action lists round-trip through save, export and restore', async () => {
  const alice = await account();
  const deal = await rpc(alice, 'deals.save', { deal: { businessName: 'Notes shop', meetingNotes: [{ id: 'note-1', title: 'Meeting', body: 'Useful notes', actions: ['Call on Monday', 'Send an offer'], date: '2026-10-30' }] } });
  assert.deepEqual(deal.meetingNotes[0].actions, ['Call on Monday', 'Send an offer']);
  const backup = await rpc(alice, 'export');
  await rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' });
  assert.deepEqual((await rpc(alice, 'deals.list'))[0].meetingNotes[0].actions, ['Call on Monday', 'Send an offer']);
});

test('malformed customer dates and won sales without a date fail before saving or restoring', async () => {
  const alice = await account();
  const original = await rpc(alice, 'deals.save', { deal: { businessName: 'Keep this customer' } });
  for (const invalid of [{ saleDate: {} }, { meetingDate: '2026-02-30' }, { saleDate: '2026-13-01' }, { status: 'Won', saleDate: '' }]) {
    await expectError(() => rpc(alice, 'deals.save', { deal: { businessName: 'Invalid', ...invalid } }), '400');
    const backup = { version: 1, deals: [{ id: 'bad-date', businessName: 'Invalid', ...invalid }] };
    await expectError(() => rpc(alice, 'backups.preview', { backup }), '400');
    await expectError(() => rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' }), '400');
    assert.equal((await rpc(alice, 'deals.list'))[0].id, original.id);
  }
});

test('a workspace at the database quota can preview and restore its own full export', async () => {
  const alice = await account();
  const deals = [];
  for (let index = 0; index < 11; index++) {
    deals.push(await rpc(alice, 'deals.save', { deal: { businessName: `Boundary ${index}`, padding: 'x'.repeat(952000) } }));
  }
  await db.exec('RESET ROLE');
  const used = Number((await db.query(`SELECT octet_length(jsonb_build_object('deals',(SELECT jsonb_agg(payload ORDER BY updated_at DESC,id) FROM public.flatpay_deals WHERE owner_id=$1),'assistant',public._flatpay_assistant($1::uuid)-'_revision')::text) AS used`, [alice])).rows[0].used);
  const growBy = 10485760 - used;
  assert.ok(growBy > 0 && growBy < 50000);
  const last = deals.at(-1);
  await expectError(() => rpc(alice, 'deals.save', { id: last.id, deal: { ...last, padding: last.padding + 'x'.repeat(growBy + 1) } }), '413');
  await rpc(alice, 'deals.save', { id: last.id, deal: { ...last, padding: last.padding + 'x'.repeat(growBy) } });
  const backup = await rpc(alice, 'export');
  const preview = await rpc(alice, 'backups.preview', { backup });
  assert.equal(preview.dealCount, 11);
  const restored = await rpc(alice, 'backups.restore', { backup, confirm: 'REPLACE MY WORKSPACE' });
  assert.equal(restored.restored, 11);
});
