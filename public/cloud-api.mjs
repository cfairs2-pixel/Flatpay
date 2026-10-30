import { rf, vc, dC, Wy, fC, pC } from './domain.mjs';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(error, fallback = 400) {
  const match = error?.message?.match(/^(400|401|403|404|409|413):\s*(.*)$/s);
  const status = match ? Number(match[1]) : error?.code === '42501' ? 403 : error?.status || fallback;
  throw new ApiError(status, match ? match[2] : error?.message || 'The online workspace could not complete this request.');
}

export function publicUser(user) {
  return user ? { id: user.id, username: user.email, email: user.email } : null;
}

export function createCloudApi(client, { baseUrl, now = () => new Date(), expectedUserId = () => null } = {}) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  async function rpc(operation, input = {}) {
    const { data: sessionData } = await client.auth.getSession();
    const expected = expectedUserId();
    if (expected && sessionData.session?.user?.id !== expected) throw new ApiError(401, 'Your account changed. Reopen the workspace before saving.');
    const { data, error } = await client.rpc('flatpay_workspace', { operation, input })
      .setHeader('Authorization', `Bearer ${sessionData.session?.access_token || ''}`);
    if (error) fail(error);
    return data;
  }
  async function identity() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new ApiError(401, 'Sign in to access your workspace.');
    return publicUser(data.user);
  }
  async function read(request) {
    let body;
    try { body = await request.json(); } catch { throw new ApiError(400, 'Send a valid JSON object.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Send a JSON object.');
    return body;
  }
  function password(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new ApiError(400, 'Use a password between 12 and 256 characters.');
    return value;
  }
  const email = body => String(body.email || body.username || '').trim();
  async function auth(request, path) {
    if (path === '/api/auth/me' && request.method === 'GET') return json({ authenticated: true, user: await identity() });
    const body = await read(request);
    if (path === '/api/auth/login') {
      const { data, error } = await client.auth.signInWithPassword({ email: email(body), password: body.password });
      if (error) fail(error);
      return json({ user: publicUser(data.user) });
    }
    if (path === '/api/auth/register') {
      const { data, error } = await client.auth.signUp({ email: email(body), password: password(body.password), options: { emailRedirectTo: baseUrl } });
      if (error) fail(error);
      return json({ user: publicUser(data.user), needsEmailConfirmation: !data.session }, 201);
    }
    if (path === '/api/auth/recover') {
      const { error } = await client.auth.resetPasswordForEmail(email(body), { redirectTo: baseUrl });
      if (error) fail(error);
      return json({ recoveryEmailSent: true });
    }
    if (path === '/api/auth/password') {
      const { error } = await client.auth.updateUser({ password: password(body.password) });
      if (error) fail(error);
      return json({ ok: true });
    }
    if (path === '/api/auth/logout') {
      // A local sign-out removes this browser's session without interrupting
      // the same account on another phone.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) fail(error);
      return json({ ok: true });
    }
    throw new ApiError(404, 'Account action was not found.');
  }
  async function assistant(request, path) {
    const state = await rpc('assistant.get');
    if (path === '/api/assistant' && request.method === 'GET') return json(state);
    const save = value => rpc('assistant.set', { state: { version: 1, ...state, ...value } });
    if (path === '/api/assistant/chat' && request.method === 'POST') {
      const body = dC(await read(request), vc(now()));
      const deals = await rpc('deals.list');
      const deal = body.dealId ? deals.find(item => item.id === body.dealId) : null;
      if (body.dealId && !deal) throw new ApiError(404, 'Selected customer was not found. Save it first.');
      const metrics = fC(deals, body.month, state.targets, vc(now()));
      const reply = pC({ ...body, deal, deals, metrics, preferences: state.preferences });
      const createdAt = now().toISOString();
      const message = { id: crypto.randomUUID(), role: 'assistant', content: reply.reply, mode: reply.mode || 'local', actions: reply.actions || [], dealId: body.dealId, createdAt };
      await save({ messages: [...state.messages, { id: crypto.randomUUID(), role: 'user', content: body.message, createdAt }, message].slice(-200) });
      return json({ ...reply, mode: reply.mode || 'local', metrics, message });
    }
    if (path === '/api/assistant/targets' && request.method === 'PUT') {
      const targets = Wy(await read(request));
      await save({ targets });
      return json(targets);
    }
    if (path === '/api/assistant/preferences' && request.method === 'POST') {
      const { text } = await read(request);
      if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new ApiError(400, 'A preference must contain 1 to 1,000 characters.');
      if (state.preferences.length >= 30) throw new ApiError(400, 'Keep up to 30 preferences. Remove an older one first.');
      const preference = { id: crypto.randomUUID(), text: text.trim() };
      await save({ preferences: [...state.preferences, preference] });
      return json(preference, 201);
    }
    const match = path.match(/^\/api\/assistant\/preferences\/([A-Za-z0-9-]+)$/);
    if (match && request.method === 'DELETE') {
      if (!state.preferences.some(item => item.id === match[1])) throw new ApiError(404, 'Preference was not found.');
      await save({ preferences: state.preferences.filter(item => item.id !== match[1]) });
      return json({ ok: true });
    }
    if (path === '/api/assistant/history' && request.method === 'DELETE') {
      await save({ messages: [] });
      return json({ ok: true });
    }
    throw new ApiError(404, 'Assistant action was not found.');
  }

  return async function cloudFetch(input, options) {
    try {
      const request = new Request(input instanceof Request ? input : new URL(String(input), baseUrl), options);
      // The preserved compiled workspace uses root /api paths. These are
      // handled locally and sent to Supabase through its official SDK.
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/auth/')) return await auth(request, path);
      await identity();
      if (path === '/api/health') return json({ ok: true, storage: 'supabase' });
      if (path === '/api/deals' && request.method === 'GET') return json(await rpc('deals.list'));
      const match = path.match(/^\/api\/deals\/([A-Za-z0-9-]+)$/);
      if (path === '/api/deals' && request.method === 'POST' || match && request.method === 'PUT') {
        const deal = { status: 'Lead', offers: [], checklist: {}, saleInfo: {}, commissionDetails: {}, meetingNotes: [], ...await read(request) };
        const errors = rf(deal);
        if (errors.length) return json({ error: errors[0], errors }, 400);
        return json(await rpc('deals.save', { deal, ...(match ? { id: match[1] } : {}) }), match ? 200 : 201);
      }
      if (match && request.method === 'DELETE') return json(await rpc('deals.delete', { id: match[1], revision: Number(request.headers.get('X-Record-Revision')) }));
      if (path === '/api/export' && request.method === 'GET') return json(await rpc('export'));
      if (path === '/api/backups' && request.method === 'GET') return json(await rpc('backups.list'));
      if (path === '/api/backups' && request.method === 'POST') return json(await rpc('backups.create'), 201);
      const backup = path.match(/^\/api\/backups\/([A-Za-z0-9-]+)$/);
      if (backup && request.method === 'GET') return json(await rpc('backups.get', { id: backup[1] }));
      if (path === '/api/backups/preview' && request.method === 'POST') return json(await rpc('backups.preview', await read(request)));
      if (path === '/api/backups/restore' && request.method === 'POST') return json(await rpc('backups.restore', await read(request)));
      if (path === '/api/assistant' || path.startsWith('/api/assistant/')) return await assistant(request, path);
      throw new ApiError(404, 'Workspace action was not found.');
    } catch (error) {
      return json({ error: error.message || 'The cloud workspace could not complete this request.' }, error.status || 400);
    }
  };
}
