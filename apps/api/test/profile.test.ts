import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { profiles } from '../src/db/schema.js';
import { fakeRegistry } from './fakes.js';
import { signUp } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ providers: fakeRegistry().registry });
});
afterAll(async () => {
  await app.close();
});

describe('profile', () => {
  it('returns the profile with billing accounts', async () => {
    const u = await signUp(app, 'Grace Hopper');
    const res = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { id: u.id, name: 'Grace Hopper', email: u.email },
      globalSystemPrompt: '',
      generateAiMemories: false,
      defaultApp: 'chat',
      allowedFrontends: ['chat', 'ask'],
      billingAccounts: [{ name: '[Personal] GRACE HOPPER', isDisabled: false, balanceCents: 0 }],
    });
    expect(res.json().user.memberSince).toMatch(/^\d{4}-/);
  });

  it('updates the global prompt, AI memories toggle and default app', async () => {
    const u = await signUp(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile',
      headers: { cookie: u.cookie },
      payload: { globalSystemPrompt: '  Reply in British English.  ', generateAiMemories: true, defaultApp: 'ask' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      globalSystemPrompt: 'Reply in British English.',
      generateAiMemories: true,
      defaultApp: 'ask',
    });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: u.cookie } });
    expect(me.json().profile.defaultApp).toBe('ask');
  });

  it("rejects a default app the user can't use, and empty or oversized updates", async () => {
    const u = await signUp(app);
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: '/api/profile', headers: { cookie: u.cookie }, payload });
    expect((await patch({ defaultApp: 'simgen' })).statusCode).toBe(400);
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ globalSystemPrompt: 'x'.repeat(10_001) })).statusCode).toBe(400);
    await db.update(profiles).set({ allowedFrontends: ['chat', 'ask', 'simgen'] }).where(eq(profiles.userId, u.id));
    expect((await patch({ defaultApp: 'simgen' })).statusCode).toBe(200);
  });
});
