import type { Event, EventTemplate } from 'nostr-tools/pure';
import { setAccount } from './auth';
import type { Account } from './auth';
import type { Signer } from './signer';

type BridgeResponse = { result?: unknown; error?: string };

const ERRORS: Record<string, string> = {
  'no-signer': 'No NIP-07 signer found on this page',
  'no-nip44': 'The signer does not support NIP-44',
};

async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

// Runs in the page main world where the signer injects window.nostr
async function bridge(op: string, args: unknown[]): Promise<BridgeResponse> {
  const nostr = (window as any).nostr;
  if (!nostr) return { error: 'no-signer' };
  try {
    switch (op) {
      case 'check':
        return {
          result: { pubkey: await nostr.getPublicKey(), hasNip44: !!nostr.nip44?.encrypt },
        };
      case 'getPublicKey':
        return { result: await nostr.getPublicKey() };
      case 'nip44Encrypt':
        if (!nostr.nip44?.encrypt) return { error: 'no-nip44' };
        return { result: await nostr.nip44.encrypt(args[0], args[1]) };
      case 'signEvent':
        return { result: await nostr.signEvent(args[0]) };
      default:
        return { error: 'Unknown operation' };
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

async function callNip07<T>(op: string, args: unknown[] = []): Promise<T> {
  const tabId = await getActiveTabId();
  let injected;
  try {
    [injected] = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: bridge,
      args: [op, args],
    });
  } catch {
    throw new Error('Cannot reach the signer on this page, open a regular website tab');
  }
  const response = injected?.result as BridgeResponse | undefined;
  if (!response) throw new Error('No response from the page');
  if (response.error) throw new Error(ERRORS[response.error] ?? response.error);
  return response.result as T;
}

export class Nip07Signer implements Signer {
  async getPublicKey(): Promise<string> {
    return callNip07<string>('getPublicKey');
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return callNip07<string>('nip44Encrypt', [peerPubkey, plaintext]);
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return callNip07<Event>('signEvent', [template]);
  }
}

export async function loginWithNip07(): Promise<Account> {
  const check = await callNip07<{ pubkey: string; hasNip44: boolean }>('check');
  if (!check.hasNip44) throw new Error(ERRORS['no-nip44']);
  const account: Account = { pubkey: check.pubkey, signerType: 'nip07' };
  await setAccount(account);
  return account;
}
