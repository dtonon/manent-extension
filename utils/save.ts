import type { Event } from 'nostr-tools/pure';
import {
  buildNotePayload,
  buildNoteTemplate,
  formatPageNote,
  formatCaption,
  formatSelectionNote,
  FILE_NOTE_KIND,
} from './manent';
import { getSignerState } from './signer';
import type { SignerState } from './signer';
import { getWriteRelays } from './relays';
import { publishEvent } from './publish';
import { enqueue } from './queue';
import { encryptFile, bytesToBase64 } from './file-crypto';
import { getBlossomServers, uploadToBlossom } from './blossom';
import { getTagsLine, normalizeTags } from './tags';
import { findSource, socialQuote, socialTags, socialTitle } from './social';
import type { SocialPost } from './social';
import { lookupSocialPost } from './social-lookup';

export type SaveOutcome = 'published' | 'queued';

const INLINE_LIMIT = 32 * 1024;

async function readySigner(): Promise<Extract<SignerState, { status: 'ready' }>> {
  const state = await getSignerState();
  if (state.status === 'none') throw new Error('Not logged in');
  if (state.status === 'locked') throw new Error('Locked, open the popup and enter the password');
  return state;
}

async function publishOrQueue(
  pubkey: string,
  event: Event,
  snippet: string,
  sourceUrl?: string,
): Promise<SaveOutcome> {
  const relays = await getWriteRelays(pubkey);
  const result = await publishEvent(event, relays);
  if (result.ok.length === 0) {
    await enqueue({ event, snippet, url: sourceUrl, ts: Date.now() });
    return 'queued';
  }
  return 'published';
}

export async function saveNote(
  text: string,
  sensitive = false,
  sourceUrl?: string,
  options: { appendTags?: boolean; snippet?: string } = {},
): Promise<SaveOutcome> {
  if (!text.trim()) throw new Error('Nothing to save');
  const state = await readySigner();

  const tags = options.appendTags === false ? '' : await getTagsLine();
  const body = tags ? `${text.trimEnd()}\n\n${tags}` : text;
  const payload = buildNotePayload(body, sensitive);
  const ciphertext = await state.signer.nip44Encrypt(state.account.pubkey, payload);
  const event = await state.signer.signEvent(buildNoteTemplate(ciphertext, Date.now()));

  const snippet = (options.snippet || text).slice(0, 80);
  return publishOrQueue(state.account.pubkey, event, snippet, sourceUrl);
}

export async function saveLink(
  title: string | undefined,
  url: string,
  comment = '',
  sensitive = false,
  tags?: string,
  tabId?: number,
): Promise<SaveOutcome> {
  const post = tabId ? await lookupSocialPost(tabId, url) : null;
  if (post) return saveSocialPost(post, comment, sensitive, tags);
  const text = formatPageNote({ comment, tags: await resolveTags(tags), title, url });
  return saveNote(text, sensitive, url, {
    appendTags: false,
    snippet: comment.trim() || title || url,
  });
}

function filenameFromUrl(url: string, mime: string): string {
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').filter(Boolean).pop();
    if (name && name.includes('.')) return decodeURIComponent(name);
  } catch {}
  const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
  return `image.${ext}`;
}

// NIP-44 caps the plaintext at 65535 bytes, keep the article well under it
const MAX_ARTICLE_BYTES = 55000;

function compactNewlines(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function truncateBytes(text: string, max: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  const cut = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, max));
  return cut.replace(/�+$/, '') + '\n[truncated]';
}

// Tags given for a single save win over the stored default
async function resolveTags(tags?: string): Promise<string> {
  return tags === undefined ? getTagsLine() : normalizeTags(tags);
}

export async function savePage(
  tabId: number,
  comment: string,
  sensitive = false,
  tags?: string,
): Promise<SaveOutcome> {
  await readySigner();

  const tab = await browser.tabs.get(tabId);
  const post = await lookupSocialPost(tabId, tab.url);
  if (post) return saveSocialPost(post, comment, sensitive, tags);

  let [injection] = await browser.scripting.executeScript({
    target: { tabId },
    files: ['/extract.js'],
  });
  let article = injection?.result as { title: string; text: string } | null | undefined;
  if (article === undefined) {
    [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => (window as any).__manentArticle ?? null,
    });
    article = injection?.result as { title: string; text: string } | null;
  }
  if (!article) {
    // Supported sites have no article, a plain link is better than an error
    if (tab.url && findSource(tab.url)) return saveLink(tab.title, tab.url, comment, sensitive, tags);
    throw new Error('No readable article found on this page');
  }

  const title = article.title || tab.title;
  const text = formatPageNote({
    comment,
    tags: await resolveTags(tags),
    title,
    url: tab.url,
    article: truncateBytes(compactNewlines(article.text), MAX_ARTICLE_BYTES),
  });
  return saveNote(text, sensitive, tab.url, {
    appendTags: false,
    snippet: comment.trim() || title || tab.url,
  });
}

