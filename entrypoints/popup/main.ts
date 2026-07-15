import * as nip19 from 'nostr-tools/nip19';
import { loginWithKey, unlock, logout } from '@/utils/auth';
import { loginWithNip07 } from '@/utils/nip07';
import { getSignerState } from '@/utils/signer';
import { refreshWriteRelays } from '@/utils/relays';
import { formatCapture } from '@/utils/manent';
import { saveNote } from '@/utils/save';
import { getRecentSaves } from '@/utils/history';
import { retryQueue } from '@/utils/queue';

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;

let currentTab: { title?: string; url?: string } = {};

async function render() {
  const state = await getSignerState();
  $('login').hidden = state.status !== 'none';
  $('unlock').hidden = state.status !== 'locked';
  $('main').hidden = state.status !== 'ready';
  if (state.status === 'ready') {
    $('whoami').textContent = nip19.npubEncode(state.account.pubkey);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = { title: tab?.title, url: tab?.url };
    $('tab-info').textContent = currentTab.url
      ? `${currentTab.title ?? ''}\n${currentTab.url}`
      : 'No page to save';
    await renderRecent();
  }
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

$('login-btn').addEventListener('click', async () => {
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
    const account = await loginWithNip07();
    refreshWriteRelays(account.pubkey).catch(() => {});
    await render();
  } catch (e) {
    $('login-error').textContent = e instanceof Error ? e.message : String(e);
  }
});

$('unlock-btn').addEventListener('click', async () => {
  $('unlock-error').textContent = '';
  try {
    await unlock(input('unlock-password').value);
    input('unlock-password').value = '';
    await render();
  } catch {
    $('unlock-error').textContent = 'Wrong password';
  }
});

$('save-btn').addEventListener('click', async () => {
  const btn = $('save-btn') as HTMLButtonElement;
  const status = $('save-status');
  if (!currentTab.url) return;
  const text = formatCapture({
    comment: input('comment').value,
    title: currentTab.title,
    url: currentTab.url,
  });
  btn.disabled = true;
  $('save-spinner').hidden = false;
  status.textContent = 'Saving…';
  try {
    const outcome = await saveNote(text, input('sensitive').checked, currentTab.url);
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
});

$('logout-btn').addEventListener('click', async () => {
  await logout();
  await render();
});

browser.runtime.sendMessage('ping').catch(() => {});
render().then(() => retryPending().catch(() => {}));
