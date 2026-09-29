import type { Provider } from '@wchats/shared';
import { createRegistry, type ProviderRegistry } from '../src/providers/index.js';
import type { ChatRequest, LLMProvider, ProviderEvent } from '../src/providers/types.js';

type Script = (req: ChatRequest) => AsyncIterable<ProviderEvent>;

export class FakeProvider implements LLMProvider {
  readonly requests: ChatRequest[] = [];
  script: Script = async function* () {
    yield { type: 'text.delta', text: 'Hello' };
    yield {
      type: 'done',
      stopReason: 'complete',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0, webSearches: 0 },
      rawUsage: { fake: true },
    };
  };

  constructor(
    readonly id: Provider,
    private readonly configured = true,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(req);
    return this.script(req);
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}

export function fakeRegistry(configured: Partial<Record<Provider, boolean>> = {}) {
  const providers = {
    openai: new FakeProvider('openai', configured.openai ?? true),
    anthropic: new FakeProvider('anthropic', configured.anthropic ?? true),
    google: new FakeProvider('google', configured.google ?? true),
  };
  const registry: ProviderRegistry = createRegistry(providers);
  return { registry, providers };
}
