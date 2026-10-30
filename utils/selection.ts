// Chrome flattens line breaks in the context menu's selectionText, the page keeps them
export async function readSelection(
  tabId: number,
  frameId: number | undefined,
  flat: string,
): Promise<string> {
  const [injection] = await browser.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId ?? 0] },
      func: () => window.getSelection()?.toString() ?? '',
    })
    .catch(() => [undefined]);
  const text = injection?.result as string | undefined;
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  return text && squash(text) === squash(flat) ? text : flat;
}
