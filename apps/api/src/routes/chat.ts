import {
  CreateSessionBody,
  PatchSessionBody,
  PostMessageBody,
  type PostMessageResponse,
  type SessionSummary,
} from '@wchats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth, requireFrontend, requireUser } from '../auth/guards.js';
import { createSession, postMessage, streamSession } from '../chat/send.js';
import { getOwnedSession, getSessionDetail, listSessions, toMessageDto } from '../chat/sessions.js';
import { db } from '../db/client.js';
import { chatSessions } from '../db/schema.js';
import { parse } from '../http/validate.js';

const IdParams = z.object({ id: z.uuid() });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);
  app.addHook('preHandler', requireFrontend('chat'));
  const deps = { db, providers: app.providers, runner: app.chat.runner };

  app.get('/api/chat/v2/sessions', async (request): Promise<{ sessions: SessionSummary[] }> => ({
    sessions: await listSessions(db, getAuth(request).user.id),
  }));

  app.post('/api/chat/v2/sessions', async (request, reply) => {
    const { user } = getAuth(request);
    const session = await createSession(deps, user.id, parse(CreateSessionBody, request.body));
    reply.status(201);
    return getSessionDetail(db, user.id, session.id);
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
    const sent = await postMessage(deps, user.id, session, body);
    reply.status(202);
    return { userMessage: toMessageDto(sent.userMessage, sent.files), assistantMessage: toMessageDto(sent.assistantMessage) };
  });

  app.get('/api/chat/v2/session/:id/listen', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedSession(db, getAuth(request).user.id, id);
    streamSession(app.chat.hub, request, reply, id);
  });
}
