import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { Event, EventTemplate } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { getAccount, getPrivkey } from './auth';
import type { Account } from './auth';

export interface Signer {
  getPublicKey(): Promise<string>;
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  signEvent(template: EventTemplate): Promise<Event>;
}

export class LocalSigner implements Signer {
  constructor(private sk: Uint8Array) {}

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.sk);
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.sk, peerPubkey);
    return nip44.v2.encrypt(plaintext, key);
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return finalizeEvent(template, this.sk);
  }
}

export type SignerState =
  | { status: 'none' }
  | { status: 'locked'; account: Account }
  | { status: 'ready'; account: Account; signer: Signer };

export async function getSignerState(): Promise<SignerState> {
  const account = await getAccount();
  if (!account) return { status: 'none' };
  if (account.signerType === 'nsec' || account.signerType === 'ncryptsec') {
    const sk = await getPrivkey(account);
    if (!sk) return { status: 'locked', account };
    return { status: 'ready', account, signer: new LocalSigner(sk) };
  }
  return { status: 'none' };
}
