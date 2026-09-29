import type { Frontend } from '@wchats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { HttpError, forbidden } from '../http/errors.js';
import { auth } from './auth.js';

export interface AuthContext {
  user: { id: string; name: string; email: string; image: string | null; createdAt: Date };
  profile: typeof profiles.$inferSelect;
}

declare module 'fastify' {
  interface FastifyRequest {
    authCtx?: AuthContext;
  }
}

export async function loadAuth(request: FastifyRequest): Promise<AuthContext | null> {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!result) return null;
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, result.user.id) });
  if (!profile) return null;
  const { id, name, email, image, createdAt } = result.user;
  return { user: { id, name, email, image: image ?? null, createdAt }, profile };
}

/** preHandler: 401 without a session, 403 if the user is disabled. */
export async function requireUser(request: FastifyRequest): Promise<void> {
  const ctx = await loadAuth(request);
  if (!ctx) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  if (ctx.profile.isDisabled) throw new HttpError(403, 'account_disabled', 'Your account is disabled.');
  request.authCtx = ctx;
}

/** preHandler factory: 403 unless the user may use `app`. Must run after requireUser. */
export function requireFrontend(app: Frontend) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!getAuth(request).profile.allowedFrontends.includes(app)) throw forbidden();
  };
}

/** preHandler: 403 unless the user is a manager. Must run after requireUser. */
export async function requireManager(request: FastifyRequest): Promise<void> {
  if (!getAuth(request).profile.isManager) throw forbidden();
}

export function getAuth(request: FastifyRequest): AuthContext {
  if (!request.authCtx) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  return request.authCtx;
}
