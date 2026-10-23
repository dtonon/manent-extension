import * as nip19 from 'nostr-tools/nip19';
import { loginWithKey, unlock, logout } from '@/utils/auth';
import { getSignerState } from '@/utils/signer';
import { refreshWriteRelays, getWriteRelays } from '@/utils/relays';
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
  $('avatar-btn').hidden = state.status !== 'ready';
  if (state.status !== 'ready') closeMenu(false);
  if (state.status === 'none') showLoginForm(false);
  if (state.status === 'locked') {
    $('unlock-npub').textContent = shortNpub(state.account.pubkey);
    input('unlock-password').focus();
  }
  if (state.status === 'ready') {
    $('whoami').textContent = shortNpub(state.account.pubkey);
    $('whoami').title = nip19.npubEncode(state.account.pubkey);
    $('signer-type').textContent = `Signer: ${SIGNER_LABELS[state.account.signerType]}`;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = { id: tab?.id, title: tab?.title, url: tab?.url };
    $('tab-title').textContent = currentTab.url ? (currentTab.title ?? '') : 'No page to save';
    $('tab-url').textContent = currentTab.url ?? '';
    $('tab-url').hidden = !currentTab.url;
    updateSaveControls();
    input('comment').focus();
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

const SIGNER_LABELS = { nip07: 'Extension', nsec: 'Nsec', ncryptsec: 'Nsec, password protected' };

function fillList(id: string, items: string[]) {
  const list = $(id);
  list.textContent = '';
  for (const item of items.length ? items : ['None']) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  $(`${id}-count`).textContent = String(items.length);
}

async function renderServers(pubkey: string) {
  getWriteRelays(pubkey).then((relays) => fillList('relays', relays)).catch(() => {});
  getBlossomServers(pubkey).then((servers) => fillList('blossom', servers)).catch(() => {});
}

function openMenu() {
  $('account-menu').hidden = false;
  $('menu-scrim').hidden = false;
  $('avatar-btn').setAttribute('aria-expanded', 'true');
  $('account-menu').querySelector<HTMLElement>('.menu-item')?.focus();
}

function closeMenu(restoreFocus = true) {
  if ($('account-menu').hidden) return;
  $('account-menu').hidden = true;
  $('menu-scrim').hidden = true;
  $('avatar-btn').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('avatar-btn').focus();
}

$('avatar-btn').addEventListener('click', () =>
  $('account-menu').hidden ? openMenu() : closeMenu(),
);
$('menu-scrim').addEventListener('click', () => closeMenu());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('account-menu').hidden) {
    e.preventDefault();
    closeMenu();
  }
});

for (const id of ['relays', 'blossom']) {
  const toggle = $(`${id}-toggle`);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    $(id).hidden = !open;
  });
}

const RECENT_LIMIT = 5;

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
    .slice(0, RECENT_LIMIT);

  const list = $('recent');
  list.textContent = '';
  for (const item of items) {
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
}

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

async function runSave(message: object) {
  const btn = button('save-btn');
  const icon = btn.querySelector<HTMLElement>('.btn-icon')!;
  const label = btn.querySelector('.btn-label')!;
  const original = { icon: icon.innerHTML, label: label.textContent };
  hideResult();
  btn.disabled = true;
  icon.hidden = false;
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
    icon.hidden = true;
    label.textContent = original.label;
    updateSaveControls();
  }
}

function growComment() {
  const el = $('comment');
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

$('comment').addEventListener('input', growComment);

$('sensitive').addEventListener('click', () => {
  const on = !isSensitive();
  $('sensitive').setAttribute('aria-pressed', String(on));
  $('sensitive-icon').innerHTML = iconSvg(on ? 'visibilityOff' : 'visibility', 12);
});

function isFullArticle(): boolean {
  return $('full-article').getAttribute('aria-pressed') === 'true';
}

function updateSaveControls() {
  const canSave = Boolean(currentTab.url && currentTab.id);
  button('save-btn').disabled = !currentTab.url;
  button('full-article').disabled = !canSave;
  $('article-note').hidden = !isFullArticle();
}

$('full-article').addEventListener('click', () => {
  $('full-article').setAttribute('aria-pressed', String(!isFullArticle()));
  updateSaveControls();
});

$('save-btn').addEventListener('click', async () => {
  if (!currentTab.url) return;
  // The tags field may not have fired change yet, the worker reads tags from storage
  await setTags(input('tags').value).catch(() => {});
  if (isFullArticle() && currentTab.id) {
    runSave({
      type: 'save-page',
      tabId: currentTab.id,
      comment: input('comment').value,
      sensitive: isSensitive(),
    });
    return;
  }
  runSave({
    type: 'save-link',
    title: currentTab.title,
    url: currentTab.url,
    comment: input('comment').value,
    sensitive: isSensitive(),
    tabId: currentTab.id,
  });
});

$('tags').addEventListener('change', () => {
  setTags(input('tags').value).catch(() => {});
});

$('logout-btn').addEventListener('click', async () => {
  closeMenu(false);
  await logout();
  await render();
});

renderIcons();
browser.runtime.sendMessage('ping').catch(() => {});
render().then(() => retryPending().catch(() => {}));
