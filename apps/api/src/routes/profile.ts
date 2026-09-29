import { PatchProfileBody, type Frontend, type ProfileResponse } from '@wchats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { listAccountsForUser } from '../accounts/queries.js';
import { getAuth, loadAuth, requireUser } from '../auth/guards.js';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { HttpError } from '../http/errors.js';
import { parse } from '../http/validate.js';

async function profileResponse(request: FastifyRequest): Promise<ProfileResponse> {
  const { user, profile } = getAuth(request);
  return {
    user: {
      id: user.id,
      name: user.name,
      username: profile.username,
      email: user.email,
      memberSince: user.createdAt.toISOString(),
    },
    globalSystemPrompt: profile.globalSystemPrompt,
    generateAiMemories: profile.generateAiMemories,
    defaultApp: profile.defaultApp as Frontend,
    allowedFrontends: profile.allowedFrontends as Frontend[],
    billingAccounts: await listAccountsForUser(db, user.id),
  };
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser);

  app.get('/api/profile', async (request) => profileResponse(request));

  app.patch('/api/profile', async (request) => {
    const body = parse(PatchProfileBody, request.body);
    const { user, profile } = getAuth(request);
    if (body.defaultApp && !profile.allowedFrontends.includes(body.defaultApp)) {
      throw new HttpError(400, 'validation', "You don't have access to that app.");
    }
    await db
      .update(profiles)
      .set({
        ...(body.globalSystemPrompt !== undefined ? { globalSystemPrompt: body.globalSystemPrompt.trim() } : {}),
        ...(body.generateAiMemories !== undefined ? { generateAiMemories: body.generateAiMemories } : {}),
        ...(body.defaultApp !== undefined ? { defaultApp: body.defaultApp } : {}),
      })
      .where(eq(profiles.userId, user.id));
    request.authCtx = (await loadAuth(request)) ?? request.authCtx;
    return profileResponse(request);
  });
}
