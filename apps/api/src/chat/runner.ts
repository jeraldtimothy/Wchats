import { CHAT_ERROR_TEXT, type Effort, type Source, type TerminalStatus } from '@wchats/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { chargeUsage } from '../billing/ledger.js';
import { nanoToCents } from '../billing/money.js';
import { computeCost, type CostResult, type Usage } from '../billing/pricing.js';
import type { Db } from '../db/client.js';
import { chatSessions, messages, models, profiles } from '../db/schema.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { ChatMessage, ChatRequest, ProviderEvent, StopReason } from '../providers/types.js';
import type { ChatEventHub } from './hub.js';
import { buildSystemPrompt } from './prompts.js';
import { listMessages, type MessageRow } from './sessions.js';

export interface TitleQueue {
  enqueue(sessionId: string): Promise<void>;
}

export interface RunnerDeps {
  db: Db;
  hub: ChatEventHub;
  providers: ProviderRegistry;
  titles: TitleQueue;
  markup: string;
  log?: { error: (obj: unknown, msg?: string) => void };
  /** How often partial content is written to the DB while streaming. */
  flushIntervalMs?: number;
}

export interface GenerationJob {
  sessionId: string;
  messageId: string;
  userId: string;
}

export interface MessageOptions {
  effort?: Effort | null;
  webSearch?: boolean;
  multiTurn?: boolean;
}

const STATUS_BY_STOP: Record<StopReason, TerminalStatus> = {
  complete: 'complete',
  max_tokens: 'truncated',
  refusal: 'refused',
  error: 'error',
};

/**
 * Turns prior messages into provider turns. An exchange whose reply was
 * refused or failed is left out, so the model doesn't see it.
 */
export function historyToTurns(prior: MessageRow[]): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (let i = 0; i < prior.length; i++) {
    const m = prior[i]!;
    if (m.role === 'user') {
      const reply = prior[i + 1]?.role === 'assistant' ? prior[i + 1] : undefined;
      if (reply && (reply.status === 'refused' || reply.status === 'error')) {
        i += 1;
        continue;
      }
      turns.push({ role: 'user', parts: [{ type: 'text', text: m.content }] });
    } else if ((m.status === 'complete' || m.status === 'truncated') && m.content) {
      turns.push({ role: 'assistant', parts: [{ type: 'text', text: m.content }] });
    }
  }
  return turns;
}

/**
 * Runs a reply as a server-side job, detached from the HTTP request that
 * started it: streams from the provider, fans events out through the hub,
 * checkpoints content to the DB, then charges and finalizes in one
 * transaction.
 */
