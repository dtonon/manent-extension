import { formatCapture } from '@/utils/manent';
import { saveNote, saveImage, savePage } from '@/utils/save';
import type { SaveOutcome } from '@/utils/save';
import { retryQueue } from '@/utils/queue';
import { showPageToast } from '@/utils/toast';
import { askImageComment } from '@/utils/comment-dialog';
import { loginWithNip07 } from '@/utils/nip07';
import { refreshWriteRelays } from '@/utils/relays';

const MENU_SELECTION = 'save-selection';
const MENU_IMAGE = 'save-image';
const MENU_IMAGE_COMMENT = 'save-image-comment';
const MENU_PAGE = 'save-page';

function getAction() {
  return browser.action ?? (browser as any).browserAction;
}

function flashBadge(text: string) {
  const action = getAction();
  action.setBadgeText({ text });
  setTimeout(() => action.setBadgeText({ text: '' }), 3000);
}

async function saveWithToast(
  tabId: number | undefined,
  run: () => Promise<SaveOutcome>,
  loadingMessage = 'Saving to Manent…',
): Promise<SaveOutcome> {
  const title = tabId ? (await browser.tabs.get(tabId).catch(() => undefined))?.title : undefined;
  if (tabId) await showPageToast(tabId, 'loading', loadingMessage, title);
  try {
    const outcome = await run();
    flashBadge(outcome === 'published' ? '✓' : '…');
    if (tabId) {
      if (outcome === 'published') await showPageToast(tabId, 'published', 'Saved to Manent', title);
      else await showPageToast(tabId, 'queued', 'Queued, will retry later', title);
    }
    return outcome;
  } catch (e) {
    flashBadge('!');
    if (tabId) {
      await showPageToast(tabId, 'error', 'Not saved', e instanceof Error ? e.message : 'Save failed');
    }
    throw e;
  }
}

export default defineBackground(() => {
  const setupMenu = () => {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_SELECTION,
        title: 'Save selection to Manent',
        contexts: ['selection'],
      });
      browser.contextMenus.create({
        id: MENU_IMAGE,
        title: 'Save image',
        contexts: ['image'],
      });
      browser.contextMenus.create({
        id: MENU_IMAGE_COMMENT,
        title: 'Save image with comment',
        contexts: ['image'],
      });
      browser.contextMenus.create({
        id: MENU_PAGE,
        title: 'Save full article to Manent',
        contexts: ['page'],
      });
    });
  };
  setupMenu();
  retryQueue().catch(() => {});
  browser.runtime.onInstalled.addListener(setupMenu);
  browser.runtime.onStartup.addListener(setupMenu);
  // Saves run here so a signer approval popup closing the extension popup cannot abort them
  browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const respond = (p: Promise<unknown>) => {
      p.then((result) => sendResponse({ ok: true, result })).catch((e) =>
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      return true;
    };
    if (message?.type === 'save-note') {
      return respond(
        saveWithToast(message.tabId, () => saveNote(message.text, message.sensitive, message.url)),
      );
    }
    if (message?.type === 'save-page') {
      return respond(
        saveWithToast(
          message.tabId,
          () => savePage(message.tabId, message.comment, message.sensitive),
          'Saving article to Manent…',
        ),
      );
    }
    if (message?.type === 'login-nip07') {
      return respond(
        loginWithNip07().then(async (account) => {
          await refreshWriteRelays(account.pubkey).catch(() => {});
        }),
      );
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const pageUrl = info.pageUrl ?? tab?.url;
    let action: (() => Promise<SaveOutcome>) | null = null;
    let loadingMessage = 'Saving to Manent…';

    if (info.menuItemId === MENU_SELECTION && info.selectionText) {
      const text = formatCapture({
        selection: info.selectionText,
        title: tab?.title,
        url: pageUrl,
      });
      action = () => saveNote(text, false, pageUrl);
    } else if (info.menuItemId === MENU_IMAGE && info.srcUrl) {
      const srcUrl = info.srcUrl;
      loadingMessage = 'Saving image to Manent…';
      action = () => saveImage(srcUrl, tab?.title, pageUrl);
    } else if (info.menuItemId === MENU_IMAGE_COMMENT && info.srcUrl && tab?.id) {
      const srcUrl = info.srcUrl;
      const comment = await askImageComment(tab.id, srcUrl);
      if (comment === null) return;
      loadingMessage = 'Saving image to Manent…';
      action = () => saveImage(srcUrl, tab?.title, pageUrl, comment);
    } else if (info.menuItemId === MENU_PAGE && tab?.id) {
      const tabId = tab.id;
      loadingMessage = 'Saving article to Manent…';
      action = () => savePage(tabId, '');
    }
    if (!action) return;
    await saveWithToast(tab?.id, action, loadingMessage).catch(() => {});
  });
});
