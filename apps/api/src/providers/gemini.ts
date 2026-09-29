import {
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type ThinkingConfig,
} from '@google/genai';
import type { ChatRequest, LLMProvider, ProviderEvent, StopReason, Usage } from './types.js';
import { SourceSet, mergeTurns, num, safeErrorMessage } from './util.js';

export interface GeminiProviderOptions {
  apiKey?: string;
  baseURL?: string;
  client?: GoogleGenAI;
}

export function normalizeGeminiUsage(u: GenerateContentResponseUsageMetadata | undefined, webSearches: number): Usage {
  const cached = num(u?.cachedContentTokenCount);
  return {
    // Tool-use prompt tokens (grounding context) are billed as input.
    inputTokens: Math.max(0, num(u?.promptTokenCount) - cached) + num(u?.toolUsePromptTokenCount),
    cachedInputTokens: cached,
    outputTokens: num(u?.candidatesTokenCount),
    reasoningTokens: num(u?.thoughtsTokenCount),
    webSearches,
  };
}

const REFUSAL_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

export function mapGeminiStop(reason: string | undefined): StopReason {
  if (!reason || reason === FinishReason.STOP) return 'complete';
  if (reason === FinishReason.MAX_TOKENS) return 'max_tokens';
  if (REFUSAL_REASONS.has(reason)) return 'refusal';
  return reason === FinishReason.OTHER || reason === FinishReason.MALFORMED_FUNCTION_CALL ? 'error' : 'complete';
}

const LEVELS: Record<string, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
};

/** Effort → thinkingConfig. A configured budget wins; otherwise the model's thinking level. */
function thinkingConfig(req: ChatRequest): ThinkingConfig | undefined {
  if (!req.effort) return undefined;
  if (req.effort === 'none') return { thinkingBudget: 0 };
  const budget = req.thinkingBudgets?.[req.effort];
  if (budget && budget > 0) return { thinkingBudget: budget };
  return { thinkingLevel: LEVELS[req.effort] };
}

function toContents(req: ChatRequest): Content[] {
  return mergeTurns(req.messages).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.parts.map((p) =>
      p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mediaType, data: p.data } },
    ),
  }));
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'google' as const;
  private readonly client: GoogleGenAI | null;

  constructor(opts: GeminiProviderOptions) {
    this.client =
      opts.client ??
      (opts.apiKey
        ? new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.baseURL ? { httpOptions: { baseUrl: opts.baseURL } } : {}) })
        : null);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async listModels(): Promise<string[]> {
    if (!this.client) return [];
    const ids: string[] = [];
    const pager = await this.client.models.list();
    for await (const m of pager) if (m.name) ids.push(m.name.replace(/^models\//, ''));
    return ids;
  }

  async *streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    if (!this.client) {
      yield { type: 'error', message: 'Google Gemini is not configured.' };
      return;
    }
    const config: GenerateContentConfig = {
      systemInstruction: req.system,
      maxOutputTokens: req.maxOutputTokens,
      abortSignal: req.signal,
      ...(req.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    };
    const thinking = thinkingConfig(req);
    if (thinking) config.thinkingConfig = thinking;

    const sources = new SourceSet();
    const queries = new Set<string>();
    let usageMeta: GenerateContentResponseUsageMetadata | undefined;
    let finish: string | undefined;
    let thinkingAnnounced = false;

    let stream: AsyncIterable<GenerateContentResponse>;
    try {
      stream = await this.client.models.generateContentStream({ model: req.model, contents: toContents(req), config });
    } catch (err) {
      yield { type: 'error', message: safeErrorMessage(err) };
      return;
    }

    try {
      for await (const chunk of stream) {
        if (chunk.usageMetadata) usageMeta = chunk.usageMetadata;
        if (chunk.promptFeedback?.blockReason) {
          yield { type: 'refusal', message: chunk.promptFeedback.blockReasonMessage };
          yield { type: 'done', stopReason: 'refusal', usage: normalizeGeminiUsage(usageMeta, queries.size), rawUsage: usageMeta ?? null };
          return;
        }
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          if (part.thought) {
            if (!thinkingAnnounced || part.text) yield { type: 'reasoning.delta', text: part.text };
            thinkingAnnounced = true;
          } else if (part.text) {
            yield { type: 'text.delta', text: part.text };
          }
        }
        const gm = cand?.groundingMetadata;
        for (const q of gm?.webSearchQueries ?? []) {
          if (!queries.has(q)) {
            queries.add(q);
            yield { type: 'tool.started', tool: 'web_search', query: q };
          }
        }
        const found = sources.add(
          (gm?.groundingChunks ?? [])
            .map((c) => c.web)
            .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
            .map((w) => ({ url: w.uri, title: w.title })),
        );
        if (found.length) yield { type: 'tool.sources', sources: found };
        if (cand?.finishReason) finish = cand.finishReason;
      }
      const stopReason = mapGeminiStop(finish);
      const usage = normalizeGeminiUsage(usageMeta, queries.size);
      if (stopReason === 'refusal') yield { type: 'refusal', message: undefined };
      if (stopReason === 'error') {
        yield { type: 'error', message: `The provider stopped (${finish}).`, usage, rawUsage: usageMeta ?? null };
        return;
      }
      yield { type: 'done', stopReason, usage, rawUsage: usageMeta ?? null };
    } catch (err) {
      yield { type: 'error', message: safeErrorMessage(err), usage: normalizeGeminiUsage(usageMeta, queries.size), rawUsage: usageMeta ?? null };
    }
  }
}
