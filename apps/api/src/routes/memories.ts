import { CreateMemoryBody, MAX_MEMORY_ITEMS, PatchMemoryBody, type MemoryItemDto } from '@wchats/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth, requireUser } from '../auth/guards.js';
import { db } from '../db/client.js';
import { memoryItems } from '../db/schema.js';
import { HttpError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { getOwnedMemory, listMemories, toMemoryDto } from '../memories/service.js';

const IdParams = z.object({ id: z.uuid() });

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);

  app.get('/api/memories', async (request): Promise<{ memories: MemoryItemDto[] }> => ({
    memories: (await listMemories(db, getAuth(request).user.id)).map(toMemoryDto),
  }));

  app.post('/api/memories', async (request, reply): Promise<MemoryItemDto> => {
    const body = parse(CreateMemoryBody, request.body);
    const userId = getAuth(request).user.id;
    const [row] = await db.select({ n: count() }).from(memoryItems).where(eq(memoryItems.userId, userId));
    if ((row?.n ?? 0) >= MAX_MEMORY_ITEMS) {
      throw new HttpError(400, 'validation', `You can keep up to ${MAX_MEMORY_ITEMS} memory items. Delete some first.`);
    }
    const [created] = await db.insert(memoryItems).values({ userId, ...body }).returning();
    reply.status(201);
    return toMemoryDto(created!);
  });

  app.patch('/api/memories/:id', async (request): Promise<MemoryItemDto> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PatchMemoryBody, request.body);
    await getOwnedMemory(db, getAuth(request).user.id, id);
    const [updated] = await db.update(memoryItems).set(body).where(eq(memoryItems.id, id)).returning();
    return toMemoryDto(updated!);
  });

  app.delete('/api/memories/:id', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await getOwnedMemory(db, getAuth(request).user.id, id);
    await db.delete(memoryItems).where(eq(memoryItems.id, id));
    return reply.status(204).send();
  });
}
