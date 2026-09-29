import type { SessionDetail } from '@wchats/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../../seed/models.config.js';
import { buildApp } from '../../src/app.js';
import { grantCredit } from '../../src/billing/ledger.js';
import type { InlineTitleQueue } from '../../src/chat/titles.js';
import { db } from '../../src/db/client.js';
import { billingAccounts, ledgerEntries, memoryItems, models, profiles } from '../../src/db/schema.js';
import { crawlMemories, parseProposal } from '../../src/memories/crawl.js';
import { upsertModels } from '../../src/models/catalog.js';
import { createRegistry } from '../../src/providers/index.js';
import { SimulatedProvider } from '../../src/providers/simulated.js';
import type { ChatRequest, ProviderEvent } from '../../src/providers/types.js';
import { signUp } from '../helpers.js';
import { collect, texts } from './helpers.js';

const sim = new SimulatedProvider('openai', { delayMs: 0 });

const request = (text: string, overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  model: 'gpt-5.6-luna',
  system: 'You are helpful.',
  messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
  maxOutputTokens: 1000,
  webSearch: false,
  multiTurnTools: false,
  ...overrides,
});

const done = (events: ProviderEvent[]) => events.at(-1) as Extract<ProviderEvent, { type: 'done' }>;

describe('SimulatedProvider', () => {
  it('streams a Markdown reply naming the model, with estimated usage', async () => {
    const events = await collect(sim.streamChat(request('What is a ledger?')));
    const reply = texts(events);
    expect(reply).toContain('**Simulated reply** from `gpt-5.6-luna` (OpenAI)');
    expect(reply).toContain('You asked: “What is a ledger?”');
    expect(reply).toContain('| Thinking effort | not available |');
    expect(events.filter((e) => e.type === 'text.delta').length).toBeGreaterThan(10);
    expect(events.some((e) => e.type === 'reasoning.delta')).toBe(false);
    expect(done(events)).toMatchObject({ type: 'done', stopReason: 'complete', rawUsage: { simulated: true } });
    expect(done(events).usage.inputTokens).toBeGreaterThan(0);
    expect(done(events).usage.outputTokens).toBe(Math.ceil(reply.length / 4));
    expect(sim.isConfigured()).toBe(true);
  });

  it('shows thinking and bills reasoning tokens by effort', async () => {
    const events = await collect(sim.streamChat(request('Plan a trip', { effort: 'high' })));
    expect(events[0]).toEqual({ type: 'reasoning.delta' });
    expect(done(events).usage.reasoningTokens).toBe(900);
    expect(texts(events)).toContain('| Thinking effort | high |');
  });

  it('simulates web search with sources, twice when multiple turns are allowed', async () => {
    const events = await collect(sim.streamChat(request('latest rust release notes', { webSearch: true, multiTurnTools: true })));
    const starts = events.filter((e) => e.type === 'tool.started');
    expect(starts).toEqual([
      { type: 'tool.started', tool: 'web_search', query: 'latest rust release notes' },
      { type: 'tool.started', tool: 'web_search', query: 'latest rust release notes details' },
    ]);
    const sources = events.flatMap((e) => (e.type === 'tool.sources' ? e.sources : []));
    expect(sources).toHaveLength(4);
    expect(sources.every((s) => /^https:\/\/example\.(com|org)\//.test(s.url))).toBe(true);
    expect(texts(events)).toContain(`[1](${sources[0]!.url})`);
    expect(done(events).usage.webSearches).toBe(2);
  });

  it('acknowledges attachments and counts them as input', async () => {
    const withFiles = request('', {
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', text: '[Attached file: notes.docx]\n\nHello' },
            { type: 'image', mediaType: 'image/png', data: 'aW1n' },
            { type: 'document', mediaType: 'application/pdf', data: 'cGRm', filename: 'report.pdf' },
            { type: 'text', text: 'Summarize these' },
          ],
        },
      ],
    });
    const events = await collect(sim.streamChat(withFiles));
    expect(texts(events)).toContain('I received 3 attachments: notes.docx, an image, report.pdf.');
    expect(done(events).usage.inputTokens).toBeGreaterThan(800 + 1500);
  });

  it('demos refusal, truncation and error states on request', async () => {
    const refused = await collect(sim.streamChat(request('please [simulate refusal]')));
    expect(refused.map((e) => e.type)).toEqual(['refusal', 'done']);
    expect(done(refused).stopReason).toBe('refusal');

    const cut = await collect(sim.streamChat(request('long answer [simulate truncation]')));
    expect(done(cut).stopReason).toBe('max_tokens');
    expect(texts(cut).length).toBeLessThan(texts(await collect(sim.streamChat(request('long answer')))).length);

    const failed = await collect(sim.streamChat(request('x [SIMULATE ERROR]')));
    expect(failed.at(-1)).toMatchObject({ type: 'error', message: 'Simulated provider error.' });
  });

  it('answers title and memory prompts in the formats their callers parse', async () => {
    const title = await collect(
      sim.streamChat({
        ...request('User: what is the capital of france?\n\nAssistant: Paris.\n\nTitle:'),
        system: 'You write short titles for chat conversations.',
      }),
    );
    expect(texts(title)).toBe('What is the capital of');

    const memory = await collect(
      sim.streamChat({
        ...request('Existing memory items:\n(none)\n\n## Conversation 1\nUser: I prefer metric units\nAssistant: ok\n## Conversation 2\nUser: Remember my dentist is on Friday'),
        system: 'You maintain a short list of durable memory items',
      }),
    );
    expect(parseProposal(texts(memory))).toEqual([
      { type: 'preference', content: '(Simulated) The user said: "I prefer metric units"', session: 1 },
      { type: 'reminder', content: '(Simulated) The user said: "Remember my dentist is on Friday"', session: 2 },
    ]);
  });

  it('stops when the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(sim.streamChat(request('hello', { signal: controller.signal })));
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'The request was cancelled.' });
  });
});

