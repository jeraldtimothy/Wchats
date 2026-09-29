import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { provisionUser } from '../src/accounts/provision.js';
import { grantCredit } from '../src/billing/ledger.js';
import { db } from '../src/db/client.js';
import { chatSessions, ledgerEntries, memoryItems, messages, models, profiles, user } from '../src/db/schema.js';
import { crawlMemories, parseProposal } from '../src/memories/crawl.js';
import { upsertModels } from '../src/models/catalog.js';
import type { ChatRequest, ProviderEvent } from '../src/providers/types.js';
import { fakeRegistry } from './fakes.js';

const { registry, providers } = fakeRegistry();
const deps = { db, providers: registry, markup: '1.25' };
const usage = { inputTokens: 500, cachedInputTokens: 0, outputTokens: 60, reasoningTokens: 0, webSearches: 0 };

let reply = '{"items":[]}';
let failWith: string | null = null;
const calls: ChatRequest[] = [];

beforeAll(async () => {
  await upsertModels(db, seedModels, { force: true });
  for (const p of Object.values(providers)) {
    p.script = async function* (req): AsyncGenerator<ProviderEvent> {
      calls.push(req);
      if (failWith) {
        yield { type: 'error', message: failWith, usage, rawUsage: {} };
        return;
      }
      yield { type: 'text.delta', text: reply };
      yield { type: 'done', stopReason: 'complete', usage, rawUsage: {} };
    };
  }
});
afterEach(() => {
  reply = '{"items":[]}';
  failWith = null;
  calls.length = 0;
});

async function makeUser(opts: { optIn?: boolean; creditNano?: bigint } = {}) {
  const id = randomUUID();
  await db.insert(user).values({ id, name: 'Crawl User', email: `${id}@example.com` });
  const { personalAccountId } = await provisionUser(db, { id, name: 'Crawl User', email: `${id}@example.com` });
  await db.update(profiles).set({ generateAiMemories: opts.optIn ?? true }).where(eq(profiles.userId, id));
  const credit = opts.creditNano ?? 1_000_000_000n;
  if (credit > 0n) await grantCredit(db, { accountId: personalAccountId, amountNano: credit, reason: 'test' });
  return { id, accountId: personalAccountId };
}

async function makeSession(u: { id: string; accountId: string }, exchange: [string, string]) {
  const model = (await db.query.models.findFirst({ where: eq(models.slug, 'gpt-5.6-luna') }))!;
  const [s] = await db.insert(chatSessions).values({ userId: u.id, modelId: model.id, billingAccountId: u.accountId }).returning();
  const now = Date.now();
  await db.insert(messages).values([
    { sessionId: s!.id, role: 'user', status: 'complete', content: exchange[0], createdAt: new Date(now) },
    { sessionId: s!.id, role: 'assistant', status: 'complete', content: exchange[1], createdAt: new Date(now + 1) },
  ]);
  return s!;
}

const items = (userId: string) => db.select().from(memoryItems).where(eq(memoryItems.userId, userId));
const session = async (id: string) => (await db.query.chatSessions.findFirst({ where: eq(chatSessions.id, id) }))!;

describe('crawlMemories', () => {
  it('adds new AI-generated items, skips duplicates, charges and marks sessions crawled', async () => {
    const u = await makeUser();
    await db.insert(memoryItems).values({ userId: u.id, type: 'preference', content: 'Prefers metric units.' });
    const s1 = await makeSession(u, ['I live in Manila and use metric', 'Noted!']);
    const s2 = await makeSession(u, ['Remind me I am vegetarian', 'Sure.']);
    reply =
      'Here you go:\n```json\n{"items":[' +
      '{"type":"preference","content":"prefers METRIC units"},' +
      '{"type":"fact","content":"Lives in Manila.","session":1},' +
      '{"type":"reminder","content":"Is vegetarian.","session":2},' +
      '{"type":"mystery","content":"Likes tea."}]}\n```';

    const result = await crawlMemories(deps, { userId: u.id });
    expect(result).toEqual({ users: 1, sessions: 2, items: 3 });

    const rows = (await items(u.id)).filter((r) => r.aiGenerated);
    expect(rows.map((r) => [r.type, r.content, r.sourceSessionId]).sort()).toEqual(
      [
        ['fact', 'Lives in Manila.', s1.id],
        ['other', 'Likes tea.', null],
        ['reminder', 'Is vegetarian.', s2.id],
      ].sort(),
    );
    expect(calls[0]!.system).toContain('durable memory items');
    expect((calls[0]!.messages[0]!.parts[0] as { text: string }).text).toContain('- Prefers metric units.');
    expect((await session(s1.id)).crawledAt).not.toBeNull();

    const charges = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.billingAccountId, u.accountId), eq(ledgerEntries.kind, 'usage_charge')));
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ reason: 'AI memories', messageId: null });
    expect(charges[0]!.modelId).not.toBeNull();
  });

  it('re-reads a session only after new activity', async () => {
    const u = await makeUser();
    const s = await makeSession(u, ['hello', 'hi']);
    await crawlMemories(deps, { userId: u.id });
    expect(calls).toHaveLength(1);

    await crawlMemories(deps, { userId: u.id });
    expect(calls).toHaveLength(1); // nothing new

    await db.update(chatSessions).set({ lastActivityAt: new Date(Date.now() + 60_000) }).where(eq(chatSessions.id, s.id));
    await crawlMemories(deps, { userId: u.id });
    expect(calls).toHaveLength(2);
  });

  it('skips users who opted out or have no credit', async () => {
    const out = await makeUser({ optIn: false });
    await makeSession(out, ['a', 'b']);
    const broke = await makeUser({ creditNano: 0n });
    await makeSession(broke, ['a', 'b']);
    expect(await crawlMemories(deps, { userId: out.id })).toEqual({ users: 0, sessions: 0, items: 0 });
    expect(await crawlMemories(deps, { userId: broke.id })).toEqual({ users: 0, sessions: 0, items: 0 });
    expect(calls).toHaveLength(0);
  });

  it('tolerates unusable replies but retries after provider errors', async () => {
    const u = await makeUser();
    const s = await makeSession(u, ['a', 'b']);
    reply = 'I could not find anything, sorry.';
    expect((await crawlMemories(deps, { userId: u.id })).items).toBe(0);
    expect((await session(s.id)).crawledAt).not.toBeNull();

    const v = await makeUser();
    const t = await makeSession(v, ['a', 'b']);
    failWith = 'overloaded';
    await crawlMemories(deps, { userId: v.id });
    expect((await session(t.id)).crawledAt).toBeNull();
  });
});

describe('parseProposal', () => {
  it('extracts JSON from fences or prose and coerces unknown types', () => {
    expect(parseProposal('```json\n{"items":[{"type":"fact","content":"x"}]}\n```')).toEqual([{ type: 'fact', content: 'x' }]);
    expect(parseProposal('Sure! {"items":[{"type":"weird","content":"y","session":2}]} Done.')).toEqual([
      { type: 'other', content: 'y', session: 2 },
    ]);
    expect(parseProposal('no json')).toBeNull();
    expect(parseProposal('{"items": "nope"}')).toBeNull();
    expect(parseProposal('{"items":[{"type":"fact","content":""}]}')).toBeNull();
  });
});
