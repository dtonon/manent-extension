import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';

export interface PublishResult {
  ok: string[];
  failed: string[];
}

export async function publishEvent(event: Event, relays: string[]): Promise<PublishResult> {
  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relays, event));
    const result: PublishResult = { ok: [], failed: [] };
    settled.forEach((s, i) => {
      // The pool resolves instead of rejecting when it cannot connect
      const connected = s.status === 'fulfilled' && !String(s.value).startsWith('connection failure');
      (connected ? result.ok : result.failed).push(relays[i]);
    });
    return result;
  } finally {
    pool.close(relays);
  }
}
