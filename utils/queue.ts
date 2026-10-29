import type { Event } from 'nostr-tools/pure';
import { getAccount } from './auth';
import { getWriteRelays } from './relays';
import { publishEvent } from './publish';

export interface PendingItem {
  event: Event;
  snippet: string;
  url?: string;
  ts: number;
}

const QUEUE_KEY = 'pendingEvents';

export async function getQueue(): Promise<PendingItem[]> {
  const stored = await browser.storage.local.get(QUEUE_KEY);
  return (stored[QUEUE_KEY] as PendingItem[] | undefined) ?? [];
}

async function setQueue(queue: PendingItem[]): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function enqueue(item: PendingItem): Promise<void> {
  const queue = await getQueue();
  queue.push(item);
  await setQueue(queue);
}

export async function retryQueue(): Promise<number> {
  const queue = await getQueue();
  if (queue.length === 0) return 0;
  const account = await getAccount();
  if (!account) return queue.length;

  const relays = await getWriteRelays(account.pubkey);
  const remaining: PendingItem[] = [];
  for (const item of queue) {
    const result = await publishEvent(item.event, relays);
    if (result.ok.length === 0) remaining.push(item);
  }
  await setQueue(remaining);
  return remaining.length;
}
