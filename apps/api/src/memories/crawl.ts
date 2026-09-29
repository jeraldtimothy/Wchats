import { MAX_MEMORY_CHARS, MAX_MEMORY_ITEMS, MemoryType, type Effort } from '@wchats/shared';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { chargeUsage } from '../billing/ledger.js';
import { computeCost } from '../billing/pricing.js';
import { listMessages } from '../chat/sessions.js';
import type { Db } from '../db/client.js';
import { billingAccounts, chatSessions, memoryItems, profiles } from '../db/schema.js';
import { cheapestModel } from '../models/catalog.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { Usage } from '../providers/types.js';

export const MAX_SESSIONS_PER_USER = 20;
export const MAX_TRANSCRIPT_CHARS = 12_000;
export const MAX_NEW_ITEMS = 5;

export interface CrawlDeps {
  db: Db;
  providers: ProviderRegistry;
  markup: string;
  log?: { error: (obj: unknown, msg?: string) => void };
}

export interface CrawlResult {
  users: number;
  sessions: number;
  items: number;
}

export const MEMORY_SYSTEM = `You maintain a short list of durable memory items about the user of a chat assistant: stable preferences, facts about the user, and reminders the user asked to keep.
From the conversations provided, extract at most ${MAX_NEW_ITEMS} NEW items that would help in future conversations.
Rules:
- Skip anything already covered by the existing items.
- Skip temporary details, anything about other people, and sensitive data (health, finances, passwords, government IDs, precise addresses).
- Each item is one short sentence in the user's language, in the third person, e.g. "Prefers metric units."
- "session" is the number of the conversation the item came from.
Respond with only JSON, no prose: {"items":[{"type":"preference|fact|reminder|other","content":"...","session":1}]}
If nothing qualifies, respond with {"items":[]}.`;

const Proposal = z.object({
  items: z
    .array(
      z.object({
        type: MemoryType.catch('other'),
        content: z.string().trim().min(1).max(MAX_MEMORY_CHARS),
        session: z.number().int().optional(),
      }),
    )
    .max(50),
});

/** Pulls the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function parseProposal(text: string): z.infer<typeof Proposal>['items'] | null {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = Proposal.safeParse(JSON.parse(unfenced.slice(start, end + 1)));
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function transcript(rows: Awaited<ReturnType<typeof listMessages>>): string {
  const lines: string[] = [];
  for (const m of rows) {
    if (m.role === 'user' && m.content) lines.push(`User: ${m.content}`);
    else if (m.role === 'assistant' && (m.status === 'complete' || m.status === 'truncated') && m.content) {
      lines.push(`Assistant: ${m.content}`);
    }
  }
  const text = lines.join('\n');
  return text.length > MAX_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n[…]` : text;
}

const EFFORT_ORDER: Effort[] = ['none', 'low', 'medium', 'high', 'xhigh'];

/**
 * The nightly AI-memory pass. For each opted-in user with credit on their
 * personal account, reads sessions that are new or have activity since the
 * last crawl, asks the cheapest model for new durable items, stores them as
 * AI-generated, charges the personal account and marks the sessions crawled.
 */
export async function crawlMemories(deps: CrawlDeps, opts: { userId?: string; now?: Date } = {}): Promise<CrawlResult> {
  const { db, providers } = deps;
  const result: CrawlResult = { users: 0, sessions: 0, items: 0 };
  const model = await cheapestModel(db, providers);
  if (!model) return result;

  const users = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(
      and(
        eq(profiles.generateAiMemories, true),
        eq(profiles.isDisabled, false),
        opts.userId ? eq(profiles.userId, opts.userId) : undefined,
      ),
    );

  for (const { userId } of users) {
    try {
      const done = await crawlUser(deps, model, userId, opts.now ?? new Date());
      if (done) {
        result.users += 1;
        result.sessions += done.sessions;
        result.items += done.items;
      }
    } catch (err) {
      deps.log?.error(err, `memory crawl failed for user ${userId}`);
    }
  }
  return result;
}

