import { SimplePool } from 'nostr-tools/pool';

export const DISCOVERY_RELAYS = [
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nostr.wine',
  'wss://nostr.mom',
];

export const FALLBACK_RELAYS = ['wss://nos.lol', 'wss://nostr.mom', 'wss://bitcoiner.social'];

const RELAY_LIST_KIND = 10002;
const STORAGE_KEY = 'writeRelays';

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function fetchWriteRelays(pubkey: string): Promise<string[]> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      DISCOVERY_RELAYS,
      { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
      { maxWait: 5000 },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return [];
    const urls = latest.tags
      .filter((t) => t[0] === 'r' && t[1] && (t[2] === undefined || t[2] === 'write'))
      .map((t) => normalize(t[1]))
      .filter((u) => u.startsWith('wss://') || u.startsWith('ws://'));
    return [...new Set(urls)];
  } finally {
    pool.close(DISCOVERY_RELAYS);
  }
}

export async function refreshWriteRelays(pubkey: string): Promise<string[]> {
  let relays: string[] = [];
  try {
    relays = await fetchWriteRelays(pubkey);
  } catch {
    relays = [];
  }
  if (relays.length === 0) relays = FALLBACK_RELAYS;
  await browser.storage.local.set({ [STORAGE_KEY]: relays });
  return relays;
}

export async function getWriteRelays(pubkey: string): Promise<string[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const cached = stored[STORAGE_KEY] as string[] | undefined;
  if (cached && cached.length > 0) return cached;
  return refreshWriteRelays(pubkey);
}

export async function clearWriteRelays(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}
