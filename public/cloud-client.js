// Supabase owns authentication and database access; the compiled workspace
// loads only after its user is authenticated.
import { createClient } from './vendor/supabase.js';
import { config } from './config.js';
import { createCloudApi } from './cloud-api.mjs';
const root = document.getElementById('root');
const nativeFetch = window.fetch.bind(window);
const baseUrl = new URL('./', import.meta.url).href;
let setupError = '';
let supabase;
let recoveryMode = /(?:#|&)type=recovery(?:&|$)/.test(location.hash);
let signInLinkError = new URLSearchParams(location.hash.slice(1)).get('error_description') || new URLSearchParams(location.search).get('error_description') || '';
try {
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Supabase project settings are not configured yet.');
  const key = config.supabasePublishableKey;
  if (key.startsWith('sb_secret_')) throw new Error('Use a public Supabase publishable key, never a secret key.');
  if (key.split('.').length === 3) {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'anon') throw new Error('Use the publishable or legacy anon key, never a service role key.');
  }
  supabase = createClient(config.supabaseUrl, key, {
    global: { fetch: nativeFetch },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      setTimeout(() => { if (mounted) showPasswordReset(); }, 0);
    }
    if (mounted && session?.user && currentUser && session.user.id !== currentUser.id) {
      document.documentElement.inert = true;
      location.reload();
    }
    if (mounted && event === 'SIGNED_OUT') setTimeout(requestReauthentication, 0);
  });
} catch (error) { setupError = error.message; }
const onlineFetch = supabase ? createCloudApi(supabase, { baseUrl, expectedUserId: () => currentUser?.id }) : null;
let mounted = false;
let currentUser = null;
let installPrompt = null;
let refreshing = false;
let reauthOpen = false;
window.flatpayMutationEpoch = 0;

function requestReauthentication() {
  if (!mounted || reauthOpen) return;
  reauthOpen = true;
  showAuth('login', true);
}

// Keep the workspace's original fetch calls while detecting session expiry and
// preventing an older background refresh from replacing a newly saved record.
window.fetch = async (input, options) => {
  const signal = options?.signal || (input instanceof Request ? input.signal : null);
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const response = url.origin === location.origin && url.pathname.startsWith('/api/') && onlineFetch
    ? await onlineFetch(input, options) : await nativeFetch(input, options);
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    if (response.status === 401) requestReauthentication();
    const method = (options?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (response.ok && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) window.flatpayMutationEpoch++;
  }
  return response;
};

function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

async function api(path, options = {}) {
  const response = await window.fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (response.status === 401) requestReauthentication();
  const data = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw Object.assign(new Error(data.error || data.errors?.join(' ') || 'The request could not be completed.'), { status: response.status });
  return data;
}

