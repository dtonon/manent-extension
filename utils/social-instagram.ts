import type { SocialPost, SocialSource } from './social';
import { walkJson } from './social-json';

const SITE = 'Instagram';
const COVER_WIDTH = 720;

// Reels are clips; photos, carousels and plain feed videos live under /p/
function canonicalUrl(media: any): string {
  const path = media.product_type === 'clips' ? 'reel' : 'p';
  return `https://www.instagram.com/${path}/${media.code}/`;
}

function isMedia(o: any): boolean {
  return typeof o?.code === 'string' && typeof o.taken_at === 'number';
}

// Videos get a cover near 720 px, photos the largest size; on equal width the uncropped one comes first
function pickImage(media: any, video: boolean): string | undefined {
  const candidates: { url?: string; width?: number }[] = media.image_versions2?.candidates ?? [];
  let best: { url?: string; width?: number } | undefined;
  for (const c of candidates) {
    if (typeof c.url !== 'string' || typeof c.width !== 'number') continue;
    const better = video
      ? Math.abs(c.width - COVER_WIDTH) < Math.abs(best?.width! - COVER_WIDTH)
      : c.width > best?.width!;
    if (!best || better) best = c;
  }
  return best?.url ?? media.image_versions2?.additional_candidates?.first_frame?.url;
}

function toPost(media: any): SocialPost {
  const video = media.media_type === 2;
  // Carousels keep their images in carousel_media, only the first one is saved
  const first = media.media_type === 8 ? (media.carousel_media?.[0] ?? media) : media;
  return {
    site: SITE,
    kind: video ? 'video' : 'image',
    id: media.code,
    url: canonicalUrl(media),
    author: media.user?.username,
    authorName: media.user?.full_name || undefined,
    date: media.taken_at,
    caption: media.caption?.text ?? undefined,
    coverUrl: pickImage(first, first.media_type === 2),
  };
}

function parseAll(text: string): unknown[] {
  const body = text.replace(/^for \(;;\);/, '');
  try {
    return [JSON.parse(body)];
  } catch {
    // Some endpoints stream one JSON document per line
    const docs: unknown[] = [];
    for (const line of body.split('\n')) {
      if (!line.includes('taken_at')) continue;
      try {
        docs.push(JSON.parse(line));
      } catch {}
    }
    return docs;
  }
}

function collect(json: unknown, into: Map<string, SocialPost>) {
  walkJson(json, (o) => {
    if (!isMedia(o)) return;
    into.set(o.code, toPost(o));
    return true;
  });
}

export const instagramSource: SocialSource = {
  site: SITE,
  hosts: /(^|\.)instagram\.com$/,
  network: /\/(api\/graphql|graphql\/query|api\/v1\/)/,

  postId(url) {
    // Also /<user>/p/<code>/ and /<user>/reel/<code>/, used by recent profile links
    return url.pathname.match(/(?:^|\/)(?:p|reels?)\/([\w-]+)/)?.[1] ?? null;
  },


  scanResponse(text) {
    const found = new Map<string, SocialPost>();
    if (!text.includes('taken_at')) return found;
    for (const json of parseAll(text)) collect(json, found);
    return found;
  },

  scanDocument(doc, code) {
    for (const script of doc.querySelectorAll('script[type="application/json"]')) {
      const text = script.textContent ?? '';
      if (!text.includes(code) || !text.includes('taken_at')) continue;
      const found = new Map<string, SocialPost>();
      for (const json of parseAll(text)) collect(json, found);
      const post = found.get(code);
      if (post) return post;
    }
    return null;
  },
};
