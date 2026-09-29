import type { FastifyInstance } from 'fastify';
import { requireManager, requireUser } from '../../auth/guards.js';
import { iamAccountRoutes } from './accounts.js';
import { iamModelRoutes } from './models.js';
import { iamUserRoutes } from './users.js';

/** Manager console: every /api/iam route requires a signed-in manager. */
export async function iamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);
  app.addHook('preHandler', requireManager);
  await app.register(iamUserRoutes);
  await app.register(iamAccountRoutes);
  await app.register(iamModelRoutes);
}
