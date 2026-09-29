import type { ChatStreamEvent, ModelSummary, SessionDetail } from '@wchats/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import type { InlineTitleQueue } from '../src/chat/titles.js';
import { grantCredit, ledgerSum } from '../src/billing/ledger.js';
import { computeCost } from '../src/billing/pricing.js';
import { db } from '../src/db/client.js';
import { billingAccounts, chatSessions, ledgerEntries, messages, models, profiles } from '../src/db/schema.js';
import { upsertModels } from '../src/models/catalog.js';
import type { ProviderEvent } from '../src/providers/types.js';
import { fakeRegistry } from './fakes.js';
import { signUp, type TestUser } from './helpers.js';

const { registry, providers } = fakeRegistry();
const defaultScript = providers.openai.script;
let app: FastifyInstance;

beforeAll(async () => {
  await upsertModels(db, seedModels);
  app = await buildApp({ providers: registry });
});
afterEach(async () => {
  await settle();
  for (const p of Object.values(providers)) {
    p.script = defaultScript;
    p.titleText = 'Test title.';
  }
});
afterAll(async () => {
  await app.close();
});

async function settle() {
  await app.chat.runner.idle();
  await (app.chat.titles as InlineTitleQueue).idle();
}

const usage = (o: Partial<Record<string, number>> = {}) => ({
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 50,
  reasoningTokens: 0,
  webSearches: 0,
  ...o,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function personalAccount(userId: string) {
  return (await db.query.billingAccounts.findFirst({
    where: and(eq(billingAccounts.ownerUserId, userId), eq(billingAccounts.kind, 'personal')),
  }))!;
}

async function fundedUser(credit = 1_000_000_000n): Promise<TestUser & { accountId: string }> {
  const u = await signUp(app);
  const account = await personalAccount(u.id);
  if (credit > 0n) await grantCredit(db, { accountId: account.id, amountNano: credit, reason: 'test' });
  return { ...u, accountId: account.id };
}

async function modelId(slug: string) {
  return (await db.query.models.findFirst({ where: eq(models.slug, slug) }))!.id;
}

async function createSession(u: { cookie: string; accountId: string }, slug = 'gpt-5.6-luna') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chat/v2/sessions',
    headers: { cookie: u.cookie },
    payload: { modelId: await modelId(slug), billingAccountId: u.accountId },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as SessionDetail;
}

function post(cookie: string, sessionId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/chat/v2/session/${sessionId}/post-message`,
    headers: { cookie },
    payload,
  });
}

async function detail(cookie: string, sessionId: string) {
  return (await app.inject({ method: 'GET', url: `/api/chat/v2/session/${sessionId}`, headers: { cookie } })).json() as SessionDetail;
}

describe('sessions', () => {
  it('creates, lists, renames and soft-deletes sessions', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    expect(s.session).toMatchObject({ title: null, modelName: 'GPT-5.6 Luna', billingAccountName: '[Personal] TEST USER' });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/chat/v2/session/${s.session.id}`,
      headers: { cookie: u.cookie },
      payload: { title: 'My chat' },
    });
    expect(renamed.json().session.title).toBe('My chat');

    const list = await app.inject({ method: 'GET', url: '/api/chat/v2/sessions', headers: { cookie: u.cookie } });
    expect(list.json().sessions.map((x: { id: string }) => x.id)).toEqual([s.session.id]);

    const del = await app.inject({ method: 'DELETE', url: `/api/chat/v2/session/${s.session.id}`, headers: { cookie: u.cookie } });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/chat/v2/sessions', headers: { cookie: u.cookie } });
    expect(after.json().sessions).toEqual([]);
    const gone = await app.inject({ method: 'GET', url: `/api/chat/v2/session/${s.session.id}`, headers: { cookie: u.cookie } });
    expect(gone.statusCode).toBe(404);
  });

  it("hides other users' sessions and rejects accounts the user isn't a member of", async () => {
    const a = await fundedUser();
    const b = await fundedUser();
    const s = await createSession(a);
    const peek = await app.inject({ method: 'GET', url: `/api/chat/v2/session/${s.session.id}`, headers: { cookie: b.cookie } });
    expect(peek.statusCode).toBe(404);
    const steal = await app.inject({
      method: 'POST',
      url: '/api/chat/v2/sessions',
      headers: { cookie: b.cookie },
      payload: { modelId: await modelId('gpt-5.6-luna'), billingAccountId: a.accountId },
    });
    expect(steal.statusCode).toBe(403);
  });

  it('keeps questions from the removed Ask app out of chat, and the Ask API is gone', async () => {
    const u = await fundedUser();
    const [legacy] = await db
      .insert(chatSessions)
      .values({ userId: u.id, modelId: await modelId('gpt-5.6-luna'), billingAccountId: u.accountId, kind: 'ask' })
      .returning();
    const list = await app.inject({ method: 'GET', url: '/api/chat/v2/sessions', headers: { cookie: u.cookie } });
    expect(list.json().sessions).toEqual([]);
    const open = await app.inject({ method: 'GET', url: `/api/chat/v2/session/${legacy!.id}`, headers: { cookie: u.cookie } });
    expect(open.statusCode).toBe(404);
    const ask = await app.inject({ method: 'GET', url: '/api/ask/history', headers: { cookie: u.cookie } });
    expect(ask.statusCode).toBe(404);
  });

  it('returns 403 when the chat frontend is not allowed', async () => {
    const u = await fundedUser();
    await db.update(profiles).set({ allowedFrontends: ['simgen'] }).where(eq(profiles.userId, u.id));
    const res = await app.inject({ method: 'GET', url: '/api/chat/v2/sessions', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('post-message → generation → billing', () => {
  it('streams a reply, charges the ledger and titles the session', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'reasoning.delta', text: 'hidden' };
      yield { type: 'text.delta', text: 'Paris is the ' };
      yield { type: 'text.delta', text: 'capital.' };
      yield { type: 'done', stopReason: 'complete', usage: usage({ reasoningTokens: 20 }), rawUsage: { raw: 1 } };
    };
    for (const p of Object.values(providers)) p.titleText = '"Capital of France."';
    const res = await post(u.cookie, s.session.id, { text: '  What is the capital of France? ', effort: 'low' });
    expect(res.statusCode).toBe(202);
    expect(res.json().userMessage).toMatchObject({ role: 'user', status: 'complete', content: 'What is the capital of France?', effort: 'low' });
    expect(res.json().assistantMessage).toMatchObject({ role: 'assistant', status: 'pending' });

    await settle();

    const req = providers.openai.requests.filter((r) => !r.system.startsWith('You write short titles')).at(-1)!;
    expect(req.model).toBe('gpt-5.6-luna');
    expect(req.effort).toBe('low');
    expect(req.system).toContain("Today's date is");
    expect(req.messages).toEqual([{ role: 'user', parts: [{ type: 'text', text: 'What is the capital of France?' }] }]);

    const d = await detail(u.cookie, s.session.id);
    expect(d.session.title).toBe('Capital of France');
    const reply = d.messages[1]!;
    expect(reply).toMatchObject({ status: 'complete', content: 'Paris is the capital.', errorCode: null });

    const model = (await db.query.models.findFirst({ where: eq(models.slug, 'gpt-5.6-luna') }))!;
    const expected = computeCost(usage({ reasoningTokens: 20 }), model, '1.25').costNano;
    expect(reply.costNanoUsd).toBe(expected.toString());

    const row = (await db.query.messages.findFirst({ where: eq(messages.id, reply.id) }))!;
    expect(row.usageRaw).toEqual({ raw: 1 });
    expect(row.usage).toMatchObject({ reasoningTokens: 20 });
    expect(row.pricing).toMatchObject({ markup: '1.25', inputUsdPerMtok: model.inputUsdPerMtok });

    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.billingAccountId, u.accountId));
    expect(entries.map((e) => e.kind).sort()).toEqual(['credit_grant', 'usage_charge', 'usage_charge']);
    expect(entries.find((e) => e.messageId === reply.id)!.amountNanoUsd).toBe(-expected);
    expect(entries.find((e) => e.kind === 'usage_charge' && e.messageId === null)!.reason).toContain('Session title');
    // Every usage charge records its model, so usage can be reported per model.
    expect(entries.find((e) => e.messageId === reply.id)!.modelId).toBe(model.id);
    expect(entries.find((e) => e.kind === 'usage_charge' && e.messageId === null)!.modelId).not.toBeNull();
    const account = await personalAccount(u.id);
    expect(account.balanceNanoUsd).toBe(await ledgerSum(db, u.accountId));
  });

  it('includes prior turns but drops refused exchanges', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    await post(u.cookie, s.session.id, { text: 'first' });
    await settle();
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'refusal' };
      yield { type: 'done', stopReason: 'refusal', usage: usage(), rawUsage: {} };
    };
    await post(u.cookie, s.session.id, { text: 'bad request' });
    await settle();
    providers.openai.script = defaultScript;
    await post(u.cookie, s.session.id, { text: 'third' });
    await settle();

    const msgs = providers.openai.requests.at(-1)!.messages.map((m) => `${m.role}:${(m.parts[0] as { text: string }).text}`);
    expect(msgs).toEqual(['user:first', 'assistant:Hello', 'user:third']);

    const d = await detail(u.cookie, s.session.id);
    expect(d.messages[3]).toMatchObject({
      status: 'refused',
      errorMessage: 'The provider declined this request. Rephrase it before continuing.',
    });
  });

  it('marks max-token stops as truncated with the inline message', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'text.delta', text: 'Partial' };
      yield { type: 'done', stopReason: 'max_tokens', usage: usage(), rawUsage: {} };
    };
    await post(u.cookie, s.session.id, { text: 'long essay' });
    await settle();
    const d = await detail(u.cookie, s.session.id);
    expect(d.messages[1]).toMatchObject({
      status: 'truncated',
      content: 'Partial',
      errorMessage: 'The provider stopped before a complete answer was ready',
    });
  });

  it('charges reported usage even when the provider errors midway', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'text.delta', text: 'Half' };
      yield { type: 'error', message: 'overloaded', usage: usage(), rawUsage: {} };
    };
    await post(u.cookie, s.session.id, { text: 'hi' });
    await settle();
    const d = await detail(u.cookie, s.session.id);
    expect(d.messages[1]).toMatchObject({ status: 'error', errorCode: 'provider_error', errorMessage: 'overloaded' });
    expect(d.messages[1]!.costNanoUsd).not.toBeNull();
    expect(d.session.title).toBeNull();
  });

  it('blocks sends at zero balance with 402 and creates no messages', async () => {
    const u = await fundedUser(0n);
    const s = await createSession(u);
    const res = await post(u.cookie, s.session.id, { text: 'hello' });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('insufficient_credit');
    const rows = await db.select().from(messages).where(eq(messages.sessionId, s.session.id));
    expect(rows).toHaveLength(0);
  });

  it('rejects a second send while a reply is in flight', async () => {
    const u = await fundedUser();
    const s = await createSession(u);
    const gate = deferred();
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      await gate.promise;
      yield { type: 'done', stopReason: 'complete', usage: usage(), rawUsage: {} };
    };
    expect((await post(u.cookie, s.session.id, { text: 'one' })).statusCode).toBe(202);
    const second = await post(u.cookie, s.session.id, { text: 'two' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('busy');
    gate.resolve();
  });

  it('validates effort against the model and rejects retired models', async () => {
    const u = await fundedUser();
    const s = await createSession(u, 'gpt-5.6-luna');
    const bad = await post(u.cookie, s.session.id, { text: 'x', effort: 'xhigh' });
    expect(bad.statusCode).toBe(400);

    await db.update(models).set({ isRetired: true }).where(eq(models.slug, 'gpt-5.6-luna'));
    try {
      const retired = await post(u.cookie, s.session.id, { text: 'x' });
      expect(retired.statusCode).toBe(409);
      expect(retired.json().error.code).toBe('model_retired');
      expect((await detail(u.cookie, s.session.id)).session.isRetired).toBe(true);
    } finally {
      await db.update(models).set({ isRetired: false }).where(eq(models.slug, 'gpt-5.6-luna'));
    }
  });

  it('never exposes reasoning text in stored content', async () => {
    const rows = await db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.role, 'assistant'), isNull(messages.errorCode)));
    expect(rows.every((r) => !r.content.includes('hidden'))).toBe(true);
  });
});

