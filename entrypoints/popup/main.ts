import * as nip19 from 'nostr-tools/nip19';
import { MANENT_URL } from '@/utils/manent';
import { loginWithKey, unlock, logout } from '@/utils/auth';
import { getSignerState } from '@/utils/signer';
import { refreshWriteRelays, getWriteRelays } from '@/utils/relays';
import { retryQueue, getQueue } from '@/utils/queue';
import { getBlossomServers } from '@/utils/blossom';
import { getRawTags, setTags, normalizeTags, HIGHLIGHT_TAG } from '@/utils/tags';
import { renderIcons, iconSvg } from '@/utils/icons';
import { takePendingCapture, PENDING_CAPTURE_KEY } from '@/utils/pending-capture';
import type { PendingCapture } from '@/utils/pending-capture';
import { readSelection } from '@/utils/selection';
import { getProfile, isProfileStale, PROFILE_KEY } from '@/utils/profile';
import type { Profile } from '@/utils/profile';
import { socialBody, socialTags, socialTitle } from '@/utils/social';
import type { SocialPost } from '@/utils/social';
import { lookupSocialPost } from '@/utils/social-lookup';

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

let currentTab: { id?: number; title?: string; url?: string; favIconUrl?: string } = {};
let socialPost: SocialPost | null = null;

async function render() {
  const state = await getSignerState();
  $('login').hidden = state.status !== 'none';
  $('unlock').hidden = state.status !== 'locked';
  $('main').hidden = state.status !== 'ready';
  $('avatar-btn').hidden = state.status !== 'ready';
  if (state.status !== 'ready') closeMenu(false);
  if (state.status === 'none') showLoginForm(false);
  if (state.status !== 'none') renderProfile(state.account.pubkey);
  if (state.status === 'locked') {
    $('unlock-npub').textContent = shortNpub(state.account.pubkey);
    input('unlock-password').focus();
  }
  if (state.status === 'ready') {
    $('whoami').textContent = shortNpub(state.account.pubkey);
    $('whoami').title = nip19.npubEncode(state.account.pubkey);
    $('signer-type').textContent = `Signer: ${SIGNER_LABELS[state.account.signerType]}`;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = { id: tab?.id, title: tab?.title, url: tab?.url, favIconUrl: tab?.favIconUrl };
    socialPost = null;
    renderPage();
    loadSocialPost();
    showComposer(false);
    await renderTags();
    await renderPending();
    renderShortcut().catch(() => {});
    await checkPendingCapture();
    renderServers(state.account.pubkey);
  }
}

let shownPubkey = '';

async function renderProfile(pubkey: string) {
  shownPubkey = pubkey;
  const profile = await getProfile(pubkey);
  showProfile(profile);
  if (isProfileStale(profile)) {
    browser.runtime.sendMessage({ type: 'refresh-profile', pubkey }).catch(() => {});
  }
}

function showProfile(profile: Profile | null) {
  for (const id of ['avatar-btn', 'unlock-avatar']) setAvatarPicture($(id), profile?.picture);
  $('whoami-name').textContent = profile?.name ?? '';
  $('whoami-name').hidden = !profile?.name;
  $('avatar-btn').setAttribute('aria-label', profile?.name ? `Account, ${profile.name}` : 'Account');
}

// The person icon stays underneath until the picture loads, and when it fails
function setAvatarPicture(avatar: HTMLElement, url: string | undefined) {
  const current = avatar.querySelector('img');
  if (current?.getAttribute('src') === url) return;
  current?.remove();
  if (!url) return;
  const img = document.createElement('img');
  img.className = 'avatar-picture';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.hidden = true;
  img.addEventListener('load', () => (img.hidden = false));
  img.addEventListener('error', () => img.remove());
  img.src = url;
  avatar.appendChild(img);
}

browser.storage.onChanged.addListener((changes, area) => {
  const profile = changes[PROFILE_KEY]?.newValue as Profile | undefined;
  if (area === 'local' && profile?.pubkey === shownPubkey) showProfile(profile);
});

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

