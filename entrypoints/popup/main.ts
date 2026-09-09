import * as nip19 from 'nostr-tools/nip19';
import { loginWithKey, unlock, logout } from '@/utils/auth';
import { getSignerState } from '@/utils/signer';
import { refreshWriteRelays, getWriteRelays } from '@/utils/relays';
import { formatCapture } from '@/utils/manent';
import { getRecentSaves } from '@/utils/history';
import { retryQueue, getQueue } from '@/utils/queue';
import { getBlossomServers } from '@/utils/blossom';
import { getRawTags, setTags } from '@/utils/tags';
import { renderIcons, iconSvg } from '@/utils/icons';

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const button = (id: string) => $(id) as HTMLButtonElement;

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
    $('tab-title').textContent = currentTab.url ? (currentTab.title ?? '') : 'No page to save';
    $('tab-url').textContent = currentTab.url ?? '';
    $('tab-url').hidden = !currentTab.url;
    button('save-btn').disabled = !currentTab.url;
    button('save-article-btn').disabled = !currentTab.id || !currentTab.url;
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

const RECENT_COLLAPSED = 3;
let recentExpanded = false;

function formatTime(ts: number): string {
  const date = new Date(ts);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

async function renderRecent() {
  const [saved, pending] = await Promise.all([getRecentSaves(), getQueue()]);
  const items = [
    ...pending.map((p) => ({ snippet: p.snippet, ts: p.ts, pending: true })),
    ...saved.map((s) => ({ snippet: s.snippet, ts: s.ts, pending: false })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  const list = $('recent');
  list.textContent = '';
  const visible = recentExpanded ? items : items.slice(0, RECENT_COLLAPSED);
  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'recent-row';
    const text = document.createElement('span');
    text.className = 'recent-text';
    text.textContent = item.snippet;
    text.title = new Date(item.ts).toLocaleString();
    const time = document.createElement('time');
    time.className = 'recent-time';
    time.dateTime = new Date(item.ts).toISOString();
    time.textContent = formatTime(item.ts);
    const status = document.createElement('span');
    status.className = 'recent-status';
    status.setAttribute('role', 'img');
    status.setAttribute('aria-label', item.pending ? 'Waiting to sync' : 'Saved');
    status.innerHTML = iconSvg(item.pending ? 'schedule' : 'check', 14);
    li.append(text, time, status);
    list.appendChild(li);
  }
  $('recent-section').hidden = items.length === 0;
  $('recent-more').hidden = items.length <= RECENT_COLLAPSED;
  $('recent-more').textContent = recentExpanded ? 'Show less' : 'Show all';
  $('recent-more').setAttribute('aria-expanded', String(recentExpanded));
}

$('recent-more').addEventListener('click', () => {
  recentExpanded = !recentExpanded;
  renderRecent();
});

async function retryPending() {
  await retryQueue();
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

let resultTimer: ReturnType<typeof setTimeout> | undefined;

function isSensitive(): boolean {
  return $('sensitive').getAttribute('aria-pressed') === 'true';
}

function showResult(kind: 'published' | 'queued' | 'error', text: string) {
  const icon = kind === 'published' ? 'checkCircle' : kind === 'queued' ? 'schedule' : 'syncProblem';
  $('save-result-icon').innerHTML = iconSvg(icon, 20);
  $('save-result-text').textContent = text;
  $('save-open').hidden = kind === 'error';
  $('save-result').hidden = false;
  $('save-live').textContent = text;
  // Errors keep the buttons visible so the save can be retried
  $('save-actions').hidden = kind !== 'error';
  clearTimeout(resultTimer);
  resultTimer = setTimeout(hideResult, kind === 'error' ? 6000 : 3000);
}

function hideResult() {
  const lostFocus = document.activeElement === document.body;
  $('save-result').hidden = true;
  $('save-actions').hidden = false;
  if (lostFocus) button('save-btn').focus();
}

async function runSave(buttonId: string, message: object) {
  const btn = button(buttonId);
  const icon = btn.querySelector('.btn-icon')!;
  const label = btn.querySelector('.btn-label')!;
  const original = { icon: icon.innerHTML, label: label.textContent };
  hideResult();
  button('save-btn').disabled = true;
  button('save-article-btn').disabled = true;
  icon.innerHTML = '<span class="spinner"></span>';
  label.textContent = 'Saving…';
  $('save-live').textContent = 'Saving…';
  try {
    const outcome = await askBackground(message);
    input('comment').value = '';
    growComment();
    if (outcome === 'published') showResult('published', 'Saved to Manent');
    else showResult('queued', 'Queued, will retry later');
    await renderRecent();
  } catch (e) {
    showResult('error', e instanceof Error ? e.message : String(e));
  } finally {
    icon.innerHTML = original.icon;
    label.textContent = original.label;
    button('save-btn').disabled = !currentTab.url;
    button('save-article-btn').disabled = !currentTab.id || !currentTab.url;
  }
}

function growComment() {
  const el = $('comment');
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

$('comment').addEventListener('input', growComment);

$('sensitive').addEventListener('click', () => {
  $('sensitive').setAttribute('aria-pressed', String(!isSensitive()));
});

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
    sensitive: isSensitive(),
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
    sensitive: isSensitive(),
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
