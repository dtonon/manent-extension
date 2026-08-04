import { formatCapture } from '@/utils/manent';
import { saveNote, saveImage, savePage } from '@/utils/save';
import type { SaveOutcome } from '@/utils/save';
import { retryQueue } from '@/utils/queue';
import { showPageToast } from '@/utils/toast';

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

export default defineBackground(() => {
  const MENU_PARENT = 'manent';
  const setupMenu = () => {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_PARENT,
        title: 'Manent',
        contexts: ['selection', 'image', 'page'],
      });
      browser.contextMenus.create({
        id: MENU_SELECTION,
        parentId: MENU_PARENT,
        title: 'Save selection',
        contexts: ['selection'],
      });
      browser.contextMenus.create({
        id: MENU_IMAGE,
        parentId: MENU_PARENT,
        title: 'Save image',
        contexts: ['image'],
      });
      browser.contextMenus.create({
        id: MENU_IMAGE_COMMENT,
        parentId: MENU_PARENT,
        title: 'Save image with comment',
        contexts: ['image'],
      });
      browser.contextMenus.create({
        id: MENU_PAGE,
        parentId: MENU_PARENT,
        title: 'Save full article',
        contexts: ['page'],
      });
    });
  };
  setupMenu();
  retryQueue().catch(() => {});
  browser.runtime.onInstalled.addListener(setupMenu);
  browser.runtime.onStartup.addListener(setupMenu);
  // Popup pings on open so the worker wakes and refreshes the menus
  browser.runtime.onMessage.addListener(() => {});

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
      const [injection] = await browser.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: () => window.prompt('Comment for this image:'),
        })
        .catch(() => [undefined]);
      const comment = (injection?.result ?? null) as string | null;
      if (comment === null) return;
      loadingMessage = 'Saving image to Manent…';
      action = () => saveImage(srcUrl, tab?.title, pageUrl, comment);
    } else if (info.menuItemId === MENU_PAGE && tab?.id) {
      const tabId = tab.id;
      loadingMessage = 'Saving article to Manent…';
      action = () => savePage(tabId, '');
    }
    if (!action) return;

    const tabId = tab?.id;
    if (tabId) await showPageToast(tabId, 'loading', loadingMessage);
    try {
      const outcome = await action();
      flashBadge(outcome === 'published' ? '✓' : '…');
      if (tabId) {
        await showPageToast(
          tabId,
          'success',
          outcome === 'published' ? 'Saved to Manent' : 'Queued, will retry later',
        );
      }
    } catch (e) {
      flashBadge('!');
      if (tabId) {
        await showPageToast(tabId, 'error', e instanceof Error ? e.message : 'Save failed');
      }
    }
  });
});
