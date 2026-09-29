import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExtractionError, MAX_EXTRACTED_CHARS, extractDocx, extractPlain, extractPptx, extractXlsx } from '../src/attachments/extract.js';
import { cleanupUnsent } from '../src/attachments/service.js';
import { sniff } from '../src/attachments/sniff.js';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { attachments } from '../src/db/schema.js';
import { PDF, PNG, docx, para, pptx, xlsx } from './office-fixtures.js';
import { fakeRegistry } from './fakes.js';
import { signUp } from './helpers.js';

describe('sniff', () => {
  it('accepts matching bytes and extensions', () => {
    expect(sniff(PNG, 'a.PNG')).toEqual({ kind: 'image', mimeType: 'image/png' });
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.jpeg')?.mimeType).toBe('image/jpeg');
    expect(sniff(Buffer.from('GIF89a....'), 'a.gif')?.mimeType).toBe('image/gif');
    expect(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'a.webp')?.mimeType).toBe('image/webp');
    expect(sniff(PDF, 'r.pdf')).toEqual({ kind: 'pdf', mimeType: 'application/pdf' });
    expect(sniff(docx(para('x')), 'r.docx')).toMatchObject({ kind: 'text', source: 'docx' });
    expect(sniff(Buffer.from('a,b\n1,2'), 'd.csv')).toMatchObject({ kind: 'text', source: 'plain', mimeType: 'text/csv' });
  });

  it('rejects mismatched, binary and unknown files', () => {
    expect(sniff(PDF, 'fake.png')).toBeNull();
    expect(sniff(PNG, 'fake.pdf')).toBeNull();
    expect(sniff(Buffer.from('not a zip'), 'x.docx')).toBeNull();
    expect(sniff(Buffer.from([0x61, 0x00, 0x62]), 'x.txt')).toBeNull();
    expect(sniff(Buffer.from([0xc3, 0x28]), 'x.md')).toBeNull();
    expect(sniff(PNG, 'x.exe')).toBeNull();
    expect(sniff(PNG, 'noext')).toBeNull();
  });
});

describe('extract', () => {
  it('reads docx paragraphs, tabs, breaks, tables and entities', () => {
    const body =
      para('Hello ', 'world &amp; friends') +
      '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc>' + para('Name') + '</w:tc><w:tc>' + para('Qty') + '</w:tc></w:tr>' +
      '<w:tr><w:tc>' + para('Apples') + '</w:tc><w:tc>' + para('3') + '</w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>';
    expect(extractDocx(docx(body)).text).toBe('Hello world & friends\na\tb\nc\nName\tQty\nApples\t3');
  });

  it('reads xlsx sheets in workbook order with shared, inline, numeric and boolean cells', () => {
    expect(extractXlsx(xlsx()).text).toBe(
      '## Sheet: Budget & Plan\nItem\tCost\nCoffee beans\t12.5\t\tTRUE\nTea <green>\n\n## Sheet: Empty',
    );
  });

  it('reads pptx slides in presentation order', () => {
    expect(extractPptx(pptx()).text).toBe('## Slide 1\nTitle slide\n\n## Slide 2\nSecond slide\nDetails');
  });

  it('truncates long text with a note', () => {
    const r = extractPlain(Buffer.from('﻿' + 'x'.repeat(MAX_EXTRACTED_CHARS + 10)));
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('xxx')).toBe(true);
    expect(r.text).toContain('[Truncated: the file is longer than 200,000 characters.]');
  });

  it('refuses entries that declare a huge uncompressed size', () => {
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(51 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => extractDocx(bomb)).toThrow(ExtractionError);
  });

  it('does not inflate past a falsely small declared size', () => {
    const real = zipSync({ 'word/document.xml': new Uint8Array(4 * 1024 * 1024) }, { level: 9 });
    // Rewrite the declared uncompressed size (local header offset 22, central directory offset 24) to 10 bytes.
    const lying = Buffer.from(real);
    lying.writeUInt32LE(10, 22);
    const cd = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(10, cd + 24);
    let out: string | null = null;
    try {
      out = extractDocx(lying).text;
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionError);
    }
    if (out !== null) expect(out.length).toBeLessThanOrEqual(10);
  });

  it('reports corrupt archives as extraction errors', () => {
    expect(() => extractXlsx(Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(200)]))).toThrow(ExtractionError);
    expect(() => extractDocx(zipSync({ 'other.xml': strToU8('<x/>') }))).toThrow('no content');
  });
});

function multipart(filename: string, data: Buffer) {
  const boundary = '----wchatsTestBoundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('upload routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ providers: fakeRegistry().registry });
  });
  afterAll(async () => {
    await app.close();
  });

  const upload = (cookie: string, filename: string, data: Buffer) => {
    const m = multipart(filename, data);
    return app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie } });
  };

  it('stores an image and serves it only to its owner', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const res = await upload(a.cookie, 'dir/../photo.png', PNG);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({ kind: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: PNG.length, truncated: false });

    const content = await app.inject({ method: 'GET', url: `/api/uploads/${dto.id}/content`, headers: { cookie: a.cookie } });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.rawPayload.equals(PNG)).toBe(true);

    const other = await app.inject({ method: 'GET', url: `/api/uploads/${dto.id}/content`, headers: { cookie: b.cookie } });
    expect(other.statusCode).toBe(404);
  });

  it('extracts office text on upload', async () => {
    const u = await signUp(app);
    const res = await upload(u.cookie, 'notes.docx', Buffer.from(docx(para('Quarterly notes'))));
    expect(res.statusCode).toBe(201);
    const row = await db.query.attachments.findFirst({ where: eq(attachments.id, res.json().id) });
    expect(row).toMatchObject({ kind: 'text', extractedText: 'Quarterly notes' });
  });

  it('rejects spoofed, empty, oversized and unreadable files', async () => {
    const u = await signUp(app);
    expect((await upload(u.cookie, 'evil.png', PDF)).statusCode).toBe(415);
    expect((await upload(u.cookie, 'empty.txt', Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload(u.cookie, 'big.txt', Buffer.alloc(21 * 1024 * 1024, 0x61))).statusCode).toBe(413);
    expect((await upload(u.cookie, 'broken.xlsx', Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(64)]))).statusCode).toBe(422);
    const anon = await app.inject({ method: 'POST', url: '/api/uploads', ...multipart('a.txt', Buffer.from('x')) });
    expect(anon.statusCode).toBe(401);
  });

  it('deletes unsent uploads and cleans up stale ones', async () => {
    const u = await signUp(app);
    const one = (await upload(u.cookie, 'a.txt', Buffer.from('one'))).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/uploads/${one.id}`, headers: { cookie: u.cookie } });
    expect(del.statusCode).toBe(204);

    const two = (await upload(u.cookie, 'b.txt', Buffer.from('two'))).json();
    await db.update(attachments).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(attachments.id, two.id));
    const row = (await db.query.attachments.findFirst({ where: eq(attachments.id, two.id) }))!;
    expect(await cleanupUnsent(db, app.storage)).toBeGreaterThanOrEqual(1);
    expect(await db.query.attachments.findFirst({ where: eq(attachments.id, two.id) })).toBeUndefined();
    await expect(app.storage.get(row.storageKey)).rejects.toThrow();
  });
});
