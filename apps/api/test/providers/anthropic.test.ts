import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import { baseRequest, collect, stream, texts } from './helpers.js';

function mockClient(events: unknown[]) {
  const create = vi.fn(async (_params: Record<string, unknown>, _opts?: unknown) => stream(events));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const start = {
  type: 'message_start',
  message: { usage: { input_tokens: 900, cache_creation_input_tokens: 100, cache_read_input_tokens: 300, output_tokens: 1 } },
};
const stop = (reason: string, output = 600, extra: Record<string, unknown> = {}) => [
  {
    type: 'message_delta',
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: output, output_tokens_details: { thinking_tokens: 250 }, ...extra },
  },
  { type: 'message_stop' },
];

describe('AnthropicProvider', () => {
  it('maps effort to extended thinking with the configured budget', async () => {
    const { client, create } = mockClient([start, ...stop('end_turn')]);
    await collect(
      new AnthropicProvider({ client }).streamChat(baseRequest({ effort: 'medium', thinkingBudgets: { medium: 4096 } })),
    );
    expect(create.mock.calls[0]![0]).toMatchObject({
      thinking: { type: 'enabled', budget_tokens: 4096 },
      max_tokens: 1000 + 4096,
      system: 'You are helpful.',
      stream: true,
    });
  });

  it('uses adaptive thinking when no budget is configured, and none disables thinking', async () => {
    const a = mockClient([start, ...stop('end_turn')]);
    await collect(new AnthropicProvider({ client: a.client }).streamChat(baseRequest({ effort: 'high' })));
    expect(a.create.mock.calls[0]![0]).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });

    const b = mockClient([start, ...stop('end_turn')]);
    await collect(new AnthropicProvider({ client: b.client }).streamChat(baseRequest({ effort: 'none' })));
    expect(b.create.mock.calls[0]![0]).not.toHaveProperty('thinking');
  });

  it('sends images as image blocks, PDFs as document blocks, and the web search tool', async () => {
    const { client, create } = mockClient([start, ...stop('end_turn')]);
    await collect(new AnthropicProvider({ client }).streamChat(baseRequest({ webSearch: true, multiTurnTools: true })));
    const params = create.mock.calls[0]![0] as unknown as { messages: { role: string; content: unknown }[]; tools: unknown };
    expect(params.messages[1]).toEqual({ role: 'assistant', content: 'Hi!' });
    expect(params.messages[2]!.content).toEqual([
      { type: 'text', text: 'Look at these' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } },
      { type: 'document', title: 'a.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' } },
    ]);
    expect(params.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
  });

  it('normalizes text, thinking, search results, citations and usage', async () => {
    const { client } = mockClient([
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret plan' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', name: 'web_search', input: {} } },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A', encrypted_content: 'x', page_age: null }],
        },
      },
      { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'The answer' } },
      {
        type: 'content_block_delta',
        index: 3,
        delta: {
          type: 'citations_delta',
          citation: { type: 'web_search_result_location', url: 'https://b.test', title: 'B', cited_text: 'c', encrypted_index: 'e' },
        },
      },
      { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: ' is 42.' } },
      ...stop('end_turn', 600, { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }),
    ]);
    const events = await collect(new AnthropicProvider({ client }).streamChat(baseRequest({ webSearch: true })));
    expect(texts(events)).toBe('The answer is 42.');
    expect(events).toContainEqual({ type: 'reasoning.delta' });
    expect(events).toContainEqual({ type: 'tool.started', tool: 'web_search' });
    expect(events.flatMap((e) => (e.type === 'tool.sources' ? e.sources : []))).toEqual([
      { url: 'https://a.test', title: 'A' },
      { url: 'https://b.test', title: 'B' },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      stopReason: 'complete',
      usage: { inputTokens: 1000, cachedInputTokens: 300, outputTokens: 350, reasoningTokens: 250, webSearches: 1 },
    });
  });

  it('maps refusal and max_tokens stop reasons', async () => {
    const r = mockClient([start, ...stop('refusal')]);
    const a = await collect(new AnthropicProvider({ client: r.client }).streamChat(baseRequest()));
    expect(a.map((e) => e.type)).toEqual(['refusal', 'done']);
    expect(a.at(-1)).toMatchObject({ stopReason: 'refusal' });

    const m = mockClient([start, ...stop('max_tokens')]);
    const b = await collect(new AnthropicProvider({ client: m.client }).streamChat(baseRequest()));
    expect(b.at(-1)).toMatchObject({ stopReason: 'max_tokens' });
  });

  it('reports partial usage when the stream breaks', async () => {
    async function* broken() {
      yield start;
      throw Object.assign(new Error('overloaded'), { status: 529 });
    }
    const client = { messages: { create: vi.fn(async () => broken()) } } as unknown as Anthropic;
    const events = await collect(new AnthropicProvider({ client }).streamChat(baseRequest()));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: 'The provider had an internal error (529).',
      usage: { inputTokens: 1000, cachedInputTokens: 300 },
    });
  });
});
