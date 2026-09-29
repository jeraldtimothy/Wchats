/**
 * Model catalog seed. `pnpm seed` upserts these rows by `slug` (config wins
 * over DB edits on re-seed). `pnpm check-models` verifies every
 * provider_model_id against the provider's list-models endpoint.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDERS: every providerModelId, price and thinking budget below │
 * │ is a placeholder. Replace them with the exact ids your keys can      │
 * │ access and your negotiated/public prices, then run `pnpm seed`.      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Prices are USD per million tokens (webSearchUsdPerCall: USD per search).
 * thinkingBudgets: Anthropic → budget_tokens, Gemini → thinkingBudget, per
 * effort. Leave an effort out to use the model's adaptive thinking
 * (Anthropic output_config.effort / Gemini thinkingLevel) instead.
 */
import type { Effort, Provider, Tier } from '@wchats/shared';

export interface SeedModel {
  slug: string;
  provider: Provider;
  providerModelId: string;
  displayName: string;
  description: string;
  tier: Tier;
  reasoningEfforts: Effort[];
  defaultEffort: Effort | null;
  thinkingBudgets: Partial<Record<Effort, number>>;
  maxOutputTokens: number;
  supportsImages: boolean;
  supportsDocuments: boolean;
  supportsMultiTurnTools: boolean;
  webSearchEnabled: boolean;
  inputUsdPerMtok: string;
  cachedInputUsdPerMtok: string;
  outputUsdPerMtok: string;
  webSearchUsdPerCall: string;
  isRetired: boolean;
  agentEnabled: boolean;
}

const common = {
  maxOutputTokens: 16_000,
  supportsImages: true,
  supportsDocuments: true,
  supportsMultiTurnTools: true,
  webSearchEnabled: true,
  isRetired: false,
  agentEnabled: false,
} as const;

