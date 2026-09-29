import type { ChatRequest, ProviderEvent } from '../../src/providers/types.js';

export async function* stream<T>(events: T[]): AsyncGenerator<T> {
  for (const e of events) yield e;
}

export async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

export function baseRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'test-model',
    system: 'You are helpful.',
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi!' }] },
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Look at these' },
          { type: 'image', mediaType: 'image/png', data: 'aW1n' },
          { type: 'document', mediaType: 'application/pdf', data: 'cGRm', filename: 'a.pdf' },
        ],
      },
    ],
    maxOutputTokens: 1000,
    webSearch: false,
    multiTurnTools: false,
    ...overrides,
  };
}

export const texts = (events: ProviderEvent[]) =>
  events.flatMap((e) => (e.type === 'text.delta' ? [e.text] : [])).join('');
