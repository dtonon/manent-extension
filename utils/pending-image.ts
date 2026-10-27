// Image picked from the context menu, handed to the popup through session storage
export const PENDING_IMAGE_KEY = 'pendingImage';
export const PENDING_IMAGE_TTL = 30_000;

export interface PendingImage {
  srcUrl: string;
  title?: string;
  pageUrl?: string;
  tabId: number;
  ts: number;
}

export async function takePendingImage(): Promise<PendingImage | null> {
  const stored = await browser.storage.session.get(PENDING_IMAGE_KEY);
  const pending = stored[PENDING_IMAGE_KEY] as PendingImage | undefined;
  if (!pending) return null;
  await browser.storage.session.remove(PENDING_IMAGE_KEY);
  return Date.now() - pending.ts < PENDING_IMAGE_TTL ? pending : null;
}
