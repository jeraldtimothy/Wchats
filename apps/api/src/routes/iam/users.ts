import { PatchIamUserBody, type Frontend, type IamUser, type IamUsersResponse } from '@wchats/shared';
import { and, asc, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAuth } from '../../auth/guards.js';
import { db } from '../../db/client.js';
import { billingAccountMembers, billingAccounts, profiles, session, user } from '../../db/schema.js';
import { HttpError, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const IdParams = z.object({ id: z.string().min(1).max(100) });

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function loadUsers(where: SQL | undefined, limit: number, offset: number): Promise<IamUser[]> {
  const rows = await db
    .select({ u: user, p: profiles })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .where(where)
    .orderBy(asc(user.name), asc(user.email))
    .limit(limit)
    .offset(offset);
  const ids = rows.map((r) => r.u.id);
  const memberships = ids.length
    ? await db
        .select({ userId: billingAccountMembers.userId, id: billingAccounts.id, name: billingAccounts.name, kind: billingAccounts.kind })
        .from(billingAccountMembers)
        .innerJoin(billingAccounts, eq(billingAccounts.id, billingAccountMembers.billingAccountId))
        .where(inArray(billingAccountMembers.userId, ids))
        .orderBy(asc(billingAccounts.kind), asc(billingAccounts.name))
    : [];
  return rows.map(({ u, p }) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    username: p.username,
    isManager: p.isManager,
    isDisabled: p.isDisabled,
    allowedFrontends: p.allowedFrontends as Frontend[],
    createdAt: u.createdAt.toISOString(),
    accounts: memberships.filter((m) => m.userId === u.id).map(({ id, name, kind }) => ({ id, name, kind })),
  }));
}

export async function iamUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/iam/users', async (request): Promise<IamUsersResponse> => {
    const { q, limit, offset } = parse(ListQuery, request.query);
    const pattern = q ? `%${escapeLike(q)}%` : null;
    const where = pattern
      ? or(ilike(user.name, pattern), ilike(user.email, pattern), ilike(profiles.username, pattern))
      : undefined;
    const [total] = await db
      .select({ n: count() })
      .from(user)
      .innerJoin(profiles, eq(profiles.userId, user.id))
      .where(where);
    return { users: await loadUsers(where, limit, offset), total: total?.n ?? 0 };
  });

  app.patch('/api/iam/users/:id', async (request): Promise<IamUser> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PatchIamUserBody, request.body);
    const me = getAuth(request).user;
    const target = await db.query.profiles.findFirst({ where: eq(profiles.userId, id) });
    if (!target) throw notFound('User');
    if (id === me.id && body.isDisabled === true) throw new HttpError(400, 'validation', "You can't disable your own account.");
    if (id === me.id && body.isManager === false) {
      throw new HttpError(400, 'validation', "You can't remove your own manager access.");
    }

    const frontends = body.allowedFrontends ?? (target.allowedFrontends as Frontend[]);
    // Keep the default app valid when access changes.
    const defaultApp = frontends.includes(target.defaultApp as Frontend)
      ? target.defaultApp
      : (frontends.find((f) => f !== 'simgen') ?? frontends[0] ?? 'chat');

    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          ...(body.isDisabled !== undefined ? { isDisabled: body.isDisabled } : {}),
          ...(body.isManager !== undefined ? { isManager: body.isManager } : {}),
          ...(body.allowedFrontends !== undefined ? { allowedFrontends: body.allowedFrontends } : {}),
          defaultApp,
        })
        .where(eq(profiles.userId, id));
      // Disabling signs the user out everywhere.
      if (body.isDisabled === true) await tx.delete(session).where(eq(session.userId, id));
    });

    const [updated] = await loadUsers(and(eq(user.id, id)), 1, 0);
    return updated!;
  });
}
