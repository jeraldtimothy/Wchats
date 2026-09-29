import type { IamModel, ModelSummary } from '@wchats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { models } from '../src/db/schema.js';
import { upsertModels } from '../src/models/catalog.js';
import { fakeRegistry } from './fakes.js';
import { manager, signUp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let m: TestUser;
beforeAll(async () => {
  await upsertModels(db, seedModels, { force: true });
  app = await buildApp({ providers: fakeRegistry({ google: false }).registry });
  m = await manager(app);
});
afterAll(async () => {
  await upsertModels(db, seedModels, { force: true });
  await app.close();
});

const bySlug = async (slug: string) => (await db.query.models.findFirst({ where: eq(models.slug, slug) }))!;
const patch = (id: string, payload: object, cookie = m.cookie) =>
  app.inject({ method: 'PATCH', url: `/api/iam/models/${id}`, headers: { cookie }, payload });

describe('IAM models', () => {
  it('lists every model with prices and provider status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/iam/models', headers: { cookie: m.cookie } });
    const list = res.json().models as IamModel[];
    expect(list).toHaveLength(seedModels.length);
    const flash = list.find((x) => x.slug === 'gemini-flash')!;
    expect(flash).toMatchObject({ providerConfigured: false, inputUsdPerMtok: '0.5', editedAt: null });
  });

  it('edits prices and fields and marks the model as edited', async () => {
    const luna = await bySlug('gpt-5.6-luna');
    const res = await patch(luna.id, { inputUsdPerMtok: '0.3', outputUsdPerMtok: '2.4', displayName: 'GPT-5.6 Luna (EU)', agentEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ inputUsdPerMtok: '0.3', outputUsdPerMtok: '2.4', displayName: 'GPT-5.6 Luna (EU)', agentEnabled: true });
    expect(res.json().editedAt).not.toBeNull();
    expect((await bySlug('gpt-5.6-luna')).inputUsdPerMtok).toBe('0.300000');
  });

  it('keeps the default effort consistent with the allowed efforts', async () => {
    const sol = await bySlug('gpt-5.6-sol');
    expect((await patch(sol.id, { reasoningEfforts: ['low', 'high'], defaultEffort: 'medium' })).statusCode).toBe(400);
    const ok = await patch(sol.id, { reasoningEfforts: ['low', 'high'] });
    expect(ok.json()).toMatchObject({ reasoningEfforts: ['low', 'high'], defaultEffort: 'low' });
    const none = await patch(sol.id, { reasoningEfforts: [] });
    expect(none.json().defaultEffort).toBeNull();
  });

  it('rejects bad prices and invalid values', async () => {
    const x = await bySlug('claude-opus-5');
    expect((await patch(x.id, { inputUsdPerMtok: '1.1234567' })).statusCode).toBe(400);
    expect((await patch(x.id, { inputUsdPerMtok: '-1' })).statusCode).toBe(400);
    expect((await patch(x.id, { tier: 'gold' })).statusCode).toBe(400);
    expect((await patch(x.id, {})).statusCode).toBe(400);
  });

  it('retiring hides a model from the picker; unretiring brings it back', async () => {
    const u = await signUp(app);
    const haiku = await bySlug('claude-haiku-4.5');
    const picker = async () =>
      ((await app.inject({ method: 'GET', url: '/api/models', headers: { cookie: u.cookie } })).json().models as ModelSummary[]).map(
        (x) => x.id,
      );
    await patch(haiku.id, { isRetired: true });
    expect(await picker()).not.toContain(haiku.id);
    await patch(haiku.id, { isRetired: false });
    expect(await picker()).toContain(haiku.id);
  });

  it('seeding keeps IAM edits unless forced', async () => {
    const terra = await bySlug('gpt-5.6-terra');
    await patch(terra.id, { outputUsdPerMtok: '99' });
    const kept = await upsertModels(db, seedModels);
    expect(kept).toContain('gpt-5.6-terra');
    expect((await bySlug('gpt-5.6-terra')).outputUsdPerMtok).toBe('99.000000');
    await upsertModels(db, seedModels, { force: true });
    const reset = await bySlug('gpt-5.6-terra');
    expect(reset.outputUsdPerMtok).toBe('10.000000');
    expect(reset.editedAt).toBeNull();
  });

  it('is manager-only', async () => {
    const u = await signUp(app);
    const x = await bySlug('claude-opus-5');
    expect((await patch(x.id, { isRetired: true }, u.cookie)).statusCode).toBe(403);
  });
});
