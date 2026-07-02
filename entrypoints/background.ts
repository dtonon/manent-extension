import { formatCapture } from '@/utils/manent';
import { saveNote } from '@/utils/save';
import { retryQueue } from '@/utils/queue';

const MENU_ID = 'save-selection';

function getAction() {
  return browser.action ?? (browser as any).browserAction;
}

function flashBadge(text: string) {
  const action = getAction();
  action.setBadgeText({ text });
  setTimeout(() => action.setBadgeText({ text: '' }), 3000);
}

export default defineBackground(() => {
  const setupMenu = () => {
    browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: 'Save selection to Manent',
        contexts: ['selection'],
      });
    });
  };
  browser.runtime.onInstalled.addListener(() => {
    setupMenu();
    retryQueue().catch(() => {});
  });
  browser.runtime.onStartup.addListener(() => {
    setupMenu();
    retryQueue().catch(() => {});
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText) return;
    const text = formatCapture({
      selection: info.selectionText,
      title: tab?.title,
      url: info.pageUrl ?? tab?.url,
    });
    try {
      const outcome = await saveNote(text, false, info.pageUrl ?? tab?.url);
      flashBadge(outcome === 'published' ? '✓' : '…');
    } catch {
      flashBadge('!');
    }
  });
});
