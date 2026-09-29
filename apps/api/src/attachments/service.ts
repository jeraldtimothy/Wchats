import type { AttachmentDto } from '@wchats/shared';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DbOrTx } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import type { Storage } from '../storage/index.js';
import { ExtractionError, extractText } from './extract.js';
import { sniff } from './sniff.js';

export type AttachmentRow = typeof attachments.$inferSelect;

export function toAttachmentDto(a: AttachmentRow): AttachmentDto {
  return {
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    truncated: a.truncated,
  };
}

/** Keeps a readable, safe display name. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, 200);
}

export async function createUpload(
  db: DbOrTx,
  storage: Storage,
  input: { userId: string; filename: string; data: Buffer },
): Promise<AttachmentRow> {
  const filename = cleanFilename(input.filename);
  const kind = sniff(input.data, filename);
  if (!kind) {
    throw new HttpError(
      415,
      'validation',
      `"${filename}" isn't a supported file, or its contents don't match its extension.`,
    );
  }
  let extracted: { text: string; truncated: boolean } | null = null;
  if (kind.kind === 'text') {
    try {
      extracted = extractText(kind.source ?? 'plain', input.data);
    } catch (err) {
      if (err instanceof ExtractionError) throw new HttpError(422, 'validation', `${filename}: ${err.message}`);
      throw err;
    }
    if (!extracted.text) throw new HttpError(422, 'validation', `"${filename}" has no readable text.`);
  }
  const id = randomUUID();
  const storageKey = `uploads/${input.userId}/${id}`;
  await storage.put(storageKey, input.data, kind.mimeType);
  const [row] = await db
    .insert(attachments)
    .values({
      id,
      userId: input.userId,
      kind: kind.kind,
      mimeType: kind.mimeType,
      filename,
      sizeBytes: input.data.length,
      storageKey,
      extractedText: extracted?.text ?? null,
      truncated: extracted?.truncated ?? false,
    })
    .returning();
  return row!;
}

export async function getOwnedAttachment(db: DbOrTx, userId: string, id: string): Promise<AttachmentRow> {
  const row = await db.query.attachments.findFirst({ where: and(eq(attachments.id, id), eq(attachments.userId, userId)) });
  if (!row) throw notFound('File');
  return row;
}

/** Removes an upload that hasn't been sent yet. Sent files stay with their message. */
export async function deleteUnsent(db: DbOrTx, storage: Storage, userId: string, id: string): Promise<void> {
  const row = await getOwnedAttachment(db, userId, id);
  if (row.messageId) throw new HttpError(409, 'validation', 'This file was already sent and can no longer be removed.');
  await db.delete(attachments).where(eq(attachments.id, id));
  await storage.delete(row.storageKey);
}

export async function listForMessages(db: DbOrTx, messageIds: string[]): Promise<Map<string, AttachmentRow[]>> {
  const map = new Map<string, AttachmentRow[]>();
  if (messageIds.length === 0) return map;
  const rows = await db.select().from(attachments).where(inArray(attachments.messageId, messageIds)).orderBy(attachments.createdAt);
  for (const r of rows) {
    const list = map.get(r.messageId!) ?? [];
    list.push(r);
    map.set(r.messageId!, list);
  }
  return map;
}

/** Deletes uploads that were never sent, older than `olderThanMs`. */
export async function cleanupUnsent(db: DbOrTx, storage: Storage, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .delete(attachments)
    .where(and(isNull(attachments.messageId), lt(attachments.createdAt, cutoff)))
    .returning({ storageKey: attachments.storageKey });
  for (const r of rows) await storage.delete(r.storageKey);
  return rows.length;
}
