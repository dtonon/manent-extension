import { facebookSource } from './social-facebook';
import { instagramSource } from './social-instagram';

export interface SocialPost {
  site: string;
  id: string;
  url: string;
  author?: string;
  authorName?: string;
  date?: number;
  caption?: string;
  coverUrl?: string;
}

export interface SocialSource {
  site: string;
  hosts: RegExp;
  // Request URLs whose responses carry post data
  network: RegExp;
  postId(url: URL): string | null;
  canonicalUrl(id: string): string;
  // Posts found in a network response, keyed by the ids they can be looked up with
  scanResponse(text: string): Map<string, SocialPost>;
  // Post embedded in the page on a direct load
  scanDocument?(doc: Document, id: string): SocialPost | null;
}

export const SOCIAL_SOURCES: SocialSource[] = [facebookSource, instagramSource];

export const SOCIAL_MATCHES = ['*://*.facebook.com/*', '*://*.instagram.com/*'];

export function findSource(url: string | undefined): SocialSource | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return SOCIAL_SOURCES.find((s) => s.hosts.test(host)) ?? null;
  } catch {
    return null;
  }
}

// Default tags of a saved post, in place of the user's default tags
export function socialTags(post: SocialPost): string {
  return `#video #${post.site.toLowerCase()}`;
}

// Title of a saved post: author and the first line of the caption
export function socialTitle(post: SocialPost): string {
  const who = post.author || post.authorName || post.site;
  const first = post.caption?.trim().split('\n')[0]?.trim() ?? '';
  if (!first) return who;
  const short = first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
  return `${who}: ${short}`;
}

// Source text of a saved post: title, link, caption and date; the popup preview leaves out the link
export function socialQuote(post: SocialPost, withUrl = true): string {
  const head = withUrl ? `${socialTitle(post)}\n${post.url}` : socialTitle(post);
  const date = post.date ? new Date(post.date * 1000).toISOString().slice(0, 10) : '';
  return [head, post.caption?.trim(), date].filter(Boolean).join('\n\n');
}
