import type { Effort, Provider } from '@wchats/shared';
import type { Usage } from '../billing/pricing.js';

export type { Usage };

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string /* base64 */ }
  | { type: 'document'; mediaType: 'application/pdf'; data: string /* base64 */; filename: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  parts: ContentPart[];
}

export interface ChatRequest {
  /** The provider's own model id (models.provider_model_id). */
  model: string;
  system: string;
  messages: ChatMessage[];
  /** Omitted for models without reasoning controls. */
  effort?: Effort;
  /** Per-effort token budgets (Anthropic budget_tokens / Gemini thinkingBudget). */
  thinkingBudgets?: Partial<Record<Effort, number>>;
  maxOutputTokens: number;
  webSearch: boolean;
  multiTurnTools: boolean;
  signal?: AbortSignal;
}

export type StopReason = 'complete' | 'max_tokens' | 'refusal' | 'error';

export interface Source {
  url: string;
  title?: string;
}

export type ProviderEvent =
  | { type: 'text.delta'; text: string }
  /** The model is reasoning. Counted in usage; never shown to the user. */
  | { type: 'reasoning.delta'; text?: string }
  | { type: 'tool.started'; tool: 'web_search'; query?: string }
  | { type: 'tool.sources'; sources: Source[] }
  | { type: 'refusal'; message?: string }
  /** Terminal. `usage` is present when the provider reported any before failing. */
  | { type: 'error'; message: string; usage?: Usage; rawUsage?: unknown }
  /** Terminal. */
  | { type: 'done'; stopReason: StopReason; usage: Usage; rawUsage: unknown };

export interface LLMProvider {
  readonly id: Provider;
  isConfigured(): boolean;
  streamChat(request: ChatRequest): AsyncIterable<ProviderEvent>;
  listModels(): Promise<string[]>;
}
