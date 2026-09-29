import type { ModelSummary } from '@wchats/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { models } from '../src/db/schema.js';
import { cheapestModel, upsertModels } from '../src/models/catalog.js';
import { fakeRegistry } from './fakes.js';
import { signUp } from './helpers.js';

let app: FastifyInstance;
const { registry } = fakeRegistry({ google: false });

beforeAll(async () => {
  await upsertModels(db, seedModels);
  app = await buildApp({ providers: registry });
});
afterAll(async () => {
  await app.close();
  await db.update(models).set({ isRetired: false });
});

describe('model catalog', () => {
  it('hides models whose provider has no key, and retired models', async () => {
    await db.update(models).set({ isRetired: true }).where(eq(models.slug, 'gpt-6-luna'));
    const u = await signUp(app);
    const res = await app.inject({ method: 'GET', url: '/api/models', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json().models as ModelSummary[];
    expect(new Set(list.map((m) => m.provider))).toEqual(new Set(['openai', 'anthropic']));
    expect(list.map((m) => m.displayName)).not.toContain('GPT-6 Luna');
    expect(list[0]).not.toHaveProperty('providerModelId');
    expect(list[0]).not.toHaveProperty('inputUsdPerMtok');
  });

  it('persists favorites per user', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const list = (await app.inject({ method: 'GET', url: '/api/models', headers: { cookie: a.cookie } })).json()
      .models as ModelSummary[];
    const target = list[2]!;
    const put = await app.inject({ method: 'PUT', url: `/api/models/${target.id}/favorite`, headers: { cookie: a.cookie } });
    expect(put.statusCode).toBe(204);
    await app.inject({ method: 'PUT', url: `/api/models/${target.id}/favorite`, headers: { cookie: a.cookie } });

    const fav = (id: string, cookie: string) =>
      app
        .inject({ method: 'GET', url: '/api/models', headers: { cookie } })
        .then((r) => (r.json().models as ModelSummary[]).find((m) => m.id === id)!.isFavorite);
    expect(await fav(target.id, a.cookie)).toBe(true);
    expect(await fav(target.id, b.cookie)).toBe(false);

    await app.inject({ method: 'DELETE', url: `/api/models/${target.id}/favorite`, headers: { cookie: a.cookie } });
    expect(await fav(target.id, a.cookie)).toBe(false);
  });

  it('404s favoriting an unknown model and 400s a bad id', async () => {
    const u = await signUp(app);
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/models/00000000-0000-4000-8000-000000000000/favorite',
      headers: { cookie: u.cookie },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'PUT', url: '/api/models/nope/favorite', headers: { cookie: u.cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('picks the cheapest configured model for titles', async () => {
    const m = await cheapestModel(db, registry);
    // Google is unconfigured here, so its Flash-Lite model must not be chosen.
    expect(m?.provider).not.toBe('google');
    expect(m?.slug).toBe('gpt-5.6-luna');
  });
});
