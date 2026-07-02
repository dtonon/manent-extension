import { buildNotePayload, buildNoteTemplate } from './manent';
import { getSignerState } from './signer';
import { getWriteRelays } from './relays';
import { publishEvent } from './publish';
import { addRecentSave } from './history';
import { enqueue } from './queue';

export type SaveOutcome = 'published' | 'queued';

export async function saveNote(
  text: string,
  sensitive = false,
  sourceUrl?: string,
): Promise<SaveOutcome> {
  if (!text.trim()) throw new Error('Nothing to save');
  const state = await getSignerState();
  if (state.status === 'none') throw new Error('Not logged in');
  if (state.status === 'locked') throw new Error('Locked, open the popup and enter the password');

  const payload = buildNotePayload(text, sensitive);
  const ciphertext = await state.signer.nip44Encrypt(state.account.pubkey, payload);
  const template = buildNoteTemplate(ciphertext, Date.now());
  const event = await state.signer.signEvent(template);

  const relays = await getWriteRelays(state.account.pubkey);
  const result = await publishEvent(event, relays);
  const snippet = text.slice(0, 80);

  if (result.ok.length === 0) {
    await enqueue({ event, snippet, url: sourceUrl, ts: Date.now() });
    return 'queued';
  }
  await addRecentSave({ snippet, url: sourceUrl, ts: Date.now() });
  return 'published';
}
