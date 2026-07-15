import type { Event } from 'nostr-tools/pure';
import { buildNotePayload, buildNoteTemplate, formatCapture, FILE_NOTE_KIND } from './manent';
import { getSignerState } from './signer';
import type { SignerState } from './signer';
import { getWriteRelays } from './relays';
import { publishEvent } from './publish';
import { addRecentSave } from './history';
import { enqueue } from './queue';
import { encryptFile, bytesToBase64 } from './file-crypto';
import { getBlossomServers, uploadToBlossom } from './blossom';

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
  await addRecentSave({ snippet, url: sourceUrl, ts: Date.now() });
  return 'published';
}

export async function saveNote(
  text: string,
  sensitive = false,
  sourceUrl?: string,
): Promise<SaveOutcome> {
  if (!text.trim()) throw new Error('Nothing to save');
  const state = await readySigner();

  const payload = buildNotePayload(text, sensitive);
  const ciphertext = await state.signer.nip44Encrypt(state.account.pubkey, payload);
  const event = await state.signer.signEvent(buildNoteTemplate(ciphertext, Date.now()));

  return publishOrQueue(state.account.pubkey, event, text.slice(0, 80), sourceUrl);
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

export async function saveImage(
  srcUrl: string,
  pageTitle?: string,
  pageUrl?: string,
): Promise<SaveOutcome> {
  const state = await readySigner();

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
  const caption = formatCapture({ title: pageTitle, url: pageUrl });
  if (caption) meta.caption = caption;

  if (encrypted.bytes.length < INLINE_LIMIT) {
    meta.data = bytesToBase64(encrypted.bytes);
  } else {
    const servers = await getBlossomServers(state.account.pubkey);
    meta.url = await uploadToBlossom(state.signer, servers, encrypted.bytes, encrypted.sha256Hex);
  }

  const ciphertext = await state.signer.nip44Encrypt(state.account.pubkey, JSON.stringify(meta));
  const event = await state.signer.signEvent(
    buildNoteTemplate(ciphertext, Date.now(), FILE_NOTE_KIND),
  );

  return publishOrQueue(state.account.pubkey, event, `Image: ${meta.filename}`, pageUrl ?? srcUrl);
}
