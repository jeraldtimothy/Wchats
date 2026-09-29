import type { AskHistoryItem } from '@wchats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { grantCredit } from '../src/billing/ledger.js';
import type { InlineTitleQueue } from '../src/chat/titles.js';
import { db } from '../src/db/client.js';
import { billingAccounts, chatSessions, ledgerEntries, models, profiles } from '../src/db/schema.js';
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

const settle = async () => {
  await app.chat.runner.idle();
  await (app.chat.titles as InlineTitleQueue).idle();
};

async function user(credit = 1_000_000_000n) {
  const u = await signUp(app);
  const account = (await db.query.billingAccounts.findFirst({
    where: and(eq(billingAccounts.ownerUserId, u.id), eq(billingAccounts.kind, 'personal')),
  }))!;
  if (credit) await grantCredit(db, { accountId: account.id, amountNano: credit, reason: 'test' });
  const model = (await db.query.models.findFirst({ where: eq(models.slug, 'claude-haiku-4.5') }))!;
  return { ...u, accountId: account.id, modelId: model.id };
}

const ask = (u: { cookie: string; accountId: string; modelId: string }, text: string, extra: object = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/ask',
    headers: { cookie: u.cookie },
    payload: { modelId: u.modelId, billingAccountId: u.accountId, text, ...extra },
  });

describe('Ask', () => {
  it('answers one question, bills it, and keeps it out of chat', async () => {
    const u = await user();
    const res = await ask(u, 'What is 2 + 2?', { effort: 'low' });
    expect(res.statusCode).toBe(202);
    const { session, userMessage, assistantMessage } = res.json();
    expect(userMessage).toMatchObject({ role: 'user', content: 'What is 2 + 2?', effort: 'low' });
    expect(assistantMessage.status).toBe('pending');
    await settle();

    const detail = await app.inject({ method: 'GET', url: `/api/ask/${session.id}`, headers: { cookie: u.cookie } });
    expect(detail.json().messages[1]).toMatchObject({ status: 'complete', content: 'Hello' });
    expect(detail.json().session.title).toBeNull();

    const history = (await app.inject({ method: 'GET', url: '/api/ask/history', headers: { cookie: u.cookie } })).json()
      .items as AskHistoryItem[];
    expect(history).toEqual([
      expect.objectContaining({ id: session.id, question: 'What is 2 + 2?', modelName: 'Claude Haiku 4.5', status: 'complete' }),
    ]);

    const chats = await app.inject({ method: 'GET', url: '/api/chat/v2/sessions', headers: { cookie: u.cookie } });
    expect(chats.json().sessions).toEqual([]);
    const viaChat = await app.inject({ method: 'GET', url: `/api/chat/v2/session/${session.id}`, headers: { cookie: u.cookie } });
    expect(viaChat.statusCode).toBe(404);

    const charges = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.billingAccountId, u.accountId), eq(ledgerEntries.kind, 'usage_charge')));
    expect(charges).toHaveLength(1);
    expect(charges[0]!.messageId).toBe(assistantMessage.id);
    expect(providers.anthropic.requests.at(-1)).toMatchObject({ effort: 'low', webSearch: false });
  });

  it('blocks at zero balance without leaving a session behind', async () => {
    const u = await user(0n);
    const res = await ask(u, 'Hello?');
    expect(res.statusCode).toBe(402);
    const rows = await db.select().from(chatSessions).where(eq(chatSessions.userId, u.id));
    expect(rows).toHaveLength(0);
  });

  it('removes a failed send (bad effort) instead of keeping an empty question', async () => {
    const u = await user();
    const res = await ask(u, 'Hello?', { effort: 'xhigh' });
    expect(res.statusCode).toBe(400);
    expect(await db.select().from(chatSessions).where(eq(chatSessions.userId, u.id))).toHaveLength(0);
  });

  it('is only available to users with the ask frontend', async () => {
    const u = await user();
    await db.update(profiles).set({ allowedFrontends: ['chat'] }).where(eq(profiles.userId, u.id));
    expect((await ask(u, 'x')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/ask/history', headers: { cookie: u.cookie } })).statusCode).toBe(403);
  });

  it('deletes questions from the history and hides chat sessions from Ask', async () => {
    const u = await user();
    const { session } = (await ask(u, 'Delete me')).json();
    await settle();
    const del = await app.inject({ method: 'DELETE', url: `/api/ask/${session.id}`, headers: { cookie: u.cookie } });
    expect(del.statusCode).toBe(204);
    const history = await app.inject({ method: 'GET', url: '/api/ask/history', headers: { cookie: u.cookie } });
    expect(history.json().items).toEqual([]);

    const chat = await app.inject({
      method: 'POST',
      url: '/api/chat/v2/sessions',
      headers: { cookie: u.cookie },
      payload: { modelId: u.modelId, billingAccountId: u.accountId },
    });
    const viaAsk = await app.inject({ method: 'GET', url: `/api/ask/${chat.json().session.id}`, headers: { cookie: u.cookie } });
    expect(viaAsk.statusCode).toBe(404);
  });
});
