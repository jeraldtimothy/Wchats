import {
  CreateSessionBody,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PatchSessionBody,
  PostMessageBody,
  type ChatStreamEvent,
  type Effort,
  type PostMessageResponse,
  type SessionSummary,
} from '@wchats/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth, requireFrontend, requireUser } from '../auth/guards.js';
import { assertCanSpend } from '../billing/ledger.js';
import { getOwnedSession, getSessionDetail, listSessions, toMessageDto } from '../chat/sessions.js';
import { db } from '../db/client.js';
import { attachments, billingAccountMembers, billingAccounts, chatSessions, messages, models } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';

const IdParams = z.object({ id: z.uuid() });
const HEARTBEAT_MS = 15_000;

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);
  app.addHook('preHandler', requireFrontend('chat'));

  app.get('/api/chat/v2/sessions', async (request): Promise<{ sessions: SessionSummary[] }> => ({
    sessions: await listSessions(db, getAuth(request).user.id),
  }));

  app.post('/api/chat/v2/sessions', async (request, reply) => {
    const { user } = getAuth(request);
    const body = parse(CreateSessionBody, request.body);
    const model = await db.query.models.findFirst({ where: eq(models.id, body.modelId) });
    if (!model) throw notFound('Model');
    if (model.isRetired) throw new HttpError(409, 'model_retired', 'This model is retired.');
    if (!app.providers.isConfigured(model.provider)) {
      throw new HttpError(409, 'model_unavailable', 'This model is not available right now.');
    }
    const [membership] = await db
      .select({ account: billingAccounts })
      .from(billingAccountMembers)
      .innerJoin(billingAccounts, eq(billingAccounts.id, billingAccountMembers.billingAccountId))
      .where(and(eq(billingAccountMembers.billingAccountId, body.billingAccountId), eq(billingAccountMembers.userId, user.id)));
    if (!membership) throw new HttpError(403, 'forbidden', 'You are not a member of this billing account.');
    if (membership.account.isDisabled) {
      throw new HttpError(403, 'billing_account_disabled', 'This billing account is disabled.');
    }
    const [session] = await db
      .insert(chatSessions)
      .values({ userId: user.id, modelId: model.id, billingAccountId: body.billingAccountId })
      .returning();
    reply.status(201);
    return getSessionDetail(db, user.id, session!.id);
  });

  app.get('/api/chat/v2/session/:id', async (request) => {
    const { id } = parse(IdParams, request.params);
    return getSessionDetail(db, getAuth(request).user.id, id);
  });

  app.patch('/api/chat/v2/session/:id', async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PatchSessionBody, request.body);
    const { user } = getAuth(request);
    await getOwnedSession(db, user.id, id);
    await db.update(chatSessions).set(body).where(eq(chatSessions.id, id));
    return getSessionDetail(db, user.id, id);
  });

  app.delete('/api/chat/v2/session/:id', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedSession(db, getAuth(request).user.id, id);
    await db.update(chatSessions).set({ deletedAt: new Date() }).where(eq(chatSessions.id, id));
    return reply.status(204).send();
  });

  app.post('/api/chat/v2/session/:id/post-message', async (request, reply): Promise<PostMessageResponse> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PostMessageBody, request.body);
    const { user } = getAuth(request);
    const session = await getOwnedSession(db, user.id, id);
    const model = await db.query.models.findFirst({ where: eq(models.id, session.modelId) });
    if (!model) throw notFound('Model');
    if (model.isRetired) {
      throw new HttpError(409, 'model_retired', 'This model is retired. You can read this chat, or start a new chat to continue.');
    }
    if (!app.providers.isConfigured(model.provider)) {
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
          .where(and(inArray(attachments.id, attachmentIds), eq(attachments.userId, user.id), isNull(attachments.messageId)))
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

    await assertCanSpend(db, session.billingAccountId, user.id);

    const { userMessage, assistantMessage } = await db.transaction(async (tx) => {
      // Row lock serializes concurrent sends to one session.
      await tx.execute(sql`select 1 from ${chatSessions} where ${chatSessions.id} = ${id} for update`);
      const busy = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.sessionId, id), inArray(messages.status, ['pending', 'streaming'])))
        .limit(1);
      if (busy.length) throw new HttpError(409, 'busy', 'Wait for the current reply to finish.');

      // Explicit timestamps keep the pair ordered even inside one transaction.
      const now = Date.now();
      const [u] = await tx
        .insert(messages)
        .values({
          sessionId: id,
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
        .values({ sessionId: id, role: 'assistant', status: 'pending', createdAt: new Date(now + 1) })
        .returning();
      await tx.update(chatSessions).set({ lastActivityAt: new Date(now) }).where(eq(chatSessions.id, id));
      return { userMessage: u!, assistantMessage: a! };
    });

    app.chat.runner.start({ sessionId: id, messageId: assistantMessage.id, userId: user.id });
    reply.status(202);
    return { userMessage: toMessageDto(userMessage, files), assistantMessage: toMessageDto(assistantMessage) };
  });

  /**
   * SSE. Always starts with `snapshot` (the in-flight reply, if any), then live
   * events. EventSource reconnects on its own; each reconnect gets a fresh
   * snapshot, so a partial reply is restored before deltas resume.
   */
  app.get('/api/chat/v2/session/:id/listen', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedSession(db, getAuth(request).user.id, id);

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
    const { snapshot, unsubscribe } = app.chat.hub.snapshotAndSubscribe(id, send);
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
  });
}