function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const anchor = element('a', '', { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.flatpayExportBackup = async () => {
  download(await api('/api/export'), `myflatpay-backup-${new Date().toISOString().slice(0,10)}.json`);
};

function dialog(title, closeable = true) {
  const modal = element('dialog', undefined, { class: 'cloud-dialog', 'aria-label': title });
  const content = element('div', undefined, { class: 'cloud-dialog-content' });
  const head = element('div', undefined, { class: 'cloud-heading' });
  head.append(element('h2', title));
  if (closeable) {
    const close = element('button', 'Close', { type: 'button', class: 'cloud-link' });
    close.addEventListener('click', () => modal.close());
    head.append(close);
  } else modal.addEventListener('cancel', event => event.preventDefault());
  content.append(head);
  modal.append(content);
  document.body.append(modal);
  modal.addEventListener('close', () => modal.remove());
  modal.showModal();
  return { modal, content };
}

function field(form, label, name, type = 'text', autocomplete = '') {
  const wrap = element('label', undefined, { class: 'cloud-field' });
  wrap.append(element('span', label));
  const input = element('input', undefined, { name, type, required: '', ...(autocomplete ? { autocomplete } : {}) });
  if (name === 'password') input.minLength = 12;
  wrap.append(input);
  form.append(wrap);
  return input;
}

function showAuth(mode = 'login', overlay = false) {
  const frame = overlay ? dialog('Sign in to continue', false) : null;
  const container = frame?.content || root;
  if (!overlay) container.replaceChildren();
  const card = element('section', undefined, { class: 'cloud-auth' });
  card.append(element('div', 'myflatpay', { class: 'cloud-brand' }));
  const heading = { login: 'Your sales. Wherever you are.', register: 'Create your workspace.', recover: 'Recover your account.' }[mode];
  card.append(element('h1', heading));
  card.append(element('p', mode === 'register' ? 'Save customers, notes and offers to your account. Sign in on either phone to pick up where you left off.' : mode === 'recover' ? 'Enter your email address to receive a password reset link. Open the link in this browser.' : 'Sign in to open your customers, offers and commission.'));
  const form = element('form');
  field(form, 'Email address', 'username', 'email', 'username');
  if (mode !== 'recover') field(form, 'Password (12 characters minimum)', 'password', 'password', mode === 'login' ? 'current-password' : 'new-password');
  if (mode === 'register') field(form, 'Confirm password', 'confirmation', 'password', 'new-password');
  const error = element('p', '', { class: 'cloud-error', role: 'alert' });
  const submit = element('button', mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link', { type: 'submit', class: 'cloud-primary' });
  form.append(error, submit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    if (mode === 'register' && data.password !== data.confirmation) { error.textContent = 'The passwords do not match.'; return; }
    submit.disabled = true;
    try {
      const result = await post(`/api/auth/${mode === 'login' ? 'login' : mode === 'register' ? 'register' : 'recover'}`, data);
      if (mode === 'recover' || result.needsEmailConfirmation) {
        form.replaceChildren(element('p', mode === 'recover' ? 'If this address is registered, a reset link will arrive by email. Open it in this browser to choose a new password.' : 'Check your email and confirm your account, then return here to sign in.'));
      } else {
        frame?.modal.close();
        await openWorkspace(result.user);
      }
    } catch (e) { error.textContent = e.message; }
    finally { submit.disabled = false; }
  });
  card.append(form);
  const links = element('div', undefined, { class: 'cloud-auth-links' });
  for (const [target, text] of mode === 'login' ? [['register', 'Create an account'], ['recover', 'Forgot password?']] : [['login', 'Back to sign in']]) {
    const button = element('button', text, { type: 'button', class: 'cloud-link' });
    button.addEventListener('click', () => { frame?.modal.close(); showAuth(target, overlay); });
    links.append(button);
  }
  card.append(links, element('small', 'Your records are stored in your online account. An internet connection is needed to load and save changes.'));
  container.append(card);
}

function showPasswordReset() {
  const { modal, content } = dialog('Choose a new password', false);
  const form = element('form');
  field(form, 'New password (12 characters minimum)', 'password', 'password', 'new-password');
  field(form, 'Confirm password', 'confirmation', 'password', 'new-password');
  const message = element('p', '', { role: 'alert', class: 'cloud-error' });
  const save = element('button', 'Save new password', { type: 'submit', class: 'cloud-primary' });
  form.append(message, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.confirmation) { message.textContent = 'The passwords do not match.'; return; }
    save.disabled = true;
    try {
      await post('/api/auth/password', { password: values.password });
      recoveryMode = false;
      modal.close();
      history.replaceState({}, '', new URL('./', baseUrl));
      await openWorkspace();
    } catch (error) { message.textContent = error.message; }
    finally { save.disabled = false; }
  });
  content.append(form);
  const cancel = element('button', 'Back to sign in', { type: 'button', class: 'cloud-link' });
  cancel.addEventListener('click', async () => { await supabase.auth.signOut({ scope: 'local' }); location.href = baseUrl; });
  content.append(cancel);
}

async function openWorkspace(user) {
  if (!user) user = (await api('/api/auth/me')).user;
  if (mounted && currentUser && user.id !== currentUser.id) {
    // Never reuse one account's mounted records or unsaved editor for another.
    location.reload();
    return;
  }
  currentUser = user;
  reauthOpen = false;
  window.flatpayUser = { ...user, name: user.username };
  if (!mounted) {
    root.replaceChildren();
    try { await import('./workspace.js'); }
    catch (error) {
      const panel = element('section', undefined, { class: 'cloud-auth' });
      panel.append(element('h1', 'Your account is ready'), element('p', 'The workspace could not finish loading. Check your connection, then try again.'));
      const retry = element('button', 'Try loading again', { class: 'cloud-primary', type: 'button' });
      retry.addEventListener('click', () => location.reload());
      panel.append(retry);
      root.replaceChildren(panel);
      throw error;
    }
    mounted = true;
    new MutationObserver(attachAccountControls).observe(root, { childList: true, subtree: true });
  } else refreshWorkspace();
  attachAccountControls();
}

