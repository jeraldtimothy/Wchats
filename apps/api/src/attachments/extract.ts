import { unzipSync, type Unzipped } from 'fflate';

export const MAX_EXTRACTED_CHARS = 200_000;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class ExtractionError extends Error {}

export interface Extracted {
  text: string;
  truncated: boolean;
}

/** Collects text up to the character limit, then stops accepting more. */
class TextSink {
  private parts: string[] = [];
  private length = 0;
  truncated = false;

  push(s: string): void {
    if (this.truncated) return;
    if (this.length + s.length > MAX_EXTRACTED_CHARS) {
      this.parts.push(s.slice(0, MAX_EXTRACTED_CHARS - this.length));
      this.length = MAX_EXTRACTED_CHARS;
      this.truncated = true;
      return;
    }
    this.parts.push(s);
    this.length += s.length;
  }

  get full(): boolean {
    return this.truncated;
  }

  result(): Extracted {
    const text = this.parts.join('').trim();
    return {
      text: this.truncated ? `${text}\n\n[Truncated: the file is longer than ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} characters.]` : text,
      truncated: this.truncated,
    };
  }
}

const decoder = new TextDecoder('utf-8');

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

type Token = { tag: string; close: boolean; selfClose: boolean; attrs: string } | { text: string };

/** Minimal XML tokenizer: tags and text nodes (enough for OOXML text runs). */
function* tokens(xml: string): Generator<Token> {
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|<[!?][^>]*>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[5] !== undefined) yield { text: m[5] };
    else if (m[2]) yield { tag: m[2], close: m[1] === '/', selfClose: m[4] === '/', attrs: m[3] ?? '' };
  }
}

const attr = (attrs: string, name: string) =>
  new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`).exec(attrs)?.[1];

/** Unzips only the entries `want` accepts, enforcing declared-size limits before inflating. */
function unzip(buf: Uint8Array, want: (name: string) => boolean): Unzipped {
  let total = 0;
  try {
    return unzipSync(buf, {
      filter: (f) => {
        if (!want(f.name)) return false;
        if (f.originalSize > MAX_ENTRY_BYTES) throw new ExtractionError('This file is too large to read.');
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new ExtractionError('This file is too large to read.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError('This file could not be read. Is it a valid Office document?');
  }
}

const xmlOf = (files: Unzipped, name: string) => {
  const f = files[name];
  return f ? decoder.decode(f) : undefined;
};

/** Relationship id → target path, resolved against `baseDir`. */
function relationships(xml: string | undefined, baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tokens(xml ?? '')) {
    if ('tag' in t && t.tag === 'Relationship') {
      const id = attr(t.attrs, 'Id');
      const target = attr(t.attrs, 'Target');
      if (id && target) map.set(id, target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`);
    }
  }
  return map;
}

export function extractDocx(buf: Uint8Array): Extracted {
  const files = unzip(buf, (n) => n === 'word/document.xml');
  const xml = xmlOf(files, 'word/document.xml');
  if (!xml) throw new ExtractionError('This Word document has no content.');
  const out = new TextSink();
  let para = '';
  let inText = false;
  let cells: string[] | null = null;
  let cellDepth = 0;
  let cell = '';
  for (const t of tokens(xml)) {
    if (out.full) break;
    if ('text' in t) {
      if (inText) para += decodeEntities(t.text);
      continue;
    }
    switch (t.tag) {
      case 'w:t':
        inText = !t.close && !t.selfClose;
        break;
      case 'w:tab':
        if (!t.close) para += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (!t.close) para += '\n';
        break;
      case 'w:p':
        if (t.close || t.selfClose) {
          if (cellDepth > 0) cell += (cell ? ' ' : '') + para.trim();
          else out.push(`${para}\n`);
          para = '';
        }
        break;
      case 'w:tr':
        if (!t.close) cells = [];
        else if (cells) {
          out.push(`${cells.join('\t')}\n`);
          cells = null;
        }
        break;
      case 'w:tc':
        if (!t.close) {
          cellDepth += 1;
          cell = '';
        } else {
          cellDepth = Math.max(0, cellDepth - 1);
          cells?.push(cell);
        }
        break;
    }
  }
  return out.result();
}

