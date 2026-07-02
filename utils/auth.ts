import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';
import { clearWriteRelays } from './relays';

export type SignerType = 'nsec' | 'ncryptsec' | 'nip07';

export interface Account {
  pubkey: string;
  signerType: SignerType;
  nsec?: string;
  ncryptsec?: string;
}

const ACCOUNT_KEY = 'account';
const SESSION_PRIVKEY = 'privkey';

export async function getAccount(): Promise<Account | null> {
  const stored = await browser.storage.local.get(ACCOUNT_KEY);
  return (stored[ACCOUNT_KEY] as Account | undefined) ?? null;
}

export async function setAccount(account: Account): Promise<void> {
  await browser.storage.local.set({ [ACCOUNT_KEY]: account });
}

export async function getSessionPrivkey(): Promise<Uint8Array | null> {
  const stored = await browser.storage.session.get(SESSION_PRIVKEY);
  const hex = stored[SESSION_PRIVKEY] as string | undefined;
  return hex ? hexToBytes(hex) : null;
}

async function setSessionPrivkey(sk: Uint8Array): Promise<void> {
  await browser.storage.session.set({ [SESSION_PRIVKEY]: bytesToHex(sk) });
}

function decodeKeyInput(input: string): Uint8Array {
  if (input.startsWith('nsec1')) {
    const decoded = nip19.decode(input);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    return decoded.data;
  }
  if (/^[0-9a-f]{64}$/i.test(input)) return hexToBytes(input.toLowerCase());
  throw new Error('Invalid key: expected nsec, 64-char hex or ncryptsec');
}

// With a password the key is stored as NIP-49 ncryptsec, otherwise as plain nsec
export async function loginWithKey(input: string, password: string): Promise<Account> {
  input = input.trim();
  password = password.trim();

  let account: Account;
  let sk: Uint8Array;

  if (input.startsWith('ncryptsec1')) {
    if (!password) throw new Error('Password required to decrypt ncryptsec');
    sk = nip49.decrypt(input, password);
    account = { pubkey: getPublicKey(sk), signerType: 'ncryptsec', ncryptsec: input };
  } else {
    sk = decodeKeyInput(input);
    const pubkey = getPublicKey(sk);
    if (password) {
      account = { pubkey, signerType: 'ncryptsec', ncryptsec: nip49.encrypt(sk, password) };
    } else {
      account = { pubkey, signerType: 'nsec', nsec: nip19.nsecEncode(sk) };
    }
  }

  await setAccount(account);
  await setSessionPrivkey(sk);
  return account;
}

export async function unlock(password: string): Promise<void> {
  const account = await getAccount();
  if (!account?.ncryptsec) throw new Error('No encrypted key stored');
  const sk = nip49.decrypt(account.ncryptsec, password.trim());
  if (getPublicKey(sk) !== account.pubkey) throw new Error('Key mismatch');
  await setSessionPrivkey(sk);
}

export async function logout(): Promise<void> {
  await browser.storage.local.remove(ACCOUNT_KEY);
  await browser.storage.session.remove(SESSION_PRIVKEY);
  await clearWriteRelays();
}

export async function getPrivkey(account: Account): Promise<Uint8Array | null> {
  if (account.signerType === 'nsec' && account.nsec) {
    const decoded = nip19.decode(account.nsec);
    return decoded.type === 'nsec' ? decoded.data : null;
  }
  if (account.signerType === 'ncryptsec') return getSessionPrivkey();
  return null;
}
