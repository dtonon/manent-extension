import * as nip19 from 'nostr-tools/nip19';
import { loginWithKey, unlock, logout } from '@/utils/auth';
import { getSignerState } from '@/utils/signer';
import { refreshWriteRelays, getWriteRelays } from '@/utils/relays';
import { formatCapture } from '@/utils/manent';
import { getRecentSaves } from '@/utils/history';
import { retryQueue } from '@/utils/queue';
import { getBlossomServers } from '@/utils/blossom';
import { getRawTags, setTags } from '@/utils/tags';
import { renderIcons, iconSvg } from '@/utils/icons';

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;

async function askBackground(message: object): Promise<unknown> {
  const res = (await browser.runtime.sendMessage(message)) as
    | { ok: boolean; result?: unknown; error?: string }
    | undefined;
  if (!res) throw new Error('No response from the extension worker');
  if (!res.ok) throw new Error(res.error ?? 'Unknown error');
  return res.result;
}

let currentTab: { id?: number; title?: string; url?: string } = {};

async function render() {
  const state = await getSignerState();
  $('login').hidden = state.status !== 'none';
  $('unlock').hidden = state.status !== 'locked';
  $('main').hidden = state.status !== 'ready';
  if (state.status === 'none') showLoginForm(false);
  if (state.status === 'locked') {
    $('unlock-npub').textContent = shortNpub(state.account.pubkey);
    input('unlock-password').focus();
  }
  if (state.status === 'ready') {
    $('whoami').textContent = nip19.npubEncode(state.account.pubkey);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = { id: tab?.id, title: tab?.title, url: tab?.url };
    $('tab-info').textContent = currentTab.url
      ? `${currentTab.title ?? ''}\n${currentTab.url}`
      : 'No page to save';
    await renderRecent();
    renderServers(state.account.pubkey);
    input('tags').value = await getRawTags();
  }
}

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}

function showLoginForm(open: boolean) {
  $('login-choice').hidden = open;
  $('login-form').hidden = !open;
  $('login-error').textContent = '';
  if (open) input('login-key').focus();
}

function fillList(id: string, items: string[]) {
  const list = $(id);
  list.textContent = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
}

async function renderServers(pubkey: string) {
  getWriteRelays(pubkey).then((relays) => fillList('relays', relays)).catch(() => {});
  getBlossomServers(pubkey).then((servers) => fillList('blossom', servers)).catch(() => {});
}

async function renderRecent() {
  const list = $('recent');
  list.textContent = '';
  for (const item of await getRecentSaves()) {
    const li = document.createElement('li');
    li.textContent = item.snippet;
    li.title = new Date(item.ts).toLocaleString();
    list.appendChild(li);
  }
}

async function retryPending() {
  const remaining = await retryQueue();
  $('pending-info').textContent = remaining > 0 ? `${remaining} pending, will retry` : '';
  await renderRecent();
}

$('nsec-open').addEventListener('click', () => showLoginForm(true));
$('nsec-back').addEventListener('click', () => {
  showLoginForm(false);
  $('nsec-open').focus();
});

$('login-key-toggle').addEventListener('click', () => {
  const key = input('login-key');
  const show = key.type === 'password';
  key.type = show ? 'text' : 'password';
  const toggle = $('login-key-toggle');
  toggle.setAttribute('aria-pressed', String(show));
  toggle.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
  toggle.innerHTML = iconSvg(show ? 'visibilityOff' : 'visibility', 18);
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const account = await loginWithKey(input('login-key').value, input('login-password').value);
    input('login-key').value = '';
    input('login-password').value = '';
    refreshWriteRelays(account.pubkey).catch(() => {});
    await render();
  } catch (e) {
    $('login-error').textContent = e instanceof Error ? e.message : String(e);
  }
});

$('nip07-btn').addEventListener('click', async () => {
  $('login-error').textContent = '';
  try {
    await askBackground({ type: 'login-nip07' });
    await render();
  } catch (e) {
    $('login-error').textContent = e instanceof Error ? e.message : String(e);
  }
});

$('unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('unlock-error').textContent = '';
  try {
    await unlock(input('unlock-password').value);
    input('unlock-password').value = '';
    await render();
  } catch {
    $('unlock-error').textContent = 'Wrong password, try again';
  }
});

$('unlock-logout').addEventListener('click', async () => {
  await logout();
  await render();
});

async function runSave(buttonId: string, message: object) {
  const btn = $(buttonId) as HTMLButtonElement;
  const status = $('save-status');
  btn.disabled = true;
  $('save-spinner').hidden = false;
  status.textContent = 'Saving…';
  try {
    const outcome = await askBackground(message);
    input('comment').value = '';
    status.textContent = outcome === 'published' ? 'Saved' : 'Queued, will retry later';
    await renderRecent();
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    btn.disabled = false;
    $('save-spinner').hidden = true;
    setTimeout(() => (status.textContent = ''), 3000);
  }
}

$('save-btn').addEventListener('click', () => {
  if (!currentTab.url) return;
  const text = formatCapture({
    comment: input('comment').value,
    title: currentTab.title,
    url: currentTab.url,
  });
  runSave('save-btn', {
    type: 'save-note',
    text,
    sensitive: input('sensitive').checked,
    url: currentTab.url,
    tabId: currentTab.id,
  });
});

$('save-article-btn').addEventListener('click', () => {
  if (!currentTab.id) return;
  runSave('save-article-btn', {
    type: 'save-page',
    tabId: currentTab.id,
    comment: input('comment').value,
    sensitive: input('sensitive').checked,
  });
});

$('tags').addEventListener('change', () => {
  setTags(input('tags').value).catch(() => {});
});

$('logout-btn').addEventListener('click', async () => {
  await logout();
  await render();
});

renderIcons();
browser.runtime.sendMessage('ping').catch(() => {});
render().then(() => retryPending().catch(() => {}));
