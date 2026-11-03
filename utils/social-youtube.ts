import type { SocialPost, SocialSource } from './social';
import { walkJson } from './social-json';

const SITE = 'YouTube';

function canonicalUrl(id: string, page?: URL): string {
  return page?.pathname.startsWith('/shorts/')
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;
}

// Largest thumbnail the video actually has, without the resizing parameters
function pickCover(details: any): string | undefined {
  const thumbs: { url?: string; width?: number }[] = details.thumbnail?.thumbnails ?? [];
  let best: { url?: string; width?: number } | undefined;
  for (const t of thumbs) {
    if (typeof t.url !== 'string') continue;
    if (!best || (t.width ?? 0) > (best.width ?? 0)) best = t;
  }
  return best?.url?.split('?')[0];
}

// A player response: videoDetails plus microformat, as in ytInitialPlayerResponse and /youtubei/v1/player
function toPost(player: any): SocialPost | null {
  const details = player?.videoDetails;
  if (typeof details?.videoId !== 'string') return null;
  const micro = player.microformat?.playerMicroformatRenderer;
  const published = Date.parse(micro?.publishDate ?? micro?.uploadDate ?? '');
  const id = details.videoId;
  return {
    site: SITE,
    id,
    url: canonicalUrl(id),
    author: details.author || undefined,
    title: details.title || undefined,
    date: Number.isNaN(published) ? undefined : Math.floor(published / 1000),
    caption: details.shortDescription || undefined,
    coverUrl: pickCover(details) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    coverFallbackUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

export const youtubeSource: SocialSource = {
  site: SITE,
  hosts: /(^|\.)youtube\.com$/,
  network: /\/youtubei\/v1\//,

  postId(url) {
    if (url.pathname === '/watch') return url.searchParams.get('v');
    return url.pathname.match(/^\/shorts\/([\w-]+)/)?.[1] ?? null;
  },

  canonicalUrl,

  scanResponse(text) {
    const found = new Map<string, SocialPost>();
    if (!text.includes('videoDetails')) return found;
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^\)\]\}'\n?/, ''));
    } catch {
      return found;
    }
    walkJson(json, (o) => {
      if (!o.videoDetails) return;
      const post = toPost(o);
      if (post) found.set(post.id, post);
      return true;
    });
    return found;
  },

  // ytInitialPlayerResponse keeps the first video after in-app navigation, so the id must match
  scanDocument(_doc, id) {
    const post = toPost((window as any).ytInitialPlayerResponse);
    return post?.id === id ? post : null;
  },
};
