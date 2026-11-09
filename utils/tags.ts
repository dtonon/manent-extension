const TAGS_KEY = 'tags';
export const DEFAULT_TAGS = '#readlater';
export const HIGHLIGHT_TAG = '#highlight';
export const SCREENSHOT_TAG = '#screenshot';

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

// Screenshots are not for later reading, the default tag gives way to their own
export function screenshotTags(tags: string[]): string[] {
  return [...new Set([...tags.filter((t) => t !== DEFAULT_TAGS), SCREENSHOT_TAG])];
}

export async function getScreenshotTagsLine(): Promise<string> {
  return screenshotTags((await getTagsLine()).split(' ').filter(Boolean)).join(' ');
}

export async function getHighlightTagsLine(): Promise<string> {
  return normalizeTags(`${await getRawTags()} ${HIGHLIGHT_TAG}`)
    .split(' ')
    .filter((t, i, all) => all.indexOf(t) === i)
    .join(' ');
}
