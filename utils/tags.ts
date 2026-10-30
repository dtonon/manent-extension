const TAGS_KEY = 'tags';
export const DEFAULT_TAGS = '#readlater';
export const HIGHLIGHT_TAG = '#highlight';

export function normalizeTags(raw: string): string {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : '#' + t))
    .join(' ');
}

export async function getRawTags(): Promise<string> {
  const stored = await browser.storage.local.get(TAGS_KEY);
  return (stored[TAGS_KEY] as string | undefined) ?? DEFAULT_TAGS;
}

export async function getTagsLine(): Promise<string> {
  return normalizeTags(await getRawTags());
}

export async function setTags(raw: string): Promise<void> {
  await browser.storage.local.set({ [TAGS_KEY]: raw });
}

export async function getHighlightTagsLine(): Promise<string> {
  return normalizeTags(`${await getRawTags()} ${HIGHLIGHT_TAG}`)
    .split(' ')
    .filter((t, i, all) => all.indexOf(t) === i)
    .join(' ');
}
