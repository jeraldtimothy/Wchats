import { AskBody, type AskHistoryItem, type AskResponse, type MessageStatus } from '@wchats/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth, requireFrontend, requireUser } from '../auth/guards.js';
import { assertCanSpend } from '../billing/ledger.js';
import { createSession, postMessage, streamSession } from '../chat/send.js';
import { getOwnedSession, getSessionDetail, getSessionSummary, toMessageDto } from '../chat/sessions.js';
import { db } from '../db/client.js';
import { chatSessions, models } from '../db/schema.js';
import { parse } from '../http/validate.js';

const IdParams = z.object({ id: z.uuid() });

/**
 * Ask: one-shot questions. Each question is a hidden session of kind 'ask'
 * with a single exchange, streamed and billed exactly like chat.
 */
export async function askRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);
  app.addHook('preHandler', requireFrontend('ask'));
  const deps = { db, providers: app.providers, runner: app.chat.runner };

  app.post('/api/ask', async (request, reply): Promise<AskResponse> => {
    const body = parse(AskBody, request.body);
    const { user } = getAuth(request);
    // Check the balance before creating anything, so a blocked question leaves no trace.
    await assertCanSpend(db, body.billingAccountId, user.id);
    const session = await createSession(deps, user.id, body, 'ask');
    try {
      const sent = await postMessage(deps, user.id, session, { text: body.text, effort: body.effort, webSearch: body.webSearch });
      reply.status(202);
      return {
        session: await getSessionSummary(db, session),
        userMessage: toMessageDto(sent.userMessage),
        assistantMessage: toMessageDto(sent.assistantMessage),
      };
    } catch (err) {
      await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
      throw err;
    }
  });

  app.get('/api/ask/history', async (request): Promise<{ items: AskHistoryItem[] }> => {
    const { user } = getAuth(request);
    const rows = await db
      .select({
        id: chatSessions.id,
        createdAt: chatSessions.createdAt,
        modelName: models.displayName,
        provider: models.provider,
        question: sql<string | null>`(select m.content from messages m where m.session_id = ${chatSessions.id} and m.role = 'user' order by m.created_at limit 1)`,
        status: sql<MessageStatus | null>`(select m.status from messages m where m.session_id = ${chatSessions.id} and m.role = 'assistant' order by m.created_at desc limit 1)`,
      })
      .from(chatSessions)
      .innerJoin(models, eq(models.id, chatSessions.modelId))
      .where(and(eq(chatSessions.userId, user.id), eq(chatSessions.kind, 'ask'), isNull(chatSessions.deletedAt)))
      .orderBy(desc(chatSessions.createdAt))
      .limit(50);
    return {
      items: rows.map((r) => ({
        id: r.id,
        question: r.question ?? '',
        modelName: r.modelName,
        provider: r.provider,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.get('/api/ask/:id', async (request) => {
    const { id } = parse(IdParams, request.params);
    return getSessionDetail(db, getAuth(request).user.id, id, 'ask');
  });

  app.get('/api/ask/:id/listen', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedSession(db, getAuth(request).user.id, id, 'ask');
    streamSession(app.chat.hub, request, reply, id);
  });

  app.delete('/api/ask/:id', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedSession(db, getAuth(request).user.id, id, 'ask');
    await db.update(chatSessions).set({ deletedAt: new Date() }).where(eq(chatSessions.id, id));
    return reply.status(204).send();
  });
}

