import type { EventTemplate } from 'nostr-tools/pure';

export const TEXT_NOTE_KIND = 33301;

// Hex ms timestamp plus 6 random hex chars, Manent parses it back as creation time
export function generateNoteId(nowMs: number): string {
  const rand = crypto.getRandomValues(new Uint8Array(3));
  const randHex = Array.from(rand)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return nowMs.toString(16) + randHex;
}

export function buildNotePayload(text: string, sensitive = false): string {
  return JSON.stringify(sensitive ? { text, sensitive: true } : { text });
}

export function buildNoteTemplate(ciphertext: string, nowMs: number): EventTemplate {
  return {
    kind: TEXT_NOTE_KIND,
    created_at: Math.floor(nowMs / 1000),
    tags: [['d', generateNoteId(nowMs)]],
    content: ciphertext,
  };
}

export function formatCapture(parts: {
  comment?: string;
  selection?: string;
  title?: string;
  url?: string;
}): string {
  const blocks: string[] = [];
  if (parts.comment?.trim()) blocks.push(parts.comment.trim());
  if (parts.selection?.trim()) blocks.push(parts.selection.trim());
  const source = [parts.title, parts.url].filter(Boolean).join('\n');
  if (source) blocks.push(source);
  return blocks.join('\n\n');
}