async function retryPending() {
  await retryQueue();
  await renderPending();
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

function renderPage() {
  const url = currentTab.url;
  let domain = '';
  try {
    const parsed = new URL(url ?? '');
    domain = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    domain = url ?? '';
  }
  $('tab-title').textContent = url ? currentTab.title || domain : 'No page to save';
  $('tab-domain').textContent = domain;
  const icon = $('page-icon');
  icon.textContent = '';
  icon.classList.remove('has-image');
  if (currentTab.favIconUrl?.startsWith('http') || currentTab.favIconUrl?.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = currentTab.favIconUrl;
    img.alt = '';
    img.addEventListener('error', () => {
      img.remove();
      icon.classList.remove('has-image');
      icon.textContent = (currentTab.title || domain || '?').charAt(0).toUpperCase();
    });
    icon.appendChild(img);
    icon.classList.add('has-image');
  } else {
    icon.textContent = (currentTab.title || domain || '?').charAt(0).toUpperCase();
  }
  const canSave = Boolean(url && currentTab.id);
  for (const id of ['save-link', 'save-article', 'open-composer']) button(id).disabled = !canSave;
}

async function loadSocialPost() {
  const tab = currentTab;
  if (!tab.id) return;
  const post = await lookupSocialPost(tab.id, tab.url);
  if (!post || tab !== currentTab) return;
  socialPost = post;
  $('tab-title').textContent = socialTitle(post);
  if (!$('composer').hidden && !pendingCapture) {
    renderSocialPreview();
    setComposerTags(socialTags(post).split(' '));
  }
}

// Cover and quoted caption of the post the composer will save
function renderSocialPreview() {
  if (!socialPost) return;
  const title = socialTitle(socialPost);
  const img = $('composer-image') as HTMLImageElement;
  if (socialPost.coverUrl) {
    img.src = socialPost.coverUrl;
    img.alt = `Cover: ${title}`;
    img.hidden = false;
  }
  $('composer-quote').textContent = socialBody(socialPost);
  $('composer-quote').setAttribute('aria-label', 'Post caption');
  $('composer-quote').hidden = false;
  $('full-article').hidden = true;
}

async function renderTags() {
  const raw = await getRawTags();
  $('tags-view').textContent = normalizeTags(raw) || 'none';
  input('tags').value = raw;
}

async function renderPending() {
  const count = (await getQueue()).length;
  $('pending-line').hidden = count === 0;
  $('pending-count').textContent = String(count);
}

// Toasts cannot be injected in browser pages, so there the popup stays open to show the result
function pageShowsToast(): boolean {
  return /^(https?|file):/.test(currentTab.url ?? '');
}

function setSensitiveChip(on: boolean) {
  $('sensitive').setAttribute('aria-pressed', String(on));
  $('sensitive-icon').innerHTML = iconSvg(on ? 'visibilityOff' : 'visibility', 12);
}

let pendingCapture: PendingCapture | null = null;

async function checkPendingCapture() {
  const capture = await takePendingCapture().catch(() => null);
  if (capture) openCaptureComposer(capture);
}

// The menu click may open the popup before the worker has stored the capture
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[PENDING_CAPTURE_KEY]?.newValue && !$('main').hidden) {
    checkPendingCapture();
  }
});

function openCaptureComposer(capture: PendingCapture) {
  pendingCapture = capture;
  showComposer(true);
  if (capture.kind === 'image') {
    const img = $('composer-image') as HTMLImageElement;
    img.src = capture.srcUrl;
    img.alt = 'Image to save';
    img.hidden = false;
    $('composer-title').textContent = 'Save image with comment';
  } else {
    $('composer-quote').textContent = capture.text.trim();
    $('composer-quote').setAttribute('aria-label', 'Selected text');
    $('composer-quote').hidden = false;
    $('composer-title').textContent = 'Save selection with comment';
    setComposerTags([...composerTags, HIGHLIGHT_TAG]);
    readSelection(capture.tabId, capture.frameId, capture.text).then((text) => {
      if (pendingCapture !== capture) return;
      capture.text = text;
      $('composer-quote').textContent = text.trim();
    });
  }
  $('full-article').hidden = true;
}

