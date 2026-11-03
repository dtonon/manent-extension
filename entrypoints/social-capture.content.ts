import { SOCIAL_MATCHES, SOCIAL_SOURCES } from '@/utils/social';
import type { SocialPost } from '@/utils/social';

const MAX_POSTS = 200;

// Runs in the page before its own code, to see the post data the site downloads while scrolling.
// Captured posts stay in page memory and are read only when the user saves.
export default defineContentScript({
  matches: SOCIAL_MATCHES,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const source = SOCIAL_SOURCES.find((s) => s.hosts.test(location.hostname));
    if (!source) return;
    const posts = new Map<string, SocialPost>();

    const ingest = (text: string) => {
      let found: Map<string, SocialPost>;
      try {
        found = source.scanResponse(text);
      } catch {
        return;
      }
      for (const [id, post] of found) {
        posts.delete(id);
        posts.set(id, post);
      }
      while (posts.size > MAX_POSTS) posts.delete(posts.keys().next().value!);
    };

    const originalFetch = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const pending = originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (source.network.test(url)) {
          pending
            .then((r) => r.clone().text())
            .then(ingest)
            .catch(() => {});
        }
      } catch {}
      return pending;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
      try {
        if (source.network.test(String(args[1]))) {
          this.addEventListener('load', () => {
            try {
              if (this.responseType === '' || this.responseType === 'text') ingest(this.responseText);
            } catch {}
          });
        }
      } catch {}
      return (originalOpen as any).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;

    const visiblePoster = (): string | undefined => {
      let best: string | undefined;
      let bestArea = 0;
      for (const video of document.querySelectorAll('video')) {
        if (!video.poster.startsWith('http')) continue;
        const r = video.getBoundingClientRect();
        const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
        const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
        const area = Math.max(0, w) * Math.max(0, h);
        if (area > bestArea) {
          best = video.poster;
          bestArea = area;
        }
      }
      return best;
    };

    Object.defineProperty(window, '__manentSocial', {
      value: {
        lookup(href: string): SocialPost | null {
          const id = source.postId(new URL(href));
          if (!id) return null;
          const post = posts.get(id) ?? source.scanDocument?.(document, id) ?? null;
          if (!post) return null;
          return {
            ...post,
            url: source.canonicalUrl(id, new URL(href)),
            coverUrl: post.coverUrl ?? visiblePoster(),
          };
        },
      },
    });
  },
});
