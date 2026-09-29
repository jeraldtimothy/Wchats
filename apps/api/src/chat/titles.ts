import type { Effort } from '@wchats/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { chargeUsage } from '../billing/ledger.js';
import { computeCost } from '../billing/pricing.js';
import type { Db } from '../db/client.js';
import { chatSessions } from '../db/schema.js';
import { cheapestModel } from '../models/catalog.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { Usage } from '../providers/types.js';
import type { ChatEventHub } from './hub.js';
import type { TitleQueue } from './runner.js';
import { listMessages } from './sessions.js';

export interface TitleDeps {
  db: Db;
  hub: ChatEventHub;
  providers: ProviderRegistry;
  markup: string;
}

const TITLE_SYSTEM =
  'You write short titles for chat conversations. Reply with only the title: 3 to 6 words, ' +
  'in the language of the conversation, no quotes, no trailing punctuation.';

const EFFORT_ORDER: Effort[] = ['none', 'low', 'medium', 'high', 'xhigh'];

export function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split('\n')[0] ?? '';
  const t = firstLine
    .replace(/^(title:)\s*/i, '')
    .replace(/^["'“”‘’*#\s]+|["'“”‘’*.\s]+$/g, '')
    .trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
}

export function fallbackTitle(userText: string): string {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t) return 'New conversation';
  return t.length > 50 ? `${t.slice(0, 47).trimEnd()}…` : t;
}

/**
 * Names a session from its first exchange using the cheapest available
 * model. The call is charged to the session's billing account. Falls back to
 * the start of the user's message if no model is available or it fails.
 */
export async function generateTitle(deps: TitleDeps, sessionId: string): Promise<void> {
  const { db, hub, providers } = deps;
  const session = await db.query.chatSessions.findFirst({ where: eq(chatSessions.id, sessionId) });
  if (!session || session.title !== null || session.deletedAt) return;

  const msgs = await listMessages(db, sessionId);
  const firstUser = msgs.find((m) => m.role === 'user');
  const firstReply = msgs.find((m) => m.role === 'assistant' && (m.status === 'complete' || m.status === 'truncated'));
  if (!firstUser) return;

  let title = '';
  let usage: Usage | undefined;
  const model = await cheapestModel(db, providers);
  if (model) {
    const efforts = model.reasoningEfforts as Effort[];
    const effort = EFFORT_ORDER.find((e) => efforts.includes(e));
    let text = '';
    for await (const ev of providers.get(model.provider).streamChat({
      model: model.providerModelId,
      system: TITLE_SYSTEM,
      messages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `User: ${firstUser.content.slice(0, 2000)}\n\nAssistant: ${(firstReply?.content ?? '').slice(0, 2000)}\n\nTitle:`,
            },
          ],
        },
      ],
      effort,
      thinkingBudgets: {},
      maxOutputTokens: 1024,
      webSearch: false,
      multiTurnTools: false,
    })) {
      if (ev.type === 'text.delta') text += ev.text;
      if (ev.type === 'done' || ev.type === 'error') {
        usage = ev.usage;
        break;
      }
    }
    title = cleanTitle(text);

    if (usage) {
      const cost = computeCost(usage, model, deps.markup);
      await db.transaction((tx) =>
        chargeUsage(tx, {
          accountId: session.billingAccountId,
          userId: session.userId,
          messageId: null,
          costNano: cost.costNano,
          reason: `Session title (${model.displayName})`,
        }),
      );
    }
  }
  if (!title) title = fallbackTitle(firstUser.content);

  const updated = await db
    .update(chatSessions)
    .set({ title })
    .where(and(eq(chatSessions.id, sessionId), isNull(chatSessions.title)))
    .returning({ id: chatSessions.id });
  if (updated.length) hub.publishSession(sessionId, { type: 'session.updated', sessionId, title });
}

/** Runs title jobs in-process (default; used by tests and single-process dev). */
export class InlineTitleQueue implements TitleQueue {
  private readonly running = new Set<Promise<void>>();
  private readonly pending = new Set<string>();

  constructor(
    private readonly deps: TitleDeps,
    private readonly log?: { error: (obj: unknown, msg?: string) => void },
  ) {}

  async enqueue(sessionId: string): Promise<void> {
    if (this.pending.has(sessionId)) return;
    this.pending.add(sessionId);
    const p: Promise<void> = generateTitle(this.deps, sessionId)
      .catch((err: unknown) => this.log?.error(err, 'title generation failed'))
      .finally(() => {
        this.pending.delete(sessionId);
        this.running.delete(p);
      });
    this.running.add(p);
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }
}
