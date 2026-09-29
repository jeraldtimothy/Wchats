import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { profiles } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { signUp } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

describe('auth + provisioning', () => {
  it('rejects /api/me without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('provisions a profile and a personal billing account on sign-up', async () => {
    const u = await signUp(app, 'Ada Lovelace');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.profile.username).toMatch(/^u-/);
    expect(me.profile.allowedFrontends).toEqual(['chat']);
    expect(me.profile.isManager).toBe(false);
    expect(me.billingAccounts).toHaveLength(1);
    expect(me.billingAccounts[0]).toMatchObject({ name: '[Personal] ADA LOVELACE', kind: 'personal' });
  });

  it('blocks disabled users on API routes and at sign-in', async () => {
    const u = await signUp(app);
    await db.update(profiles).set({ isDisabled: true }).where(eq(profiles.userId, u.id));
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: u.cookie } });
    expect(me.statusCode).toBe(403);
    expect(me.json().error.code).toBe('account_disabled');

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN },
      payload: { email: u.email, password: 'correct-horse-battery' },
    });
    expect(signIn.statusCode).not.toBe(200);
  });
});
