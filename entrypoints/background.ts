import { saveLink, saveImage, savePage, saveScreenshot, saveSelection } from '@/utils/save';
import type { SaveOutcome } from '@/utils/save';
import { retryQueue } from '@/utils/queue';
import { showPageToast } from '@/utils/toast';
import { askComment } from '@/utils/comment-dialog';
import { PENDING_CAPTURE_KEY } from '@/utils/pending-capture';
import type { PendingCapture } from '@/utils/pending-capture';
import { getHighlightTagsLine } from '@/utils/tags';
import { readSelection } from '@/utils/selection';
import { loginWithNip07 } from '@/utils/nip07';
import { refreshWriteRelays } from '@/utils/relays';
import { refreshProfile } from '@/utils/profile';
import { askArea } from '@/utils/screenshot-overlay';
import { captureTab } from '@/utils/screenshot';

const MENU_SELECTION = 'save-selection';
const MENU_IMAGE = 'save-image';
const MENU_PAGE = 'save-page';
const MENU_SCREENSHOT = 'save-screenshot';
const SCREENSHOT_FALLBACK = 'No readable article, saved a screenshot';

function getAction() {
  return browser.action ?? (browser as any).browserAction;
}

function styleBadge() {
  const action = getAction();
  action.setBadgeBackgroundColor({ color: '#e32a6d' });
  action.setBadgeTextColor?.({ color: '#ffffff' });
}

function flashBadge(text: string) {
  const action = getAction();
  action.setBadgeText({ text });
  setTimeout(() => action.setBadgeText({ text: '' }), 3000);
}

async function showError(tabId: number | undefined, e: unknown) {
  flashBadge('!');
  if (tabId) {
    await showPageToast(tabId, 'error', 'Not saved', e instanceof Error ? e.message : 'Save failed');
  }
}

// The run can replace the toast detail, the page title by default
async function saveWithToast(
  tabId: number | undefined,
  run: (setDetail: (detail: string) => void) => Promise<SaveOutcome>,
  loadingMessage = 'Saving to Manent…',
): Promise<SaveOutcome> {
  const title = tabId ? (await browser.tabs.get(tabId).catch(() => undefined))?.title : undefined;
  let detail = title;
  if (tabId) await showPageToast(tabId, 'loading', loadingMessage, title);
  try {
    const outcome = await run((d) => (detail = d));
    flashBadge(outcome === 'published' ? '✓' : '…');
    if (tabId) {
      if (outcome === 'published') await showPageToast(tabId, 'published', 'Saved to Manent', detail);
      else await showPageToast(tabId, 'queued', 'Queued, will retry later', detail);
    }
    return outcome;
  } catch (e) {
    await showError(tabId, e);
    throw e;
  }
}

// Opens the popup composer on the capture, or returns false so the caller falls back to the page dialog
async function openComposer(pending: PendingCapture): Promise<boolean> {
  // openPopup must run right away, while the menu click still counts as a user action
  browser.storage.session.set({ [PENDING_CAPTURE_KEY]: pending }).catch(() => {});
  const popupAction = getAction() as { openPopup?: () => Promise<void> };
  const opened = popupAction.openPopup
    ? await popupAction
        .openPopup()
        .then(() => true)
        .catch((e) => {
          console.warn('Manent: cannot open the popup, using the page dialog', e);
          return false;
        })
    : (console.warn('Manent: action.openPopup is not available, using the page dialog'), false);
  if (!opened) await browser.storage.session.remove(PENDING_CAPTURE_KEY).catch(() => {});
  return opened;
}

