import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages/messages';
import type { ChatRequest, LLMProvider, ProviderEvent, StopReason, Usage } from './types.js';
import { SourceSet, mergeTurns, num, safeErrorMessage, textOf } from './util.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  client?: Anthropic;
}

interface RawUsage {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number } | null;
  server_tool_use?: { web_search_requests?: number } | null;
}

/**
 * Cache writes are billed at the input price (ARCHITECTURE D10). Thinking is
 * reported inside output_tokens and broken out in output_tokens_details.
 */
export function normalizeAnthropicUsage(u: RawUsage): Usage {
  const thinking = num(u.output_tokens_details?.thinking_tokens);
  return {
    inputTokens: num(u.input_tokens) + num(u.cache_creation_input_tokens),
    cachedInputTokens: num(u.cache_read_input_tokens),
    outputTokens: Math.max(0, num(u.output_tokens) - thinking),
    reasoningTokens: thinking,
    webSearches: num(u.server_tool_use?.web_search_requests),
  };
}

export function mapAnthropicStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'complete';
  }
}

function toMessages(req: ChatRequest): MessageParam[] {
  return mergeTurns(req.messages).map((m): MessageParam => {
    if (m.role === 'assistant') return { role: 'assistant', content: textOf(m.parts) };
    const content: ContentBlockParam[] = m.parts.map((p): ContentBlockParam => {
      switch (p.type) {
        case 'text':
          return { type: 'text', text: p.text };
        case 'image':
          return {
            type: 'image',
            source: { type: 'base64', media_type: p.mediaType as 'image/png', data: p.data },
          };
        case 'document':
          return { type: 'document', title: p.filename, source: { type: 'base64', media_type: p.mediaType, data: p.data } };
      }
    });
    return { role: 'user', content };
  });
}

/**
 * Effort → thinking. `none` disables thinking. A configured budget uses
 * extended thinking with budget_tokens; without one the model's adaptive
 * thinking is used with output_config.effort.
 */
function thinkingParams(req: ChatRequest): Pick<MessageCreateParamsStreaming, 'thinking' | 'output_config' | 'max_tokens'> {
  if (!req.effort || req.effort === 'none') return { max_tokens: req.maxOutputTokens };
  const budget = req.thinkingBudgets?.[req.effort];
  if (budget && budget > 0) {
    return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: req.maxOutputTokens + budget };
  }
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: req.effort },
    max_tokens: req.maxOutputTokens,
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic | null;

  constructor(opts: AnthropicProviderOptions) {
    this.client =
      opts.client ??
      (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 }) : null);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async listModels(): Promise<string[]> {
    if (!this.client) return [];
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async *streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    if (!this.client) {
      yield { type: 'error', message: 'Anthropic is not configured.' };
      return;
    }
    const sources = new SourceSet();
    const usage: RawUsage = {};
    let stopReason: string | null = null;
    let refused = false;

    let stream: AsyncIterable<RawMessageStreamEvent>;
    try {
      stream = await this.client.messages.create(
        {
          model: req.model,
          system: req.system,
          messages: toMessages(req),
          stream: true,
          ...thinkingParams(req),
          ...(req.webSearch
            ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: req.multiTurnTools ? 5 : 1 }] }
            : {}),
        },
        { signal: req.signal },
      );
    } catch (err) {
      yield { type: 'error', message: safeErrorMessage(err) };
      return;
    }

    try {
      for await (const ev of stream) {
        switch (ev.type) {
          case 'message_start':
            Object.assign(usage, ev.message.usage);
            break;
          case 'content_block_start': {
            const b = ev.content_block;
            if (b.type === 'thinking' || b.type === 'redacted_thinking') yield { type: 'reasoning.delta' };
            else if (b.type === 'server_tool_use' && b.name === 'web_search') {
              const query = (b.input as { query?: string } | null)?.query;
              yield { type: 'tool.started', tool: 'web_search', ...(query ? { query } : {}) };
            } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
              const found = sources.add(b.content.map((r) => ({ url: r.url, title: r.title })));
              if (found.length) yield { type: 'tool.sources', sources: found };
            } else if (b.type === 'text' && b.text) yield { type: 'text.delta', text: b.text };
            break;
          }
          case 'content_block_delta': {
            const d = ev.delta;
            if (d.type === 'text_delta') yield { type: 'text.delta', text: d.text };
            else if (d.type === 'thinking_delta') yield { type: 'reasoning.delta', text: d.thinking };
            else if (d.type === 'citations_delta' && d.citation.type === 'web_search_result_location') {
              const found = sources.add([{ url: d.citation.url, title: d.citation.title ?? undefined }]);
              if (found.length) yield { type: 'tool.sources', sources: found };
            }
            break;
          }
          case 'message_delta': {
            stopReason = ev.delta.stop_reason ?? stopReason;
            // message_delta usage is cumulative; keep non-null fields.
            for (const [k, v] of Object.entries(ev.usage)) if (v !== null && v !== undefined) (usage as Record<string, unknown>)[k] = v;
            if (stopReason === 'refusal' && !refused) {
              refused = true;
              yield { type: 'refusal' };
            }
            break;
          }
          case 'message_stop':
            yield { type: 'done', stopReason: mapAnthropicStop(stopReason), usage: normalizeAnthropicUsage(usage), rawUsage: usage };
            return;
          default:
            break;
        }
      }
      yield { type: 'error', message: 'The provider stream ended unexpectedly.', usage: normalizeAnthropicUsage(usage), rawUsage: usage };
    } catch (err) {
      yield { type: 'error', message: safeErrorMessage(err), usage: normalizeAnthropicUsage(usage), rawUsage: usage };
    }
  }
}
