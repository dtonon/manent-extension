import { bytesToHex } from '@noble/hashes/utils.js';

export interface EncryptedFile {
  bytes: Uint8Array;
  keyHex: string;
  sha256Hex: string;
}

// Wire format used by Manent: nonce[12] || ciphertext || mac[16]
export async function encryptFile(data: Uint8Array<ArrayBuffer>): Promise<EncryptedFile> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data),
  );
  const bytes = new Uint8Array(nonce.length + encrypted.length);
  bytes.set(nonce);
  bytes.set(encrypted, nonce.length);
  const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { bytes, keyHex: bytesToHex(keyBytes), sha256Hex: bytesToHex(sha) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
