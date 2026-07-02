import { buildNotePayload, buildNoteTemplate } from './manent';
import { getSignerState } from './signer';
import { getWriteRelays } from './relays';
import { publishEvent } from './publish';

export async function saveNote(text: string, sensitive = false): Promise<void> {
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
  if (result.ok.length === 0) throw new Error('No relay accepted the note');
}
