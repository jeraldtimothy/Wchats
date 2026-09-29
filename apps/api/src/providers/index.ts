import type { Provider } from '@wchats/shared';
import { env } from '../env.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { SimulatedProvider } from './simulated.js';
import type { LLMProvider } from './types.js';

export type * from './types.js';

/** The only way the rest of the app reaches an LLM. */
export interface ProviderRegistry {
  get(provider: Provider): LLMProvider;
  isConfigured(provider: Provider): boolean;
  configured(): Provider[];
}

export function createRegistry(providers: Record<Provider, LLMProvider>): ProviderRegistry {
  return {
    get: (p) => providers[p],
    isConfigured: (p) => providers[p].isConfigured(),
    configured: () => (Object.keys(providers) as Provider[]).filter((p) => providers[p].isConfigured()),
  };
}

/**
 * Builds adapters from env. A provider without a key stays unconfigured;
 * nothing throws. With LLM_SIMULATION on, every provider is simulated.
 */
export function createProvidersFromEnv(): ProviderRegistry {
  if (env.LLM_SIMULATION) {
    return createRegistry({
      openai: new SimulatedProvider('openai'),
      anthropic: new SimulatedProvider('anthropic'),
      google: new SimulatedProvider('google'),
    });
  }
  return createRegistry({
    openai: new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL }),
    anthropic: new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL }),
    google: new GeminiProvider({ apiKey: env.GEMINI_API_KEY, baseURL: env.GEMINI_BASE_URL }),
  });
}