function showComposer(open: boolean) {
  if (!open || !pendingCapture) {
    pendingCapture = open ? pendingCapture : null;
    ($('composer-image') as HTMLImageElement).hidden = true;
    $('composer-quote').hidden = true;
    $('composer-quote').textContent = '';
    $('composer-title').textContent = 'Save with comment';
    $('full-article').hidden = false;
    if (open) renderSocialPreview();
  }
  $('quick-menu').hidden = open;
  $('page-row').hidden = open;
  $('composer').hidden = !open;
  $('tags-line').hidden = open;
  $('shortcut-line').hidden = open;
  $('tags-form').hidden = true;
  $('save-result').hidden = true;
  if (open) {
    setSensitiveChip(false);
    setComposerTags(
      (socialPost && !pendingCapture ? socialTags(socialPost) : normalizeTags(input('tags').value))
        .split(' ')
        .filter(Boolean),
    );
    input('comment').focus();
  } else {
    input('comment').value = '';
    $('full-article').setAttribute('aria-pressed', 'false');
    $('quick-menu').querySelector<HTMLButtonElement>('.quick-item:not(:disabled)')?.focus();
  }
}

let composerTags: string[] = [];

function setComposerTags(tags: string[]) {
  composerTags = [...new Set(tags)];
  const box = $('tag-chips');
  box.querySelectorAll('.tag-chip').forEach((chip) => chip.remove());
  for (const tag of composerTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = tag;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tag-remove';
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.innerHTML = iconSvg('close', 12);
    remove.addEventListener('click', () => {
      setComposerTags(composerTags.filter((t) => t !== tag));
      input('tag-add').focus();
    });
    chip.append(label, remove);
    box.insertBefore(chip, input('tag-add'));
  }
}

function pendingTagText(): string[] {
  return normalizeTags(input('tag-add').value).split(' ').filter(Boolean);
}

function commitTagText() {
  const added = pendingTagText();
  input('tag-add').value = '';
  if (added.length) setComposerTags([...composerTags, ...added]);
}

$('tag-add').addEventListener('keydown', (e) => {
  const field = input('tag-add');
  if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
    if (!field.value.trim()) return;
    e.preventDefault();
    commitTagText();
  } else if (e.key === 'Backspace' && !field.value && composerTags.length) {
    e.preventDefault();
    setComposerTags(composerTags.slice(0, -1));
  }
});
$('tag-add').addEventListener('blur', commitTagText);
$('tag-chips').addEventListener('click', (e) => {
  if (e.target === $('tag-chips')) input('tag-add').focus();
});

function showResult(kind: 'published' | 'queued' | 'error', text: string) {
  const icon = kind === 'published' ? 'checkCircle' : kind === 'queued' ? 'schedule' : 'syncProblem';
  $('save-result-icon').innerHTML = iconSvg(icon, 20);
  $('save-result-text').textContent = text;
  $('save-result').hidden = false;
  $('save-live').textContent = text;
}

async function runSave(trigger: HTMLButtonElement, message: object) {
  const label = trigger.querySelector('.quick-label, .btn-label')!;
  const original = label.textContent;
  trigger.disabled = true;
  label.textContent = 'Saving…';
  $('save-live').textContent = 'Saving…';
  if (pageShowsToast()) {
    // The worker owns the save and the page toast confirms it, so the popup can go
    browser.runtime.sendMessage(message).catch(() => {});
    setTimeout(() => window.close(), 150);
    return;
  }
  try {
    const outcome = await askBackground(message);
    if (outcome === 'published') showResult('published', 'Saved to Manent');
    else showResult('queued', 'Queued, will retry later');
    if (!$('composer').hidden) showComposer(false);
  } catch (e) {
    showResult('error', e instanceof Error ? e.message : String(e));
  } finally {
    label.textContent = original;
    trigger.disabled = false;
    renderPending();
  }
}

function saveLink() {
  if (!currentTab.url) return;
  runSave(button('save-link'), {
    type: 'save-link',
    title: currentTab.title,
    url: currentTab.url,
    comment: '',
    sensitive: false,
    tabId: currentTab.id,
  });
}

function saveArticle() {
  if (!currentTab.id) return;
  runSave(button('save-article'), {
    type: 'save-page',
    tabId: currentTab.id,
    comment: '',
    sensitive: false,
  });
}

$('save-link').addEventListener('click', saveLink);
$('save-article').addEventListener('click', saveArticle);
$('open-composer').addEventListener('click', () => showComposer(true));
$('composer-close').addEventListener('click', () => showComposer(false));