export async function saveSelection(
  selection: string,
  title?: string,
  url?: string,
  comment = '',
  sensitive = false,
  tags?: string,
): Promise<SaveOutcome> {
  if (!selection.trim()) throw new Error('Nothing to save');
  const text = formatSelectionNote({
    selection: truncateBytes(compactNewlines(selection), MAX_ARTICLE_BYTES),
    comment,
    tags: await resolveTags(tags),
    title,
    url,
  });
  return saveNote(text, sensitive, url, {
    appendTags: false,
    snippet: comment.trim() || selection.trim(),
  });
}

type ReadySigner = Extract<SignerState, { status: 'ready' }>;

// NIP-44 caps the plaintext at 65535 bytes, the image metadata must stay under it
const MAX_META_BYTES = 65000;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// Downloads, encrypts and stores the image, returns the metadata of the image note
async function buildImageMeta(
  state: ReadySigner,
  srcUrl: string,
  caption: string,
  sensitive: boolean,
): Promise<Record<string, unknown>> {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error('Cannot fetch the image');
  const blob = await res.blob();
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length === 0) throw new Error('Empty image');
  const mime = blob.type || 'application/octet-stream';

  const encrypted = await encryptFile(data);

  const meta: Record<string, unknown> = {
    filename: filenameFromUrl(srcUrl, mime),
    'file-type': mime,
    'encryption-algorithm': 'aes-gcm',
    size: data.length,
    x: encrypted.sha256Hex,
    'decryption-key': encrypted.keyHex,
  };
  try {
    const bitmap = await createImageBitmap(blob);
    meta.dim = `${bitmap.width}x${bitmap.height}`;
    bitmap.close();
  } catch {}
  if (sensitive) meta.sensitive = true;

  if (encrypted.bytes.length < INLINE_LIMIT) {
    meta.data = bytesToBase64(encrypted.bytes);
  } else {
    const servers = await getBlossomServers(state.account.pubkey);
    meta.url = await uploadToBlossom(state.signer, servers, encrypted.bytes, encrypted.sha256Hex);
  }

  if (caption) {
    meta.caption = caption;
    const excess = byteLength(JSON.stringify(meta)) - MAX_META_BYTES;
    // JSON escaping never shrinks text, so cutting the raw caption by the excess is enough
    if (excess > 0) meta.caption = truncateBytes(caption, Math.max(0, byteLength(caption) - excess - 64));
  }
  return meta;
}

async function publishImageMeta(
  state: ReadySigner,
  meta: Record<string, unknown>,
  snippet: string,
  sourceUrl: string,
): Promise<SaveOutcome> {
  const ciphertext = await state.signer.nip44Encrypt(state.account.pubkey, JSON.stringify(meta));
  const event = await state.signer.signEvent(
    buildNoteTemplate(ciphertext, Date.now(), FILE_NOTE_KIND),
  );
  return publishOrQueue(state.account.pubkey, event, snippet, sourceUrl);
}

export async function saveImage(
  srcUrl: string,
  pageTitle?: string,
  pageUrl?: string,
  comment?: string,
  sensitive = false,
  tags?: string,
): Promise<SaveOutcome> {
  const state = await readySigner();
  const caption = formatCaption({
    comment,
    tags: await resolveTags(tags),
    title: pageTitle,
    url: pageUrl,
  });
  const meta = await buildImageMeta(state, srcUrl, caption, sensitive);
  return publishImageMeta(state, meta, `Image: ${meta.filename}`, pageUrl ?? srcUrl);
}

// One image note with the cover, or a text note with the same content when the cover cannot be stored
async function saveSocialPost(
  post: SocialPost,
  comment: string,
  sensitive: boolean,
  tags?: string,
): Promise<SaveOutcome> {
  const state = await readySigner();
  const title = socialTitle(post);
  // Everything from the source is quoted, the user's comment and tags follow
  const text = formatSelectionNote({
    selection: truncateBytes(socialQuote(post), MAX_ARTICLE_BYTES),
    comment,
    tags: tags === undefined ? socialTags(post) : normalizeTags(tags),
  });
  const snippet = comment.trim() || title;

  for (const cover of [post.coverUrl, ...(post.coverFallbacks ?? [])]) {
    if (!cover) continue;
    let meta: Record<string, unknown> | null = null;
    try {
      meta = await buildImageMeta(state, cover, text, sensitive);
    } catch (e) {
      console.warn('Manent: cannot store the cover', cover, e);
    }
    if (meta) return publishImageMeta(state, meta, snippet, post.url);
  }
  return saveNote(text, sensitive, post.url, { appendTags: false, snippet });
}
