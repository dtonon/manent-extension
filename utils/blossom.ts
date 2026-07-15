import { SimplePool } from 'nostr-tools/pool';
import { DISCOVERY_RELAYS } from './relays';
import type { Signer } from './signer';

// Fallbacks used by Manent since most public servers reject opaque ciphertext
export const FALLBACK_BLOSSOM_SERVERS = ['https://nostr.download', 'https://cdn.hzrd149.com'];

const SERVER_LIST_KIND = 10063;
const STORAGE_KEY = 'blossomServers';

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function getBlossomServers(pubkey: string): Promise<string[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const cached = stored[STORAGE_KEY] as string[] | undefined;
  if (cached && cached.length > 0) return cached;

  let servers: string[] = [];
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      DISCOVERY_RELAYS,
      { kinds: [SERVER_LIST_KIND], authors: [pubkey] },
      { maxWait: 5000 },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (latest) {
      servers = latest.tags
        .filter((t) => t[0] === 'server' && t[1])
        .map((t) => normalize(t[1]));
    }
  } catch {
    servers = [];
  } finally {
    pool.close(DISCOVERY_RELAYS);
  }

  for (const fallback of FALLBACK_BLOSSOM_SERVERS) {
    if (!servers.includes(fallback)) servers.push(fallback);
  }
  await browser.storage.local.set({ [STORAGE_KEY]: servers });
  return servers;
}

export async function clearBlossomServers(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

export async function uploadToBlossom(
  signer: Signer,
  servers: string[],
  bytes: Uint8Array,
  sha256Hex: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const auth = await signer.signEvent({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256Hex],
      ['expiration', String(now + 600)],
    ],
    content: 'Upload blob',
  });
  const header = 'Nostr ' + btoa(JSON.stringify(auth));

  for (const server of servers) {
    try {
      const res = await fetch(server + '/upload', {
        method: 'PUT',
        headers: { Authorization: header, 'Content-Type': 'application/octet-stream' },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) continue;
      const descriptor = await res.json().catch(() => null);
      return descriptor?.url ?? `${server}/${sha256Hex}`;
    } catch {
      continue;
    }
  }
  throw new Error('Upload failed on all Blossom servers');
}