$('sensitive').addEventListener('click', () => {
  setSensitiveChip($('sensitive').getAttribute('aria-pressed') !== 'true');
});

$('full-article').addEventListener('click', () => {
  const on = $('full-article').getAttribute('aria-pressed') !== 'true';
  $('full-article').setAttribute('aria-pressed', String(on));
});

$('comment').addEventListener('input', () => {
  const el = $('comment');
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
});

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const common = {
    comment: input('comment').value,
    sensitive: $('sensitive').getAttribute('aria-pressed') === 'true',
    tags: [...composerTags, ...pendingTagText()].join(' '),
  };
  if (pendingCapture) {
    const { kind, title, pageUrl, tabId } = pendingCapture;
    runSave(button('save-btn'), {
      ...(kind === 'image'
        ? { type: 'save-image', srcUrl: pendingCapture.srcUrl }
        : { type: 'save-selection', text: pendingCapture.text }),
      title,
      pageUrl,
      tabId,
      ...common,
    });
    return;
  }
  if (!currentTab.url) return;
  if ($('full-article').getAttribute('aria-pressed') === 'true' && currentTab.id) {
    runSave(button('save-btn'), { type: 'save-page', tabId: currentTab.id, ...common });
  } else {
    runSave(button('save-btn'), {
      type: 'save-link',
      title: currentTab.title,
      url: currentTab.url,
      tabId: currentTab.id,
      ...common,
    });
  }
});

$('comment').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $('composer').dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

$('tags-change').addEventListener('click', () => {
  $('tags-line').hidden = true;
  $('tags-form').hidden = false;
  input('tags').focus();
  input('tags').select();
});

$('tags-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await setTags(input('tags').value).catch(() => {});
  await renderTags();
  $('tags-form').hidden = true;
  $('tags-line').hidden = false;
  button('tags-change').focus();
});

const shortcutCommands = browser.commands as typeof browser.commands & {
  openShortcutSettings?: () => Promise<void>;
};
// Firefox before 137 has no API for its shortcut settings, and extensions cannot open about:addons
const canOpenShortcutSettings =
  Boolean(shortcutCommands.openShortcutSettings) || location.protocol !== 'moz-extension:';

async function renderShortcut() {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((c) => c.name === '_execute_action')?.shortcut;
  const text = shortcut ? `Open with ${shortcut}` : 'No keyboard shortcut';
  const action = shortcut ? 'change it' : 'set one';
  $('shortcut-text').textContent = canOpenShortcutSettings
    ? text
    : `${text} · ${action} in about:addons › Manage Extension Shortcuts`;
  $('shortcut-action').hidden = !canOpenShortcutSettings;
  $('shortcut-change').textContent = shortcut ? 'change' : 'set one';
}

$('shortcut-change').addEventListener('click', async () => {
  // Firefox has its own settings page; Chrome only allows editing shortcuts on chrome://extensions
  if (shortcutCommands.openShortcutSettings) await shortcutCommands.openShortcutSettings();
  else await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

$('retry').addEventListener('click', () => retryPending().catch(() => {}));

// The mouse takes over from the keyboard selection, so only the hovered row is highlighted
$('quick-menu').addEventListener('mousemove', () => {
  const active = document.activeElement as HTMLElement | null;
  if (active?.classList.contains('quick-item')) active.blur();
});

// Menu keys: arrows move, 1-3 run the actions, Esc leaves the composer
document.addEventListener('keydown', (e) => {
  if ($('main').hidden || !$('account-menu').hidden) return;
  const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea');
  if (e.key === 'Escape' && !$('composer').hidden) {
    e.preventDefault();
    showComposer(false);
    return;
  }
  if (typing || $('quick-menu').hidden) return;
  const items = [...$('quick-menu').querySelectorAll<HTMLButtonElement>('.quick-item:not(:disabled)')];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  } else if (e.key === '1') saveLink();
  else if (e.key === '2') saveArticle();
  else if (e.key === '3' && !button('open-composer').disabled) showComposer(true);
});

$('logout-btn').addEventListener('click', async () => {
  closeMenu(false);
  await logout();
  await render();
});

renderIcons();
($('open-manent') as HTMLAnchorElement).href = MANENT_URL;
browser.runtime.sendMessage('ping').catch(() => {});
render().then(() => retryPending().catch(() => {}));
