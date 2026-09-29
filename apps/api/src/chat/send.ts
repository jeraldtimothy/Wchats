import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  type ChatStreamEvent,
  type CreateSessionBody,
  type Effort,
  type PostMessageBody,
} from '@wchats/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AttachmentRow } from '../attachments/service.js';
import { assertCanSpend } from '../billing/ledger.js';
import type { Db } from '../db/client.js';
import { attachments, billingAccountMembers, billingAccounts, chatSessions, messages, models } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ChatEventHub } from './hub.js';
import type { GenerationRunner } from './runner.js';
import type { MessageRow, SessionRow } from './sessions.js';

const HEARTBEAT_MS = 15_000;

export interface SendDeps {
  db: Db;
  providers: ProviderRegistry;
  runner: GenerationRunner;
}

/** A model a new session may use: exists, not retired, provider configured. */
async function usableModel(deps: Pick<SendDeps, 'db' | 'providers'>, modelId: string) {
  const model = await deps.db.query.models.findFirst({ where: eq(models.id, modelId) });
  if (!model) throw notFound('Model');
  if (model.isRetired) throw new HttpError(409, 'model_retired', 'This model is retired.');
  if (!deps.providers.isConfigured(model.provider)) {
    throw new HttpError(409, 'model_unavailable', 'This model is not available right now.');
  }
  return model;
}

/** Creates a session bound to a model and a billing account the user belongs to (and that isn't disabled). */
export async function createSession(
  deps: Pick<SendDeps, 'db' | 'providers'>,
  userId: string,
  body: CreateSessionBody,
): Promise<SessionRow> {
  const model = await usableModel(deps, body.modelId);
  const [membership] = await deps.db
    .select({ account: billingAccounts })
    .from(billingAccountMembers)
    .innerJoin(billingAccounts, eq(billingAccounts.id, billingAccountMembers.billingAccountId))
    .where(and(eq(billingAccountMembers.billingAccountId, body.billingAccountId), eq(billingAccountMembers.userId, userId)));
  if (!membership) throw new HttpError(403, 'forbidden', 'You are not a member of this billing account.');
  if (membership.account.isDisabled) {
    throw new HttpError(403, 'billing_account_disabled', 'This billing account is disabled.');
  }
  const [session] = await deps.db
    .insert(chatSessions)
    .values({ userId, modelId: model.id, billingAccountId: body.billingAccountId })
    .returning();
  return session!;
}

export interface SentMessages {
  userMessage: MessageRow;
  assistantMessage: MessageRow;
  files: AttachmentRow[];
}

/**
 * Validates and saves a user turn plus a pending reply, then starts
 * generation. Used by chat post-message.
 */
export async function postMessage(
  deps: SendDeps,
  userId: string,
  session: SessionRow,
  body: PostMessageBody,
): Promise<SentMessages> {
  const { db } = deps;
  const model = await db.query.models.findFirst({ where: eq(models.id, session.modelId) });
  if (!model) throw notFound('Model');
  if (model.isRetired) {
    throw new HttpError(409, 'model_retired', 'This model is retired. You can read this chat, or start a new chat to continue.');
  }
  if (!deps.providers.isConfigured(model.provider)) {
    throw new HttpError(409, 'model_unavailable', 'This model is not available right now.');
  }
  const text = body.text.trim();
  const attachmentIds = [...new Set(body.attachmentIds ?? [])];
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new HttpError(400, 'validation', `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
  }
  const files = attachmentIds.length
    ? await db
        .select()
        .from(attachments)
        .where(and(inArray(attachments.id, attachmentIds), eq(attachments.userId, userId), isNull(attachments.messageId)))
    : [];
  if (files.length !== attachmentIds.length) {
    throw new HttpError(400, 'validation', 'One or more files are no longer available. Remove them and attach again.');
  }
  for (const f of files) {
    if (f.kind === 'image' && !model.supportsImages) {
      throw new HttpError(400, 'validation', `${model.displayName} can't read images ("${f.filename}").`);
    }
    if (f.kind === 'pdf' && !model.supportsDocuments) {
      throw new HttpError(400, 'validation', `${model.displayName} can't read PDFs ("${f.filename}").`);
    }
  }
  if (!text && files.length === 0) throw new HttpError(400, 'validation', 'Type a message first.');

  const efforts = model.reasoningEfforts as Effort[];
  let effort: Effort | null = null;
  if (efforts.length > 0) {
    effort = body.effort ?? (model.defaultEffort as Effort | null) ?? efforts[0]!;
    if (!efforts.includes(effort)) {
      throw new HttpError(400, 'validation', `Thinking effort "${effort}" is not available for this model.`);
    }
  }

  await assertCanSpend(db, session.billingAccountId, userId);

  const sent = await db.transaction(async (tx) => {
    // Row lock serializes concurrent sends to one session.
    await tx.execute(sql`select 1 from ${chatSessions} where ${chatSessions.id} = ${session.id} for update`);
    const busy = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.sessionId, session.id), inArray(messages.status, ['pending', 'streaming'])))
      .limit(1);
    if (busy.length) throw new HttpError(409, 'busy', 'Wait for the current reply to finish.');

    // Explicit timestamps keep the pair ordered even inside one transaction.
    const now = Date.now();
    const [u] = await tx
      .insert(messages)
      .values({
        sessionId: session.id,
        role: 'user',
        status: 'complete',
        content: text,
        options: {
          effort,
          webSearch: Boolean(body.webSearch) && model.webSearchEnabled,
          multiTurn: Boolean(body.multiTurn) && model.supportsMultiTurnTools,
        },
        createdAt: new Date(now),
        completedAt: new Date(now),
      })
      .returning();
    if (attachmentIds.length) {
      const linked = await tx
        .update(attachments)
        .set({ messageId: u!.id })
        .where(and(inArray(attachments.id, attachmentIds), isNull(attachments.messageId)))
        .returning({ id: attachments.id });
      if (linked.length !== attachmentIds.length) {
        throw new HttpError(409, 'validation', 'One or more files were already sent. Attach them again.');
      }
    }
    const [a] = await tx
      .insert(messages)
      .values({ sessionId: session.id, role: 'assistant', status: 'pending', createdAt: new Date(now + 1) })
      .returning();
    await tx.update(chatSessions).set({ lastActivityAt: new Date(now) }).where(eq(chatSessions.id, session.id));
    return { userMessage: u!, assistantMessage: a! };
  });

  deps.runner.start({ sessionId: session.id, messageId: sent.assistantMessage.id, userId });
  return { ...sent, files };
}

/**
 * SSE for one session. Always starts with `snapshot` (the in-flight reply, if
 * any), then live events. EventSource reconnects on its own; each reconnect
 * gets a fresh snapshot, so a partial reply is restored before deltas resume.
 */
export function streamSession(hub: ChatEventHub, request: FastifyRequest, reply: FastifyReply, sessionId: string): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const send = (ev: ChatStreamEvent) => {
    if (res.writableEnded || res.destroyed) return;
    const eventId = 'messageId' in ev && 'seq' in ev ? `id: ${ev.messageId}:${ev.seq}\n` : '';
    res.write(`${eventId}event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  const { snapshot, unsubscribe } = hub.snapshotAndSubscribe(sessionId, send);
  send({ type: 'snapshot', inflight: snapshot });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.raw.on('close', close);
  res.on('close', close);
}
