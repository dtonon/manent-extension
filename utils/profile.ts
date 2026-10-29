import { SimplePool } from 'nostr-tools/pool';
import { DISCOVERY_RELAYS, getWriteRelays } from './relays';

export interface Profile {
  pubkey: string;
  name?: string;
  picture?: string;
  fetchedAt: number;
}

export const PROFILE_KEY = 'profile';
const PROFILE_KIND = 0;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function getProfile(pubkey: string): Promise<Profile | null> {
  const stored = await browser.storage.local.get(PROFILE_KEY);
  const profile = stored[PROFILE_KEY] as Profile | undefined;
  return profile?.pubkey === pubkey ? profile : null;
}

export function isProfileStale(profile: Profile | null): boolean {
  return !profile || Date.now() - profile.fetchedAt > MAX_AGE_MS;
}

function parseContent(content: string): Pick<Profile, 'name' | 'picture'> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content);
  } catch {
    return {};
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const name = text(data.display_name) ?? text(data.displayName) ?? text(data.name);
  const picture = text(data.picture);
  return { name, picture: picture?.startsWith('https://') ? picture : undefined };
}

export async function refreshProfile(pubkey: string): Promise<Profile | null> {
  const writeRelays = await getWriteRelays(pubkey).catch(() => [] as string[]);
  const relays = [...new Set([...writeRelays, ...DISCOVERY_RELAYS])];
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [PROFILE_KIND], authors: [pubkey] },
      { maxWait: 5000 },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    // Without an answer keep the cached fields, still waiting a day before asking again
    const fields = latest ? parseContent(latest.content) : await getProfile(pubkey);
    const profile: Profile = {
      pubkey,
      name: fields?.name,
      picture: fields?.picture,
      fetchedAt: Date.now(),
    };
    // A logout during the fetch must not leave a profile behind
    const { account } = await browser.storage.local.get('account');
    if ((account as { pubkey?: string } | undefined)?.pubkey !== pubkey) return null;
    await browser.storage.local.set({ [PROFILE_KEY]: profile });
    return profile;
  } finally {
    pool.close(relays);
  }
}

export async function clearProfile(): Promise<void> {
  await browser.storage.local.remove(PROFILE_KEY);
}