export class GenerationRunner {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly deps: RunnerDeps) {}

  start(job: GenerationJob): void {
    this.deps.hub.begin(job.sessionId, job.messageId);
    const p: Promise<void> = this.run(job)
      .catch((err: unknown) => this.crash(job, err))
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  /** Resolves once every in-flight generation has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private async run(job: GenerationJob): Promise<void> {
    const { db, hub, providers } = this.deps;
    const session = await db.query.chatSessions.findFirst({ where: eq(chatSessions.id, job.sessionId) });
    if (!session) throw new Error(`session ${job.sessionId} vanished`);
    const model = await db.query.models.findFirst({ where: eq(models.id, session.modelId) });
    if (!model) throw new Error(`model ${session.modelId} vanished`);
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, job.userId) });

    const all = await listMessages(db, session.id);
    const idx = all.findIndex((m) => m.id === job.messageId);
    const prior = idx >= 0 ? all.slice(0, idx) : all;
    const options = (prior.at(-1)?.options ?? {}) as MessageOptions;

    const request: ChatRequest = {
      model: model.providerModelId,
      system: buildSystemPrompt({ globalSystemPrompt: profile?.globalSystemPrompt }),
      messages: historyToTurns(prior),
      effort: options.effort ?? undefined,
      thinkingBudgets: model.thinkingBudgets as ChatRequest['thinkingBudgets'],
      maxOutputTokens: model.maxOutputTokens,
      webSearch: Boolean(options.webSearch) && model.webSearchEnabled,
      multiTurnTools: Boolean(options.multiTurn) && model.supportsMultiTurnTools,
    };

    await db.update(messages).set({ status: 'streaming' }).where(eq(messages.id, job.messageId));
    hub.publish(session.id, { type: 'message.started', messageId: job.messageId });

    let content = '';
    const sources: Source[] = [];
    let thinking = false;
    let terminal: Extract<ProviderEvent, { type: 'done' | 'error' }> | null = null;

    const flushEvery = this.deps.flushIntervalMs ?? 750;
    let lastFlush = Date.now();
    let flushing: Promise<unknown> = Promise.resolve();
    const flush = () => {
      const snapshot = { content, sources: [...sources] };
      lastFlush = Date.now();
      flushing = flushing
        .then(() =>
          db
            .update(messages)
            .set(snapshot)
            .where(and(eq(messages.id, job.messageId), eq(messages.status, 'streaming'))),
        )
        .catch((err: unknown) => this.deps.log?.error(err, 'checkpoint failed'));
    };

    const provider = providers.get(model.provider);
    try {
      for await (const ev of provider.streamChat(request)) {
        switch (ev.type) {
          case 'text.delta':
            content += ev.text;
            thinking = false;
            hub.publish(session.id, { type: 'text.delta', messageId: job.messageId, text: ev.text });
            break;
          case 'reasoning.delta':
            // Reasoning text is never forwarded; only the fact that the model is thinking.
            if (!thinking) {
              thinking = true;
              hub.publish(session.id, { type: 'thinking', messageId: job.messageId, active: true });
            }
            break;
          case 'tool.started':
            hub.publish(session.id, { type: 'tool.started', messageId: job.messageId, tool: ev.tool, query: ev.query });
            break;
          case 'tool.sources':
            sources.push(...ev.sources);
            hub.publish(session.id, { type: 'tool.sources', messageId: job.messageId, sources: ev.sources });
            break;
          case 'refusal':
            hub.publish(session.id, { type: 'refusal', messageId: job.messageId, message: ev.message });
            break;
          case 'done':
          case 'error':
            terminal = ev;
            break;
        }
        if (terminal) break;
        if (Date.now() - lastFlush >= flushEvery) flush();
      }
    } catch (err) {
      terminal = { type: 'error', message: err instanceof Error ? err.message : 'Provider error' };
    }
    await flushing;
    terminal ??= { type: 'error', message: 'The provider stream ended unexpectedly.' };

    const status: TerminalStatus = terminal.type === 'done' ? STATUS_BY_STOP[terminal.stopReason] : 'error';
    const usage: Usage | undefined = terminal.usage;
    const cost: CostResult | null = usage ? computeCost(usage, model, this.deps.markup) : null;
    const error =
      status === 'refused'
        ? { code: 'refused', message: CHAT_ERROR_TEXT.refused }
        : status === 'truncated'
          ? { code: 'truncated', message: CHAT_ERROR_TEXT.truncated }
          : status === 'error'
            ? { code: 'provider_error', message: terminal.type === 'error' ? terminal.message : 'Provider error' }
            : null;

    const balanceAfter = await db.transaction(async (tx) => {
      const entry = cost
        ? await chargeUsage(tx, {
            accountId: session.billingAccountId,
            userId: job.userId,
            messageId: job.messageId,
            costNano: cost.costNano,
          })
        : null;
      await tx
        .update(messages)
        .set({
          status,
          content,
          sources,
          stopReason: terminal.type === 'done' ? terminal.stopReason : 'error',
          usage: usage ? { ...usage } : null,
          usageRaw: terminal.rawUsage ?? null,
          pricing: cost ? { ...cost.pricing } : null,
          costNanoUsd: cost?.costNano ?? null,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          completedAt: new Date(),
        })
        .where(eq(messages.id, job.messageId));
      await tx.update(chatSessions).set({ lastActivityAt: new Date() }).where(eq(chatSessions.id, session.id));
      return entry?.balanceAfterNanoUsd ?? null;
    });

    if (status === 'error') {
      hub.finish(session.id, { type: 'error', messageId: job.messageId, code: error!.code, message: error!.message });
    } else {
      hub.finish(session.id, {
        type: 'done',
        messageId: job.messageId,
        status,
        costNanoUsd: cost ? cost.costNano.toString() : null,
        balanceCents: balanceAfter === null ? null : nanoToCents(balanceAfter),
      });
    }

    const answered = status === 'complete' || status === 'truncated';
    if (answered && session.title === null) {
      await this.deps.titles.enqueue(session.id).catch((err: unknown) => this.deps.log?.error(err, 'title enqueue failed'));
    }
  }

  /** Unexpected failure (DB down, bug): mark the reply failed and tell listeners. */
  private async crash(job: GenerationJob, err: unknown): Promise<void> {
    this.deps.log?.error(err, 'generation crashed');
    const message = 'Something went wrong while generating this reply.';
    await this.deps.db
      .update(messages)
      .set({ status: 'error', errorCode: 'internal', errorMessage: message, completedAt: new Date() })
      .where(and(eq(messages.id, job.messageId), inArray(messages.status, ['pending', 'streaming'])))
      .catch(() => undefined);
    this.deps.hub.finish(job.sessionId, { type: 'error', messageId: job.messageId, code: 'internal', message });
  }
}

/** On boot: replies left pending/streaming by a previous process can never finish. */
export async function recoverOrphans(db: Db): Promise<number> {
  const rows = await db
    .update(messages)
    .set({
      status: 'error',
      errorCode: 'interrupted',
      errorMessage: 'This reply was interrupted. Please send your message again.',
      completedAt: new Date(),
    })
    .where(inArray(messages.status, ['pending', 'streaming']))
    .returning({ id: messages.id });
  return rows.length;
}
