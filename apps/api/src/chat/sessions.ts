import type { Effort, MessageDto, SessionDetail, SessionSummary, Source } from '@wchats/shared';
import { listForMessages, toAttachmentDto, type AttachmentRow } from '../attachments/service.js';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { billingAccounts, chatSessions, messages, modelFavorites, models } from '../db/schema.js';
import { notFound } from '../http/errors.js';
import { toModelSummary } from '../models/catalog.js';

export type SessionRow = typeof chatSessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export function toMessageDto(m: MessageRow, files: AttachmentRow[] = []): MessageDto {
  const options = m.options as { effort?: Effort | null; webSearch?: boolean };
  const effort = options.effort ?? null;
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    content: m.content,
    sources: (m.sources ?? []) as Source[],
    attachments: files.map(toAttachmentDto),
    effort,
    webSearch: options.webSearch ?? false,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    costNanoUsd: m.costNanoUsd === null ? null : m.costNanoUsd.toString(),
    createdAt: m.createdAt.toISOString(),
  };
}

function toSummary(s: SessionRow, model: typeof models.$inferSelect): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    modelId: model.id,
    modelName: model.displayName,
    provider: model.provider,
    billingAccountId: s.billingAccountId,
    isRetired: model.isRetired,
    createdAt: s.createdAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
  };
}

export async function listSessions(db: DbOrTx, userId: string): Promise<SessionSummary[]> {
  const rows = await db
    .select({ s: chatSessions, m: models })
    .from(chatSessions)
    .innerJoin(models, eq(models.id, chatSessions.modelId))
    .where(and(eq(chatSessions.userId, userId), eq(chatSessions.kind, 'chat'), isNull(chatSessions.deletedAt)))
    .orderBy(desc(chatSessions.lastActivityAt));
  return rows.map((r) => toSummary(r.s, r.m));
}

export async function getSessionSummary(db: DbOrTx, session: SessionRow): Promise<SessionSummary> {
  const model = await db.query.models.findFirst({ where: eq(models.id, session.modelId) });
  if (!model) throw notFound('Model');
  return toSummary(session, model);
}

/**
 * The chat session if it exists, belongs to the user and isn't deleted;
 * otherwise 404. (Sessions of the retired kind 'ask' are never returned.)
 */
export async function getOwnedSession(db: DbOrTx, userId: string, sessionId: string): Promise<SessionRow> {
  const s = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, userId),
      eq(chatSessions.kind, 'chat'),
      isNull(chatSessions.deletedAt),
    ),
  });
  if (!s) throw notFound('Chat session');
  return s;
}

/** Messages in conversation order. Within a turn the user message sorts before its reply. */
export async function listMessages(db: DbOrTx, sessionId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.role));
}

export async function getSessionDetail(db: DbOrTx, userId: string, sessionId: string): Promise<SessionDetail> {
  const s = await getOwnedSession(db, userId, sessionId);
  const [row] = await db
    .select({ m: models, account: billingAccounts, fav: modelFavorites.createdAt })
    .from(models)
    .innerJoin(billingAccounts, eq(billingAccounts.id, s.billingAccountId))
    .leftJoin(modelFavorites, and(eq(modelFavorites.modelId, models.id), eq(modelFavorites.userId, userId)))
    .where(eq(models.id, s.modelId));
  if (!row) throw notFound('Model');
  return {
    session: {
      ...toSummary(s, row.m),
      includeMemories: s.includeMemories,
      billingAccountName: row.account.name,
      model: toModelSummary(row.m, row.fav !== null),
    },
    messages: await withAttachments(db, await listMessages(db, s.id)),
  };
}

export async function withAttachments(db: DbOrTx, rows: MessageRow[]): Promise<MessageDto[]> {
  const files = await listForMessages(
    db,
    rows.filter((m) => m.role === 'user').map((m) => m.id),
  );
  return rows.map((m) => toMessageDto(m, files.get(m.id)));
}
