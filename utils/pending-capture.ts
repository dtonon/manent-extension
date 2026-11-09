// Capture picked from the context menu, handed to the popup through session storage
export const PENDING_CAPTURE_KEY = 'pendingCapture';
export const PENDING_CAPTURE_TTL = 30_000;

interface PendingBase {
  title?: string;
  pageUrl?: string;
  tabId: number;
  ts: number;
}

export type PendingCapture =
  | (PendingBase & { kind: 'image'; srcUrl: string })
  | (PendingBase & { kind: 'screenshot'; dataUrl: string })
  | (PendingBase & { kind: 'selection'; text: string; frameId?: number });

export async function takePendingCapture(): Promise<PendingCapture | null> {
  const stored = await browser.storage.session.get(PENDING_CAPTURE_KEY);
  const pending = stored[PENDING_CAPTURE_KEY] as PendingCapture | undefined;
  if (!pending) return null;
  await browser.storage.session.remove(PENDING_CAPTURE_KEY);
  return Date.now() - pending.ts < PENDING_CAPTURE_TTL ? pending : null;
}
