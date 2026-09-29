import type { Frontend, MeResponse, PublicConfig } from '@wchats/shared';
import type { FastifyInstance } from 'fastify';
import { listAccountsForUser } from '../accounts/queries.js';
import { googleAuthEnabled } from '../auth/auth.js';
import { getAuth, requireUser } from '../auth/guards.js';
import { db } from '../db/client.js';
import { env } from '../env.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async (): Promise<PublicConfig> => ({ googleAuthEnabled }));

  app.get('/api/me', { preHandler: requireUser }, async (request): Promise<MeResponse> => {
    const { user, profile } = getAuth(request);
    return {
      user: { ...user, createdAt: user.createdAt.toISOString() },
      profile: {
        username: profile.username,
        isManager: profile.isManager,
        allowedFrontends: profile.allowedFrontends as Frontend[],
        defaultApp: profile.defaultApp as Frontend,
      },
      billingAccounts: await listAccountsForUser(db, user.id),
      config: { googleAuthEnabled, simgenUrl: env.SIMGEN_URL },
    };
  });

  app.get('/api/billing-accounts', { preHandler: requireUser }, async (request) => ({
    accounts: await listAccountsForUser(db, getAuth(request).user.id),
  }));
}