function columnIndex(ref: string | undefined): number {
  const letters = /^[A-Z]+/.exec(ref ?? '')?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

export function extractXlsx(buf: Uint8Array): Extracted {
  const files = unzip(
    buf,
    (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );

  const shared: string[] = [];
  let si: string | null = null;
  let inT = false;
  for (const t of tokens(xmlOf(files, 'xl/sharedStrings.xml') ?? '')) {
    if ('text' in t) {
      if (si !== null && inT) si += decodeEntities(t.text);
    } else if (t.tag === 'si') {
      if (!t.close) si = '';
      else {
        shared.push(si ?? '');
        si = null;
      }
    } else if (t.tag === 't') inT = !t.close && !t.selfClose;
  }

  const rels = relationships(xmlOf(files, 'xl/_rels/workbook.xml.rels'), 'xl/');
  const sheets: { name: string; path: string }[] = [];
  for (const t of tokens(xmlOf(files, 'xl/workbook.xml') ?? '')) {
    if ('tag' in t && t.tag === 'sheet') {
      const path = rels.get(attr(t.attrs, 'r:id') ?? '');
      if (path) sheets.push({ name: decodeEntities(attr(t.attrs, 'name') ?? 'Sheet'), path });
    }
  }
  if (sheets.length === 0) throw new ExtractionError('This spreadsheet has no sheets.');

  const out = new TextSink();
  for (const sheet of sheets) {
    if (out.full) break;
    out.push(`## Sheet: ${sheet.name}\n`);
    let row: string[] | null = null;
    let col = 0;
    let type = '';
    let value = '';
    let capture = false;
    for (const t of tokens(xmlOf(files, sheet.path) ?? '')) {
      if (out.full) break;
      if ('text' in t) {
        if (capture) value += decodeEntities(t.text);
        continue;
      }
      if (t.tag === 'row') {
        if (!t.close && !t.selfClose) row = [];
        else if (row) {
          while (row.length && !row.at(-1)) row.pop();
          if (row.length) out.push(`${row.join('\t')}\n`);
          row = null;
        }
      } else if (t.tag === 'c') {
        if (!t.close) {
          col = columnIndex(attr(t.attrs, 'r'));
          type = attr(t.attrs, 't') ?? 'n';
          value = '';
        }
        if ((t.close || t.selfClose) && row) {
          const text = type === 's' ? (shared[Number(value)] ?? '') : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
          while (row.length < col) row.push('');
          row[col] = text.replace(/[\t\n]+/g, ' ');
        }
      } else if (t.tag === 'v' || t.tag === 't') {
        capture = !t.close && !t.selfClose;
      }
    }
    out.push('\n');
  }
  return out.result();
}

export function extractPptx(buf: Uint8Array): Extracted {
  const files = unzip(
    buf,
    (n) => n === 'ppt/presentation.xml' || n === 'ppt/_rels/presentation.xml.rels' || /^ppt\/slides\/slide\d+\.xml$/.test(n),
  );
  const rels = relationships(xmlOf(files, 'ppt/_rels/presentation.xml.rels'), 'ppt/');
  let order: string[] = [];
  for (const t of tokens(xmlOf(files, 'ppt/presentation.xml') ?? '')) {
    if ('tag' in t && t.tag === 'p:sldId') {
      const path = rels.get(attr(t.attrs, 'r:id') ?? '');
      if (path && files[path]) order.push(path);
    }
  }
  if (order.length === 0) {
    order = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  if (order.length === 0) throw new ExtractionError('This presentation has no slides.');

  const out = new TextSink();
  order.forEach((path, i) => {
    if (out.full) return;
    out.push(`## Slide ${i + 1}\n`);
    let para = '';
    let inText = false;
    for (const t of tokens(xmlOf(files, path) ?? '')) {
      if ('text' in t) {
        if (inText) para += decodeEntities(t.text);
      } else if (t.tag === 'a:t') inText = !t.close && !t.selfClose;
      else if (t.tag === 'a:br' && !t.close) para += '\n';
      else if (t.tag === 'a:p' && (t.close || t.selfClose)) {
        if (para.trim()) out.push(`${para}\n`);
        para = '';
      }
    }
    out.push('\n');
  });
  return out.result();
}

export function extractPlain(buf: Uint8Array): Extracted {
  const out = new TextSink();
  out.push(decoder.decode(buf).replace(/^\uFEFF/, ''));
  return out.result();
}

export function extractText(source: 'plain' | 'docx' | 'xlsx' | 'pptx', buf: Uint8Array): Extracted {
  switch (source) {
    case 'docx':
      return extractDocx(buf);
    case 'xlsx':
      return extractXlsx(buf);
    case 'pptx':
      return extractPptx(buf);
    case 'plain':
      return extractPlain(buf);
  }
}
