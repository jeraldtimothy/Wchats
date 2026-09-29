import type { SessionDetail } from '@wchats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { grantCredit } from '../src/billing/ledger.js';
import { buildSystemPrompt } from '../src/chat/prompts.js';
import type { InlineTitleQueue } from '../src/chat/titles.js';
import { db } from '../src/db/client.js';
import { billingAccounts, models, profiles } from '../src/db/schema.js';
import { upsertModels } from '../src/models/catalog.js';
import { fakeRegistry } from './fakes.js';
import { signUp } from './helpers.js';

const { registry, providers } = fakeRegistry();
let app: FastifyInstance;
beforeAll(async () => {
  await upsertModels(db, seedModels);
  app = await buildApp({ providers: registry });
});
afterAll(async () => {
  await app.close();
});

const req = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

describe('memory items', () => {
  it('creates, lists, edits and deletes items, scoped to the owner', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    expect((await req(a.cookie, 'GET', '/api/memories')).json()).toEqual({ memories: [] });

    const created = await req(a.cookie, 'POST', '/api/memories', { type: 'preference', content: '  Prefers metric units ' });
    expect(created.statusCode).toBe(201);
    const item = created.json();
    expect(item).toMatchObject({ type: 'preference', content: 'Prefers metric units', aiGenerated: false });

    const edited = await req(a.cookie, 'PATCH', `/api/memories/${item.id}`, { type: 'fact', content: 'Lives in Manila' });
    expect(edited.json()).toMatchObject({ type: 'fact', content: 'Lives in Manila' });

    expect((await req(b.cookie, 'PATCH', `/api/memories/${item.id}`, { content: 'x' })).statusCode).toBe(404);
    expect((await req(b.cookie, 'DELETE', `/api/memories/${item.id}`)).statusCode).toBe(404);
    expect((await req(b.cookie, 'GET', '/api/memories')).json().memories).toHaveLength(0);

    expect((await req(a.cookie, 'DELETE', `/api/memories/${item.id}`)).statusCode).toBe(204);
    expect((await req(a.cookie, 'GET', '/api/memories')).json().memories).toHaveLength(0);
  });

  it('validates type and content', async () => {
    const u = await signUp(app);
    expect((await req(u.cookie, 'POST', '/api/memories', { type: 'secret', content: 'x' })).statusCode).toBe(400);
    expect((await req(u.cookie, 'POST', '/api/memories', { type: 'fact', content: '   ' })).statusCode).toBe(400);
    expect((await req(u.cookie, 'POST', '/api/memories', { type: 'fact', content: 'x'.repeat(2001) })).statusCode).toBe(400);
  });
});

describe('system prompt', () => {
  it('assembles base, global prompt, memories and date in order', () => {
    const p = buildSystemPrompt({
      globalSystemPrompt: 'Answer in French.',
      memories: [{ type: 'Fact', content: 'Has a cat' }],
      now: new Date('2026-09-29T12:00:00Z'),
    });
    const iGlobal = p.indexOf('Answer in French.');
    const iMem = p.indexOf('- (Fact) Has a cat');
    const iDate = p.indexOf("Today's date is Tuesday, September 29, 2026.");
    expect(iGlobal).toBeGreaterThan(0);
    expect(iMem).toBeGreaterThan(iGlobal);
    expect(iDate).toBeGreaterThan(iMem);
  });

  it('includes memories only when the session has Include Memories on', async () => {
    const u = await signUp(app);
    await db.update(profiles).set({ globalSystemPrompt: 'Be brief.' }).where(eq(profiles.userId, u.id));
    await req(u.cookie, 'POST', '/api/memories', { type: 'reminder', content: 'Dentist on Friday' });
    const account = (await db.query.billingAccounts.findFirst({
      where: and(eq(billingAccounts.ownerUserId, u.id), eq(billingAccounts.kind, 'personal')),
    }))!;
    await grantCredit(db, { accountId: account.id, amountNano: 1_000_000_000n, reason: 'test' });
    const model = (await db.query.models.findFirst({ where: eq(models.slug, 'gpt-5.6-luna') }))!;
    const s = (
      await req(u.cookie, 'POST', '/api/chat/v2/sessions', { modelId: model.id, billingAccountId: account.id })
    ).json() as SessionDetail;
    const lastSystem = () => providers.openai.requests.filter((r) => !r.system.startsWith('You write short titles')).at(-1)!.system;
    const settle = async () => {
      await app.chat.runner.idle();
      await (app.chat.titles as InlineTitleQueue).idle();
    };

    await req(u.cookie, 'POST', `/api/chat/v2/session/${s.session.id}/post-message`, { text: 'hi' });
    await settle();
    expect(lastSystem()).toContain('Be brief.');
    expect(lastSystem()).not.toContain('Dentist');

    const patched = await req(u.cookie, 'PATCH', `/api/chat/v2/session/${s.session.id}`, { includeMemories: true });
    expect(patched.json().session.includeMemories).toBe(true);
    await req(u.cookie, 'POST', `/api/chat/v2/session/${s.session.id}/post-message`, { text: 'again' });
    await settle();
    expect(lastSystem()).toContain('- (Reminder) Dentist on Friday');
  });
});