function attachAccountControls() {
  const target = document.querySelector('.topbar-right');
  if (!target || target.querySelector('.cloud-account-button')) return;
  const button = element('button', 'Account & backups', { type: 'button', class: 'cloud-account-button' });
  button.addEventListener('click', showAccount);
  target.append(button);
}

function refreshWorkspace() {
  if (!mounted || refreshing || document.hidden || document.querySelector('.modal-overlay, .cloud-dialog')) return;
  refreshing = true;
  window.dispatchEvent(new Event('flatpay:refresh'));
  setTimeout(() => { refreshing = false; }, 1500);
}

async function showAccount() {
  const { content, modal } = dialog('Account & backups');
  content.append(element('p', `Signed in as ${currentUser.username}. Your account works on iPhone, Android and your computer.`));
  const actions = element('div', undefined, { class: 'cloud-actions' });
  const notice = element('p', '', { class: 'cloud-message', role: 'status' });
  const run = async (button, action) => {
    button.disabled = true;
    notice.textContent = '';
    try { await action(); } catch (error) { notice.textContent = error.message; }
    finally { button.disabled = false; }
  };
  const sync = element('button', 'Refresh from server', { type: 'button' });
  sync.addEventListener('click', () => { modal.close(); refreshWorkspace(); });
  const exportButton = element('button', 'Download full backup', { type: 'button' });
  exportButton.addEventListener('click', () => run(exportButton, async () => {
    download(await api('/api/export'), `myflatpay-backup-${new Date().toISOString().slice(0,10)}.json`);
    notice.textContent = 'Backup downloaded. Keep a copy away from the server.';
  }));
  const snapshot = element('button', 'Create recovery point', { type: 'button' });
  snapshot.addEventListener('click', () => run(snapshot, async () => {
    await post('/api/backups', {});
    notice.textContent = 'Recovery point created.';
    await loadBackups();
  }));
  actions.append(sync, exportButton, snapshot);
  content.append(actions, notice);
  content.append(element('h3', 'Import a backup'));
  content.append(element('p', 'You can import the JSON export from your previous browser version. Import replaces the records in this account. A recovery point is saved first.'));
  const input = element('input', undefined, { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a myflatpay JSON backup' });
  const preview = element('div', undefined, { class: 'cloud-restore-preview' });
  let importGeneration = 0;
  input.addEventListener('change', async () => {
    const generation = ++importGeneration;
    preview.replaceChildren();
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose a JSON backup smaller than 12 MB.');
      const data = JSON.parse(await file.text());
      const result = await post('/api/backups/preview', { backup: data });
      if (generation !== importGeneration) return;
      preview.append(element('p', `${result.dealCount} customer records from ${file.name} are ready to import. This replaces your current workspace.`));
      const confirm = element('button', 'Replace workspace with this backup', { type: 'button', class: 'cloud-danger' });
      confirm.addEventListener('click', () => run(confirm, async () => {
        await post('/api/backups/restore', { backup: data, confirm: 'REPLACE MY WORKSPACE' });
        location.reload();
      }));
      preview.append(confirm);
    } catch (error) { if (generation === importGeneration) preview.append(element('p', error.message, { class: 'cloud-error', role: 'alert' })); }
  });
  content.append(input, preview, element('h3', 'Recovery points'));
  content.append(element('p', 'Daily recovery points and copies made before deletes or restores are stored on the server. Download a separate backup for protection if the server storage is lost.'));
  const list = element('div', undefined, { class: 'cloud-backup-list' });
  content.append(list);
  async function loadBackups() {
    list.replaceChildren(element('p', 'Loading recovery points…'));
    try {
      const data = await api('/api/backups');
      const backups = Array.isArray(data) ? data : data.backups;
      list.replaceChildren();
      if (!backups.length) list.append(element('p', 'No recovery points yet.'));
      for (const backup of backups) {
        const row = element('div', undefined, { class: 'cloud-backup-row' });
        row.append(element('span', `${new Date(backup.createdAt).toLocaleString()} · ${backup.reason || 'Backup'}`));
        const restore = element('button', 'Review', { type: 'button' });
        restore.addEventListener('click', () => run(restore, async () => {
          const saved = await api(`/api/backups/${encodeURIComponent(backup.id)}`);
          const result = await post('/api/backups/preview', { backup: saved });
          const review = dialog('Restore recovery point');
          review.content.append(element('p', `Restore ${result.dealCount} customers from ${new Date(backup.createdAt).toLocaleString()}? This replaces the current workspace. A recovery point is saved first.`));
          const accept = element('button', 'Restore this recovery point', { type: 'button', class: 'cloud-danger' });
          const message = element('p', '', { role: 'alert' });
          accept.addEventListener('click', async () => {
            accept.disabled = true;
            try { await post('/api/backups/restore', { backup: saved, confirm: 'REPLACE MY WORKSPACE' }); location.reload(); }
            catch (error) { message.textContent = error.message; accept.disabled = false; }
          });
          review.content.append(accept, message);
        }));
        row.append(restore);
        list.append(row);
      }
    } catch (error) { list.replaceChildren(element('p', error.message, { class: 'cloud-error' })); }
  }
  await loadBackups();
  content.append(element('h3', 'Install on your phone'));
  content.append(element('p', 'iPhone: open this address in Safari, tap Share, then Add to Home Screen. Android: open in Chrome, tap the menu, then Install app or Add to Home screen.'));
  if (installPrompt) {
    const install = element('button', 'Install myflatpay', { type: 'button', class: 'cloud-primary' });
    install.addEventListener('click', async () => { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; install.remove(); });
    content.append(install);
  }
  const logout = element('button', 'Sign out', { type: 'button', class: 'cloud-link cloud-signout' });
  logout.addEventListener('click', () => run(logout, async () => {
    await post('/api/auth/logout', {});
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' });
    location.reload();
  }));
  content.append(logout);
}

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('focus', refreshWorkspace);
window.addEventListener('online', refreshWorkspace);
document.addEventListener('visibilitychange', refreshWorkspace);
setInterval(refreshWorkspace, 30000);
window.addEventListener('offline', () => {
  const text = document.querySelector('.topbar-right');
  if (text) text.setAttribute('data-offline', 'Offline — reconnect before saving');
});
window.addEventListener('online', () => document.querySelector('.topbar-right')?.removeAttribute('data-offline'));
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(new URL('./service-worker.js', import.meta.url)).catch(error => console.warn('Install support unavailable:', error.message));
}

