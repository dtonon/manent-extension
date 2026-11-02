import { findSource } from './social';
import type { SocialPost } from './social';

// Post data the in-page capture script collected for the tab's URL, on supported sites only
export async function lookupSocialPost(tabId: number, url?: string): Promise<SocialPost | null> {
  if (!url || !findSource(url)) return null;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (href: string) => (window as any).__manentSocial?.lookup(href) ?? null,
      args: [url],
    });
    return (injection?.result as SocialPost | null) ?? null;
  } catch {
    return null;
  }
}
