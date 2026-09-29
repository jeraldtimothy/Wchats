import OpenAI from 'openai';
import type {
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
  Tool,
} from 'openai/resources/responses/responses';
import type { ChatRequest, LLMProvider, ProviderEvent, StopReason, Usage } from './types.js';
import { SourceSet, mergeTurns, num, safeErrorMessage, textOf } from './util.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseURL?: string;
  /** Injected in tests. */
  client?: OpenAI;
}

export function normalizeOpenAIUsage(u: ResponseUsage | null | undefined, webSearches: number): Usage {
  const cached = num(u?.input_tokens_details?.cached_tokens);
  const reasoning = num(u?.output_tokens_details?.reasoning_tokens);
  return {
    inputTokens: Math.max(0, num(u?.input_tokens) - cached),
    cachedInputTokens: cached,
    outputTokens: Math.max(0, num(u?.output_tokens) - reasoning),
    reasoningTokens: reasoning,
    webSearches,
  };
}

function toInput(req: ChatRequest): ResponseInputItem[] {
  return mergeTurns(req.messages).map((m): ResponseInputItem => {
    if (m.role === 'assistant') return { role: 'assistant', content: textOf(m.parts) };
    return {
      role: 'user',
      content: m.parts.map((p) => {
        switch (p.type) {
          case 'text':
            return { type: 'input_text' as const, text: p.text };
          case 'image':
            return { type: 'input_image' as const, detail: 'auto' as const, image_url: `data:${p.mediaType};base64,${p.data}` };
          case 'document':
            return { type: 'input_file' as const, filename: p.filename, file_data: `data:${p.mediaType};base64,${p.data}` };
        }
      }),
    };
  });
}

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAI | null;

  constructor(opts: OpenAIProviderOptions) {
    this.client =
      opts.client ?? (opts.apiKey ? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 }) : null);
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
      yield { type: 'error', message: 'OpenAI is not configured.' };
      return;
    }
    const tools: Tool[] = req.webSearch ? [{ type: 'web_search' }] : [];
    const sources = new SourceSet();
    let webSearches = 0;
    let refused = false;

    let stream: AsyncIterable<ResponseStreamEvent>;
    try {
      stream = await this.client.responses.create(
        {
          model: req.model,
          instructions: req.system,
          input: toInput(req),
          stream: true,
          store: false,
          max_output_tokens: req.maxOutputTokens,
          ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
          ...(tools.length ? { tools } : {}),
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
          case 'response.output_text.delta':
            yield { type: 'text.delta', text: ev.delta };
            break;
          case 'response.output_item.added':
            if (ev.item.type === 'reasoning') yield { type: 'reasoning.delta' };
            break;
          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning_text.delta':
            yield { type: 'reasoning.delta', text: ev.delta };
            break;
          case 'response.web_search_call.in_progress':
            yield { type: 'tool.started', tool: 'web_search' };
            break;
          case 'response.output_item.done':
            if (ev.item.type === 'web_search_call') {
              webSearches += 1;
              const action = ev.item.action as { type?: string; sources?: { type: string; url?: string }[] } | undefined;
              const found = sources.add(
                (action?.sources ?? []).filter((s) => s.type === 'url' && s.url).map((s) => ({ url: s.url! })),
              );
              if (found.length) yield { type: 'tool.sources', sources: found };
            }
            break;
          case 'response.output_text.annotation.added': {
            const a = ev.annotation;
            if (a && a.type === 'url_citation') {
              const found = sources.add([{ url: a.url, title: a.title }]);
              if (found.length) yield { type: 'tool.sources', sources: found };
            }
            break;
          }
          case 'response.refusal.delta':
            if (!refused) {
              refused = true;
              yield { type: 'refusal' };
            }
            break;
          case 'response.completed': {
            const usage = normalizeOpenAIUsage(ev.response.usage, webSearches);
            yield { type: 'done', stopReason: refused ? 'refusal' : 'complete', usage, rawUsage: ev.response.usage };
            return;
          }
          case 'response.incomplete': {
            const reason = ev.response.incomplete_details?.reason;
            const stopReason: StopReason =
              reason === 'content_filter' ? 'refusal' : reason === 'max_output_tokens' ? 'max_tokens' : 'complete';
            if (stopReason === 'refusal' && !refused) yield { type: 'refusal' };
            yield {
              type: 'done',
              stopReason,
              usage: normalizeOpenAIUsage(ev.response.usage, webSearches),
              rawUsage: ev.response.usage,
            };
            return;
          }
          case 'response.failed':
            yield {
              type: 'error',
              message: ev.response.error?.message ?? 'The provider reported a failure.',
              usage: normalizeOpenAIUsage(ev.response.usage, webSearches),
              rawUsage: ev.response.usage,
            };
            return;
          case 'error':
            yield { type: 'error', message: safeErrorMessage(new Error(ev.message)) };
            return;
          default:
            break;
        }
      }
      yield { type: 'error', message: 'The provider stream ended unexpectedly.' };
    } catch (err) {
      yield { type: 'error', message: safeErrorMessage(err) };
    }
  }
}