// Area selection on the page, then the composer, or the page dialog when the popup cannot open
async function startScreenshot(tabId: number): Promise<void> {
  let dataUrl: string;
  try {
    const area = await askArea(tabId).catch(() => {
      throw new Error('This page cannot be captured');
    });
    if (!area) return;
    dataUrl = await captureTab(tabId, area);
  } catch (e) {
    await showError(tabId, e);
    return;
  }
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  const pending: PendingCapture = {
    kind: 'screenshot',
    dataUrl,
    title: tab?.title,
    pageUrl: tab?.url,
    tabId,
    ts: Date.now(),
  };
  if (await openComposer(pending)) return;
  const comment = await askComment(tabId, { srcUrl: dataUrl, screenshot: true });
  if (comment === null) return;
  await saveWithToast(
    tabId,
    () => saveScreenshot(dataUrl, tab?.title, tab?.url, comment),
    'Saving screenshot to Manent…',
  ).catch(() => {});
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
        title: 'Save image to Manent',
        contexts: ['image'],
      });
      browser.contextMenus.create({
        id: MENU_PAGE,
        title: 'Save full article to Manent',
        contexts: ['page'],
      });
      browser.contextMenus.create({
        id: MENU_SCREENSHOT,
        title: 'Save screenshot to Manent',
        contexts: ['page'],
      });
    });
  };
  setupMenu();
  styleBadge();
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
    if (message?.type === 'save-link') {
      return respond(
        saveWithToast(message.tabId, () =>
          saveLink(
            message.title,
            message.url,
            message.comment,
            message.sensitive,
            message.tags,
            message.tabId,
          ),
        ),
      );
    }
    if (message?.type === 'save-image') {
      return respond(
        saveWithToast(
          message.tabId,
          () =>
            saveImage(
              message.srcUrl,
              message.title,
              message.pageUrl,
              message.comment,
              message.sensitive,
              message.tags,
            ),
          'Saving image to Manent…',
        ),
      );
    }
    if (message?.type === 'save-selection') {
      return respond(
        saveWithToast(message.tabId, () =>
          saveSelection(
            message.text,
            message.title,
            message.pageUrl,
            message.comment,
            message.sensitive,
            message.tags,
          ),
        ),
      );
    }
    if (message?.type === 'save-page') {
      return respond(
        saveWithToast(
          message.tabId,
          (setDetail) =>
            savePage(message.tabId, message.comment, message.sensitive, message.tags, () =>
              setDetail(SCREENSHOT_FALLBACK),
            ),
          'Saving article to Manent…',
        ),
      );
    }
    if (message?.type === 'save-screenshot') {
      return respond(
        saveWithToast(
          message.tabId,
          () =>
            saveScreenshot(
              message.dataUrl,
              message.title,
              message.pageUrl,
              message.comment,
              message.sensitive,
              message.tags,
            ),
          'Saving screenshot to Manent…',
        ),
      );
    }
    if (message?.type === 'start-screenshot') {
      startScreenshot(message.tabId);
      return;
    }
    if (message?.type === 'login-nip07') {
      return respond(
        loginWithNip07().then(async (account) => {
          await refreshWriteRelays(account.pubkey).catch(() => {});
        }),
      );
    }
    if (message?.type === 'refresh-profile') {
      return respond(refreshProfile(message.pubkey));
    }
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'save-link') return;
    const target = tab?.id ? tab : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target?.id || !target.url) return;
    const { id, title, url } = target;
    await saveWithToast(id, () => saveLink(title, url, '', false, undefined, id)).catch(() => {});
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const pageUrl = info.pageUrl ?? tab?.url;
    let action: ((setDetail: (detail: string) => void) => Promise<SaveOutcome>) | null = null;
    let loadingMessage = 'Saving to Manent…';

    if (info.menuItemId === MENU_SELECTION && info.selectionText && tab?.id) {
      const flat = info.selectionText;
      const pending: PendingCapture = {
        kind: 'selection',
        text: flat,
        frameId: info.frameId,
        title: tab.title,
        pageUrl,
        tabId: tab.id,
        ts: Date.now(),
      };
      if (await openComposer(pending)) return;
      const text = await readSelection(tab.id, info.frameId, flat);
      const comment = await askComment(tab.id, { quote: text });
      if (comment === null) return;
      const tags = await getHighlightTagsLine();
      action = () => saveSelection(text, tab?.title, pageUrl, comment, false, tags);
    } else if (info.menuItemId === MENU_IMAGE && info.srcUrl && tab?.id) {
      const srcUrl = info.srcUrl;
      const pending: PendingCapture = {
        kind: 'image',
        srcUrl,
        title: tab.title,
        pageUrl,
        tabId: tab.id,
        ts: Date.now(),
      };
      if (await openComposer(pending)) return;
      const comment = await askComment(tab.id, { srcUrl });
      if (comment === null) return;
      loadingMessage = 'Saving image to Manent…';
      action = () => saveImage(srcUrl, tab?.title, pageUrl, comment);
    } else if (info.menuItemId === MENU_PAGE && tab?.id) {
      const tabId = tab.id;
      loadingMessage = 'Saving article to Manent…';
      action = (setDetail) =>
        savePage(tabId, '', false, undefined, () => setDetail(SCREENSHOT_FALLBACK));
    } else if (info.menuItemId === MENU_SCREENSHOT && tab?.id) {
      await startScreenshot(tab.id);
      return;
    }
    if (!action) return;
    await saveWithToast(tab?.id, action, loadingMessage).catch(() => {});
  });
});