export const seedModels: SeedModel[] = [
  // ─── OpenAI ──────────────────────────────────────────────────────────────
  {
    ...common,
    slug: 'gpt-5.6-sol',
    provider: 'openai',
    providerModelId: 'gpt-5.6-sol', // PLACEHOLDER id
    displayName: 'GPT-5.6 Sol',
    description: "OpenAI's most capable 5.6 model for complex, multi-step work.",
    tier: 'premium',
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    thinkingBudgets: {},
    inputUsdPerMtok: '5.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.500000', // PLACEHOLDER price
    outputUsdPerMtok: '30.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gpt-5.6-terra',
    provider: 'openai',
    providerModelId: 'gpt-5.6-terra', // PLACEHOLDER id
    displayName: 'GPT-5.6 Terra',
    description: 'Balanced speed and intelligence for everyday tasks.',
    tier: 'standard',
    reasoningEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'low',
    thinkingBudgets: {},
    inputUsdPerMtok: '1.250000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.125000', // PLACEHOLDER price
    outputUsdPerMtok: '10.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gpt-5.6-luna',
    provider: 'openai',
    providerModelId: 'gpt-5.6-luna', // PLACEHOLDER id
    displayName: 'GPT-5.6 Luna',
    description: 'Fast, low-cost model for quick questions and drafts.',
    tier: 'value',
    reasoningEfforts: ['none', 'low', 'medium'],
    defaultEffort: 'none',
    thinkingBudgets: {},
    inputUsdPerMtok: '0.250000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.025000', // PLACEHOLDER price
    outputUsdPerMtok: '2.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gpt-6-sol',
    provider: 'openai',
    providerModelId: 'gpt-6-sol', // PLACEHOLDER id
    displayName: 'GPT-6 Sol',
    description: "OpenAI's flagship GPT-6 model for the hardest problems.",
    tier: 'premium',
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    thinkingBudgets: {},
    inputUsdPerMtok: '10.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '1.000000', // PLACEHOLDER price
    outputUsdPerMtok: '40.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gpt-6-luna',
    provider: 'openai',
    providerModelId: 'gpt-6-luna', // PLACEHOLDER id
    displayName: 'GPT-6 Luna',
    description: 'The efficient GPT-6 model: quick and affordable.',
    tier: 'value',
    reasoningEfforts: ['none', 'low', 'medium'],
    defaultEffort: 'low',
    thinkingBudgets: {},
    inputUsdPerMtok: '0.400000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.040000', // PLACEHOLDER price
    outputUsdPerMtok: '3.200000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },

  // ─── Anthropic ───────────────────────────────────────────────────────────
  {
    ...common,
    slug: 'claude-opus-5',
    provider: 'anthropic',
    providerModelId: 'claude-opus-5', // PLACEHOLDER id
    displayName: 'Claude Opus 5',
    description: "Anthropic's most intelligent model for deep analysis and writing.",
    tier: 'premium',
    reasoningEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'none',
    thinkingBudgets: { low: 2_048, medium: 8_192, high: 24_576 }, // PLACEHOLDER budgets
    inputUsdPerMtok: '5.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.500000', // PLACEHOLDER price
    outputUsdPerMtok: '25.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'claude-sonnet-5',
    provider: 'anthropic',
    providerModelId: 'claude-sonnet-5', // PLACEHOLDER id
    displayName: 'Claude Sonnet 5',
    description: 'Strong all-rounder for writing, coding and analysis.',
    tier: 'standard',
    reasoningEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'none',
    thinkingBudgets: { low: 2_048, medium: 8_192, high: 16_384 }, // PLACEHOLDER budgets
    inputUsdPerMtok: '3.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.300000', // PLACEHOLDER price
    outputUsdPerMtok: '15.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'claude-haiku-4.5',
    provider: 'anthropic',
    providerModelId: 'claude-haiku-4-5', // PLACEHOLDER id
    displayName: 'Claude Haiku 4.5',
    description: 'Fast and affordable Claude for everyday questions.',
    tier: 'value',
    reasoningEfforts: ['none', 'low', 'medium'],
    defaultEffort: 'none',
    thinkingBudgets: { low: 1_024, medium: 4_096 }, // PLACEHOLDER budgets
    inputUsdPerMtok: '1.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.100000', // PLACEHOLDER price
    outputUsdPerMtok: '5.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.010000', // PLACEHOLDER price
  },

  // ─── Google ──────────────────────────────────────────────────────────────
  {
    ...common,
    slug: 'gemini-pro',
    provider: 'google',
    providerModelId: 'gemini-3.1-pro-preview', // PLACEHOLDER id
    displayName: 'Gemini 3.1 Pro',
    description: "Google's most capable Gemini for reasoning over long inputs.",
    tier: 'premium',
    // Pro models cannot turn thinking off.
    reasoningEfforts: ['low', 'high'],
    defaultEffort: 'high',
    thinkingBudgets: {},
    inputUsdPerMtok: '2.000000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.200000', // PLACEHOLDER price
    outputUsdPerMtok: '12.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.014000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gemini-flash',
    provider: 'google',
    providerModelId: 'gemini-3.5-flash', // PLACEHOLDER id
    displayName: 'Gemini 3.5 Flash',
    description: 'Fast, capable Gemini for most everyday work.',
    tier: 'standard',
    reasoningEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'low',
    thinkingBudgets: {},
    inputUsdPerMtok: '0.500000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.050000', // PLACEHOLDER price
    outputUsdPerMtok: '3.000000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.014000', // PLACEHOLDER price
  },
  {
    ...common,
    slug: 'gemini-flash-lite',
    provider: 'google',
    providerModelId: 'gemini-3.1-flash-lite', // PLACEHOLDER id
    displayName: 'Gemini 3.1 Flash-Lite',
    description: 'The lowest-cost Gemini for simple, high-volume tasks.',
    tier: 'value',
    reasoningEfforts: ['none', 'low', 'medium'],
    defaultEffort: 'none',
    thinkingBudgets: { low: 1_024, medium: 4_096 }, // PLACEHOLDER budgets
    inputUsdPerMtok: '0.100000', // PLACEHOLDER price
    cachedInputUsdPerMtok: '0.010000', // PLACEHOLDER price
    outputUsdPerMtok: '0.400000', // PLACEHOLDER price
    webSearchUsdPerCall: '0.014000', // PLACEHOLDER price
    supportsMultiTurnTools: false,
  },
];
