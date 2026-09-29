import { MEMORY_TYPE_LABELS, type MemoryItemDto } from '@wchats/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { memoryItems } from '../db/schema.js';
import { notFound } from '../http/errors.js';
import type { MemoryItem } from '../chat/prompts.js';

export type MemoryRow = typeof memoryItems.$inferSelect;

export function toMemoryDto(m: MemoryRow): MemoryItemDto {
  return {
    id: m.id,
    type: m.type,
    content: m.content,
    aiGenerated: m.aiGenerated,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listMemories(db: DbOrTx, userId: string): Promise<MemoryRow[]> {
  return db.select().from(memoryItems).where(eq(memoryItems.userId, userId)).orderBy(desc(memoryItems.createdAt));
}

export async function getOwnedMemory(db: DbOrTx, userId: string, id: string): Promise<MemoryRow> {
  const row = await db.query.memoryItems.findFirst({ where: and(eq(memoryItems.id, id), eq(memoryItems.userId, userId)) });
  if (!row) throw notFound('Memory item');
  return row;
}

/** Memory items for the system prompt, oldest first. */
export async function memoriesForPrompt(db: DbOrTx, userId: string): Promise<MemoryItem[]> {
  const rows = await db
    .select({ type: memoryItems.type, content: memoryItems.content })
    .from(memoryItems)
    .where(eq(memoryItems.userId, userId))
    .orderBy(asc(memoryItems.createdAt));
  return rows.map((r) => ({ type: MEMORY_TYPE_LABELS[r.type], content: r.content }));
}
