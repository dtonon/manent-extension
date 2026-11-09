import { bytesToBase64 } from './file-crypto';
import type { SelectedArea } from './screenshot-overlay';

const JPEG_QUALITY = 85;

// Runs in the page: hides Manent's own UI and waits for the repaint before the capture
function setManentUiHidden(hidden: boolean): Promise<void> {
  for (const id of ['manent-toast-host', 'manent-dialog-host', 'manent-area-host']) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = hidden ? 'hidden' : '';
  }
  if (!hidden) return Promise.resolve();
  return new Promise((resolve) => {
    // Frames do not fire in a hidden tab, the timeout keeps the capture from hanging
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

async function hideManentUi(tabId: number, hidden: boolean): Promise<void> {
  await browser.scripting
    .executeScript({ target: { tabId }, func: setManentUiHidden, args: [hidden] })
    .catch(() => {});
}

async function crop(dataUrl: string, area: SelectedArea): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // The capture is in device pixels, the area in CSS pixels
  const scale = bitmap.width / area.viewWidth;
  const sx = Math.max(0, Math.round(area.x * scale));
  const sy = Math.max(0, Math.round(area.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(area.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.round(area.height * scale));
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY / 100 });
  return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

// JPEG data URL of the visible tab, cropped to the area when given
export async function captureTab(tabId: number, area?: SelectedArea): Promise<string> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active) throw new Error('Switch to the tab to take the screenshot');
  await hideManentUi(tabId, true);
  let dataUrl: string;
  try {
    dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: JPEG_QUALITY,
    });
  } catch (e) {
    console.warn('Manent: cannot capture the tab', e);
    throw new Error('This page cannot be captured');
  } finally {
    await hideManentUi(tabId, false);
  }
  const whole = !area || (area.width >= area.viewWidth && area.height >= area.viewHeight);
  return whole ? dataUrl : crop(dataUrl, area);
}

export function screenshotFilename(pageUrl?: string, now = new Date()): string {
  let host = 'page';
  try {
    if (pageUrl) host = new URL(pageUrl).hostname.replace(/^www\./, '') || host;
  } catch {}
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `screenshot-${host}-${stamp}.jpg`;
}
