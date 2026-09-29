import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { baseRequest, collect, stream, texts } from './helpers.js';

function mockClient(events: unknown[]) {
  const create = vi.fn(async (_params: Record<string, unknown>, _opts?: unknown) => stream(events));
  const client = { responses: { create }, models: { list: () => stream([{ id: 'gpt-a' }, { id: 'gpt-b' }]) } };
  return { client: client as unknown as OpenAI, create };
}

const usage = {
  input_tokens: 1000,
  input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
  output_tokens: 500,
  output_tokens_details: { reasoning_tokens: 100 },
  total_tokens: 1500,
};

describe('OpenAIProvider', () => {
  it('is unconfigured without a key and yields an error instead of throwing', async () => {
    const p = new OpenAIProvider({});
    expect(p.isConfigured()).toBe(false);
    expect(await collect(p.streamChat(baseRequest()))).toEqual([{ type: 'error', message: 'OpenAI is not configured.' }]);
    expect(await p.listModels()).toEqual([]);
  });

  it('maps the request: instructions, effort, web search, image and PDF parts', async () => {
    const { client, create } = mockClient([{ type: 'response.completed', response: { usage } }]);
    const p = new OpenAIProvider({ client });
    await collect(p.streamChat(baseRequest({ effort: 'high', webSearch: true })));
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: 'test-model',
      instructions: 'You are helpful.',
      stream: true,
      store: false,
      max_output_tokens: 1000,
      reasoning: { effort: 'high' },
      tools: [{ type: 'web_search' }],
    });
    const input = params.input as { role: string; content: unknown }[];
    expect(input[1]).toEqual({ role: 'assistant', content: 'Hi!' });
    expect(input[2]!.content).toEqual([
      { type: 'input_text', text: 'Look at these' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1n' },
      { type: 'input_file', filename: 'a.pdf', file_data: 'data:application/pdf;base64,cGRm' },
    ]);
  });

  it('omits reasoning when the model has no effort control', async () => {
    const { client, create } = mockClient([{ type: 'response.completed', response: { usage } }]);
    await collect(new OpenAIProvider({ client }).streamChat(baseRequest()));
    expect(create.mock.calls[0]![0]).not.toHaveProperty('reasoning');
  });

  it('normalizes text, reasoning, web search sources and usage', async () => {
    const { client } = mockClient([
      { type: 'response.output_item.added', item: { type: 'reasoning' } },
      { type: 'response.web_search_call.in_progress' },
      {
        type: 'response.output_item.done',
        item: { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://a.test' }] } },
      },
      { type: 'response.output_text.delta', delta: 'Hello ' },
      { type: 'response.output_text.delta', delta: 'world' },
      {
        type: 'response.output_text.annotation.added',
        annotation: { type: 'url_citation', url: 'https://b.test', title: 'B', start_index: 0, end_index: 1 },
      },
      {
        type: 'response.output_text.annotation.added',
        annotation: { type: 'url_citation', url: 'https://b.test', title: 'B', start_index: 2, end_index: 3 },
      },
      { type: 'response.completed', response: { usage } },
    ]);
    const events = await collect(new OpenAIProvider({ client }).streamChat(baseRequest({ webSearch: true })));
    expect(texts(events)).toBe('Hello world');
    expect(events).toContainEqual({ type: 'reasoning.delta' });
    expect(events).toContainEqual({ type: 'tool.started', tool: 'web_search' });
    const sources = events.flatMap((e) => (e.type === 'tool.sources' ? e.sources : []));
    expect(sources).toEqual([{ url: 'https://a.test' }, { url: 'https://b.test', title: 'B' }]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'complete',
      usage: { inputTokens: 800, cachedInputTokens: 200, outputTokens: 400, reasoningTokens: 100, webSearches: 1 },
      rawUsage: usage,
    });
  });

  it('maps incomplete responses to max_tokens or refusal', async () => {
    const maxed = mockClient([
      { type: 'response.incomplete', response: { usage, incomplete_details: { reason: 'max_output_tokens' } } },
    ]);
    const a = await collect(new OpenAIProvider({ client: maxed.client }).streamChat(baseRequest()));
    expect(a.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_tokens' });

    const filtered = mockClient([
      { type: 'response.incomplete', response: { usage, incomplete_details: { reason: 'content_filter' } } },
    ]);
    const b = await collect(new OpenAIProvider({ client: filtered.client }).streamChat(baseRequest()));
    expect(b.map((e) => e.type)).toEqual(['refusal', 'done']);
    expect(b.at(-1)).toMatchObject({ stopReason: 'refusal' });
  });

  it('reports refusal content as a refusal stop', async () => {
    const { client } = mockClient([
      { type: 'response.refusal.delta', delta: "I can't help with that." },
      { type: 'response.completed', response: { usage } },
    ]);
    const events = await collect(new OpenAIProvider({ client }).streamChat(baseRequest()));
    expect(events[0]).toEqual({ type: 'refusal' });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'refusal' });
  });

  it('turns SDK failures into a safe error without leaking keys', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('Incorrect API key provided: sk-proj-abcdef123456'), { status: 400 });
    });
    const p = new OpenAIProvider({ client: { responses: { create } } as unknown as OpenAI });
    const [ev] = await collect(p.streamChat(baseRequest()));
    expect(ev!.type).toBe('error');
    expect(JSON.stringify(ev)).not.toContain('abcdef123456');
  });

  it('lists model ids', async () => {
    const { client } = mockClient([]);
    expect(await new OpenAIProvider({ client }).listModels()).toEqual(['gpt-a', 'gpt-b']);
  });
});
