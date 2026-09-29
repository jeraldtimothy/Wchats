import type { IamUser } from '@wchats/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeRegistry } from './fakes.js';
import { manager, signUp } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ providers: fakeRegistry().registry });
});
afterAll(async () => {
  await app.close();
});

const patch = (cookie: string, id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/api/iam/users/${id}`, headers: { cookie }, payload });

describe('IAM users', () => {
  it('is for managers only', async () => {
    const u = await signUp(app);
    expect((await app.inject({ method: 'GET', url: '/api/iam/users', headers: { cookie: u.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/iam/users' })).statusCode).toBe(401);
  });

  it('lists and searches users with their accounts', async () => {
    const m = await manager(app);
    const target = await signUp(app, 'Zelda Searchable');
    const res = await app.inject({ method: 'GET', url: '/api/iam/users?q=zelda%20search', headers: { cookie: m.cookie } });
    expect(res.statusCode).toBe(200);
    const { users, total } = res.json() as { users: IamUser[]; total: number };
    expect(total).toBe(1);
    expect(users[0]).toMatchObject({
      id: target.id,
      name: 'Zelda Searchable',
      isManager: false,
      isDisabled: false,
      allowedFrontends: ['chat'],
      accounts: [{ name: '[Personal] ZELDA SEARCHABLE', kind: 'personal' }],
    });
    // LIKE wildcards in the query are matched literally.
    const wild = await app.inject({ method: 'GET', url: '/api/iam/users?q=%25', headers: { cookie: m.cookie } });
    expect(wild.json().total).toBe(0);
  });

  it('changes apps and manager access, keeping the default app valid', async () => {
    const m = await manager(app);
    const t = await signUp(app);
    const res = await patch(m.cookie, t.id, { allowedFrontends: ['simgen'], isManager: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ allowedFrontends: ['simgen'], isManager: true });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: t.cookie } });
    expect(me.json().profile.defaultApp).toBe('simgen');
  });

  it('disables a user and signs them out; they can be re-enabled', async () => {
    const m = await manager(app);
    const t = await signUp(app);
    expect((await patch(m.cookie, t.id, { isDisabled: true })).json().isDisabled).toBe(true);
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: t.cookie } });
    expect(after.statusCode).toBe(401); // session revoked, not just blocked
    expect((await patch(m.cookie, t.id, { isDisabled: false })).json().isDisabled).toBe(false);
  });

  it('prevents managers from locking themselves out', async () => {
    const m = await manager(app);
    expect((await patch(m.cookie, m.id, { isDisabled: true })).statusCode).toBe(400);
    expect((await patch(m.cookie, m.id, { isManager: false })).statusCode).toBe(400);
    expect((await patch(m.cookie, 'no-such-user', { isManager: true })).statusCode).toBe(404);
    expect((await patch(m.cookie, m.id, { allowedFrontends: ['chat', 'chat'] })).statusCode).toBe(400);
  });
});