try {
  if (setupError) throw new Error(setupError);
  const { error } = await supabase.auth.getSession();
  if (error) signInLinkError = error.message;
  if (signInLinkError) throw new Error(signInLinkError);
  if (recoveryMode) showPasswordReset();
  else await openWorkspace((await api('/api/auth/me')).user);
}
catch (error) {
  if (error.status === 401) showAuth();
  else {
    root.replaceChildren();
    const panel = element('section', undefined, { class: 'cloud-auth' });
    panel.append(element('h1', setupError ? 'Connect your Supabase project' : signInLinkError ? 'Request a new sign-in link' : 'Connect to your workspace'), element('p', setupError ? `${setupError} Add the project URL and publishable key in config.js and apply the included database migration. No service role key is needed.` : signInLinkError ? 'This email link could not be used. Return to sign in and request a fresh confirmation or password reset link in this browser.' : 'The online workspace could not be reached. Check your connection and try again.'));
    const retry = element('button', 'Try again', { class: 'cloud-primary', type: 'button' });
    retry.addEventListener('click', () => location.reload());
    panel.append(retry);
    if (signInLinkError) {
      const back = element('button', 'Back to sign in', { type: 'button', class: 'cloud-link' });
      back.addEventListener('click', () => { location.href = baseUrl; });
      panel.append(back);
    }
    root.append(panel);
  }
}
