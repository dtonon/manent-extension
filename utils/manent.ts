import type { EventTemplate } from 'nostr-tools/pure';

export const TEXT_NOTE_KIND = 33301;
export const FILE_NOTE_KIND = 33302;

export const MANENT_URL = 'https://manent.dtonon.com';

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

export function buildNoteTemplate(
  ciphertext: string,
  nowMs: number,
  kind = TEXT_NOTE_KIND,
): EventTemplate {
  return {
    kind,
    created_at: Math.floor(nowMs / 1000),
    tags: [['d', generateNoteId(nowMs)]],
    content: ciphertext,
  };
}

// Popup saves, in the same order as the popup preview card
export function formatPageNote(parts: {
  comment?: string;
  tags?: string;
  title?: string;
  url?: string;
  article?: string;
}): string {
  const source = [parts.title, parts.url].filter(Boolean).join('\n');
  return [parts.comment?.trim(), parts.tags, source, parts.article?.trim()]
    .filter(Boolean)
    .join('\n\n');
}

// Selection saves: quoted highlight, then comment with tags, then the source
export function formatSelectionNote(parts: {
  selection: string;
  comment?: string;
  tags?: string;
  title?: string;
  url?: string;
}): string {
  const quote = parts.selection
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line.trimEnd()}` : '>'))
    .join('\n');
  return [quote, formatCaption(parts)].filter(Boolean).join('\n\n');
}

// Comment and tags on consecutive lines, then the source
export function formatCaption(parts: {
  comment?: string;
  tags?: string;
  title?: string;
  url?: string;
}): string {
  const note = [parts.comment?.trim(), parts.tags].filter(Boolean).join('\n');
  const source = [parts.title, parts.url].filter(Boolean).join('\n');
  return [note, source].filter(Boolean).join('\n\n');
}
