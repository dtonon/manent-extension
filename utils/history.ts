export const MANENT_URL = 'https://manent.dtonon.com';

export interface RecentSave {
  snippet: string;
  url?: string;
  ts: number;
}

const RECENT_KEY = 'recentSaves';
const MAX_RECENT = 10;

export async function getRecentSaves(): Promise<RecentSave[]> {
  const stored = await browser.storage.local.get(RECENT_KEY);
  return (stored[RECENT_KEY] as RecentSave[] | undefined) ?? [];
}

export async function addRecentSave(item: RecentSave): Promise<void> {
  const list = await getRecentSaves();
  list.unshift(item);
  await browser.storage.local.set({ [RECENT_KEY]: list.slice(0, MAX_RECENT) });
}
