import type { SocialPost, SocialSource } from './social';
import { containsValue, walkJson } from './social-json';

const SITE = 'Facebook';

function canonicalUrl(id: string): string {
  return `https://www.facebook.com/reel/${id}`;
}

function isPost(o: any): boolean {
  return typeof o?.message?.text === 'string' && typeof o.creation_time === 'number' && o.attachments;
}

// The post data has no thumbnail, the cover is the poster of the video in view
function toPost(o: any, id: string): SocialPost {
  return {
    site: SITE,
    kind: 'video',
    id,
    url: canonicalUrl(id),
    authorName: o.actors?.[0]?.name,
    date: o.creation_time,
    caption: o.message.text,
  };
}

export const facebookSource: SocialSource = {
  site: SITE,
  hosts: /(^|\.)facebook\.com$/,
  network: /\/api\/graphql\/?(\?|$)/,

  postId(url) {
    return url.pathname.match(/^\/reel\/(\d+)/)?.[1] ?? null;
  },


  scanResponse(text) {
    const found = new Map<string, SocialPost>();
    if (!text.includes('creation_time')) return found;
    for (const line of text.replace(/^for \(;;\);/, '').split('\n')) {
      if (!line.includes('creation_time')) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      walkJson(json, (o) => {
        if (!isPost(o)) return;
        const ids = new Set(
          [...JSON.stringify(o.attachments).matchAll(/"id":"(\d{10,})"/g)].map((m) => m[1]),
        );
        for (const id of ids) found.set(id, toPost(o, id));
        return true;
      });
    }
    return found;
  },

  scanDocument(doc, id) {
    for (const script of doc.querySelectorAll('script[type="application/json"]')) {
      const text = script.textContent ?? '';
      if (!text.includes(id) || !text.includes('creation_time')) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      let post: SocialPost | null = null;
      walkJson(json, (o) => {
        if (post) return true;
        if (isPost(o) && containsValue(o, id)) {
          post = toPost(o, id);
          return true;
        }
      });
      if (post) return post;
    }
    return null;
  },
};
