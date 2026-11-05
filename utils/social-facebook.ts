import type { SocialPost, SocialSource } from './social';
import { containsValue, walkJson } from './social-json';

const SITE = 'Facebook';
// Photos have their own key, the attachments of a post can carry the same id
const PHOTO = 'photo:';

function canonicalUrl(key: string): string {
  return key.startsWith(PHOTO)
    ? `https://www.facebook.com/photo/?fbid=${key.slice(PHOTO.length)}`
    : `https://www.facebook.com/reel/${key}`;
}

function isPost(o: any): boolean {
  return typeof o?.message?.text === 'string' && typeof o.creation_time === 'number' && o.attachments;
}

// Media opened in the photo viewer, as data.currMedia
function isPhoto(o: any): boolean {
  return o?.__typename === 'Photo' && typeof o.id === 'string' && typeof o.image?.uri === 'string';
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

function toPhoto(o: any): SocialPost {
  const story = o.creation_story ?? o.container_story;
  const key = PHOTO + o.id;
  return {
    site: SITE,
    kind: 'image',
    id: key,
    url: canonicalUrl(key),
    authorName: story?.actors?.[0]?.name ?? o.owner?.name,
    date: typeof o.created_time === 'number' ? o.created_time : undefined,
    caption: story?.message?.text ?? o.container_story?.message?.text,
    coverUrl: o.image.uri,
  };
}

function hasPostData(text: string): boolean {
  return text.includes('creation_time') || text.includes('"Photo"');
}

function collect(json: unknown, into: Map<string, SocialPost>) {
  walkJson(json, (o) => {
    if (isPhoto(o)) {
      const post = toPhoto(o);
      into.set(post.id, post);
      return true;
    }
    if (!isPost(o)) return;
    const ids = new Set(
      [...JSON.stringify(o.attachments).matchAll(/"id":"(\d{10,})"/g)].map((m) => m[1]),
    );
    for (const id of ids) into.set(id, toPost(o, id));
    return true;
  });
}

export const facebookSource: SocialSource = {
  site: SITE,
  hosts: /(^|\.)facebook\.com$/,
  network: /\/api\/graphql\/?(\?|$)/,

  postId(url) {
    const reel = url.pathname.match(/^\/reel\/(\d+)/)?.[1];
    if (reel) return reel;
    const fbid =
      /^\/photo(\.php)?\/?$/.test(url.pathname) ? url.searchParams.get('fbid') : null;
    const photo = fbid ?? url.pathname.match(/\/photos\/[^/]+\/(\d+)\/?$/)?.[1];
    return photo ? PHOTO + photo : null;
  },

  scanResponse(text) {
    const found = new Map<string, SocialPost>();
    if (!hasPostData(text)) return found;
    for (const line of text.replace(/^for \(;;\);/, '').split('\n')) {
      if (!hasPostData(line)) continue;
      try {
        collect(JSON.parse(line), found);
      } catch {}
    }
    return found;
  },

  scanDocument(doc, key) {
    const photo = key.startsWith(PHOTO);
    const id = photo ? key.slice(PHOTO.length) : key;
    for (const script of doc.querySelectorAll('script[type="application/json"]')) {
      const text = script.textContent ?? '';
      if (!text.includes(id) || !hasPostData(text)) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      let post: SocialPost | null = null;
      walkJson(json, (o) => {
        if (post) return true;
        if (photo ? isPhoto(o) && o.id === id : isPost(o) && containsValue(o, id)) {
          post = photo ? toPhoto(o) : toPost(o, id);
          return true;
        }
      });
      if (post) return post;
    }
    return null;
  },
};
