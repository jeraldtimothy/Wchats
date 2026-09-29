import {
  IMAGE_EXTENSIONS,
  OFFICE_EXTENSIONS,
  TEXT_EXTENSIONS,
  extensionOf,
  type AttachmentKind,
} from '@wchats/shared';

export interface Sniffed {
  kind: AttachmentKind;
  mimeType: string;
  /** How text is obtained for kind 'text'. */
  source?: 'plain' | 'docx' | 'xlsx' | 'pptx';
}

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function imageType(buf: Uint8Array): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

const OFFICE_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const TEXT_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
};

/**
 * Identifies an upload from its bytes and extension. The extension picks the
 * expected format; the bytes must match it. Returns null when unsupported
 * or when the content doesn't match the extension.
 */
export function sniff(buf: Uint8Array, filename: string): Sniffed | null {
  const ext = extensionOf(filename);
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    const mime = imageType(buf);
    return mime ? { kind: 'image', mimeType: mime } : null;
  }
  if (ext === '.pdf') {
    return startsWith(buf, ascii('%PDF-')) ? { kind: 'pdf', mimeType: 'application/pdf' } : null;
  }
  if ((OFFICE_EXTENSIONS as readonly string[]).includes(ext)) {
    return startsWith(buf, [0x50, 0x4b, 0x03, 0x04])
      ? { kind: 'text', mimeType: OFFICE_MIME[ext]!, source: ext.slice(1) as 'docx' | 'xlsx' | 'pptx' }
      : null;
  }
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) {
    if (buf.includes(0)) return null;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return null;
    }
    return { kind: 'text', mimeType: TEXT_MIME[ext]!, source: 'plain' };
  }
  return null;
}