async function crawlUser(
  deps: CrawlDeps,
  model: NonNullable<Awaited<ReturnType<typeof cheapestModel>>>,
  userId: string,
  now: Date,
): Promise<{ sessions: number; items: number } | null> {
  const { db, providers } = deps;
  const account = await db.query.billingAccounts.findFirst({
    where: and(eq(billingAccounts.ownerUserId, userId), eq(billingAccounts.kind, 'personal')),
  });
  if (!account || account.isDisabled || account.balanceNanoUsd <= 0n) return null;

  const sessions = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.kind, 'chat'),
        isNull(chatSessions.deletedAt),
        or(isNull(chatSessions.crawledAt), gt(chatSessions.lastActivityAt, chatSessions.crawledAt)),
      ),
    )
    .orderBy(asc(chatSessions.lastActivityAt))
    .limit(MAX_SESSIONS_PER_USER);
  if (sessions.length === 0) return null;

  const markCrawled = () =>
    db.update(chatSessions).set({ crawledAt: now }).where(inArray(chatSessions.id, sessions.map((s) => s.id)));

  const texts: { sessionId: string; text: string }[] = [];
  for (const s of sessions) {
    const text = transcript(await listMessages(db, s.id));
    if (text) texts.push({ sessionId: s.id, text });
  }
  const existing = await db
    .select({ content: memoryItems.content })
    .from(memoryItems)
    .where(eq(memoryItems.userId, userId));
  const room = Math.min(MAX_NEW_ITEMS, MAX_MEMORY_ITEMS - existing.length);
  if (texts.length === 0 || room <= 0) {
    await markCrawled();
    return { sessions: sessions.length, items: 0 };
  }

  const prompt = [
    'Existing memory items:',
    existing.length ? existing.map((e) => `- ${e.content}`).join('\n') : '(none)',
    '',
    ...texts.map((t, i) => `## Conversation ${i + 1}\n${t.text}`),
  ].join('\n');

  const efforts = model.reasoningEfforts as Effort[];
  let reply = '';
  let usage: Usage | undefined;
  let failed: string | null = null;
  for await (const ev of providers.get(model.provider).streamChat({
    model: model.providerModelId,
    system: MEMORY_SYSTEM,
    messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
    effort: EFFORT_ORDER.find((e) => efforts.includes(e)),
    thinkingBudgets: {},
    maxOutputTokens: 2048,
    webSearch: false,
    multiTurnTools: false,
  })) {
    if (ev.type === 'text.delta') reply += ev.text;
    if (ev.type === 'done' || ev.type === 'error') {
      usage = ev.usage;
      if (ev.type === 'error') failed = ev.message;
      break;
    }
  }

  const seen = new Set(existing.map((e) => normalize(e.content)));
  const proposals = failed ? [] : (parseProposal(reply) ?? []);
  const fresh = proposals.filter((p) => {
    const key = normalize(p.content);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const items = fresh.slice(0, room);

  await db.transaction(async (tx) => {
    if (items.length) {
      await tx.insert(memoryItems).values(
        items.map((p) => ({
          userId,
          type: p.type,
          content: p.content,
          aiGenerated: true,
          sourceSessionId: p.session && texts[p.session - 1] ? texts[p.session - 1]!.sessionId : null,
        })),
      );
    }
    if (usage) {
      await chargeUsage(tx, {
        accountId: account.id,
        userId,
        messageId: null,
        modelId: model.id,
        costNano: computeCost(usage, model, deps.markup).costNano,
        reason: 'AI memories',
      });
    }
  });

  // A provider failure leaves the sessions uncrawled so tomorrow's run retries them.
  if (failed) {
    deps.log?.error(new Error(failed), `memory crawl provider error for user ${userId}`);
    return { sessions: 0, items: 0 };
  }
  await markCrawled();
  return { sessions: sessions.length, items: items.length };
}
