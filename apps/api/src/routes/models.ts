import type { ModelListResponse } from '@wchats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth, requireUser } from '../auth/guards.js';
import { db } from '../db/client.js';
import { modelFavorites, models } from '../db/schema.js';
import { notFound } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { listPickerModels } from '../models/catalog.js';

const IdParams = z.object({ id: z.uuid() });

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models', { preHandler: requireUser }, async (request): Promise<ModelListResponse> => ({
    models: await listPickerModels(db, app.providers, getAuth(request).user.id),
  }));

  app.put('/api/models/:id/favorite', { preHandler: requireUser }, async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    const model = await db.query.models.findFirst({ where: eq(models.id, id) });
    if (!model) throw notFound('Model');
    await db
      .insert(modelFavorites)
      .values({ userId: getAuth(request).user.id, modelId: id })
      .onConflictDoNothing();
    return reply.status(204).send();
  });

  app.delete('/api/models/:id/favorite', { preHandler: requireUser }, async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await db
      .delete(modelFavorites)
      .where(and(eq(modelFavorites.userId, getAuth(request).user.id), eq(modelFavorites.modelId, id)));
    return reply.status(204).send();
  });
}