describe('simulation through the app', () => {
  const registry = createRegistry({
    openai: new SimulatedProvider('openai', { delayMs: 0 }),
    anthropic: new SimulatedProvider('anthropic', { delayMs: 0 }),
    google: new SimulatedProvider('google', { delayMs: 0 }),
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    await upsertModels(db, seedModels, { force: true });
    app = await buildApp({ providers: registry });
  });
  afterAll(async () => {
    await app.close();
  });

  it('streams, bills and titles a chat, and feeds the memory job', async () => {
    const u = await signUp(app, 'Sim User');
    const account = (await db.query.billingAccounts.findFirst({
      where: and(eq(billingAccounts.ownerUserId, u.id), eq(billingAccounts.kind, 'personal')),
    }))!;
    await grantCredit(db, { accountId: account.id, amountNano: 1_000_000_000n, reason: 'test' });
    const model = (await db.query.models.findFirst({ where: eq(models.slug, 'claude-sonnet-5') }))!;
    const s = (
      await app.inject({
        method: 'POST',
        url: '/api/chat/v2/sessions',
        headers: { cookie: u.cookie },
        payload: { modelId: model.id, billingAccountId: account.id },
      })
    ).json() as SessionDetail;
    const post = await app.inject({
      method: 'POST',
      url: `/api/chat/v2/session/${s.session.id}/post-message`,
      headers: { cookie: u.cookie },
      payload: { text: 'I prefer short answers about gardening', webSearch: true, effort: 'low' },
    });
    expect(post.statusCode).toBe(202);
    await app.chat.runner.idle();
    await (app.chat.titles as InlineTitleQueue).idle();

    const detail = (
      await app.inject({ method: 'GET', url: `/api/chat/v2/session/${s.session.id}`, headers: { cookie: u.cookie } })
    ).json() as SessionDetail;
    expect(detail.session.title).toBe('I prefer short answers about');
    expect(detail.messages[1]).toMatchObject({ status: 'complete' });
    expect(detail.messages[1]!.content).toContain('(Anthropic)');
    expect(detail.messages[1]!.sources).toHaveLength(2);
    expect(BigInt(detail.messages[1]!.costNanoUsd!)).toBeGreaterThan(0n);

    const charges = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.billingAccountId, account.id), eq(ledgerEntries.kind, 'usage_charge')));
    expect(charges.length).toBe(2); // reply + title

    await db.update(profiles).set({ generateAiMemories: true }).where(eq(profiles.userId, u.id));
    const result = await crawlMemories({ db, providers: registry, markup: '1.25' }, { userId: u.id });
    expect(result.items).toBe(1);
    const [item] = await db.select().from(memoryItems).where(eq(memoryItems.userId, u.id));
    expect(item).toMatchObject({ type: 'preference', aiGenerated: true, sourceSessionId: s.session.id });
  });
});