describe('listen SSE', () => {
  async function openStream(base: string, cookie: string, sessionId: string) {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/chat/v2/session/${sessionId}/listen`, {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const queue: ChatStreamEvent[] = [];
    const next = async (): Promise<ChatStreamEvent> => {
      for (;;) {
        if (queue.length) return queue.shift()!;
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed');
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) queue.push(JSON.parse(data.slice(6)) as ChatStreamEvent);
        }
      }
    };
    const until = async (type: ChatStreamEvent['type']) => {
      const seen: ChatStreamEvent[] = [];
      for (;;) {
        const ev = await next();
        seen.push(ev);
        if (ev.type === type) return seen;
      }
    };
    return { next, until, close: () => controller.abort() };
  }

  it('replays the in-progress reply on reconnect, then continues live', async () => {
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const u = await fundedUser();
    const s = await createSession(u);
    const firstHalf = deferred();
    const gate = deferred();
    providers.openai.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'text.delta', text: 'Hello ' };
      yield { type: 'text.delta', text: 'there, ' };
      firstHalf.resolve();
      await gate.promise;
      yield { type: 'text.delta', text: 'friend.' };
      yield { type: 'done', stopReason: 'complete', usage: usage(), rawUsage: {} };
    };

    const first = await openStream(base, u.cookie, s.session.id);
    expect(await first.next()).toEqual({ type: 'snapshot', inflight: null });

    const res = await post(u.cookie, s.session.id, { text: 'hi' });
    const assistantId = res.json().assistantMessage.id as string;
    await firstHalf.promise;
    const seen = await first.until('text.delta');
    expect(seen[0]).toMatchObject({ type: 'message.started', messageId: assistantId });
    first.close();

    // Reconnect mid-stream: the snapshot carries everything generated so far.
    const second = await openStream(base, u.cookie, s.session.id);
    const snap = await second.next();
    expect(snap).toMatchObject({
      type: 'snapshot',
      inflight: { messageId: assistantId, status: 'streaming', content: 'Hello there, ' },
    });

    gate.resolve();
    const rest = await second.until('done');
    const tail = rest.map((e) => (e.type === 'text.delta' ? e.text : '')).join('');
    expect((snap as { inflight: { content: string } }).inflight.content + tail).toBe('Hello there, friend.');
    expect(rest.at(-1)).toMatchObject({ type: 'done', messageId: assistantId, status: 'complete' });
    expect((rest.at(-1) as { balanceCents: number }).balanceCents).toBeTypeOf('number');

    const titled = await second.until('session.updated');
    expect(titled.at(-1)).toMatchObject({ type: 'session.updated', sessionId: s.session.id, title: 'Test title' });
    second.close();
  });
});

describe('model availability', () => {
  it('rejects new sessions for a provider without a key', async () => {
    const { registry: noGoogle } = fakeRegistry({ google: false });
    const other = await buildApp({ providers: noGoogle });
    try {
      const u = await signUp(other);
      const account = await personalAccount(u.id);
      const list = (await other.inject({ method: 'GET', url: '/api/models', headers: { cookie: u.cookie } })).json()
        .models as ModelSummary[];
      expect(list.some((m) => m.provider === 'google')).toBe(false);
      const res = await other.inject({
        method: 'POST',
        url: '/api/chat/v2/sessions',
        headers: { cookie: u.cookie },
        payload: { modelId: await modelId('gemini-flash'), billingAccountId: account.id },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('model_unavailable');
    } finally {
      await other.close();
    }
  });
});
